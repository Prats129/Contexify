import sys
import uuid
from pathlib import Path

# Add backend directory to Python path
backend_dir = Path(__file__).resolve().parent
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

from app.db.database import init_db
from app.schemas.user import UserLoginRequest
from app.services.user_service import user_service
from app.services.chat_history_service import chat_history_service
from app.schemas.chat import ChatMode

def run_verification():
    print("=== 1. Testing Database Initialization ===")
    init_db()
    print("[OK] DB Tables initialized successfully.")

    print("\n=== 2. Testing User Management ===")
    user_req = UserLoginRequest(username="test_alice", email="alice@test.com", display_name="Alice Wonderland")
    user = user_service.get_or_create_user(user_req)
    assert user.id is not None, "User creation failed!"
    print(f"[OK] User created/retrieved: ID={user.id}, Username={user.username}, DisplayName={user.display_name}")

    # Re-login with same username should return same user
    user_again = user_service.get_or_create_user(user_req)
    assert user_again.id == user.id, "User idempotency failed!"
    print("[OK] User retrieval by username idempotency confirmed.")

    print("\n=== 3. Testing Session Management ===")
    session = chat_history_service.create_session(
        user_id=user.id,
        title="Test RAG Session",
        mode=ChatMode.DOCUMENT_RAG
    )
    assert session.id is not None
    print(f"[OK] Chat session created: ID={session.id}, Title='{session.title}'")

    # List sessions for user
    sessions = chat_history_service.list_user_sessions(user.id)
    assert len(sessions) >= 1
    print(f"[OK] User sessions listed: count={len(sessions)}")

    print("\n=== 4. Testing Document Persistence ===")
    doc_id = str(uuid.uuid4())
    doc = chat_history_service.save_document(
        document_id=doc_id,
        user_id=user.id,
        session_id=session.id,
        filename="rag_spec.pdf",
        file_type=".pdf",
        file_size_bytes=45210,
        total_chunks=8
    )
    assert doc.document_id == doc_id
    print(f"[OK] Document saved: ID={doc.document_id}, Filename={doc.filename}, Chunks={doc.total_chunks}")

    docs = chat_history_service.list_session_documents(session.id)
    assert len(docs) == 1
    print(f"[OK] Session documents verified: count={len(docs)}")

    print("\n=== 5. Testing Message & Citation History ===")
    # Save User message
    user_msg = chat_history_service.save_message(
        session_id=session.id,
        role="user",
        content="What is the retrieval threshold used by the system?"
    )
    print(f"[OK] User message saved: ID={user_msg.id}")

    # Save Assistant message with citation
    citation_mock = [{
        "document_id": doc_id,
        "filename": "rag_spec.pdf",
        "page_number": 2,
        "chunk_index": 1,
        "snippet": "The similarity threshold is set to 0.2 by default.",
        "similarity_score": 0.89
    }]
    asst_msg = chat_history_service.save_message(
        session_id=session.id,
        role="assistant",
        content="The system uses a default similarity threshold of 0.2 for retrieval.",
        citations=citation_mock
    )
    print(f"[OK] Assistant message with citation saved: ID={asst_msg.id}")

    # Retrieve full history
    history = chat_history_service.get_session_history(session.id)
    assert len(history.messages) == 2
    assert len(history.documents) == 1
    assert history.messages[1].citations is not None
    assert len(history.messages[1].citations) == 1
    print(f"[OK] Full Session History verified: {len(history.messages)} messages, {len(history.documents)} documents, citations intact.")

    print("\n=== 6. Testing Session Deletion & Cascading ===")
    deleted = chat_history_service.delete_session(session.id)
    assert deleted is True
    post_delete_history = chat_history_service.get_session_history(session.id)
    assert post_delete_history is None
    print("[OK] Session deleted and cascaded clean successfully.")

    # Clean up test user
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM users WHERE id = ?", (user.id,))
    print("[OK] Test user cleaned up.")

    print("\nALL PERSISTENCE AND USER MANAGEMENT TESTS PASSED!")

if __name__ == "__main__":
    run_verification()
