import os
import uuid
import random
import hashlib
import secrets
import time
from pathlib import Path
from datetime import datetime
from typing import Optional
from fastapi import HTTPException, status
from app.core.config import settings
from app.db.database import get_db_connection
from app.schemas.user import (
    UserResponse,
    UserRegisterRequest,
    UserLoginRequest,
    SendOtpRequest,
    SendOtpResponse,
    VerifyOtpLoginRequest
)
from app.services.email_service import email_service
from app.core.logging import logger

AVATAR_COLORS = [
    "#3B82F6", "#10B981", "#8B5CF6", "#F59E0B", "#EC4899", "#06B6D4", "#6366F1"
]

MAX_AVATAR_SIZE_BYTES = 2 * 1024 * 1024  # 2MB maximum file size
ALLOWED_AVATAR_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".gif"}

def mask_email(email: str) -> str:
    """Mask email for privacy display (e.g., a***x@domain.com)."""
    parts = email.split("@")
    if len(parts) != 2:
        return email
    username, domain = parts
    if len(username) <= 2:
        masked_user = username[0] + "*"
    else:
        masked_user = username[0] + "*" * (len(username) - 2) + username[-1]
    return f"{masked_user}@{domain}"

def hash_password(password: str, salt: str) -> str:
    """
    Hash password using PBKDF2-HMAC-SHA256 with 100,000 iterations and unique salt.
    """
    return hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        salt.encode("utf-8"),
        100000
    ).hex()

def verify_password(plain_password: str, salt: str, password_hash: str) -> bool:
    """
    Constant-time password hash verification against timing attacks.
    """
    calc_hash = hash_password(plain_password, salt)
    return secrets.compare_digest(calc_hash, password_hash)

