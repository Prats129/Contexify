from fastapi import APIRouter, HTTPException, status
from app.schemas.user import (
    UserRegisterRequest,
    UserLoginRequest,
    UserResponse,
    UserProfileUpdateRequest,
    UserPasswordChangeRequest
)
from app.services.user_service import user_service

router = APIRouter()

@router.post("/register", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
async def register(req: UserRegisterRequest):
    """
    Register a new user account with required display name, username, email, and password.
    """
    return user_service.register_user(req)

@router.post("/login", response_model=UserResponse, status_code=status.HTTP_200_OK)
async def login(req: UserLoginRequest):
    """
    Authenticate an existing user using username/email and password.
    """
    return user_service.authenticate_user(req)

@router.get("/me", response_model=UserResponse)
async def get_current_user(user_id: str):
    """
    Get user profile details by user ID.
    """
    user = user_service.get_user_by_id(user_id)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User account not found."
        )
    return user

@router.patch("/profile", response_model=UserResponse)
async def update_profile(req: UserProfileUpdateRequest):
    """
    Update user display name and/or avatar color.
    """
    return user_service.update_user_profile(
        user_id=req.user_id,
        display_name=req.display_name,
        avatar_color=req.avatar_color
    )

@router.post("/change-password")
async def change_password(req: UserPasswordChangeRequest):
    """
    Change user password with old password verification.
    """
    success = user_service.change_user_password(
        user_id=req.user_id,
        old_password=req.old_password,
        new_password=req.new_password
    )
    return {"message": "Password changed successfully."}

