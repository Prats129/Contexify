from pydantic import BaseModel, Field, field_validator
from typing import Optional
import re

EMAIL_REGEX = re.compile(r"^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$")

class UserRegisterRequest(BaseModel):
    username: str = Field(..., min_length=3, max_length=30, description="Unique username")
    display_name: str = Field(..., min_length=2, max_length=50, description="Full Name / Display Name")
    email: str = Field(..., description="Valid unique email address")
    password: str = Field(..., min_length=6, max_length=128, description="Account password (min 6 characters)")

    @field_validator("username")
    @classmethod
    def validate_username(cls, v: str) -> str:
        clean = v.strip().lower()
        if not re.match(r"^[a-zA-Z0-9_]+$", clean):
            raise ValueError("Username may only contain letters, numbers, and underscores.")
        return clean

    @field_validator("display_name")
    @classmethod
    def validate_display_name(cls, v: str) -> str:
        clean = v.strip()
        if len(clean) < 2:
            raise ValueError("Display name must be at least 2 characters long.")
        return clean

    @field_validator("email")
    @classmethod
    def validate_email(cls, v: str) -> str:
        clean = v.strip().lower()
        if not EMAIL_REGEX.match(clean):
            raise ValueError("Invalid email format. Please enter a valid email address.")
        return clean

class UserLoginRequest(BaseModel):
    username_or_email: str = Field(..., min_length=2, description="Registered username or email")
    password: str = Field(..., min_length=1, description="Account password")

    @field_validator("username_or_email")
    @classmethod
    def validate_username_or_email(cls, v: str) -> str:
        return v.strip().lower()

class UserResponse(BaseModel):
    id: str
    username: str
    email: str
    display_name: str
    avatar_color: Optional[str] = "#3B82F6"
    created_at: str

    class Config:
        from_attributes = True

class UserProfileUpdateRequest(BaseModel):
    user_id: str = Field(..., description="ID of the user to update")
    display_name: Optional[str] = Field(None, min_length=2, max_length=50, description="New display name")
    avatar_color: Optional[str] = Field(None, max_length=30, description="Avatar hex color or preset name")

    @field_validator("display_name")
    @classmethod
    def validate_display_name(cls, v: Optional[str]) -> Optional[str]:
        if v is not None:
            clean = v.strip()
            if len(clean) < 2:
                raise ValueError("Display name must be at least 2 characters long.")
            return clean
        return v

class UserPasswordChangeRequest(BaseModel):
    user_id: str = Field(..., description="ID of the user")
    old_password: str = Field(..., min_length=1, description="Current password")
    new_password: str = Field(..., min_length=6, max_length=128, description="New password (min 6 characters)")

