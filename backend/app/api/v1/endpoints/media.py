from pathlib import Path
from typing import Optional, List
from fastapi import APIRouter, UploadFile, File, Form, HTTPException, status
from app.core.config import settings
from app.core.logging import logger
from app.schemas.chat import MediaAttachment
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