class UserService:
    """
    User Management Service handling Registration, Login, Profile updates,
    and Avatar image uploads.
    """

    def register_user(self, req: UserRegisterRequest) -> UserResponse:
        username = req.username.strip().lower()
        email = req.email.strip().lower()
        display_name = req.display_name.strip()

        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 1. Check duplicate username
            cursor.execute("SELECT id FROM users WHERE username = ?", (username,))
            if cursor.fetchone():
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Username '{username}' is already taken. Please choose another username."
                )

            # 2. Check duplicate email
            cursor.execute("SELECT id FROM users WHERE email = ?", (email,))
            if cursor.fetchone():
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Email '{email}' is already registered. Please sign in instead."
                )

            # 3. Create secure salt and password hash
            salt = secrets.token_hex(16)
            pwd_hash = hash_password(req.password, salt)
            user_id = str(uuid.uuid4())
            avatar_color = random.choice(AVATAR_COLORS)
            created_at = datetime.utcnow().isoformat()

            cursor.execute(
                """
                INSERT INTO users (id, username, email, display_name, password_hash, password_salt, avatar_color, avatar_url, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, '', ?)
                """,
                (user_id, username, email, display_name, pwd_hash, salt, avatar_color, created_at)
            )

            logger.info(f"Successfully registered new user: '{username}' ({user_id})")
            return UserResponse(
                id=user_id,
                username=username,
                email=email,
                display_name=display_name,
                avatar_color=avatar_color,
                avatar_url=None,
                created_at=created_at
            )

    def authenticate_user(self, req: UserLoginRequest) -> UserResponse:
        identifier = req.username_or_email.strip().lower()

        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                SELECT id, username, email, display_name, password_hash, password_salt, avatar_color, avatar_url, created_at
                FROM users
                WHERE username = ? OR email = ?
                """,
                (identifier, identifier)
            )
            row = cursor.fetchone()

            if not row:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Invalid username/email or password."
                )

            stored_salt = row["password_salt"] or ""
            stored_hash = row["password_hash"] or ""

            if not verify_password(req.password, stored_salt, stored_hash):
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Invalid username/email or password."
                )

            logger.info(f"User authenticated successfully: '{row['username']}' ({row['id']})")
            return UserResponse(
                id=row["id"],
                username=row["username"],
                email=row["email"],
                display_name=row["display_name"],
                avatar_color=row["avatar_color"],
                avatar_url=row["avatar_url"] or None,
                created_at=row["created_at"]
            )

    def get_user_by_id(self, user_id: str) -> Optional[UserResponse]:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                "SELECT id, username, email, display_name, avatar_color, avatar_url, created_at FROM users WHERE id = ?",
                (user_id,)
            )
            row = cursor.fetchone()
            if not row:
                return None
            return UserResponse(
                id=row["id"],
                username=row["username"],
                email=row["email"],
                display_name=row["display_name"],
                avatar_color=row["avatar_color"],
                avatar_url=row["avatar_url"] or None,
                created_at=row["created_at"]
            )

    def update_user_profile(
        self,
        user_id: str,
        display_name: Optional[str] = None,
        avatar_color: Optional[str] = None,
        avatar_url: Optional[str] = None
    ) -> UserResponse:
        """Update display name, avatar color, or avatar url for a user."""
        user = self.get_user_by_id(user_id)
        if not user:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="User account not found."
            )

        new_display_name = display_name.strip() if display_name else user.display_name
        new_avatar_color = avatar_color.strip() if avatar_color else (user.avatar_color or "#3B82F6")
        new_avatar_url = avatar_url if avatar_url is not None else (user.avatar_url or "")

        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                UPDATE users
                SET display_name = ?, avatar_color = ?, avatar_url = ?
                WHERE id = ?
                """,
                (new_display_name, new_avatar_color, new_avatar_url, user_id)
            )

        logger.info(f"Updated profile for user '{user.username}' ({user_id})")
        return UserResponse(
            id=user.id,
            username=user.username,
            email=user.email,
            display_name=new_display_name,
            avatar_color=new_avatar_color,
            avatar_url=new_avatar_url or None,
            created_at=user.created_at
        )

    def save_user_avatar(self, user_id: str, file_bytes: bytes, filename: str) -> UserResponse:
        """Save uploaded avatar image file with size and format validation."""
        user = self.get_user_by_id(user_id)
        if not user:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="User account not found."
            )

        # 1. Enforce size limit (2MB)
        if len(file_bytes) > MAX_AVATAR_SIZE_BYTES:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Avatar image size exceeds the maximum limit of 2MB."
            )

        if not file_bytes:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Empty image file provided."
            )

        # 2. Enforce file format
        ext = Path(filename).suffix.lower()
        if ext not in ALLOWED_AVATAR_EXTENSIONS:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid image format '{ext}'. Allowed formats: PNG, JPG, JPEG, WEBP, GIF."
            )

        # 3. Save to storage
        avatars_dir = settings.DATA_DIR / "avatars"
        avatars_dir.mkdir(parents=True, exist_ok=True)

        # Remove previous avatar files for this user
        for old_file in avatars_dir.glob(f"{user_id}.*"):
            try:
                old_file.unlink()
            except Exception:
                pass

        target_file = avatars_dir / f"{user_id}{ext}"
        target_file.write_bytes(file_bytes)

        avatar_url = f"/api/v1/user/avatar/{user_id}?v={int(time.time())}"

        with get_db_connection() as conn:
            conn.execute("UPDATE users SET avatar_url = ? WHERE id = ?", (avatar_url, user_id))

        logger.info(f"Saved custom avatar image for user '{user.username}' ({user_id})")
        return self.get_user_by_id(user_id)

    def delete_user_avatar(self, user_id: str) -> UserResponse:
        """Delete custom avatar image and reset to default avatar color."""
        user = self.get_user_by_id(user_id)
        if not user:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="User account not found."
            )

        avatars_dir = settings.DATA_DIR / "avatars"
        for old_file in avatars_dir.glob(f"{user_id}.*"):
            try:
                old_file.unlink()
            except Exception:
                pass

        with get_db_connection() as conn:
            conn.execute("UPDATE users SET avatar_url = '' WHERE id = ?", (user_id,))

        logger.info(f"Removed custom avatar image for user '{user.username}' ({user_id})")
        return self.get_user_by_id(user_id)

    def get_user_avatar_path(self, user_id: str) -> Optional[Path]:
        """Find the avatar image file path for a user."""
        avatars_dir = settings.DATA_DIR / "avatars"
        for f in avatars_dir.glob(f"{user_id}.*"):
            if f.is_file():
                return f
        return None

    def change_user_password(
        self,
        user_id: str,
        old_password: str,
        new_password: str
    ) -> bool:
        """Change user password after verifying the old password."""
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                "SELECT password_salt, password_hash, username FROM users WHERE id = ?",
                (user_id,)
            )
            row = cursor.fetchone()
            if not row:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="User account not found."
                )

            stored_salt = row["password_salt"] or ""
            stored_hash = row["password_hash"] or ""

            if not verify_password(old_password, stored_salt, stored_hash):
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Current password is incorrect."
                )

            if len(new_password) < 6:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="New password must be at least 6 characters long."
                )

            new_salt = secrets.token_hex(16)
            new_hash = hash_password(new_password, new_salt)

            cursor.execute(
                "UPDATE users SET password_hash = ?, password_salt = ? WHERE id = ?",
                (new_hash, new_salt, user_id)
            )
            logger.info(f"Password changed successfully for user '{row['username']}' ({user_id})")
            return True

    async def send_login_otp(self, identifier: str) -> SendOtpResponse:
        """
        Generate and send a 6-digit OTP to the registered user's email address.
        """
        clean_id = identifier.strip().lower()

        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                SELECT id, username, email, display_name
                FROM users
                WHERE username = ? OR email = ?
                """,
                (clean_id, clean_id)
            )
            user = cursor.fetchone()

            if not user:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"No registered account found matching '{clean_id}'. Please check your spelling or register a new account."
                )

            user_email = user["email"]
            user_display_name = user["display_name"]
            now_ts = time.time()

            # Enforce cooldown on recent active OTP requests
            cursor.execute(
                """
                SELECT expires_at, created_at, is_used
                FROM email_otps
                WHERE email = ? AND is_used = 0
                ORDER BY expires_at DESC
                LIMIT 1
                """,
                (user_email,)
            )
            latest_otp = cursor.fetchone()

            if latest_otp:
                # Calculate time since this OTP was issued based on expires_at - OTP_EXPIRY_SECONDS
                issued_at = float(latest_otp["expires_at"]) - settings.OTP_EXPIRY_SECONDS
                elapsed = now_ts - issued_at
                if elapsed < settings.OTP_RESEND_COOLDOWN_SECONDS:
                    wait_sec = int(settings.OTP_RESEND_COOLDOWN_SECONDS - elapsed)
                    raise HTTPException(
                        status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                        detail=f"A code was recently sent. Please wait {wait_sec} seconds before requesting a new code."
                    )

            # Invalidate all prior unused OTPs for this email
            cursor.execute(
                "UPDATE email_otps SET is_used = 1 WHERE email = ? AND is_used = 0",
                (user_email,)
            )

            # Generate fresh 6-digit OTP
            otp_code = f"{secrets.randbelow(900000) + 100000}"
            otp_id = str(uuid.uuid4())
            expires_at = now_ts + settings.OTP_EXPIRY_SECONDS
            created_at = datetime.utcnow().isoformat()

            cursor.execute(
                """
                INSERT INTO email_otps (id, email, otp_code, expires_at, attempts, is_used, created_at)
                VALUES (?, ?, ?, ?, 0, 0, ?)
                """,
                (otp_id, user_email, otp_code, expires_at, created_at)
            )

        # Dispatch email asynchronously
        sent = await email_service.send_otp_email(
            to_email=user_email,
            otp_code=otp_code,
            display_name=user_display_name
        )

        if settings.SMTP_HOST and not sent:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to send OTP verification email. Please check your SMTP server settings or connection."
            )

        logger.info(f"Dispatched login OTP to '{user_email}' for user '{user['username']}'")
        masked = mask_email(user_email)

        return SendOtpResponse(
            message=f"A 6-digit verification code has been sent to {masked}.",
            email=user_email,
            masked_email=masked,
            expires_in_seconds=settings.OTP_EXPIRY_SECONDS,
            cooldown_seconds=settings.OTP_RESEND_COOLDOWN_SECONDS
        )

    def verify_login_otp(self, identifier: str, otp: str) -> UserResponse:
        """
        Verify the OTP code and return the authenticated UserResponse.
        """
        clean_id = identifier.strip().lower()
        clean_otp = otp.strip()

        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                SELECT id, username, email, display_name, avatar_color, avatar_url, created_at
                FROM users
                WHERE username = ? OR email = ?
                """,
                (clean_id, clean_id)
            )
            user = cursor.fetchone()

            if not user:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"No account found matching '{clean_id}'."
                )

            user_email = user["email"]
            now_ts = time.time()

            cursor.execute(
                """
                SELECT id, otp_code, expires_at, attempts, is_used
                FROM email_otps
                WHERE email = ? AND is_used = 0
                ORDER BY expires_at DESC
                LIMIT 1
                """,
                (user_email,)
            )
            otp_record = cursor.fetchone()

            if not otp_record or float(otp_record["expires_at"]) < now_ts:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Verification code has expired or is invalid. Please request a new code."
                )

            current_attempts = int(otp_record["attempts"])
            if current_attempts >= settings.OTP_MAX_ATTEMPTS:
                cursor.execute("UPDATE email_otps SET is_used = 1 WHERE id = ?", (otp_record["id"],))
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Too many invalid attempts. This verification code has been revoked. Please request a new code."
                )

            if not secrets.compare_digest(otp_record["otp_code"].strip(), clean_otp):
                new_attempts = current_attempts + 1
                cursor.execute(
                    "UPDATE email_otps SET attempts = ? WHERE id = ?",
                    (new_attempts, otp_record["id"])
                )
                remaining = max(0, settings.OTP_MAX_ATTEMPTS - new_attempts)
                if remaining > 0:
                    detail_msg = f"Invalid verification code. {remaining} attempt{'s' if remaining != 1 else ''} remaining."
                else:
                    cursor.execute("UPDATE email_otps SET is_used = 1 WHERE id = ?", (otp_record["id"],))
                    detail_msg = "Too many invalid attempts. Please request a new code."
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=detail_msg
                )

            # Mark OTP as successfully used
            cursor.execute("UPDATE email_otps SET is_used = 1 WHERE id = ?", (otp_record["id"],))

            logger.info(f"User authenticated successfully via OTP: '{user['username']}' ({user['id']})")
            return UserResponse(
                id=user["id"],
                username=user["username"],
                email=user["email"],
                display_name=user["display_name"],
                avatar_color=user["avatar_color"],
                avatar_url=user["avatar_url"] or None,
                created_at=user["created_at"]
            )

user_service = UserService()

