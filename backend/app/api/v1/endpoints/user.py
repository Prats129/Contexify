from fastapi import APIRouter, HTTPException, status, UploadFile, File, Form, Query
from fastapi.responses import FileResponse
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
        avatar_color=req.avatar_color,
        avatar_url=req.avatar_url
    )

@router.post("/avatar", response_model=UserResponse)
async def upload_avatar(
    user_id: str = Form(...),
    file: UploadFile = File(...)
):
    """
    Upload and update a custom user profile picture.
    Maximum file size: 2MB. Allowed formats: PNG, JPG, JPEG, WEBP, GIF.
    """
    file_bytes = await file.read()
    return user_service.save_user_avatar(
        user_id=user_id,
        file_bytes=file_bytes,
        filename=file.filename or "avatar.png"
    )

@router.get("/avatar/{user_id}")
async def get_avatar(user_id: str):
    """
    Serve the user's custom avatar image file.
    """
    path = user_service.get_user_avatar_path(user_id)
    if not path or not path.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Avatar image not found for this user."
        )
    return FileResponse(
        path=path,
        headers={"Cache-Control": "public, max-age=86400"}
    )

@router.delete("/avatar", response_model=UserResponse)
async def delete_avatar(user_id: str = Query(...)):
    """
    Delete the user's custom avatar image and revert to default avatar color.
    """
    return user_service.delete_user_avatar(user_id)

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


