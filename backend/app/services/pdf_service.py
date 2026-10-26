"""Bounded PDF extraction without importing application code in the worker."""

import json
import os
import subprocess
import sys
import threading
from pathlib import Path
from typing import List, Tuple

from app.core.config import settings

_slots = threading.BoundedSemaphore(settings.PDF_MAX_CONCURRENT_PARSERS)
_worker = Path(__file__).with_name("pdf_worker.py")


class PDFProcessingError(ValueError):
    def __init__(self, message: str, status_code: int = 422):
        super().__init__(message)
        self.status_code = status_code


def extract_pdf_pages(file_path: Path) -> List[Tuple[str, int]]:
    if file_path.stat().st_size > settings.PDF_MAX_FILE_SIZE_BYTES:
        raise PDFProcessingError(
            f"PDF exceeds the upload size limit ({settings.PDF_MAX_FILE_SIZE_BYTES / (1024 * 1024):g} MB). "
            "Upload a smaller PDF.",
            413,
        )
    if not _slots.acquire(blocking=False):
        raise PDFProcessingError("PDF processing is busy. Please retry shortly.", 503)
    try:
        command = [
            sys.executable,
            "-I",
            "-B",
            str(_worker),
            str(file_path.resolve()),
            str(settings.PDF_MAX_PAGES),
            str(settings.PDF_MAX_TEXT_CHARS),
            str(settings.PDF_PARSE_MEMORY_MB),
            str(settings.PDF_PARSE_TIMEOUT_SECONDS),
        ]
        # Preserve Windows path expansion without passing application credentials.
        environment = {
            key: value
            for key, value in os.environ.items()
            if key.upper()
            in {
                "SYSTEMROOT",
                "SYSTEMDRIVE",
                "WINDIR",
                "PATH",
                "TEMP",
                "TMP",
                "LANG",
                "LC_ALL",
            }
        }
        try:
            with subprocess.Popen(
                command,
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
                env=environment,
                text=True,
                encoding="utf-8",
                creationflags=subprocess.CREATE_NO_WINDOW
                if sys.platform == "win32"
                else 0,
            ) as process:
                try:
                    output, _ = process.communicate(
                        timeout=settings.PDF_PARSE_TIMEOUT_SECONDS
                    )
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.communicate()
                    raise PDFProcessingError(
                        "PDF processing timed out. Try a smaller document."
                    ) from None
        except OSError:
            raise PDFProcessingError(
                "PDF processing is unavailable. Please retry shortly.", 503
            ) from None
        if process.returncode:
            raise PDFProcessingError("PDF could not be processed within safety limits.")
        try:
            result = json.loads(output)
        except json.JSONDecodeError:
            raise PDFProcessingError(
                "PDF could not be processed within safety limits."
            ) from None
        if "error" in result:
            raise PDFProcessingError(result["error"], result["status_code"])
        return [(text, number) for text, number in result["pages"]]
    finally:
        _slots.release()
