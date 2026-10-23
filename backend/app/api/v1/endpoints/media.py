import uuid
from pathlib import Path
from typing import List, Optional

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
from fastapi.responses import Response
from fastapi.security import HTTPAuthorizationCredentials

from app.core.concurrency import run_blocking
from app.core.logging import logger
from app.core.security import (
    Principal,
    bearer,
    check_asset,
    check_session,
    check_user_claim,
    download_principal,
    download_url,
    ensure_session,
    present_attachment,
    require_principal,
)
from app.db.database import get_db_connection
from app.schemas.chat import MediaAttachment
from app.schemas.media import AssetDeleteResponse, AssetItem, PaginatedAssetsResponse
from app.services.image_validation import image_response
from app.services.media_service import (
    ALLOWED_IMAGE_EXTENSIONS,
    MAX_FILE_SIZE_BYTES,
    media_service,
)
from app.services.storage_service import storage_service
from app.services.user_service import MAX_AVATAR_SIZE_BYTES, user_service

router = APIRouter()


@router.get("/content/{kind}/{asset_id}")
def download_asset(
    asset_id: str,
    kind: str,
    ticket: Optional[str] = None,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer),
):
    principal = download_principal(asset_id, kind, ticket, credentials)
    headers = {
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "sandbox",
        "Referrer-Policy": "no-referrer",
    }
    if kind == "avatar":
        check_user_claim(asset_id, principal)
        path = user_service.get_user_avatar_path(asset_id)
        if not path:
            raise HTTPException(404, "Avatar not found.")
        data = storage_service.download_owned_file(
            f"avatars/{path.name}", max_bytes=MAX_AVATAR_SIZE_BYTES
        )
        if data is None:
            raise HTTPException(404, "Avatar not found.")
        return image_response(data)
    row = check_asset(asset_id, principal, kind)
    key = storage_service.owned_storage_key(row, kind)
    data = storage_service.download_owned_file(
        key, max_bytes=MAX_FILE_SIZE_BYTES if kind != "document" else None
    )
    if data is None:
        raise HTTPException(404, "Asset not found.")
    if kind != "document":
        return image_response(data)
    headers["Content-Disposition"] = "attachment"
    return Response(data, media_type="application/octet-stream", headers=headers)


@router.post(
    "/upload", response_model=MediaAttachment, status_code=status.HTTP_201_CREATED
)
async def upload_media(
    file: UploadFile = File(...),
    session_id: Optional[str] = Form(None),
    user_id: Optional[str] = Form(None),
    is_temporary: bool = Form(False),
    principal: Principal = Depends(require_principal),
):
    """
    Upload an image or media asset to be attached to a chat query or analyzed by Gemini Vision.
    """
    check_user_claim(user_id, principal)
    if principal.is_guest and not session_id:
        session_id = uuid.uuid4().hex
    if session_id:
        await run_blocking(
            ensure_session, session_id, principal, is_temporary=is_temporary
        )
    user_id = principal.user_id
    filename = file.filename or "uploaded_media.png"
    ext = Path(filename).suffix.lower()

    if ext not in ALLOWED_IMAGE_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unsupported file type '{ext}'. Allowed image formats: {', '.join(sorted(ALLOWED_IMAGE_EXTENSIONS))}",
        )

    try:
        content = await file.read(MAX_FILE_SIZE_BYTES + 1)
        if len(content) > MAX_FILE_SIZE_BYTES:
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail=f"File exceeds maximum allowed size of {MAX_FILE_SIZE_BYTES // (1024 * 1024)}MB",
            )

        attachment = await run_blocking(
            media_service.save_uploaded_media,
            file_bytes=content,
            original_filename=filename,
            session_id=session_id,
            user_id=user_id,
            mime_type=file.content_type,
        )
        return await run_blocking(present_attachment, attachment, principal)
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Failed to process media upload: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to save and process media file: {str(e)}",
        )


@router.get("/session/{session_id}", response_model=List[MediaAttachment])
def get_session_media(
    session_id: str, principal: Principal = Depends(require_principal)
):
    """Retrieve all media assets associated with a specific session."""
    check_session(session_id, principal)
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                SELECT id, filename, file_url, mime_type, file_size_bytes, media_type, prompt
                FROM media_assets
                WHERE session_id = ?
                ORDER BY created_at DESC
                """,
                (session_id,),
            )
            rows = cursor.fetchall()
            attachments = [
                MediaAttachment(
                    id=row["id"],
                    url=row["file_url"],
                    file_type="image",
                    file_name=row["filename"],
                    mime_type=row["mime_type"],
                    file_size_bytes=row["file_size_bytes"],
                    media_type=row["media_type"],
                    prompt=row["prompt"],
                )
                for row in rows
            ]
        return [present_attachment(a, principal) for a in attachments]
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Error fetching session media: {e}")
        return []


@router.get("/assets", response_model=PaginatedAssetsResponse)
def list_unified_assets(
    user_id: Optional[str] = Query(None, description="Filter by user ID"),
    session_id: Optional[str] = Query(None, description="Filter by session ID"),
    origin: Optional[str] = Query(
        None, description="Filter by origin: 'upload' | 'generated' | 'all'"
    ),
    file_type: Optional[str] = Query(
        None, description="Filter by type: 'image' | 'document' | 'all'"
    ),
    search: Optional[str] = Query(None, description="Search by filename or prompt"),
    limit: int = Query(50, ge=1, le=100, description="Items per page"),
    offset: int = Query(0, ge=0, description="Pagination offset"),
    principal: Principal = Depends(require_principal),
):
    """
    Unified Attachments & Media library endpoint.
    Retrieves user uploads and AI generated media with high performance indexing.
    """
    check_user_claim(user_id, principal)
    user_id = principal.user_id
    if session_id:
        check_session(session_id, principal)
    items, total = media_service.list_assets(
        user_id=user_id,
        session_id=session_id,
        origin=origin,
        file_type=file_type,
        search=search,
        limit=limit,
        offset=offset,
    )

    for item in items:
        item["url"] = download_url(
            item["id"],
            principal,
            "document" if item["file_type"] == "document" else "media",
        )
    has_more = (offset + len(items)) < total
    return PaginatedAssetsResponse(
        items=[AssetItem(**item) for item in items],
        total=total,
        has_more=has_more,
        limit=limit,
        offset=offset,
    )


@router.delete("/assets/{asset_id}", response_model=AssetDeleteResponse)
def delete_unified_asset(
    asset_id: str, principal: Principal = Depends(require_principal)
):
    """
    Delete an asset (uploaded image, document, or generated media) and purge from storage.
    """
    from app.core.security import asset_record

    check_asset(asset_id, principal, "media" if asset_record(asset_id) else "document")
    success = media_service.delete_asset(asset_id)
    if not success:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Asset with ID '{asset_id}' not found",
        )
    return AssetDeleteResponse(
        message=f"Asset '{asset_id}' deleted successfully", id=asset_id
    )
