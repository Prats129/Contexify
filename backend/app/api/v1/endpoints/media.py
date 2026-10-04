from pathlib import Path
from typing import Optional, List
from fastapi import APIRouter, UploadFile, File, Form, HTTPException, status, Query
from app.core.config import settings
from app.core.logging import logger
from app.schemas.chat import MediaAttachment
from app.schemas.media import AssetItem, PaginatedAssetsResponse, AssetDeleteResponse
from app.services.media_service import media_service, ALLOWED_IMAGE_EXTENSIONS, MAX_FILE_SIZE_BYTES
from app.db.database import get_db_connection

router = APIRouter()

@router.post("/upload", response_model=MediaAttachment, status_code=status.HTTP_201_CREATED)
async def upload_media(
    file: UploadFile = File(...),
    session_id: Optional[str] = Form(None),
    user_id: Optional[str] = Form(None)
):
    """
    Upload an image or media asset to be attached to a chat query or analyzed by Gemini Vision.
    """
    filename = file.filename or "uploaded_media.png"
    ext = Path(filename).suffix.lower()

    if ext not in ALLOWED_IMAGE_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unsupported file type '{ext}'. Allowed image formats: {', '.join(sorted(ALLOWED_IMAGE_EXTENSIONS))}"
        )

    try:
        content = await file.read()
        if len(content) > MAX_FILE_SIZE_BYTES:
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail=f"File exceeds maximum allowed size of {MAX_FILE_SIZE_BYTES // (1024 * 1024)}MB"
            )

        attachment = media_service.save_uploaded_media(
            file_bytes=content,
            original_filename=filename,
            session_id=session_id,
            user_id=user_id,
            mime_type=file.content_type
        )
        return attachment
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to process media upload: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to save and process media file: {str(e)}"
        )

@router.get("/session/{session_id}", response_model=List[MediaAttachment])
async def get_session_media(session_id: str):
    """Retrieve all media assets associated with a specific session."""
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
                (session_id,)
            )
            rows = cursor.fetchall()
            return [
                MediaAttachment(
                id=row["id"],
                url=row["file_url"],
                file_type="image",
                file_name=row["filename"],
                mime_type=row["mime_type"],
                file_size_bytes=row["file_size_bytes"],
                media_type=row["media_type"],
                prompt=row["prompt"]
            )
            for row in rows
        ]
    except Exception as e:
        logger.error(f"Error fetching session media: {e}")
        return []

@router.get("/assets", response_model=PaginatedAssetsResponse)
async def list_unified_assets(
    user_id: Optional[str] = Query(None, description="Filter by user ID"),
    session_id: Optional[str] = Query(None, description="Filter by session ID"),
    origin: Optional[str] = Query(None, description="Filter by origin: 'upload' | 'generated' | 'all'"),
    file_type: Optional[str] = Query(None, description="Filter by type: 'image' | 'document' | 'all'"),
    search: Optional[str] = Query(None, description="Search by filename or prompt"),
    limit: int = Query(50, ge=1, le=100, description="Items per page"),
    offset: int = Query(0, ge=0, description="Pagination offset")
):
    """
    Unified Attachments & Media library endpoint.
    Retrieves user uploads and AI generated media with high performance indexing.
    """
    items, total = media_service.list_assets(
        user_id=user_id,
        session_id=session_id,
        origin=origin,
        file_type=file_type,
        search=search,
        limit=limit,
        offset=offset
    )

    has_more = (offset + len(items)) < total
    return PaginatedAssetsResponse(
        items=[AssetItem(**item) for item in items],
        total=total,
        has_more=has_more,
        limit=limit,
        offset=offset
    )

@router.delete("/assets/{asset_id}", response_model=AssetDeleteResponse)
async def delete_unified_asset(asset_id: str):
    """
    Delete an asset (uploaded image, document, or generated media) and purge from storage.
    """
    success = media_service.delete_asset(asset_id)
    if not success:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Asset with ID '{asset_id}' not found"
        )
    return AssetDeleteResponse(
        message=f"Asset '{asset_id}' deleted successfully",
        id=asset_id
    )
