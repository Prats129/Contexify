import os
import uuid
import mimetypes
from pathlib import Path
from datetime import datetime
from typing import Optional, List, Dict, Any
from app.core.config import settings
from app.core.logging import logger
from app.db.database import get_db_connection
from app.schemas.chat import MediaAttachment
from app.services.storage_service import storage_service

ALLOWED_IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".svg"}
MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024  # 25 MB

class MediaService:
    """Service for managing uploaded media files and AI generated images."""

    def __init__(self):
        settings.MEDIA_DIR.mkdir(parents=True, exist_ok=True)
        settings.UPLOAD_IMAGE_DIR.mkdir(parents=True, exist_ok=True)
        settings.GENERATED_IMAGE_DIR.mkdir(parents=True, exist_ok=True)

    def is_allowed_image(self, filename: str) -> bool:
        ext = Path(filename).suffix.lower()
        return ext in ALLOWED_IMAGE_EXTENSIONS

    def save_uploaded_media(
        self,
        file_bytes: bytes,
        original_filename: str,
        session_id: Optional[str] = None,
        user_id: Optional[str] = None,
        mime_type: Optional[str] = None
    ) -> MediaAttachment:
        """Save an uploaded media file to Cloudflare R2 (or local disk) and register in DB."""
        ext = Path(original_filename).suffix.lower()
        if not ext:
            ext = ".png"
        
        asset_id = str(uuid.uuid4())
        safe_name = f"{asset_id}{ext}"
        storage_dest_key = f"media/uploads/{safe_name}"

        detected_mime, _ = mimetypes.guess_type(original_filename)
        final_mime = mime_type or detected_mime or "image/png"
        file_size = len(file_bytes)
        now = datetime.utcnow().isoformat()

        # Upload to Storage (Cloudflare R2 or local fallback)
        file_url, storage_key = storage_service.upload_file(
            file_bytes=file_bytes,
            destination_key=storage_dest_key,
            content_type=final_mime
        )

        # Register in DB
        try:
            with get_db_connection() as conn:
                cursor = conn.cursor()
                valid_session_id = None
                if session_id:
                    cursor.execute("SELECT id FROM chat_sessions WHERE id = ?", (session_id,))
                    if cursor.fetchone():
                        valid_session_id = session_id
                cursor.execute(
                    """
                    INSERT INTO media_assets (
                        id, user_id, session_id, filename, file_path, file_url,
                        mime_type, file_size_bytes, media_type, prompt, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        asset_id, user_id, valid_session_id, original_filename,
                        storage_key, file_url, final_mime, file_size,
                        "upload", "", now
                    )
                )
        except Exception as e:
            logger.warning(f"Could not register media asset in database: {e}")

        return MediaAttachment(
            id=asset_id,
            url=file_url,
            file_type="image",
            file_name=original_filename,
            mime_type=final_mime,
            file_size_bytes=file_size,
            media_type="upload",
            prompt=""
        )

    def save_generated_image(
        self,
        image_bytes: bytes,
        prompt: str,
        session_id: Optional[str] = None,
        user_id: Optional[str] = None,
        ext: str = ".png"
    ) -> MediaAttachment:
        """Save an AI-generated image to Cloudflare R2 (or local disk) and register in DB."""
        asset_id = str(uuid.uuid4())
        safe_name = f"gen_{asset_id}{ext}"
        storage_dest_key = f"media/generated/{safe_name}"

        file_size = len(image_bytes)
        mime_type = "image/png" if ext.lower() == ".png" else "image/jpeg"
        now = datetime.utcnow().isoformat()

        # Upload to Storage (Cloudflare R2 or local fallback)
        file_url, storage_key = storage_service.upload_file(
            file_bytes=image_bytes,
            destination_key=storage_dest_key,
            content_type=mime_type
        )

        try:
            with get_db_connection() as conn:
                cursor = conn.cursor()
                valid_session_id = None
                if session_id:
                    cursor.execute("SELECT id FROM chat_sessions WHERE id = ?", (session_id,))
                    if cursor.fetchone():
                        valid_session_id = session_id
                cursor.execute(
                    """
                    INSERT INTO media_assets (
                        id, user_id, session_id, filename, file_path, file_url,
                        mime_type, file_size_bytes, media_type, prompt, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        asset_id, user_id, valid_session_id, safe_name,
                        storage_key, file_url, mime_type, file_size,
                        "generated", prompt, now
                    )
                )
        except Exception as e:
            logger.warning(f"Could not register generated media asset in database: {e}")

        return MediaAttachment(
            id=asset_id,
            url=file_url,
            file_type="image",
            file_name=safe_name,
            mime_type=mime_type,
            file_size_bytes=file_size,
            media_type="generated",
            prompt=prompt
        )

    def get_media_bytes(self, url_or_path: str) -> Optional[bytes]:
        """Fetch binary content of a media asset from Cloudflare R2 or local disk."""
        if not url_or_path:
            return None
        return storage_service.download_file(url_or_path)

    def resolve_local_path(self, url_or_path: str) -> Optional[Path]:
        """Convert a media URL or relative path to its actual local filesystem Path if present."""
        if not url_or_path:
            return None

        # If it's already an absolute file path that exists
        p = Path(url_or_path)
        if p.is_file() and p.exists():
            return p

        # Check /api/v1/media/uploads/ or /api/v1/media/generated/
        clean_url = url_or_path.split("?")[0]
        if "/api/v1/media/uploads/" in clean_url:
            filename = clean_url.split("/api/v1/media/uploads/")[-1]
            candidate = settings.UPLOAD_IMAGE_DIR / filename
            if candidate.exists():
                return candidate
        elif "/api/v1/media/generated/" in clean_url:
            filename = clean_url.split("/api/v1/media/generated/")[-1]
            candidate = settings.GENERATED_IMAGE_DIR / filename
            if candidate.exists():
                return candidate
        
        # Check standard upload directory
        candidate = settings.UPLOAD_DIR / Path(clean_url).name
        if candidate.exists():
            return candidate

        return None

media_service = MediaService()
