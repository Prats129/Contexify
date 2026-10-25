import tempfile
import uuid
from functools import partial
from pathlib import Path
from threading import BoundedSemaphore
from typing import List, Optional, Tuple

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    File,
    Form,
    HTTPException,
    UploadFile,
    status,
)

from app.core.concurrency import run_blocking
from app.core.config import settings
from app.core.errors import DocumentLimitError, EmbeddingDimensionError, EmbeddingError
from app.core.logging import logger
from app.core.rate_limits import require_ai_budget
from app.core.security import (
    Principal,
    check_asset,
    check_session,
    check_user_claim,
    download_url,
    ensure_session,
    require_admin,
    require_principal,
)
from app.repositories.session_store import session_store_repo
from app.repositories.vector_store import vector_store_repo
from app.schemas.document import (
    DocumentChunkItem,
    DocumentChunksResponse,
    DocumentListResponse,
    DocumentMetadata,
    DocumentUploadResponse,
)
from app.services.asset_lifecycle import cleanup_asset
from app.services.chat_history_service import chat_history_service
from app.services.pdf_service import PDFProcessingError
from app.services.rag_service import rag_service
from app.services.session_lifecycle import register_resource, resource_operation
from app.services.storage_service import storage_service
from app.services.upload_lifecycle import rollback_failed_upload

router = APIRouter()
_upload_slots = BoundedSemaphore(
    getattr(settings, "DOCUMENT_MAX_CONCURRENT_INGESTIONS", 2)
)

ALLOWED_EXTENSIONS = {".pdf", ".txt", ".md", ".csv", ".json", ".log"}


@rollback_failed_upload
def _store_and_index_document(
    content: bytes,
    temp_file_path: Path,
    filename: str,
    session_id: str,
    user_id: Optional[str],
    content_type: Optional[str],
    pages: Optional[List[Tuple[str, int]]],
) -> DocumentMetadata:
    storage_key = f"documents/{session_id}/{uuid.uuid4().hex}{temp_file_path.suffix}"
    storage_url, _ = storage_service.upload_file(
        file_bytes=content,
        destination_key=storage_key,
        content_type=content_type or "application/octet-stream",
        session_id=session_id,
    )
    ingest = partial(
        rag_service.process_and_index_document,
        file_path=temp_file_path,
        filename=filename,
        session_id=session_id,
        user_id=user_id,
        storage_url=storage_url,
    )
    return ingest(extracted_pages=pages) if pages is not None else ingest()


def _remove_temp_file(path: Path) -> None:
    try:
        path.unlink(missing_ok=True)
    except OSError:
        logger.warning("Could not remove temporary upload", exc_info=True)


def _cache_document_upload(content: bytes, ext: str, session_id: str) -> Path:
    temp_file_path = None
    try:
        with resource_operation(session_id):
            with tempfile.NamedTemporaryFile(
                mode="wb", suffix=ext, dir=settings.UPLOAD_DIR, delete=False
            ) as buffer:
                temp_file_path = Path(buffer.name)
                register_resource(
                    session_id,
                    "local",
                    temp_file_path.relative_to(settings.DATA_DIR).as_posix(),
                )
                buffer.write(content)
    except HTTPException:
        if temp_file_path is not None:
            temp_file_path.unlink(missing_ok=True)
        raise
    except Exception as e:
        logger.exception(f"Failed to save temp file: {e}")
        if temp_file_path is not None:
            try:
                temp_file_path.unlink(missing_ok=True)
            except OSError:
                logger.warning(
                    "Could not remove failed temporary upload", exc_info=True
                )
        raise HTTPException(status_code=500, detail="Failed to save uploaded file.")

    return temp_file_path


def _process_document_upload(
    content: bytes,
    filename: str,
    session_id: str,
    user_id: Optional[str],
    content_type: Optional[str],
    principal: Principal,
) -> DocumentUploadResponse:
    # The same worker owns the temporary file through parsing and indexing.
    temp_file_path = _cache_document_upload(
        content, Path(filename).suffix.lower(), session_id
    )

    try:
        # Validate extracted text before persisting the raw file or indexing.
        pages = (
            rag_service.extract_text_from_file(temp_file_path)
            if temp_file_path.suffix in ALLOWED_EXTENSIONS
            else None
        )
        # Keep the attempt alive in the worker until storage/indexing actually
        # stops, even if the HTTP request is cancelled while awaiting the worker.
        doc_metadata = _store_and_index_document(
            content,
            temp_file_path,
            filename,
            session_id,
            user_id,
            content_type,
            pages,
        )

        doc_metadata.storage_url = download_url(
            doc_metadata.document_id, principal, "document"
        )
        return DocumentUploadResponse(
            document=doc_metadata,
            message=f"Document '{filename}' uploaded and vectorized successfully ({doc_metadata.total_chunks} chunks).",
        )
    except HTTPException:
        raise
    except DocumentLimitError as e:
        raise HTTPException(413, str(e)) from None
    except PDFProcessingError as e:
        raise HTTPException(e.status_code, str(e)) from None
    except (EmbeddingDimensionError, EmbeddingError) as e:
        raise HTTPException(status_code=503, detail=str(e)) from None
    except Exception as e:
        logger.exception(f"Error processing document: {e}")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        _remove_temp_file(temp_file_path)


