import sqlite3
import os
from pathlib import Path
from contextlib import contextmanager
from app.core.config import settings
from app.core.logging import logger

DB_FILE = settings.DATA_DIR / "app.db"

def get_db_path() -> Path:
    settings.DATA_DIR.mkdir(parents=True, exist_ok=True)
    return DB_FILE

@contextmanager
def get_db_connection():
    """
    Context manager providing a SQLite database connection with row factory
    and write-ahead logging (WAL) for safe concurrency.
    """
    db_path = get_db_path()
    conn = sqlite3.connect(str(db_path), timeout=20.0)
    conn.row_factory = sqlite3.Row
    try:
        # Enable foreign keys and WAL mode
        conn.execute("PRAGMA foreign_keys = ON;")
        conn.execute("PRAGMA journal_mode = WAL;")
        yield conn
        conn.commit()
    except Exception as e:
        conn.rollback()
        logger.error(f"Database transaction error: {e}")
        raise
    finally:
        conn.close()

def init_db():
    """
    Initialize SQLite database tables, indexes, and run migrations if needed.
    """
    logger.info(f"Initializing SQLite database at {DB_FILE}...")
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
        
        # Indexes for fast querying
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON chat_sessions(user_id);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_messages_session_id ON messages(session_id);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_documents_session_id ON documents(session_id);")
        
        logger.info("SQLite database initialized successfully.")
