import asyncio
import uuid
import base64
import json
from app.db.database import init_db
from app.schemas.user import GoogleAuthRequest
from app.services.user_service import user_service

def make_fake_google_jwt(email: str, name: str, picture: str) -> str:
    header = base64.urlsafe_b64encode(json.dumps({"alg": "RS256", "typ": "JWT"}).encode()).decode().rstrip("=")
    payload = base64.urlsafe_b64encode(json.dumps({
        "iss": "https://accounts.google.com",
        "sub": "108347291837491823749",
        "email": email,
        "email_verified": True,
        "name": name,
        "picture": picture
    }).encode()).decode().rstrip("=")
    signature = base64.urlsafe_b64encode(b"fakesignature123").decode().rstrip("=")
    return f"{header}.{payload}.{signature}"

async def main():
    print("=== Testing Google Sign-In & Sign-Up Auth ===")
    init_db()

    test_uid = uuid.uuid4().hex[:6]
    google_email = f"googleuser_{test_uid}@gmail.com"
    google_name = f"Google User {test_uid}"
    google_picture = "https://lh3.googleusercontent.com/a/fakeavatar123"

    fake_jwt = make_fake_google_jwt(google_email, google_name, google_picture)

    print(f"\n1. Testing Google Auto-Registration with new email: {google_email}...")
    user1 = await user_service.authenticate_with_google(
        GoogleAuthRequest(credential=fake_jwt)
    )
    print(f"   Success: Registered user ID={user1.id}, Username='{user1.username}', DisplayName='{user1.display_name}'")
    assert user1.email == google_email
    assert user1.display_name == google_name
    assert user1.avatar_url == google_picture

    print(f"\n2. Testing Google Sign-In with existing email: {google_email}...")
    user2 = await user_service.authenticate_with_google(
        GoogleAuthRequest(credential=fake_jwt)
    )
    print(f"   Success: Authenticated existing user ID={user2.id}, Username='{user2.username}'")
    assert user2.id == user1.id
    assert user2.username == user1.username

    print(f"\n3. Testing Google Auth with direct payload (dev/fallback mode)...")
    dev_email = f"devgoogle_{test_uid}@gmail.com"
    user3 = await user_service.authenticate_with_google(
        GoogleAuthRequest(email=dev_email, name="Dev Tester", picture="https://example.com/pic.png")
    )
    print(f"   Success: Auto-registered dev user ID={user3.id}, Username='{user3.username}'")
    assert user3.email == dev_email

    print("\n=== ALL GOOGLE AUTH TESTS PASSED SUCCESSFULLY! ===")

if __name__ == "__main__":
    asyncio.run(main())
