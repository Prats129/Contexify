from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Query,
    UploadFile,
    status,
)

from app.core.concurrency import run_blocking
from app.core.security import (
    Principal,
    check_user_claim,
    create_guest,
    digest,
    issue_credentials,
    present_user,
    require_principal,
    require_user,
    resolve_principal,
)
from app.db.database import get_db_connection
from app.schemas.user import (
    AuthResponse,
    GoogleAuthRequest,
    GuestAuthResponse,
    ResetPasswordWithOtpRequest,
    SendOtpRequest,
    SendOtpResponse,
    UserLoginRequest,
    UserPasswordChangeRequest,
    UserProfileUpdateRequest,
    UserRegisterRequest,
    UserResponse,
    VerifyOtpLoginRequest,
)
from app.services.image_validation import image_response
from app.services.storage_service import storage_service
from app.services.user_service import MAX_AVATAR_SIZE_BYTES, user_service

router = APIRouter()


def authenticated_response(user):
    credentials = issue_credentials(user.id)
    principal = resolve_principal(digest(credentials["access_token"]))
    return AuthResponse(**present_user(user, principal).model_dump(), **credentials)


@router.get("/auth/google/challenge")
def google_challenge():
    import secrets

    return {"nonce": secrets.token_urlsafe(32)}


@router.post("/guest", response_model=GuestAuthResponse)
def guest_session():
    return create_guest()


@router.post("/logout")
def logout(principal: Principal = Depends(require_principal)):
    with get_db_connection() as conn:
        conn.execute(
            "DELETE FROM download_tickets WHERE token_hash = ?", (principal.token_hash,)
        )
        conn.execute(
            "DELETE FROM auth_sessions WHERE token_hash = ?", (principal.token_hash,)
        )
    return {"message": "Signed out."}


@router.post(
    "/register", response_model=AuthResponse, status_code=status.HTTP_201_CREATED
)
def register(req: UserRegisterRequest):
    """
    Register a new user account with required display name, username, email, and password.
    """
    return authenticated_response(user_service.register_user(req))


@router.post("/login", response_model=AuthResponse, status_code=status.HTTP_200_OK)
def login(req: UserLoginRequest):
    """
    Authenticate an existing user using username/email and password.
    """
    return authenticated_response(user_service.authenticate_user(req))


@router.post(
    "/auth/google", response_model=AuthResponse, status_code=status.HTTP_200_OK
)
async def auth_google(req: GoogleAuthRequest):
    """
    Authenticate or register a user with Google OAuth credentials.
    """
    return await run_blocking(
        authenticated_response, await user_service.authenticate_with_google(req)
    )


@router.post(
    "/otp/send", response_model=SendOtpResponse, status_code=status.HTTP_200_OK
)
async def send_otp(req: SendOtpRequest):
    """
    Generate and send a 6-digit OTP verification code to the user's registered email address.
    """
    return await user_service.send_login_otp(req.email_or_username)


@router.post("/otp/verify", response_model=AuthResponse, status_code=status.HTTP_200_OK)
def verify_otp(req: VerifyOtpLoginRequest):
    """
    Verify 6-digit OTP code and sign in the user.
    """
    return authenticated_response(
        user_service.verify_login_otp(req.email_or_username, req.otp)
    )


@router.post(
    "/password-reset/send",
    response_model=SendOtpResponse,
    status_code=status.HTTP_200_OK,
)
async def send_password_reset_otp(req: SendOtpRequest):
    """
    Generate and send a 6-digit password reset verification code to the user's registered email address.
    """
    return await user_service.send_password_reset_otp(req.email_or_username)


@router.post("/password-reset/verify", status_code=status.HTTP_200_OK)
def verify_password_reset_otp(req: ResetPasswordWithOtpRequest):
    """
    Verify 6-digit OTP code and reset the user's password directly without requiring login.
    """
    return user_service.reset_password_with_otp(req)


@router.get("/me", response_model=UserResponse)
def get_current_user(
    user_id: str | None = None, principal: Principal = Depends(require_user)
):
    """
    Get user profile details by user ID.
    """
    check_user_claim(user_id, principal)
    user_id = principal.user_id
    user = user_service.get_user_by_id(user_id)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="User account not found."
        )
    return present_user(user, principal)


@router.patch("/profile", response_model=UserResponse)
def update_profile(
    req: UserProfileUpdateRequest, principal: Principal = Depends(require_user)
):
    """
    Update user display name and/or avatar color.
    """
    check_user_claim(req.user_id, principal)
    return present_user(
        user_service.update_user_profile(
            user_id=req.user_id,
            display_name=req.display_name,
            avatar_color=req.avatar_color,
            avatar_url=req.avatar_url,
        ),
        principal,
    )


@router.post("/avatar", response_model=UserResponse)
async def upload_avatar(
    user_id: str = Form(...),
    file: UploadFile = File(...),
    principal: Principal = Depends(require_user),
):
    """
    Upload and update a custom user profile picture.
    Maximum file size: 2MB. Allowed formats: PNG, JPG, JPEG, WEBP, GIF.
    """
    check_user_claim(user_id, principal)
    filename = file.filename or "avatar.png"
    if "." not in filename and file.content_type:
        ext_map = {
            "image/jpeg": ".jpg",
            "image/jpg": ".jpg",
            "image/png": ".png",
            "image/webp": ".webp",
            "image/gif": ".gif",
        }
        filename = f"{filename}{ext_map.get(file.content_type, '.jpg')}"

    file_bytes = await file.read(MAX_AVATAR_SIZE_BYTES + 1)
    user = await run_blocking(
        user_service.save_user_avatar,
        user_id=user_id,
        file_bytes=file_bytes,
        filename=filename,
    )
    return await run_blocking(present_user, user, principal)


@router.get("/avatar/{user_id}")
def get_avatar(user_id: str, principal: Principal = Depends(require_user)):
    """
    Serve the user's custom avatar image file with explicit image Content-Type header.
    """
    check_user_claim(user_id, principal)
    path = user_service.get_user_avatar_path(user_id)
    if not path or not path.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Avatar image not found for this user.",
        )

    data = storage_service.download_owned_file(
        f"avatars/{path.name}", max_bytes=MAX_AVATAR_SIZE_BYTES
    )
    if data is None:
        raise HTTPException(404, "Avatar image not found for this user.")
    return image_response(data)


@router.delete("/avatar", response_model=UserResponse)
def delete_avatar(
    user_id: str = Query(...), principal: Principal = Depends(require_user)
):
    """
    Delete the user's custom avatar image and revert to default avatar color.
    """
    check_user_claim(user_id, principal)
    return present_user(user_service.delete_user_avatar(user_id), principal)


@router.post("/change-password")
def change_password(
    req: UserPasswordChangeRequest, principal: Principal = Depends(require_user)
):
    """
    Change user password with old password verification.
    """
    check_user_claim(req.user_id, principal)
    user_service.change_user_password(
        user_id=req.user_id,
        old_password=req.old_password,
        new_password=req.new_password,
    )
    return {"message": "Password changed successfully."}
