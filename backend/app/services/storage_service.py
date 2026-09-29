import os
import mimetypes
from pathlib import Path
from typing import Optional, Tuple, Union
import httpx
from app.core.config import settings
from app.core.logging import logger

try:
    import boto3
    from botocore.config import Config
    from botocore.exceptions import ClientError
    BOTO3_AVAILABLE = True
except ImportError:
    BOTO3_AVAILABLE = False
    ClientError = Exception


class StorageService:
    """
    Unified Object Storage Service supporting Cloudflare R2 (S3-compatible)
    with seamless local disk fallback for development.
    """

    def __init__(self):
        self._s3_client = None
        self._initialized = False
        self._init_r2_client()

    def _init_r2_client(self):
        if not BOTO3_AVAILABLE:
            logger.info("boto3 is not available. StorageService running in local disk mode.")
            return

        if not settings.is_cloudflare_r2_configured:
            logger.info("Cloudflare R2 not configured. StorageService operating in local disk mode.")
            return

        try:
            endpoint = settings.r2_endpoint_url
            if not endpoint:
                logger.warning("Cloudflare R2 endpoint URL could not be determined.")
                return

            self._s3_client = boto3.client(
                service_name="s3",
                endpoint_url=endpoint,
                aws_access_key_id=settings.CLOUDFLARE_R2_ACCESS_KEY_ID.strip(),
                aws_secret_access_key=settings.CLOUDFLARE_R2_SECRET_ACCESS_KEY.strip(),
                config=Config(
                    signature_version="s3v4",
                    retries={"max_attempts": 3, "mode": "standard"},
                    connect_timeout=10,
                    read_timeout=30
                ),
                region_name="auto"
            )
            self._initialized = True
            logger.info(f"Initialized Cloudflare R2 Storage client for bucket '{settings.CLOUDFLARE_R2_BUCKET_NAME}' at {endpoint}")
        except Exception as e:
            logger.error(f"Failed to initialize Cloudflare R2 client: {e}. Falling back to local disk storage.")
            self._s3_client = None
            self._initialized = False

    @property
    def is_r2_active(self) -> bool:
        return self._initialized and self._s3_client is not None

    def get_public_url(self, key: str) -> str:
        """Construct the publicly accessible URL for an object key."""
        clean_key = key.lstrip("/")
        
        # 1. Custom Public CDN or r2.dev domain (e.g. https://pub-xxx.r2.dev or https://media.contexify.ai)
        if settings.CLOUDFLARE_R2_PUBLIC_URL:
            base = settings.CLOUDFLARE_R2_PUBLIC_URL.strip().rstrip("/")
            return f"{base}/{clean_key}"

        # 2. If R2 is active but no public URL is provided, build direct endpoint URL
        if self.is_r2_active and settings.r2_endpoint_url:
            base = settings.r2_endpoint_url.rstrip("/")
            bucket = settings.CLOUDFLARE_R2_BUCKET_NAME
            return f"{base}/{bucket}/{clean_key}"

        # 3. Local URL fallback
        if clean_key.startswith("media/uploads/"):
            filename = clean_key.split("media/uploads/")[-1]
            return f"/api/v1/media/uploads/{filename}"
        elif clean_key.startswith("media/generated/"):
            filename = clean_key.split("media/generated/")[-1]
            return f"/api/v1/media/generated/{filename}"
        elif clean_key.startswith("documents/"):
            return f"/api/v1/media/documents/{clean_key.split('documents/')[-1]}"

        return f"/api/v1/media/{clean_key}"

    def upload_file(
        self,
        file_bytes: bytes,
        destination_key: str,
        content_type: Optional[str] = None
    ) -> Tuple[str, str]:
        """
        Upload raw bytes to storage (Cloudflare R2 or local disk).
        Returns: (public_url, storage_key)
        """
        clean_key = destination_key.lstrip("/")
        
        if not content_type:
            guessed, _ = mimetypes.guess_type(clean_key)
            content_type = guessed or "application/octet-stream"

        # Try Cloudflare R2 Upload
        if self.is_r2_active:
            try:
                self._s3_client.put_object(
                    Bucket=settings.CLOUDFLARE_R2_BUCKET_NAME,
                    Key=clean_key,
                    Body=file_bytes,
                    ContentType=content_type
                )
                public_url = self.get_public_url(clean_key)
                logger.info(f"Uploaded {len(file_bytes)} bytes to Cloudflare R2: {clean_key} -> {public_url}")
                return public_url, clean_key
            except Exception as e:
                logger.error(f"Cloudflare R2 upload error for key '{clean_key}': {e}. Falling back to local disk.")

        # Local Disk Storage Fallback
        local_target = settings.DATA_DIR / clean_key
        local_target.parent.mkdir(parents=True, exist_ok=True)
        with open(local_target, "wb") as f:
            f.write(file_bytes)

        public_url = self.get_public_url(clean_key)
        logger.info(f"Saved {len(file_bytes)} bytes to local disk: {local_target} -> {public_url}")
        return public_url, clean_key

    def download_file(self, key_or_url: str) -> Optional[bytes]:
        """
        Download raw file bytes from Cloudflare R2, remote HTTP URL, or local disk.
        """
        if not key_or_url:
            return None

        # 1. If it's a full HTTP(S) URL
        if key_or_url.startswith("http://") or key_or_url.startswith("https://"):
            # If R2 is active and the URL contains our public URL or bucket, extract key
            if self.is_r2_active:
                key = self._extract_key_from_url(key_or_url)
                if key:
                    try:
                        resp = self._s3_client.get_object(
                            Bucket=settings.CLOUDFLARE_R2_BUCKET_NAME,
                            Key=key
                        )
                        return resp["Body"].read()
                    except Exception as e:
                        logger.warning(f"Failed to fetch key '{key}' directly from R2: {e}. Trying HTTP fetch...")

            # Otherwise fetch over HTTP
            try:
                with httpx.Client(timeout=30.0) as client:
                    resp = client.get(key_or_url)
                    if resp.status_code == 200:
                        return resp.content
            except Exception as e:
                logger.error(f"HTTP download failed for {key_or_url}: {e}")

        # 2. If it's a key and R2 is active
        if self.is_r2_active and not key_or_url.startswith("/"):
            try:
                resp = self._s3_client.get_object(
                    Bucket=settings.CLOUDFLARE_R2_BUCKET_NAME,
                    Key=key_or_url.lstrip("/")
                )
                return resp["Body"].read()
            except Exception as e:
                logger.warning(f"R2 key fetch failed for '{key_or_url}': {e}")

        # 3. Local disk resolution
        clean_path = key_or_url.split("?")[0]
        rel_key = clean_path
        if "/api/v1/media/" in clean_path:
            rel_key = clean_path.split("/api/v1/media/")[-1]
        elif clean_path.startswith("/"):
            rel_key = clean_path.lstrip("/")

        candidates = [
            Path(clean_path),
            settings.DATA_DIR / rel_key,
            settings.DATA_DIR / clean_path.lstrip("/"),
            settings.MEDIA_DIR / rel_key,
            settings.UPLOAD_IMAGE_DIR / Path(clean_path).name,
            settings.GENERATED_IMAGE_DIR / Path(clean_path).name,
            settings.UPLOAD_DIR / Path(clean_path).name,
            settings.DATA_DIR / "test" / Path(clean_path).name
        ]

        for cand in candidates:
            if cand and cand.exists() and cand.is_file():
                try:
                    with open(cand, "rb") as f:
                        return f.read()
                except Exception as e:
                    logger.warning(f"Error reading local file {cand}: {e}")

        return None

    def delete_file(self, key_or_url: str) -> bool:
        """Delete an object from Cloudflare R2 or local disk."""
        if not key_or_url:
            return False

        key = self._extract_key_from_url(key_or_url) or key_or_url.lstrip("/")

        # Delete from R2
        if self.is_r2_active:
            try:
                self._s3_client.delete_object(
                    Bucket=settings.CLOUDFLARE_R2_BUCKET_NAME,
                    Key=key
                )
                logger.info(f"Deleted from Cloudflare R2: {key}")
                return True
            except Exception as e:
                logger.warning(f"Failed to delete '{key}' from Cloudflare R2: {e}")

        # Also delete local file if it exists
        local_path = settings.DATA_DIR / key
        if local_path.exists() and local_path.is_file():
            try:
                local_path.unlink()
                logger.info(f"Deleted local file: {local_path}")
                return True
            except Exception as e:
                logger.warning(f"Failed to delete local file {local_path}: {e}")

        return False

    def _extract_key_from_url(self, url: str) -> Optional[str]:
        """Extract bucket object key from a full URL."""
        if not url:
            return None

        clean = url.split("?")[0]

        if settings.CLOUDFLARE_R2_PUBLIC_URL and settings.CLOUDFLARE_R2_PUBLIC_URL in clean:
            return clean.split(settings.CLOUDFLARE_R2_PUBLIC_URL)[-1].lstrip("/")

        if settings.CLOUDFLARE_R2_BUCKET_NAME and f"/{settings.CLOUDFLARE_R2_BUCKET_NAME}/" in clean:
            return clean.split(f"/{settings.CLOUDFLARE_R2_BUCKET_NAME}/")[-1].lstrip("/")

        if "/api/v1/media/uploads/" in clean:
            filename = clean.split("/api/v1/media/uploads/")[-1]
            return f"media/uploads/{filename}"
        elif "/api/v1/media/generated/" in clean:
            filename = clean.split("/api/v1/media/generated/")[-1]
            return f"media/generated/{filename}"
        elif "/api/v1/media/documents/" in clean:
            doc_rel = clean.split("/api/v1/media/documents/")[-1]
            return f"documents/{doc_rel}"

        return None


storage_service = StorageService()
