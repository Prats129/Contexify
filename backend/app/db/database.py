import sqlite3
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Any, List, Optional

from app.core.config import settings
from app.core.logging import logger

DB_FILE = settings.DATA_DIR / "app.db"


def is_turso_configured() -> bool:
    # 1. Check explicit DATABASE_TYPE override
    db_type = (settings.DATABASE_TYPE or "").strip().lower()
    if db_type in ["sqlite", "local"]:
        return False
    if db_type == "turso":
        url = (settings.TURSO_DATABASE_URL or "").strip()
        token = (settings.TURSO_AUTH_TOKEN or "").strip()
        return bool(url and token and not url.startswith("paste_"))

    # 2. Check general DB_MODE (default: "local" uses SQLite)
    db_mode = (settings.DB_MODE or "local").strip().lower()
    if db_mode in ["local", "sqlite", "chroma", "chromadb"]:
        return False
    if db_mode in ["cloud", "turso-pinecone", "turso", "production"]:
        url = (settings.TURSO_DATABASE_URL or "").strip()
        token = (settings.TURSO_AUTH_TOKEN or "").strip()
        return bool(url and token and not url.startswith("paste_"))

    url = (settings.TURSO_DATABASE_URL or "").strip()
    token = (settings.TURSO_AUTH_TOKEN or "").strip()
    return bool(url and token and not url.startswith("paste_"))


def get_turso_url() -> str:
    url = settings.TURSO_DATABASE_URL.strip()
    # The installed SDK only supports interactive transactions over WebSockets.
    if url.startswith("https://"):
        return url.replace("https://", "wss://", 1)
    if url.startswith("http://"):
        return url.replace("http://", "ws://", 1)
    return url


class TursoCursor:
    """DB-API compliant cursor wrapper around libsql_client."""

    def __init__(self, client):
        self._client = client
        self._last_result = None
        self._rows: List[Any] = []
        self._idx = 0
        self.rowcount = 0

    def execute(self, sql: str, params: Optional[Any] = None):
        clean_sql = sql.strip()
        # Skip local-only PRAGMAs that Turso cloud handles automatically
        if clean_sql.upper().startswith(
            "PRAGMA JOURNAL_MODE"
        ) or clean_sql.upper().startswith("PRAGMA FOREIGN_KEYS"):
            self.rowcount = 0
            self._rows = []
            return self

        args = []
        if params is not None:
            if isinstance(params, (list, tuple)):
                args = list(params)
            elif isinstance(params, dict):
                args = params

        try:
            self._last_result = self._client.execute(clean_sql, args)
            self._rows = list(self._last_result.rows) if self._last_result else []
            self.rowcount = getattr(self._last_result, "rows_affected", 0)
            self._idx = 0
        except Exception as e:
            logger.exception(
                f"Turso query error on SQL: {clean_sql[:100]}... Error: {e}"
            )
            raise e
        return self

    def fetchone(self):
        if self._idx < len(self._rows):
            row = self._rows[self._idx]
            self._idx += 1
            return row
        return None

    def fetchall(self):
        remaining = self._rows[self._idx :]
        self._idx = len(self._rows)
        return remaining

    def close(self):
        pass


class TursoConnection:
    """DB-API compliant connection wrapper around libsql_client."""

    def __init__(self, url: str, token: str):
        import libsql_client

        self._client = libsql_client.create_client_sync(url=url, auth_token=token)
        self._transaction = None

    def cursor(self):
        if self._transaction is None:
            self._transaction = self._client.transaction()
        return TursoCursor(self._transaction)

    def execute(self, sql: str, params: Optional[Any] = None):
        cursor = self.cursor()
        cursor.execute(sql, params)
        return cursor

    def commit(self):
        if self._transaction is not None:
            self._transaction.commit()
            self._transaction.close()
            self._transaction = None

    def rollback(self):
        if self._transaction is not None:
            try:
                self._transaction.rollback()
            finally:
                self._transaction.close()
                self._transaction = None

    def close(self):
        try:
            self.rollback()
        except Exception:
            logger.warning("Could not roll back database connection", exc_info=True)
        finally:
            try:
                self._client.close()
            except Exception:
                logger.warning("Could not close database connection", exc_info=True)


def get_db_path() -> Path:
    settings.DATA_DIR.mkdir(parents=True, exist_ok=True)
    return DB_FILE


