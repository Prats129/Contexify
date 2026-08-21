import uuid
import random
from datetime import datetime
from typing import List, Optional
from app.db.database import get_db_connection
from app.schemas.user import UserResponse, UserLoginRequest
from app.core.logging import logger

AVATAR_COLORS = [
    "#3B82F6", "#10B981", "#8B5CF6", "#F59E0B", "#EC4899", "#06B6D4", "#6366F1"
]

class UserService:
    """User account management service with SQLite persistence."""
    
    def get_or_create_user(self, req: UserLoginRequest) -> UserResponse:
        username = req.username.strip().lower()
        email = req.email.strip().lower() if req.email else f"{username}@contexify.ai"
        display_name = req.display_name.strip() if req.display_name else req.username.strip()
        
        with get_db_connection() as conn:
            cursor = conn.cursor()
            
            # Check existing by username or email
            cursor.execute(
                "SELECT id, username, email, display_name, avatar_color, created_at FROM users WHERE username = ? OR email = ?",
                (username, email)
            )
            row = cursor.fetchone()
            if row:
                return UserResponse(
                    id=row["id"],
                    username=row["username"],
                    email=row["email"],
                    display_name=row["display_name"],
                    avatar_color=row["avatar_color"],
                    created_at=row["created_at"]
                )
            
            # Create new user
            user_id = str(uuid.uuid4())
            avatar_color = random.choice(AVATAR_COLORS)
            created_at = datetime.utcnow().isoformat()
            
            cursor.execute(
                """
                INSERT INTO users (id, username, email, display_name, avatar_color, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (user_id, username, email, display_name, avatar_color, created_at)
            )
            
            logger.info(f"Created new user account: {username} ({user_id})")
            return UserResponse(
                id=user_id,
                username=username,
                email=email,
                display_name=display_name,
                avatar_color=avatar_color,
                created_at=created_at
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

    def list_users(self) -> List[UserResponse]:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT id, username, email, display_name, avatar_color, created_at FROM users ORDER BY created_at DESC")
            rows = cursor.fetchall()
            return [
                UserResponse(
                    id=row["id"],
                    username=row["username"],
                    email=row["email"],
                    display_name=row["display_name"],
                    avatar_color=row["avatar_color"],
                    created_at=row["created_at"]
                )
                for row in rows
            ]

user_service = UserService()
