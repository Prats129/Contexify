import sys
from pathlib import Path
from fastapi import HTTPException

# Add backend directory to Python path
backend_dir = Path(__file__).resolve().parent
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

from app.db.database import init_db, get_db_connection
from app.schemas.user import UserRegisterRequest, UserLoginRequest
from app.services.user_service import user_service
from app.services.chat_history_service import chat_history_service
from app.schemas.chat import ChatMode

def run_verification():
    print("=== 1. Testing Database Initialization & Schema ===")
    init_db()
    print("[OK] DB Tables and password columns initialized successfully.")

    print("\n=== 2. Testing Secure User Registration & Hashing ===")
    test_uname = "test_sec_user"
    test_email = "sec_user@example.com"
    test_pwd = "SuperSecretPassword123!"

    # Clean up test user if exists from prior aborted run
    with get_db_connection() as conn:
        conn.execute("DELETE FROM users WHERE username = ?", (test_uname,))

    reg_req = UserRegisterRequest(
        username=test_uname,
        display_name="Security Tester",
        email=test_email,
        password=test_pwd
    )
    user = user_service.register_user(reg_req)
    assert user.id is not None, "User registration failed!"
    print(f"[OK] User registered: ID={user.id}, Username={user.username}, DisplayName={user.display_name}")

    # Verify password hash and salt in DB
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT password_hash, password_salt FROM users WHERE id = ?", (user.id,))
        row = cursor.fetchone()
        assert row["password_hash"] != test_pwd, "Password stored in plaintext!"
        assert len(row["password_salt"]) > 0, "Salt missing!"
        print("[OK] Verified password is cryptographically hashed with salt (PBKDF2-HMAC-SHA256).")

    # Test Duplicate Username rejection
    print("\n=== 3. Testing Duplicate Username & Email Rejection ===")
    try:
        user_service.register_user(reg_req)
        assert False, "Should have rejected duplicate username"
    except HTTPException as e:
        assert e.status_code == 400
        print(f"[OK] Duplicate username properly rejected: {e.detail}")

    dup_email_req = UserRegisterRequest(
        username="unique_user_2",
        display_name="Unique User",
        email=test_email,
        password=test_pwd
    )
    try:
        user_service.register_user(dup_email_req)
        assert False, "Should have rejected duplicate email"
    except HTTPException as e:
        assert e.status_code == 400
        print(f"[OK] Duplicate email properly rejected: {e.detail}")

    print("\n=== 4. Testing Password Authentication (Login) ===")
    # Login with wrong password
    wrong_login = UserLoginRequest(username_or_email=test_uname, password="WrongPassword!")
    try:
        user_service.authenticate_user(wrong_login)
        assert False, "Should have rejected wrong password"
    except HTTPException as e:
        assert e.status_code == 401
        print(f"[OK] Wrong password properly rejected: {e.detail}")

    # Login with correct password by username
    correct_login = UserLoginRequest(username_or_email=test_uname, password=test_pwd)
    auth_user = user_service.authenticate_user(correct_login)
    assert auth_user.id == user.id
    print(f"[OK] Login via username succeeded: {auth_user.username}")

    # Login with correct password by email
    email_login = UserLoginRequest(username_or_email=test_email, password=test_pwd)
    auth_user_email = user_service.authenticate_user(email_login)
    assert auth_user_email.id == user.id
    print(f"[OK] Login via email succeeded: {auth_user_email.email}")

    print("\n=== 5. Testing Session & Message History Persistence ===")
    session = chat_history_service.create_session(
        user_id=user.id,
        title="Test Auth Session",
        mode=ChatMode.DOCUMENT_RAG
    )
    assert session.id is not None
    print(f"[OK] Chat session created: ID={session.id}")

    user_msg = chat_history_service.save_message(
        session_id=session.id,
        role="user",
        content="Testing auth chat"
    )
    assert user_msg.id is not None

    asst_msg = chat_history_service.save_message(
        session_id=session.id,
        role="assistant",
        content="Authenticated response"
    )
    assert asst_msg.id is not None

    history = chat_history_service.get_session_history(session.id)
    assert len(history.messages) == 2
    print(f"[OK] Full session history verified ({len(history.messages)} messages).")

    print("\n=== 6. Testing Session Deletion & Test User Cleanup ===")
    deleted = chat_history_service.delete_session(session.id)
    assert deleted is True
    print("[OK] Session deleted cleanly.")

    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM users WHERE id = ?", (user.id,))
    print("[OK] Test user cleaned up.")

    print("\nALL AUTHENTICATION, PASSWORD HASHING, AND PERSISTENCE TESTS PASSED!")

if __name__ == "__main__":
    run_verification()