@router.post(
    "/upload",
    response_model=DocumentUploadResponse,
    status_code=status.HTTP_201_CREATED,
)
async def upload_document(
    file: UploadFile = File(...),
    session_id: str = Form(...),
    user_id: Optional[str] = Form(None),
    is_temporary: bool = Form(False),
    principal: Principal = Depends(require_ai_budget),
):
    """
    Upload and index a document (PDF, TXT, MD, CSV, JSON, LOG) into the RAG vector knowledge base.
    """
    check_user_claim(user_id, principal)
    await run_blocking(ensure_session, session_id, principal, is_temporary=is_temporary)
    user_id = principal.user_id
    filename = Path((file.filename or "uploaded_document").replace("\\", "/")).name
    ext = Path(filename).suffix.lower()

    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unsupported file type '{ext}'. Allowed formats: {', '.join(ALLOWED_EXTENSIONS)}",
        )

    if not _upload_slots.acquire(blocking=False):
        raise HTTPException(503, "Document processing is busy. Please retry shortly.")
    try:
        max_size = (
            settings.PDF_MAX_FILE_SIZE_BYTES
            if ext == ".pdf"
            else getattr(settings, "DOCUMENT_MAX_FILE_SIZE_BYTES", 25 * 1024 * 1024)
        )
        try:
            content = await file.read(max_size + 1)
        except Exception:
            logger.exception("Failed to read uploaded document")
            raise HTTPException(500, "Failed to read uploaded file.") from None
        if len(content) > max_size:
            raise HTTPException(413, "Document exceeds the upload size limit.")

        return await run_blocking(
            _process_document_upload,
            content,
            filename,
            session_id,
            user_id,
            file.content_type,
            principal,
        )
    finally:
        _upload_slots.release()


@router.get("/list", response_model=DocumentListResponse)
def list_documents(session_id: str, principal: Principal = Depends(require_principal)):
    """
    List all documents attached to the specified session.
    """
    check_session(session_id, principal)
    session = session_store_repo.get_or_create_session(session_id)
    docs = []
    for doc_id in session.document_ids:
        metadata = session_store_repo.get_document_metadata(doc_id)
        if metadata:
            docs.append(
                metadata.model_copy(
                    update={"storage_url": download_url(doc_id, principal, "document")}
                )
            )

    return DocumentListResponse(documents=docs, total_count=len(docs))


@router.get("/{document_id}/chunks", response_model=DocumentChunksResponse)
def get_document_chunks(
    document_id: str, principal: Principal = Depends(require_principal)
):
    """
    Retrieve all chunk breakdown and text preview for an indexed document.
    """
    check_asset(document_id, principal, "document")
    metadata = session_store_repo.get_document_metadata(document_id)
    try:
        raw_chunks = vector_store_repo.get_document_chunks(document_id)
        if metadata and len(raw_chunks) != metadata.total_chunks:
            raise EmbeddingError(
                "Document preview is temporarily unavailable. Please try again later."
            )
    except EmbeddingError as error:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(error)
        ) from None
    filename = metadata.filename if metadata else "Document"

    chunk_items = [
        DocumentChunkItem(
            chunk_id=c["chunk_id"],
            chunk_index=c["chunk_index"],
            page_number=c.get("page_number"),
            text=c["text"],
        )
        for c in raw_chunks
    ]

    return DocumentChunksResponse(
        document_id=document_id,
        filename=filename,
        total_chunks=len(chunk_items),
        chunks=chunk_items,
    )


@router.delete("/{document_id}")
def delete_document(
    document_id: str,
    session_id: str,
    background_tasks: BackgroundTasks,
    principal: Principal = Depends(require_principal),
):
    """
    Delete a document and purge its vectors from ChromaDB.
    """
    row = check_asset(document_id, principal, "document")
    check_session(session_id, principal)
    if row["session_id"] != session_id:
        raise HTTPException(404, "Document not found in this session.")
    session_store_repo.remove_document(document_id, cleanup_now=False)
    background_tasks.add_task(cleanup_asset, document_id, "document")
    chat_history_service.touch_session(session_id)
    return {
        "message": "Document removed. Any pending storage cleanup will be retried automatically."
    }


@router.post("/clear-all")
def clear_all_documents(principal: Principal = Depends(require_admin)):
    """
    Purge all vector embeddings from ChromaDB and clear document records.
    """
    vector_store_repo.clear_all()
    return {
        "message": "All vectors and collections cleared from ChromaDB successfully."
    }
