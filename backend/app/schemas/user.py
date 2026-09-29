from pydantic import BaseModel, Field, field_validator
from typing import Optional, Tuple
import re

EMAIL_REGEX = re.compile(r"^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$")

def validate_password_strength(
    password: str,
    username: Optional[str] = None,
    email: Optional[str] = None,
    display_name: Optional[str] = None
) -> Tuple[bool, Optional[str]]:
    """
    Validate password strength against industry standard requirements:
    1. 8 to 128 characters
    2. At least one lowercase letter (a-z)
    3. At least one uppercase letter (A-Z)
    4. At least one digit (0-9)
    5. At least one special symbol (!@#$%^&*...)
    6. Does not contain 4+ repeated characters in a row
    7. Does not contain the user's username, email prefix, or display name
    """
    if not password:
        return False, "Password is required."

    if len(password) < 8:
        return False, "Password must be at least 8 characters long."
    if len(password) > 128:
        return False, "Password cannot exceed 128 characters."

    if not re.search(r"[a-z]", password):
        return False, "Password must contain at least one lowercase letter (a-z)."

    if not re.search(r"[A-Z]", password):
        return False, "Password must contain at least one uppercase letter (A-Z)."

    if not re.search(r"[0-9]", password):
        return False, "Password must contain at least one numeric digit (0-9)."

    if not re.search(r"[!@#$%^&*()_+\-=\[\]{}|;:,.<>?~`'\"/\\]", password):
        return False, "Password must contain at least one special symbol (!@#$%^&*...)."

    if re.search(r"(.)\1{3,}", password):
        return False, "Password cannot contain 4 or more repeated characters."

    lowered = password.lower()

    if username and len(username.strip()) >= 3:
        if username.strip().lower() in lowered:
            return False, "Password cannot contain your username."

    if email and "@" in email:
        email_prefix = email.split("@")[0].strip().lower()
        if len(email_prefix) >= 3 and email_prefix in lowered:
            return False, "Password cannot contain your email prefix."

    if display_name and len(display_name.strip()) >= 3:
        for part in display_name.strip().lower().split():
            if len(part) >= 3 and part in lowered:
                return False, "Password cannot contain your name."

    return True, None


class UserRegisterRequest(BaseModel):
    username: str = Field(..., min_length=3, max_length=30, description="Unique username")
    display_name: str = Field(..., min_length=2, max_length=50, description="Full Name / Display Name")
    email: str = Field(..., description="Valid unique email address")
    password: str = Field(..., min_length=8, max_length=128, description="Account password (min 8 characters)")

    @field_validator("password")
    @classmethod
    def validate_password(cls, v: str) -> str:
        is_valid, err_msg = validate_password_strength(v)
        if not is_valid:
            raise ValueError(err_msg)
        return v

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
    new_password: str = Field(..., min_length=8, max_length=128, description="New password (min 8 characters)")

    @field_validator("new_password")
    @classmethod
    def validate_new_password(cls, v: str) -> str:
        is_valid, err_msg = validate_password_strength(v)
        if not is_valid:
            raise ValueError(err_msg)
        return v

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
    new_password: str = Field(..., min_length=8, max_length=128, description="New password (min 8 characters)")

    @field_validator("new_password")
    @classmethod
    def validate_new_password(cls, v: str) -> str:
        is_valid, err_msg = validate_password_strength(v)
        if not is_valid:
            raise ValueError(err_msg)
        return v

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

