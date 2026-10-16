import mimetypes
from pathlib import Path, PureWindowsPath
from typing import Optional, Tuple
from urllib.parse import unquote, urlsplit

from app.core.config import settings
from app.core.logging import logger
from app.services.session_lifecycle import protect_resource_write, register_resource

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
            logger.info(
                "boto3 is not available. StorageService running in local disk mode."
            )
            return

        if not settings.is_cloudflare_r2_configured:
            logger.info(
                "Cloudflare R2 not configured. StorageService operating in local disk mode."
            )
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
                    read_timeout=30,
                ),
                region_name="auto",
            )
            self._initialized = True
            logger.info(
                f"Initialized Cloudflare R2 Storage client for bucket '{settings.CLOUDFLARE_R2_BUCKET_NAME}' at {endpoint}"
            )
        except Exception as e:
            logger.exception(
                f"Failed to initialize Cloudflare R2 client: {e}. Falling back to local disk storage."
            )
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

        # 2. If clean_key is an avatar and no custom CDN domain is configured,
        # route to backend endpoint so the backend proxies/serves the avatar
        if clean_key.startswith("avatars/"):
            filename = clean_key.split("avatars/")[-1]
            user_id = Path(filename).stem
            return f"/api/v1/user/avatar/{user_id}"

        # 3. If R2 is active but no public URL is provided, build direct endpoint URL
        if self.is_r2_active and settings.r2_endpoint_url:
            base = settings.r2_endpoint_url.rstrip("/")
            bucket = settings.CLOUDFLARE_R2_BUCKET_NAME
            return f"{base}/{bucket}/{clean_key}"

        # 4. Local URL fallback
        if clean_key.startswith("media/uploads/"):
            filename = clean_key.split("media/uploads/")[-1]
            return f"/api/v1/media/uploads/{filename}"
        elif clean_key.startswith("media/generated/"):
            filename = clean_key.split("media/generated/")[-1]
            return f"/api/v1/media/generated/{filename}"
        elif clean_key.startswith("documents/"):
            return f"/api/v1/media/documents/{clean_key.split('documents/')[-1]}"

        return f"/api/v1/media/{clean_key}"

    @protect_resource_write
    def upload_file(
        self,
        file_bytes: bytes,
        destination_key: str,
        content_type: Optional[str] = None,
        session_id: Optional[str] = None,
    ) -> Tuple[str, str]:
        """
        Upload raw bytes to storage (Cloudflare R2 or local disk).
        Returns: (public_url, storage_key)
        """
        clean_key = destination_key
        if not self._is_safe_key(clean_key):
            raise ValueError("Invalid storage key.")
        data_root = settings.DATA_DIR.resolve()
        local_target = (data_root / clean_key).resolve()
        if not local_target.is_relative_to(data_root):
            raise ValueError("Storage key escapes the data directory.")
        register_resource(session_id, "local", clean_key)
        if self.is_r2_active:
            register_resource(session_id, "r2", clean_key)

        if clean_key.startswith("documents/"):
            content_type = "application/octet-stream"
        elif not content_type:
            guessed, _ = mimetypes.guess_type(clean_key)
            content_type = guessed or "application/octet-stream"

        # Try Cloudflare R2 Upload
        if self.is_r2_active and self._s3_client is not None:
            try:
                self._s3_client.put_object(
                    Bucket=settings.CLOUDFLARE_R2_BUCKET_NAME,
                    Key=clean_key,
                    Body=file_bytes,
                    ContentType=content_type,
                    **(
                        {"ContentDisposition": "attachment"}
                        if clean_key.startswith("documents/")
                        else {}
                    ),
                )
                public_url = self.get_public_url(clean_key)
                logger.info(
                    f"Uploaded {len(file_bytes)} bytes to Cloudflare R2: {clean_key} -> {public_url}"
                )
                return public_url, clean_key
            except Exception as e:
                logger.exception(
                    f"Cloudflare R2 upload error for key '{clean_key}': {e}. Falling back to local disk."
                )

        # Local Disk Storage Fallback
        local_target.parent.mkdir(parents=True, exist_ok=True)
        with open(local_target, "wb") as f:
            f.write(file_bytes)

        public_url = self.get_public_url(clean_key)
        logger.info(
            f"Saved {len(file_bytes)} bytes to local disk: {local_target} -> {public_url}"
        )
        return public_url, clean_key

    @staticmethod
    def _is_safe_key(key: str) -> bool:
        return bool(key) and not (
            "\\" in key
            or any(
                char in '<>:"|?*' or ord(char) < 32 or ord(char) == 127 for char in key
            )
            or any(
                part in {"", ".", ".."}
                or part.endswith((" ", "."))
                or PureWindowsPath(part).is_reserved()
                for part in key.split("/")
            )
        )

    def download_file(self, key_or_url: str) -> Optional[bytes]:
        """Resolve a configured storage URL/key without arbitrary HTTP or path reads."""
        key = self._extract_key_from_url(key_or_url) or key_or_url
        return self.download_owned_file(key)

    def owned_storage_key(self, row: dict, kind: str) -> str:
        """Resolve only a database-owned storage key, never a caller's URL/path."""
        from fastapi import HTTPException

        value = row.get("storage_url") if kind == "document" else row.get("file_path")
        key = self._extract_key_from_url(value or "") or value or ""
        expected = "documents/" if kind == "document" else "media/"
        if not key.startswith(expected) or not self._is_safe_key(key):
            raise HTTPException(404, "Asset storage is unavailable.")
        return key

    def download_owned_file(
        self, key: str, max_bytes: Optional[int] = None
    ) -> Optional[bytes]:
        """Read an exact storage key; callers must check ownership before using it."""
        if not self._is_safe_key(key) or not key.startswith(
            ("media/", "documents/", "avatars/")
        ):
            return None
        data_root = settings.DATA_DIR.resolve()
        namespace_root = data_root / key.split("/", 1)[0]
        try:
            target = (data_root / key).resolve()
            if not target.is_relative_to(namespace_root):
                return None
            if target.is_file():
                with target.open("rb") as body:
                    if max_bytes is not None and target.stat().st_size > max_bytes:
                        return None
                    data = (
                        body.read() if max_bytes is None else body.read(max_bytes + 1)
                    )
                return data if max_bytes is None or len(data) <= max_bytes else None
        except (OSError, RuntimeError):
            logger.warning("Owned local object could not be read", exc_info=True)
            return None
        if self.is_r2_active and self._s3_client is not None:
            try:
                response = self._s3_client.get_object(
                    Bucket=settings.CLOUDFLARE_R2_BUCKET_NAME, Key=key
                )
                body = response["Body"]
                try:
                    if (
                        max_bytes is not None
                        and response.get("ContentLength", 0) > max_bytes
                    ):
                        return None
                    data = (
                        body.read() if max_bytes is None else body.read(max_bytes + 1)
                    )
                    return data if max_bytes is None or len(data) <= max_bytes else None
                finally:
                    body.close()
            except Exception:
                logger.warning(
                    "Owned object could not be downloaded from storage", exc_info=True
                )
        return None

    def delete_file(self, key_or_url: str) -> bool:
        """Delete both copies; a missing object is already successfully deleted."""
        key = self._extract_key_from_url(key_or_url) or key_or_url
        try:
            self.delete_owned_file(key, backend="local")
            if self.is_r2_active:
                self.delete_owned_file(key, backend="r2")
            elif key_or_url.startswith(("https://", "http://")):
                return False
            return True
        except Exception:
            logger.warning("Owned object deletion failed", exc_info=True)
            return False

    def delete_owned_file(self, key: str, *, backend: str):
        """Delete one exact owned object, raising on failure for durable retries."""
        if not self._is_safe_key(key) or not key.startswith(
            ("media/", "documents/", "avatars/", "uploads/")
        ):
            raise ValueError("Invalid storage key.")
        if backend == "r2":
            if not self.is_r2_active or self._s3_client is None:
                raise RuntimeError("Object storage is unavailable.")
            self._s3_client.delete_object(
                Bucket=settings.CLOUDFLARE_R2_BUCKET_NAME, Key=key
            )
        elif backend == "local":
            data_root = settings.DATA_DIR.resolve()
            target = (data_root / key).resolve()
            if not target.is_relative_to(data_root / key.split("/", 1)[0]):
                raise ValueError("Storage key escapes its namespace.")
            target.unlink(missing_ok=True)
        else:
            raise ValueError("Unknown storage backend.")

    def _extract_key_from_url(self, url: str) -> Optional[str]:
        """Match exact configured origins/path prefixes, never hostname substrings."""
        if not url:
            return None
        try:
            parsed = urlsplit(url)
            if parsed.username or parsed.password or parsed.fragment:
                return None
            path = unquote(parsed.path)
            if parsed.scheme or parsed.netloc:
                if parsed.scheme not in {"http", "https"}:
                    return None
                bases = [settings.CLOUDFLARE_R2_PUBLIC_URL]
                if settings.r2_endpoint_url and settings.CLOUDFLARE_R2_BUCKET_NAME:
                    bases.append(
                        f"{settings.r2_endpoint_url.rstrip('/')}/{settings.CLOUDFLARE_R2_BUCKET_NAME}"
                    )
                for value in bases:
                    if not value:
                        continue
                    base = urlsplit(value.strip().rstrip("/"))
                    prefix = unquote(base.path).rstrip("/") + "/"
                    if (
                        parsed.scheme == base.scheme
                        and parsed.netloc == base.netloc
                        and path.startswith(prefix)
                    ):
                        key = path[len(prefix) :]
                        return key if self._is_safe_key(key) else None
                return None
            for prefix, namespace in (
                ("/api/v1/media/uploads/", "media/uploads/"),
                ("/api/v1/media/generated/", "media/generated/"),
                ("/api/v1/media/documents/", "documents/"),
                ("/api/v1/user/avatar/", "avatars/"),
            ):
                if path.startswith(prefix):
                    key = namespace + path[len(prefix) :]
                    return key if self._is_safe_key(key) else None
        except ValueError:
            return None
        return None


storage_service = StorageService()
