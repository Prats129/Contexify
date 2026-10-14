import asyncio
import hashlib
import random
import re
import secrets
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from fastapi import HTTPException, status

from app.core.config import settings
from app.core.logging import logger
from app.db.database import get_db_connection
from app.schemas.user import (
    GoogleAuthRequest,
    ResetPasswordWithOtpRequest,
    SendOtpResponse,
    UserLoginRequest,
    UserRegisterRequest,
    UserResponse,
    validate_password_strength,
)
from app.services.email_service import email_service
from app.services.google_auth import verify_google_credential
from app.services.storage_service import storage_service

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

        # Validate password strength and anti-cracking rules
        is_valid, err_msg = validate_password_strength(
            req.password,
            username=username,
            email=email,
            display_name=display_name
        )
        if not is_valid:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=err_msg
            )

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
            created_at = datetime.now(timezone.utc).replace(tzinfo=None).isoformat()

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

        # 3. Save locally
        avatars_dir = settings.DATA_DIR / "avatars"
        avatars_dir.mkdir(parents=True, exist_ok=True)

        # Remove previous avatar files for this user locally
        for old_file in avatars_dir.glob(f"{user_id}.*"):
            try:
                old_file.unlink()
            except OSError:
                logger.warning("Could not remove local avatar file", exc_info=True)

        target_file = avatars_dir / f"{user_id}{ext}"
        target_file.write_bytes(file_bytes)

        # 4. Upload to persistent cloud storage (Cloudflare R2 if configured)
        storage_key = f"avatars/{user_id}{ext}"
        if storage_service.is_r2_active:
            for old_ext in ALLOWED_AVATAR_EXTENSIONS:
                if old_ext != ext:
                    try:
                        storage_service.delete_file(f"avatars/{user_id}{old_ext}")
                    except Exception:
                        logger.warning("Could not remove previous cloud avatar", exc_info=True)

        media_map = {
            ".png": "image/png",
            ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg",
            ".webp": "image/webp",
            ".gif": "image/gif"
        }
        content_type = media_map.get(ext, "image/jpeg")

        public_url, _ = storage_service.upload_file(
            file_bytes=file_bytes,
            destination_key=storage_key,
            content_type=content_type
        )

        # Append cache buster parameter to bust browser caches upon update
        cache_buster = f"v={int(time.time())}"
        avatar_url = f"{public_url}&{cache_buster}" if "?" in public_url else f"{public_url}?{cache_buster}"

        with get_db_connection() as conn:
            conn.execute("UPDATE users SET avatar_url = ? WHERE id = ?", (avatar_url, user_id))

        logger.info(f"Saved custom avatar image for user '{user.username}' ({user_id}) -> {avatar_url}")
        updated_user = self.get_user_by_id(user_id)
        if updated_user is None:
            raise HTTPException(status_code=404, detail="User account not found.")
        return updated_user

    def delete_user_avatar(self, user_id: str) -> UserResponse:
        """Delete custom avatar image from disk and cloud storage, resetting to default avatar color."""
        user = self.get_user_by_id(user_id)
        if not user:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="User account not found."
            )

        # Remove local files
        avatars_dir = settings.DATA_DIR / "avatars"
        if avatars_dir.exists():
            for old_file in avatars_dir.glob(f"{user_id}.*"):
                try:
                    old_file.unlink()
                except OSError:
                    logger.warning("Could not remove local avatar file", exc_info=True)

        # Remove from cloud storage
        if storage_service.is_r2_active:
            for ext in ALLOWED_AVATAR_EXTENSIONS:
                try:
                    storage_service.delete_file(f"avatars/{user_id}{ext}")
                except Exception:
                    logger.warning("Could not remove cloud avatar", exc_info=True)

        with get_db_connection() as conn:
            conn.execute("UPDATE users SET avatar_url = '' WHERE id = ?", (user_id,))

        logger.info(f"Removed custom avatar image for user '{user.username}' ({user_id})")
        updated_user = self.get_user_by_id(user_id)
        if updated_user is None:
            raise HTTPException(status_code=404, detail="User account not found.")
        return updated_user

    def get_user_avatar_path(self, user_id: str) -> Optional[Path]:
        """
        Find the avatar image file path for a user.
        If missing locally (e.g. after container restart), attempts to self-heal
        and restore from persistent object storage (Cloudflare R2).
        """
        avatars_dir = settings.DATA_DIR / "avatars"
        avatars_dir.mkdir(parents=True, exist_ok=True)

        # 1. Fast path: check local disk cache
        for f in avatars_dir.glob(f"{user_id}.*"):
            if f.is_file() and f.stat().st_size > 0:
                return f

        # 2. Resilient path: check Cloudflare R2 and self-heal local cache
        if storage_service.is_r2_active and storage_service._s3_client:
            try:
                resp = storage_service._s3_client.list_objects_v2(
                    Bucket=settings.CLOUDFLARE_R2_BUCKET_NAME,
                    Prefix=f"avatars/{user_id}.",
                    MaxKeys=1
                )
                contents = resp.get("Contents", [])
                if contents:
                    found_key = contents[0]["Key"]
                    data = storage_service.download_owned_file(found_key, max_bytes=MAX_AVATAR_SIZE_BYTES)
                    if data:
                        ext = Path(found_key).suffix.lower()
                        cached_file = avatars_dir / f"{user_id}{ext}"
                        cached_file.write_bytes(data)
                        logger.info(f"Self-healed missing local avatar for user {user_id} from R2 ({found_key})")
                        return cached_file
            except Exception as e:
                logger.warning(f"Failed to query R2 storage for avatar of user {user_id}: {e}", exc_info=True)

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

            # Prevent reusing current password as new password
            if verify_password(new_password, stored_salt, stored_hash):
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="New password cannot be the same as your current password. Please choose a different password."
                )

            is_valid, err_msg = validate_password_strength(
                new_password,
                username=row["username"]
            )
            if not is_valid:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=err_msg
                )

            new_salt = secrets.token_hex(16)
            new_hash = hash_password(new_password, new_salt)

            cursor.execute(
                "UPDATE users SET password_hash = ?, password_salt = ? WHERE id = ?",
                (new_hash, new_salt, user_id)
            )
            logger.info(f"Password changed successfully for user '{row['username']}' ({user_id})")
            return True

    async def _send_otp(self, identifier: str, purpose: str) -> SendOtpResponse:
        clean_id = identifier.strip().lower()
        now = time.time()
        otp_id = str(uuid.uuid4())
        otp_code = f"{secrets.randbelow(900000) + 100000}"
        with get_db_connection(write=True) as conn:
            user = conn.execute(
                "SELECT email, display_name FROM users WHERE username = ? OR email = ?",
                (clean_id, clean_id),
            ).fetchone()
            if not user:
                raise HTTPException(404, "No registered account found.")
            email = user["email"]
            # Both purposes and failed deliveries share the provider-spend budget.
            recent = conn.execute(
                "SELECT COUNT(*) AS total, MAX(requested_at) AS latest FROM email_otps "
                "WHERE email = ? AND requested_at > ?", (email, now - 3600),
            ).fetchone()
            if recent["latest"] is not None and now - float(recent["latest"]) < settings.OTP_RESEND_COOLDOWN_SECONDS:
                raise HTTPException(429, "A code was recently requested. Please wait before requesting another.")
            if int(recent["total"]) >= settings.OTP_MAX_SENDS_PER_HOUR:
                raise HTTPException(429, "Too many code requests. Please try again later.")
            conn.execute(
                "UPDATE email_otps SET is_used = 1 WHERE email = ? AND purpose = ? AND is_used = 0",
                (email, purpose),
            )
            conn.execute(
                "INSERT INTO email_otps "
                "(id,email,otp_code,expires_at,attempts,is_used,created_at,purpose,delivery_status,requested_at) "
                "VALUES (?,?,?,?,0,0,?,?, 'pending',?)",
                (otp_id, email, hash_password(otp_code, otp_id), now + settings.OTP_EXPIRY_SECONDS,
                 datetime.now(timezone.utc).replace(tzinfo=None).isoformat(), purpose, now),
            )
        # Never hold a database transaction open while contacting the provider.
        sender = email_service.send_otp_email if purpose == "login" else email_service.send_password_reset_otp_email
        try:
            delivered = await sender(to_email=email, otp_code=otp_code, display_name=user["display_name"])
        except Exception as exc:  # noqa: BLE001 - provider boundary; never log mail bodies or credentials
            logger.error("OTP email delivery failed (%s)", type(exc).__name__)
            delivered = False
        with get_db_connection(write=True) as conn:
            changed = conn.execute(
                "UPDATE email_otps SET delivery_status = ?, is_used = ? "
                "WHERE id = ? AND delivery_status = 'pending' AND is_used = 0",
                ("sent" if delivered else "failed", 0 if delivered else 1, otp_id),
            ).rowcount
        if not delivered:
            raise HTTPException(503, "Unable to send the verification email. Please try again later.")
        if changed != 1:
            raise HTTPException(409, "This code was superseded. Please use the most recently requested code.")
        masked = mask_email(email)
        return SendOtpResponse(
            message=f"A 6-digit {'password reset' if purpose == 'reset' else 'verification'} code has been sent to {masked}.",
            email=email, masked_email=masked, expires_in_seconds=settings.OTP_EXPIRY_SECONDS,
            cooldown_seconds=settings.OTP_RESEND_COOLDOWN_SECONDS,
        )

    async def send_login_otp(self, identifier: str) -> SendOtpResponse:
        return await self._send_otp(identifier, "login")

    async def send_password_reset_otp(self, identifier: str) -> SendOtpResponse:
        return await self._send_otp(identifier, "reset")

    def _consume_otp(self, conn, email: str, otp: str, purpose: str) -> str | None:
        """Return an error for rejection so attempt updates commit before raising."""
        now = time.time()
        record = conn.execute(
            "SELECT id,otp_code,expires_at,attempts FROM email_otps "
            "WHERE email = ? AND purpose = ? AND delivery_status = 'sent' AND is_used = 0 "
            "ORDER BY requested_at DESC LIMIT 1", (email, purpose),
        ).fetchone()
        invalid = "Verification code has expired or is invalid. Please request a new code."
        if not record:
            return invalid
        if float(record["expires_at"]) <= now or int(record["attempts"]) >= settings.OTP_MAX_ATTEMPTS:
            conn.execute("UPDATE email_otps SET is_used = 1 WHERE id = ?", (record["id"],))
            return invalid
        if not secrets.compare_digest(record["otp_code"], hash_password(otp.strip(), record["id"])):
            attempts = int(record["attempts"]) + 1
            conn.execute(
                "UPDATE email_otps SET attempts = attempts + 1, is_used = ? WHERE id = ? AND is_used = 0",
                (int(attempts >= settings.OTP_MAX_ATTEMPTS), record["id"]),
            )
            remaining = max(0, settings.OTP_MAX_ATTEMPTS - attempts)
            return f"Invalid verification code. {remaining} attempts remaining." if remaining else "Too many invalid attempts. Please request a new code."
        consumed = conn.execute(
            "UPDATE email_otps SET is_used = 1 WHERE id = ? AND is_used = 0 AND attempts < ? AND expires_at > ?",
            (record["id"], settings.OTP_MAX_ATTEMPTS, now),
        ).rowcount
        return None if consumed == 1 else invalid

    def verify_login_otp(self, identifier: str, otp: str) -> UserResponse:
        with get_db_connection(write=True) as conn:
            user = conn.execute(
                "SELECT id,username,email,display_name,avatar_color,avatar_url,created_at "
                "FROM users WHERE username = ? OR email = ?",
                (identifier.strip().lower(), identifier.strip().lower()),
            ).fetchone()
            if not user:
                raise HTTPException(400, "Verification code has expired or is invalid. Please request a new code.")
            error = self._consume_otp(conn, user["email"], otp, "login")
        if error:
            raise HTTPException(400, error)
        return UserResponse(
            id=user["id"], username=user["username"], email=user["email"], display_name=user["display_name"],
            avatar_color=user["avatar_color"], avatar_url=user["avatar_url"] or None, created_at=user["created_at"],
        )

    def reset_password_with_otp(self, req: ResetPasswordWithOtpRequest) -> dict:
        clean_id = req.email_or_username.strip().lower()
        with get_db_connection(write=True) as conn:
            user = conn.execute("SELECT * FROM users WHERE username = ? OR email = ?", (clean_id, clean_id)).fetchone()
            if not user:
                raise HTTPException(400, "Verification code has expired or is invalid. Please request a new code.")
            valid, message = validate_password_strength(
                req.new_password, username=user["username"], email=user["email"], display_name=user["display_name"],
            )
            if not valid:
                raise HTTPException(400, message)
            if user["password_salt"] and verify_password(req.new_password, user["password_salt"], user["password_hash"]):
                raise HTTPException(400, "New password cannot be the same as your current password.")
            error = self._consume_otp(conn, user["email"], req.otp, "reset")
            if not error:
                salt = secrets.token_hex(16)
                conn.execute("UPDATE users SET password_hash = ?, password_salt = ? WHERE id = ?",
                             (hash_password(req.new_password, salt), salt, user["id"]))
        if error:
            raise HTTPException(400, error)
        return {"message": "Password reset successfully. You can now sign in with your new password."}

    async def authenticate_with_google(self, req: GoogleAuthRequest) -> UserResponse:
        """
        Authenticate or automatically register a user via Google Sign-In.
        """
        payload = await asyncio.to_thread(verify_google_credential, req.credential, req.nonce)
        google_email = payload["email"]
        google_name = payload.get("name") or payload.get("given_name")
        google_picture = payload.get("picture")
        google_subject = payload["sub"]

        clean_email = google_email.strip().lower()
        display_name = (google_name or clean_email.split("@")[0]).strip()
        picture_url = (google_picture or "").strip()

        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM users WHERE google_subject = ?", (google_subject,))
            user = cursor.fetchone()
            if not user:
                cursor.execute("SELECT * FROM users WHERE email = ?", (clean_email,))
                user = cursor.fetchone()
                if user:
                    # Google is not authoritative for an arbitrary third-party email.
                    authoritative = clean_email.endswith("@gmail.com") or bool(payload.get("hd"))
                    if user["google_subject"] or not authoritative:
                        raise HTTPException(409, "Sign in with your existing account to verify account ownership.")
                    cursor.execute("UPDATE users SET google_subject = ? WHERE id = ? AND google_subject IS NULL",
                                   (google_subject, user["id"]))
                    if cursor.rowcount != 1:
                        raise HTTPException(409, "Google account linking changed. Please sign in again.")

            if user:
                # Existing user -> Update avatar if not set
                user_id = user["id"]
                current_avatar = user["avatar_url"] or ""
                if picture_url and not current_avatar:
                    cursor.execute("UPDATE users SET avatar_url = ? WHERE id = ?", (picture_url, user_id))
                    current_avatar = picture_url

                logger.info(f"User authenticated via Google: '{user['username']}' ({user_id})")
                return UserResponse(
                    id=user_id,
                    username=user["username"],
                    email=user["email"],
                    display_name=user["display_name"],
                    avatar_color=user["avatar_color"],
                    avatar_url=current_avatar or None,
                    created_at=user["created_at"]
                )

            # New user -> Auto-register with Google profile details
            user_id = str(uuid.uuid4())
            created_at = datetime.now(timezone.utc).replace(tzinfo=None).isoformat()
            avatar_color = random.choice(AVATAR_COLORS)

            # Generate clean, unique username
            base_username = re.sub(r"[^a-zA-Z0-9_]", "", clean_email.split("@")[0])[:15].lower()
            if len(base_username) < 3:
                base_username = f"user_{base_username}"

            final_username = base_username
            cursor.execute("SELECT id FROM users WHERE username = ?", (final_username,))
            if cursor.fetchone():
                final_username = f"{base_username}_{uuid.uuid4().hex[:4]}"

            # Generate random secure password hash & salt
            random_pwd = secrets.token_urlsafe(32)
            pwd_salt = secrets.token_hex(16)
            pwd_hash = hash_password(random_pwd, pwd_salt)

            cursor.execute(
                """
                INSERT INTO users (id, username, email, display_name, password_hash, password_salt, avatar_color, avatar_url, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (user_id, final_username, clean_email, display_name, pwd_hash, pwd_salt, avatar_color, picture_url, created_at)
            )

            cursor.execute("UPDATE users SET google_subject = ? WHERE id = ?", (google_subject, user_id))

            logger.info(f"Successfully auto-registered new user via Google: '{final_username}' ({clean_email})")
            return UserResponse(
                id=user_id,
                username=final_username,
                email=clean_email,
                display_name=display_name,
                avatar_color=avatar_color,
                avatar_url=picture_url or None,
                created_at=created_at
            )

user_service = UserService()

