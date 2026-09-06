import sqlite3
import os
from pathlib import Path
from contextlib import contextmanager
from typing import Any, List, Optional
from app.core.config import settings
from app.core.logging import logger

DB_FILE = settings.DATA_DIR / "app.db"

def is_turso_configured() -> bool:
    url = (settings.TURSO_DATABASE_URL or "").strip()
    token = (settings.TURSO_AUTH_TOKEN or "").strip()
    return bool(url and token and not url.startswith("paste_"))

def get_turso_url() -> str:
    url = settings.TURSO_DATABASE_URL.strip()
    if url.startswith("libsql://"):
        return url.replace("libsql://", "https://", 1)
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
        if clean_sql.upper().startswith("PRAGMA JOURNAL_MODE") or clean_sql.upper().startswith("PRAGMA FOREIGN_KEYS"):
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
            logger.error(f"Turso query error on SQL: {clean_sql[:100]}... Error: {e}")
            raise e
        return self

    def fetchone(self):
        if self._idx < len(self._rows):
            row = self._rows[self._idx]
            self._idx += 1
            return row
        return None

    def fetchall(self):
        remaining = self._rows[self._idx:]
        self._idx = len(self._rows)
        return remaining

    def close(self):
        pass

class TursoConnection:
    """DB-API compliant connection wrapper around libsql_client."""
    def __init__(self, url: str, token: str):
        import libsql_client
        self._client = libsql_client.create_client_sync(url=url, auth_token=token)

    def cursor(self):
        return TursoCursor(self._client)

    def execute(self, sql: str, params: Optional[Any] = None):
        cursor = self.cursor()
        cursor.execute(sql, params)
        return cursor

    def commit(self):
        pass

    def rollback(self):
        pass

    def close(self):
        try:
            self._client.close()
        except Exception:
            pass

def get_db_path() -> Path:
    settings.DATA_DIR.mkdir(parents=True, exist_ok=True)
    return DB_FILE

@contextmanager
def get_db_connection():
    """
    Context manager providing either a cloud Turso database connection
    or a local SQLite connection with automatic fallback.
    """
    if is_turso_configured():
        conn = TursoConnection(url=get_turso_url(), token=settings.TURSO_AUTH_TOKEN.strip())
        try:
            yield conn
            conn.commit()
        except Exception as e:
            conn.rollback()
            logger.error(f"Turso database transaction error: {e}")
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
            yield conn
            conn.commit()
        except Exception as e:
            conn.rollback()
            logger.error(f"Local SQLite transaction error: {e}")
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
            cursor.execute("ALTER TABLE users ADD COLUMN password_hash TEXT DEFAULT '';")
        if "password_salt" not in columns:
            cursor.execute("ALTER TABLE users ADD COLUMN password_salt TEXT DEFAULT '';")
        if "avatar_url" not in columns:
            cursor.execute("ALTER TABLE users ADD COLUMN avatar_url TEXT DEFAULT '';")
        
        # 2. Chat Sessions Table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS chat_sessions (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                title TEXT NOT NULL,
                mode TEXT NOT NULL DEFAULT 'WEB_SEARCH',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );
        """)
        
        # 3. Messages Table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS messages (
                id TEXT PRIMARY KEY,
                session_id TEXT NOT NULL,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                citations_json TEXT,
                created_at TEXT NOT NULL,
                FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
            );
        """)
        
        # 4. Documents Table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS documents (
                id TEXT PRIMARY KEY,
                user_id TEXT,
                session_id TEXT NOT NULL,
                filename TEXT NOT NULL,
                file_type TEXT NOT NULL,
                file_size_bytes INTEGER NOT NULL,
                total_chunks INTEGER NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
            );
        """)
        
        # 5. Email OTPs Table
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

        # Indexes for fast querying
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON chat_sessions(user_id);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_messages_session_id ON messages(session_id);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_documents_session_id ON documents(session_id);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_email_otps_email ON email_otps(email);")
        
        logger.info("Database schema initialized successfully.")
