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
    avatar_url: Optional[str] = None
    created_at: str

    class Config:
        from_attributes = True

class UserProfileUpdateRequest(BaseModel):
    user_id: str = Field(..., description="ID of the user to update")
    display_name: Optional[str] = Field(None, min_length=2, max_length=50, description="New display name")
    avatar_color: Optional[str] = Field(None, max_length=30, description="Avatar hex color or preset name")
    avatar_url: Optional[str] = Field(None, description="Custom avatar image URL or relative path")

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

class SendOtpRequest(BaseModel):
    email_or_username: str = Field(..., min_length=2, description="Registered email or username")

    @field_validator("email_or_username")
    @classmethod
    def validate_identifier(cls, v: str) -> str:
        clean = v.strip().lower()
        if not clean:
            raise ValueError("Email or username is required.")
        return clean

class SendOtpResponse(BaseModel):
    message: str
    email: str
    masked_email: str
    expires_in_seconds: int
    cooldown_seconds: int

class VerifyOtpLoginRequest(BaseModel):
    email_or_username: str = Field(..., min_length=2, description="Registered email or username")
    otp: str = Field(..., min_length=6, max_length=6, description="6-digit verification code")

    @field_validator("email_or_username")
    @classmethod
    def validate_identifier(cls, v: str) -> str:
        return v.strip().lower()

    @field_validator("otp")
    @classmethod
    def validate_otp(cls, v: str) -> str:
        clean = v.strip()
        if not re.match(r"^\d{6}$", clean):
            raise ValueError("OTP must be a 6-digit numeric code.")
        return clean

class ResetPasswordWithOtpRequest(BaseModel):
    email_or_username: str = Field(..., min_length=2, description="Registered email or username")
    otp: str = Field(..., min_length=6, max_length=6, description="6-digit verification code")
    new_password: str = Field(..., min_length=6, max_length=128, description="New password (min 6 characters)")

    @field_validator("email_or_username")
    @classmethod
    def validate_identifier(cls, v: str) -> str:
        return v.strip().lower()

    @field_validator("otp")
    @classmethod
    def validate_otp(cls, v: str) -> str:
        clean = v.strip()
        if not re.match(r"^\d{6}$", clean):
            raise ValueError("OTP must be a 6-digit numeric code.")
        return clean

class GoogleAuthRequest(BaseModel):
    credential: Optional[str] = Field(default=None, description="Google ID Token JWT")
    email: Optional[str] = Field(default=None, description="Google account email")
    name: Optional[str] = Field(default=None, description="Google account display name")
    picture: Optional[str] = Field(default=None, description="Google avatar image URL")
    google_id: Optional[str] = Field(default=None, description="Google user unique subject ID")

