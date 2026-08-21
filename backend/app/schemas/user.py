from pydantic import BaseModel, EmailStr, Field
from typing import Optional

class UserBase(BaseModel):
    username: str = Field(..., min_length=2, max_length=50)
    email: str = Field(..., min_length=5, max_length=100)
    display_name: Optional[str] = None
    avatar_color: Optional[str] = "#3B82F6"

class UserCreate(UserBase):
    pass

class UserResponse(UserBase):
    id: str
    created_at: str

    class Config:
        from_attributes = True

class UserLoginRequest(BaseModel):
    username: str = Field(..., min_length=2, max_length=50)
    email: Optional[str] = None
    display_name: Optional[str] = None
