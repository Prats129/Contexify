from fastapi import APIRouter, HTTPException, status
from typing import List, Optional
from app.schemas.user import UserLoginRequest, UserResponse
from app.services.user_service import user_service

router = APIRouter()

@router.post("/login-or-register", response_model=UserResponse, status_code=status.HTTP_200_OK)
async def login_or_register(req: UserLoginRequest):
    """
    Sign in or automatically register a user by username and optional email/display name.
    """
    if not req.username or len(req.username.strip()) < 2:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Username must be at least 2 characters long."
        )
    return user_service.get_or_create_user(req)

@router.get("/me", response_model=UserResponse)
async def get_current_user(user_id: str):
    """
    Get user profile details by user ID.
    """
    user = user_service.get_user_by_id(user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found.")
    return user

@router.get("/list", response_model=List[UserResponse])
async def list_users():
    """
    List all registered users.
    """
    return user_service.list_users()
