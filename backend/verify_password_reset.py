import asyncio
import uuid
from fastapi import HTTPException
from app.db.database import init_db, get_db_connection
from app.schemas.user import UserRegisterRequest, UserLoginRequest, ResetPasswordWithOtpRequest
from app.services.user_service import user_service

async def main():
    print("=== Testing Password Reset via Email OTP ===")
    init_db()

    test_uid = uuid.uuid4().hex[:6]
    test_username = f"resetuser_{test_uid}"
    test_email = f"reset_{test_uid}@example.com"
    old_password = "OldPassword123!"
    new_password = "BrandNewSecurePassword456!"
    display_name = f"Reset Tester {test_uid}"

    print(f"\n1. Registering test user: {test_username}")
    reg_req = UserRegisterRequest(
        username=test_username,
        display_name=display_name,
        email=test_email,
        password=old_password
    )
    user = user_service.register_user(reg_req)
    print(f"   Registered successfully: ID={user.id}")

    print("\n2. Sending Password Reset OTP...")
    otp_resp = await user_service.send_password_reset_otp(test_username)
    print(f"   Success: {otp_resp.message} (Masked: {otp_resp.masked_email})")

    # Fetch the generated OTP from DB
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT otp_code FROM email_otps WHERE email = ? ORDER BY expires_at DESC LIMIT 1", (test_email,))
        row = cursor.fetchone()
        sent_otp = row["otp_code"]
    print(f"   Fetched OTP from DB: {sent_otp}")

    print("\n3. Testing Password Reset with wrong OTP...")
    try:
        user_service.reset_password_with_otp(
            ResetPasswordWithOtpRequest(
                email_or_username=test_email,
                otp="000000",
                new_password=new_password
            )
        )
        print("   ERROR: Expected 400 for wrong OTP!")
    except HTTPException as e:
        print(f"   Success (Expected 400): {e.status_code} - {e.detail}")

    print("\n4. Testing Password Reset using SAME existing password...")
    try:
        user_service.reset_password_with_otp(
            ResetPasswordWithOtpRequest(
                email_or_username=test_email,
                otp=sent_otp,
                new_password=old_password
            )
        )
        print("   ERROR: Expected 400 for reusing current password!")
    except HTTPException as e:
        print(f"   Success (Expected 400 for same password): {e.status_code} - {e.detail}")

    print("\n5. Testing Password Reset with correct OTP and brand new password...")
    reset_res = user_service.reset_password_with_otp(
        ResetPasswordWithOtpRequest(
            email_or_username=test_username,
            otp=sent_otp,
            new_password=new_password
        )
    )
    print(f"   Success: {reset_res['message']}")

    print("\n5. Testing login with OLD password (should fail)...")
    try:
        user_service.authenticate_user(
            UserLoginRequest(username_or_email=test_username, password=old_password)
        )
        print("   ERROR: Old password should not work!")
    except HTTPException as e:
        print(f"   Success (Expected 401): {e.status_code} - {e.detail}")

    print("\n6. Testing login with NEW password (should succeed)...")
    auth_user = user_service.authenticate_user(
        UserLoginRequest(username_or_email=test_username, password=new_password)
    )
    print(f"   Success: Authenticated as '{auth_user.display_name}' ({auth_user.id})")
    assert auth_user.id == user.id

    print("\n=== ALL PASSWORD RESET TESTS PASSED SUCCESSFULLY! ===")

if __name__ == "__main__":
    asyncio.run(main())
