import os
import uuid
import random
import hashlib
import secrets
from datetime import datetime
from typing import Optional
from fastapi import HTTPException, status
from app.db.database import get_db_connection
from app.schemas.user import UserResponse, UserRegisterRequest, UserLoginRequest
from app.core.logging import logger

AVATAR_COLORS = [
    "#3B82F6", "#10B981", "#8B5CF6", "#F59E0B", "#EC4899", "#06B6D4", "#6366F1"
]

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
    calculated_hash = hash_password(plain_password, salt)
    return secrets.compare_digest(calculated_hash, password_hash)

class UserService:
    """User account authentication and management service with salted PBKDF2 hashing."""

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
                INSERT INTO users (id, username, email, display_name, password_hash, password_salt, avatar_color, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
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
                created_at=created_at
            )

    def authenticate_user(self, req: UserLoginRequest) -> UserResponse:
        identifier = req.username_or_email.strip().lower()

        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                SELECT id, username, email, display_name, password_hash, password_salt, avatar_color, created_at
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
                created_at=row["created_at"]
            )

    def get_user_by_id(self, user_id: str) -> Optional[UserResponse]:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                "SELECT id, username, email, display_name, avatar_color, created_at FROM users WHERE id = ?",
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
                created_at=row["created_at"]
            )

    def update_user_profile(
        self,
        user_id: str,
        display_name: Optional[str] = None,
        avatar_color: Optional[str] = None
    ) -> UserResponse:
        """Update display name and/or avatar color for a user."""
        user = self.get_user_by_id(user_id)
        if not user:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="User account not found."
            )

        new_display_name = display_name.strip() if display_name else user.display_name
        new_avatar_color = avatar_color.strip() if avatar_color else (user.avatar_color or "#3B82F6")

        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                UPDATE users
                SET display_name = ?, avatar_color = ?
                WHERE id = ?
                """,
                (new_display_name, new_avatar_color, user_id)
            )

        logger.info(f"Updated profile for user '{user.username}' ({user_id})")
        return UserResponse(
            id=user.id,
            username=user.username,
            email=user.email,
            display_name=new_display_name,
            avatar_color=new_avatar_color,
            created_at=user.created_at
        )

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

user_service = UserService()

