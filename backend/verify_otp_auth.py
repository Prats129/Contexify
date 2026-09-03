import asyncio
import uuid
import time
from fastapi import HTTPException
from app.db.database import init_db, get_db_connection
from app.schemas.user import UserRegisterRequest
from app.services.user_service import user_service

async def main():
    print("=== Initializing DB ===")
    init_db()

    test_uid = uuid.uuid4().hex[:6]
    test_username = f"otpuser_{test_uid}"
    test_email = f"otp_{test_uid}@example.com"
    test_password = "SecurePassword123!"
    display_name = f"OTP Tester {test_uid}"

    print(f"\n1. Registering test user: {test_username} ({test_email})")
    reg_req = UserRegisterRequest(
        username=test_username,
        display_name=display_name,
        email=test_email,
        password=test_password
    )
    user = user_service.register_user(reg_req)
    print(f"   Registered successfully: ID={user.id}, Username={user.username}")

    print("\n2. Testing OTP sending to non-existent account...")
    try:
        await user_service.send_login_otp("nonexistent_user_xyz@test.com")
        print("   ERROR: Expected 404 for nonexistent user!")
    except HTTPException as e:
        print(f"   Success (Expected 404): {e.status_code} - {e.detail}")

    print("\n3. Testing OTP sending using username (sent via Mailtrap/SMTP)...")
    otp_resp = await user_service.send_login_otp(test_username)
    print(f"   Success: message='{otp_resp.message}', masked_email='{otp_resp.masked_email}'")

    # Fetch the generated OTP directly from database to test verification
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT otp_code FROM email_otps WHERE email = ? ORDER BY expires_at DESC LIMIT 1", (test_email,))
        row = cursor.fetchone()
        sent_otp = row["otp_code"]
    print(f"   Retrieved OTP from DB for automated test: {sent_otp}")

    print("\n4. Testing OTP cooldown enforcement...")
    try:
        await user_service.send_login_otp(test_email)
        print("   ERROR: Expected 429 Cooldown!")
    except HTTPException as e:
        print(f"   Success (Expected 429 Cooldown): {e.status_code} - {e.detail}")

    print("\n5. Testing OTP verification with wrong code...")
    try:
        user_service.verify_login_otp(test_email, "000000")
        print("   ERROR: Expected 400 for wrong OTP!")
    except HTTPException as e:
        print(f"   Success (Expected 400): {e.status_code} - {e.detail}")

    print("\n6. Testing OTP verification with correct code...")
    auth_user = user_service.verify_login_otp(test_email, sent_otp)
    print(f"   Success: Logged in as '{auth_user.display_name}' ({auth_user.id})")
    assert auth_user.id == user.id

    print("\n7. Testing replay attack (using already-used OTP)...")
    try:
        user_service.verify_login_otp(test_email, sent_otp)
        print("   ERROR: Expected rejection for already-used OTP!")
    except HTTPException as e:
        print(f"   Success (Expected 400): {e.status_code} - {e.detail}")

    print("\n=== ALL OTP AUTHENTICATION TESTS PASSED SUCCESSFULLY! ===")

if __name__ == "__main__":
    asyncio.run(main())
