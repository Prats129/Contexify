import os
import uuid
import mimetypes
from pathlib import Path
from datetime import datetime
from typing import Optional, List, Dict, Any, Tuple
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

    def list_assets(
        self,
        user_id: Optional[str] = None,
        session_id: Optional[str] = None,
        origin: Optional[str] = None,
        file_type: Optional[str] = None,
        search: Optional[str] = None,
        limit: int = 50,
        offset: int = 0
    ) -> Tuple[List[Dict[str, Any]], int]:
        """
        Query unified assets (uploaded & AI-generated images, plus documents).
        Returns: (items, total_count)
        """
        conditions = []
        params = []

        if session_id:
            conditions.append("session_id = ?")
            params.append(session_id)
        elif user_id:
            conditions.append("user_id = ?")
            params.append(user_id)

        if origin and origin != "all":
            conditions.append("origin = ?")
            params.append(origin)

        if file_type and file_type != "all":
            conditions.append("file_type = ?")
            params.append(file_type)

        if search and search.strip():
            clean_search = f"%{search.strip().lower()}%"
            conditions.append("(LOWER(name) LIKE ? OR LOWER(prompt) LIKE ?)")
            params.extend([clean_search, clean_search])

        where_clause = ""
        if conditions:
            where_clause = "WHERE " + " AND ".join(conditions)

        base_cte = """
            WITH combined_assets AS (
                SELECT 
                    m.id, 
                    m.user_id, 
                    m.session_id, 
                    s.title AS session_title, 
                    m.filename AS name, 
                    m.file_url AS url, 
                    'image' AS file_type, 
                    m.mime_type, 
                    m.file_size_bytes AS size_bytes, 
                    m.media_type AS origin, 
                    COALESCE(m.prompt, '') AS prompt, 
                    m.created_at
                FROM media_assets m
                LEFT JOIN chat_sessions s ON m.session_id = s.id

                UNION ALL

                SELECT 
                    d.id, 
                    d.user_id, 
                    d.session_id, 
                    s.title AS session_title, 
                    d.filename AS name, 
                    d.storage_url AS url, 
                    'document' AS file_type, 
                    d.file_type AS mime_type, 
                    d.file_size_bytes AS size_bytes, 
                    'upload' AS origin, 
                    '' AS prompt, 
                    d.created_at
                FROM documents d
                LEFT JOIN chat_sessions s ON d.session_id = s.id
            )
        """

        count_sql = f"{base_cte} SELECT COUNT(*) as total FROM combined_assets {where_clause}"
        query_sql = f"{base_cte} SELECT * FROM combined_assets {where_clause} ORDER BY created_at DESC LIMIT ? OFFSET ?"

        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(count_sql, tuple(params))
            count_row = cursor.fetchone()
            total = count_row["total"] if count_row else 0

            query_params = list(params) + [limit, offset]
            cursor.execute(query_sql, tuple(query_params))
            rows = cursor.fetchall()

            items = []
            for row in rows:
                url = row["url"] or ""
                # Ensure document storage URL has a valid link
                if not url and row["file_type"] == "document":
                    url = storage_service.get_public_url(f"documents/{row['session_id']}/{row['name']}")
                elif url and not url.startswith("http") and not url.startswith("/"):
                    url = storage_service.get_public_url(url)

                items.append({
                    "id": row["id"],
                    "user_id": row["user_id"],
                    "session_id": row["session_id"],
                    "session_title": row["session_title"] or "Untitled Chat",
                    "name": row["name"],
                    "url": url,
                    "file_type": row["file_type"],
                    "mime_type": row["mime_type"],
                    "size_bytes": row["size_bytes"] or 0,
                    "origin": row["origin"],
                    "prompt": row["prompt"] or "",
                    "created_at": row["created_at"]
                })

            return items, total

    def delete_asset(self, asset_id: str) -> bool:
        """
        Delete a unified asset (from media_assets or documents).
        Deletes physical file from Cloudflare R2 / disk and Chroma vectors if document.
        """
        with get_db_connection() as conn:
            cursor = conn.cursor()
            # 1. Check media_assets
            cursor.execute("SELECT id, file_url, file_path FROM media_assets WHERE id = ?", (asset_id,))
            media_row = cursor.fetchone()
            if media_row:
                url = media_row["file_url"]
                path = media_row["file_path"]
                cursor.execute("DELETE FROM media_assets WHERE id = ?", (asset_id,))
                storage_service.delete_file(url)
                if path and path != url:
                    storage_service.delete_file(path)
                return True

            # 2. Check documents
            cursor.execute("SELECT id, session_id, storage_url FROM documents WHERE id = ?", (asset_id,))
            doc_row = cursor.fetchone()
            if doc_row:
                from app.repositories.session_store import session_store_repo
                from app.repositories.vector_store import vector_store_repo
                storage_url = doc_row["storage_url"]
                if storage_url:
                    storage_service.delete_file(storage_url)
                try:
                    vector_store_repo.delete_document(asset_id)
                except Exception as e:
                    logger.warning(f"Error purging vectors for document {asset_id}: {e}")
                session_store_repo.remove_document(asset_id)
                return True

        return False

media_service = MediaService()