@contextmanager
def get_db_connection(*, write: bool = False):
    """
    Provide the configured database with commit on success and rollback on error.
    """
    if is_turso_configured():
        conn = TursoConnection(
            url=get_turso_url(), token=settings.TURSO_AUTH_TOKEN.strip()
        )
        try:
            if write:
                from libsql_client import LibsqlError

                # Acquire the write lock before OTP reads, including on deferred
                # SDK transactions. The empty update changes no challenge rows.
                deadline = time.monotonic() + 20
                while True:
                    try:
                        conn.execute(
                            "UPDATE email_otps SET attempts = attempts WHERE 0"
                        )
                        break
                    except LibsqlError as exc:
                        if (
                            not exc.code.startswith("SQLITE_BUSY")
                            or time.monotonic() >= deadline
                        ):
                            raise
                        # Only retry lock acquisition, before caller statements.
                        # Never replay writes after an uncertain commit/network error.
                        conn.rollback()
                        time.sleep(0.05)
            yield conn
            conn.commit()
        except Exception as e:
            conn.rollback()
            logger.exception(f"Turso database transaction error: {e}")
            raise
        finally:
            conn.close()
    else:
        db_path = get_db_path()
        conn = sqlite3.connect(str(db_path), timeout=20.0)
        conn.row_factory = sqlite3.Row
        try:
            conn.execute("PRAGMA foreign_keys = ON;")
            conn.execute("PRAGMA journal_mode = WAL;")
            if write:
                conn.execute("BEGIN IMMEDIATE")
            yield conn
            conn.commit()
        except Exception as e:
            conn.rollback()
            logger.exception(f"Local SQLite transaction error: {e}")
            raise
        finally:
            conn.close()


