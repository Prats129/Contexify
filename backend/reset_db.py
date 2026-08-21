import os
import shutil
import sys
from pathlib import Path

# Add backend to path
backend_dir = Path(__file__).resolve().parent
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

from app.core.config import settings
from app.repositories.vector_store import vector_store_repo
from app.db.database import get_db_connection, init_db

def clear_chroma():
    print("[1/3] Clearing ChromaDB vector store...")
    try:
        vector_store_repo.clear_all()
        print("  [OK] ChromaDB collection cleared and recreated empty.")
    except Exception as e:
        print(f"  [ERROR] Failed to clear ChromaDB via client: {e}")

def clear_uploads():
    print("[2/3] Cleaning temporary uploaded files...")
    try:
        upload_dir = settings.UPLOAD_DIR
        if upload_dir.exists():
            for item in upload_dir.iterdir():
                if item.is_file():
                    item.unlink()
                elif item.is_dir():
                    shutil.rmtree(item)
        print("  [OK] Uploads directory cleaned.")
    except Exception as e:
        print(f"  [ERROR] Failed to clean uploads: {e}")

def clear_sqlite():
    print("[3/3] Clearing relational database documents and message history...")
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("DELETE FROM documents;")
            cursor.execute("DELETE FROM messages;")
            cursor.execute("DELETE FROM chat_sessions;")
            cursor.execute("DELETE FROM users;")
        print("  [OK] SQLite documents, messages, sessions, and users cleared.")
    except Exception as e:
        print(f"  [ERROR] SQLite error: {e}")

if __name__ == "__main__":
    print("=== Contexify Database Reset Tool ===")
    clear_chroma()
    clear_uploads()
    clear_sqlite()
    print("\n[SUCCESS] All ChromaDB vectors, document records, and chat history have been wiped cleanly!")
