"""Validate supported raster images without trusting filenames or upload MIME types."""
import io
import threading
import warnings
from pathlib import Path
from typing import Optional, Tuple

from fastapi import HTTPException
from fastapi.responses import Response
from PIL import Image, UnidentifiedImageError

IMAGE_FORMATS = {
    "PNG": (".png", "image/png"),
    "JPEG": (".jpg", "image/jpeg"),
    "WEBP": (".webp", "image/webp"),
    "GIF": (".gif", "image/gif"),
    "BMP": (".bmp", "image/bmp"),
}
ALLOWED_IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"}
MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024
MAX_IMAGE_PIXELS = 20_000_000
MAX_IMAGE_FRAMES = 200
MAX_TOTAL_IMAGE_PIXELS = 100_000_000
_validation_slots = threading.BoundedSemaphore(2)
# Pillow's hard error starts at twice this value. Enforce our ceiling during
# frame seeking even when the host overrides Python's warning filters.
Image.MAX_IMAGE_PIXELS = MAX_IMAGE_PIXELS // 2
warnings.filterwarnings("ignore", category=Image.DecompressionBombWarning)


def validate_image(file_bytes: bytes, filename: Optional[str] = None,
                   max_bytes: int = MAX_FILE_SIZE_BYTES) -> Tuple[str, str]:
    """Verify the container and decode every frame with bounded image dimensions."""
    if len(file_bytes) > max_bytes:
        raise HTTPException(413, "Image exceeds the allowed file size.")
    if not file_bytes:
        raise HTTPException(400, "Empty image file provided.")
    suffix = Path(filename).suffix.lower() if filename else None
    if suffix is not None and suffix not in ALLOWED_IMAGE_EXTENSIONS:
        raise HTTPException(400, "Unsupported image format. Use PNG, JPEG, WebP, GIF or BMP; SVG is not supported.")
    if not _validation_slots.acquire(blocking=False):
        raise HTTPException(503, "Image processing is busy. Please retry shortly.")
    try:
        with Image.open(io.BytesIO(file_bytes), formats=list(IMAGE_FORMATS)) as image:
            actual_format = image.format
            if actual_format not in IMAGE_FORMATS:
                raise HTTPException(400, "Unsupported image format.")
            extension, mime_type = IMAGE_FORMATS[actual_format]
            if suffix is not None and suffix != extension and not (actual_format == "JPEG" and suffix == ".jpeg"):
                raise HTTPException(400, "Image contents do not match the filename extension.")
            if image.width * image.height > MAX_IMAGE_PIXELS:
                raise HTTPException(413, "Image dimensions exceed the allowed pixel limit.")
            image.verify()
        with Image.open(io.BytesIO(file_bytes), formats=[actual_format]) as image:
            total_pixels = 0
            for frame in range(MAX_IMAGE_FRAMES + 1):
                try:
                    image.seek(frame)
                except EOFError:
                    break
                pixels = image.width * image.height
                total_pixels += pixels
                if frame == MAX_IMAGE_FRAMES or pixels > MAX_IMAGE_PIXELS or total_pixels > MAX_TOTAL_IMAGE_PIXELS:
                    raise HTTPException(413, "Image animation or dimensions exceed processing limits.")
                image.load()
        return extension, mime_type
    except (Image.DecompressionBombError, Image.DecompressionBombWarning):
        raise HTTPException(413, "Image dimensions exceed the allowed pixel limit.") from None
    except (UnidentifiedImageError, OSError, ValueError, SyntaxError, EOFError):
        raise HTTPException(400, "Invalid or corrupted image file. Upload a valid raster image.") from None
    finally:
        _validation_slots.release()


def image_response(file_bytes: bytes) -> Response:
    """Only verified raster bytes may render inline, including legacy assets."""
    headers = {"Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
               "Content-Security-Policy": "sandbox", "Referrer-Policy": "no-referrer"}
    try:
        _, mime_type = validate_image(file_bytes)
    except HTTPException as error:
        if error.status_code == 503:
            raise
        mime_type = "application/octet-stream"
        headers["Content-Disposition"] = "attachment"
    return Response(file_bytes, media_type=mime_type, headers=headers)