def init_db():
    """
    Initialize database tables, indexes, and run schema migrations if needed.
    """
    if is_turso_configured():
        logger.info(f"Initializing cloud Turso SQLite database ({get_turso_url()})...")
    else:
        logger.info(f"Initializing local SQLite database at {DB_FILE}...")

    with get_db_connection() as conn:
        if not is_turso_configured():
            conn.execute("BEGIN IMMEDIATE")
        cursor = conn.cursor()

        # 1. Users Table with secure password hash & salt
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                username TEXT UNIQUE NOT NULL,
                email TEXT UNIQUE NOT NULL,
                display_name TEXT NOT NULL,
                password_hash TEXT NOT NULL,
                password_salt TEXT NOT NULL,
                avatar_color TEXT DEFAULT '#3B82F6',
                avatar_url TEXT DEFAULT '',
                created_at TEXT NOT NULL
            );
        """)

        # Schema migration check: ensure password & avatar columns exist if table was previously created
        cursor.execute("PRAGMA table_info(users);")
        columns = [row["name"] for row in cursor.fetchall()]
        if "password_hash" not in columns:
            cursor.execute(
                "ALTER TABLE users ADD COLUMN password_hash TEXT DEFAULT '';"
            )
        if "password_salt" not in columns:
            cursor.execute(
                "ALTER TABLE users ADD COLUMN password_salt TEXT DEFAULT '';"
            )
        if "avatar_url" not in columns:
            cursor.execute("ALTER TABLE users ADD COLUMN avatar_url TEXT DEFAULT '';")

        if "google_subject" not in columns:
            cursor.execute("ALTER TABLE users ADD COLUMN google_subject TEXT;")
        cursor.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_subject ON users(google_subject);"
        )

        cursor.execute("""
            CREATE TABLE IF NOT EXISTS auth_sessions (
                token_hash TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                credential_hash TEXT NOT NULL,
                expires_at REAL NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );
        """)
        cursor.execute(
            "CREATE INDEX IF NOT EXISTS idx_auth_expiry ON auth_sessions(expires_at);"
        )
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS download_tickets (
                ticket_hash TEXT PRIMARY KEY,
                token_hash TEXT NOT NULL,
                asset_id TEXT NOT NULL,
                kind TEXT NOT NULL,
                expires_at REAL NOT NULL,
                FOREIGN KEY (token_hash) REFERENCES auth_sessions(token_hash) ON DELETE CASCADE
            );
        """)
        cursor.execute(
            "CREATE INDEX IF NOT EXISTS idx_download_expiry ON download_tickets(expires_at);"
        )

        # 2. Chat Sessions Table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS chat_sessions (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                title TEXT NOT NULL,
                mode TEXT NOT NULL DEFAULT 'AUTO',
                is_temporary INTEGER DEFAULT 0,
                expires_at TEXT,
                is_pinned INTEGER DEFAULT 0,
                pinned_at TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                history_version INTEGER NOT NULL DEFAULT 0,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );
        """)

        # Schema migration check: ensure is_temporary, expires_at, is_pinned, pinned_at exist
        cursor.execute("PRAGMA table_info(chat_sessions);")
        session_columns = [row["name"] for row in cursor.fetchall()]
        if "is_temporary" not in session_columns:
            cursor.execute(
                "ALTER TABLE chat_sessions ADD COLUMN is_temporary INTEGER DEFAULT 0;"
            )
        if "expires_at" not in session_columns:
            cursor.execute("ALTER TABLE chat_sessions ADD COLUMN expires_at TEXT;")
        if "is_pinned" not in session_columns:
            cursor.execute(
                "ALTER TABLE chat_sessions ADD COLUMN is_pinned INTEGER DEFAULT 0;"
            )
        if "pinned_at" not in session_columns:
            cursor.execute("ALTER TABLE chat_sessions ADD COLUMN pinned_at TEXT;")
        if "history_version" not in session_columns:
            cursor.execute(
                "ALTER TABLE chat_sessions ADD COLUMN history_version INTEGER NOT NULL DEFAULT 0"
            )

        # 3. Messages Table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS messages (
                id TEXT PRIMARY KEY,
                session_id TEXT NOT NULL,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                citations_json TEXT,
                attachments_json TEXT DEFAULT '[]',
                reply_to_json TEXT DEFAULT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
            );
        """)

        # Schema migration check: ensure attachments_json & reply_to_json columns exist if table was previously created
        cursor.execute("PRAGMA table_info(messages);")
        message_columns = [row["name"] for row in cursor.fetchall()]
        if "attachments_json" not in message_columns:
            cursor.execute(
                "ALTER TABLE messages ADD COLUMN attachments_json TEXT DEFAULT '[]';"
            )
        if "reply_to_json" not in message_columns:
            cursor.execute(
                "ALTER TABLE messages ADD COLUMN reply_to_json TEXT DEFAULT NULL;"
            )

        # 4. Documents Table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS documents (
                id TEXT PRIMARY KEY,
                user_id TEXT,
                session_id TEXT,
                filename TEXT NOT NULL,
                file_type TEXT NOT NULL,
                file_size_bytes INTEGER NOT NULL,
                total_chunks INTEGER NOT NULL,
                storage_url TEXT DEFAULT '',
                created_at TEXT NOT NULL,
                FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
            );
        """)

        # Migration check: ensure storage_url column exists in documents table
        cursor.execute("PRAGMA table_info(documents);")
        document_columns = [row["name"] for row in cursor.fetchall()]
        if "storage_url" not in document_columns:
            cursor.execute(
                "ALTER TABLE documents ADD COLUMN storage_url TEXT DEFAULT '';"
            )

        # Normal Library documents must survive deletion of their original chat.
        cursor.execute("PRAGMA table_info(documents)")
        if any(
            row["name"] == "session_id" and row["notnull"] for row in cursor.fetchall()
        ):
            cursor.execute("""CREATE TABLE documents_retained (
                id TEXT PRIMARY KEY, user_id TEXT, session_id TEXT,
                filename TEXT NOT NULL, file_type TEXT NOT NULL,
                file_size_bytes INTEGER NOT NULL, total_chunks INTEGER NOT NULL,
                storage_url TEXT DEFAULT '', created_at TEXT NOT NULL,
                FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
            )""")
            cursor.execute(
                "INSERT INTO documents_retained SELECT id,user_id,session_id,filename,file_type,"
                "file_size_bytes,total_chunks,storage_url,created_at FROM documents"
            )
            cursor.execute("DROP TABLE documents")
            cursor.execute("ALTER TABLE documents_retained RENAME TO documents")

        # No cascading foreign keys: cleanup intents must survive parent deletion
        # and remain retryable after provider failures or process restarts.
        cursor.execute("""CREATE TABLE IF NOT EXISTS session_deletions (
            session_id TEXT PRIMARY KEY, user_id TEXT NOT NULL,
            requested_at TEXT NOT NULL, completed_at TEXT,
            last_attempt_at REAL NOT NULL DEFAULT 0
        )""")
        # CREATE IF NOT EXISTS does not upgrade tables from earlier releases.
        cursor.execute("PRAGMA table_info(session_deletions)")
        deletion_columns = {row["name"] for row in cursor.fetchall()}
        if "last_attempt_at" not in deletion_columns:
            cursor.execute(
                "ALTER TABLE session_deletions ADD COLUMN last_attempt_at REAL NOT NULL DEFAULT 0"
            )
            cursor.execute("DROP INDEX IF EXISTS idx_deletions_pending")
        cursor.execute(
            "CREATE INDEX IF NOT EXISTS idx_deletions_pending ON session_deletions(completed_at,last_attempt_at,requested_at)"
        )
        cursor.execute("""CREATE TABLE IF NOT EXISTS session_resources (
            session_id TEXT NOT NULL, kind TEXT NOT NULL, resource_key TEXT NOT NULL,
            PRIMARY KEY (session_id,kind,resource_key)
        )""")
        cursor.execute("""CREATE TABLE IF NOT EXISTS session_operations (
            id TEXT PRIMARY KEY, session_id TEXT NOT NULL, expires_at REAL NOT NULL
        )""")
        cursor.execute(
            "CREATE INDEX IF NOT EXISTS idx_operations_session ON session_operations(session_id)"
        )
        cursor.execute("""CREATE TABLE IF NOT EXISTS upload_attempts (
            id TEXT PRIMARY KEY, state TEXT NOT NULL DEFAULT 'pending',
            expires_at REAL NOT NULL, last_attempt_at REAL NOT NULL DEFAULT 0
        )""")
        cursor.execute(
            "CREATE INDEX IF NOT EXISTS idx_upload_cleanup ON upload_attempts(state,expires_at,last_attempt_at)"
        )
        cursor.execute("""CREATE TABLE IF NOT EXISTS upload_resources (
            attempt_id TEXT NOT NULL, session_id TEXT, kind TEXT NOT NULL,
            resource_key TEXT NOT NULL,
            PRIMARY KEY (attempt_id,kind,resource_key),
            FOREIGN KEY (attempt_id) REFERENCES upload_attempts(id) ON DELETE CASCADE
        )""")

        # 5. Media Assets Table (for user uploads and AI generated images)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS media_assets (
                id TEXT PRIMARY KEY,
                user_id TEXT,
                session_id TEXT,
                filename TEXT NOT NULL,
                file_path TEXT NOT NULL,
                file_url TEXT NOT NULL,
                mime_type TEXT NOT NULL,
                file_size_bytes INTEGER DEFAULT 0,
                media_type TEXT NOT NULL DEFAULT 'upload',
                prompt TEXT DEFAULT '',
                created_at TEXT NOT NULL,
                FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
            );
        """)

        # 6. Email OTPs Table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS email_otps (
                id TEXT PRIMARY KEY,
                email TEXT NOT NULL,
                otp_code TEXT NOT NULL,
                expires_at REAL NOT NULL,
                attempts INTEGER DEFAULT 0,
                is_used INTEGER DEFAULT 0,
                created_at TEXT NOT NULL
            );
        """)

        cursor.execute("PRAGMA table_info(email_otps)")
        otp_columns = {row["name"] for row in cursor.fetchall()}
        for name, definition in (
            ("purpose", "TEXT NOT NULL DEFAULT 'legacy'"),
            ("delivery_status", "TEXT NOT NULL DEFAULT 'legacy'"),
            ("requested_at", "REAL NOT NULL DEFAULT 0"),
        ):
            if name not in otp_columns:
                cursor.execute(f"ALTER TABLE email_otps ADD COLUMN {name} {definition}")
        # Existing plaintext codes have no trustworthy purpose; revoke them.
        cursor.execute(
            "UPDATE email_otps SET is_used = 1, otp_code = '' WHERE purpose = 'legacy'"
        )
        cursor.execute(
            "CREATE INDEX IF NOT EXISTS idx_otp_email_requested ON email_otps(email, requested_at)"
        )

        # Indexes for fast querying
        cursor.execute(
            "CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON chat_sessions(user_id);"
        )
        cursor.execute(
            "CREATE INDEX IF NOT EXISTS idx_sessions_user_updated ON chat_sessions(user_id, updated_at DESC);"
        )
        cursor.execute(
            "CREATE INDEX IF NOT EXISTS idx_sessions_user_pinned ON chat_sessions(user_id, is_pinned DESC, created_at DESC);"
        )
        cursor.execute(
            "CREATE INDEX IF NOT EXISTS idx_sessions_temporary ON chat_sessions(is_temporary, expires_at);"
        )
        cursor.execute(
            "CREATE INDEX IF NOT EXISTS idx_messages_session_id ON messages(session_id);"
        )
        cursor.execute(
            "CREATE INDEX IF NOT EXISTS idx_documents_session_id ON documents(session_id);"
        )
        cursor.execute(
            "CREATE INDEX IF NOT EXISTS idx_documents_user_id ON documents(user_id);"
        )
        cursor.execute(
            "CREATE INDEX IF NOT EXISTS idx_documents_created ON documents(created_at DESC);"
        )
        cursor.execute(
            "CREATE INDEX IF NOT EXISTS idx_media_session_id ON media_assets(session_id);"
        )
        cursor.execute(
            "CREATE INDEX IF NOT EXISTS idx_media_user_id ON media_assets(user_id);"
        )
        cursor.execute(
            "CREATE INDEX IF NOT EXISTS idx_media_created ON media_assets(created_at DESC);"
        )
        cursor.execute(
            "CREATE INDEX IF NOT EXISTS idx_email_otps_email ON email_otps(email);"
        )

        logger.info("Database schema initialized successfully.")
