import asyncio
import os
import tempfile
import uuid
from functools import partial
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status

from app.core.config import settings
from app.core.logging import logger
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
    DocumentUploadResponse,
)
from app.services.chat_history_service import chat_history_service
from app.services.pdf_service import PDFProcessingError
from app.services.rag_service import rag_service

router = APIRouter()

ALLOWED_EXTENSIONS = {".pdf", ".txt", ".md", ".csv", ".json", ".log"}

@router.post("/upload", response_model=DocumentUploadResponse, status_code=status.HTTP_201_CREATED)
async def upload_document(
    file: UploadFile = File(...),
    session_id: str = Form(...),
    user_id: Optional[str] = Form(None),
    principal: Principal = Depends(require_principal)
):
    """
    Upload and index a document (PDF, TXT, MD, CSV, JSON, LOG) into the RAG vector knowledge base.
    """
    check_user_claim(user_id, principal)
    ensure_session(session_id, principal)
    user_id = principal.user_id
    filename = Path((file.filename or "uploaded_document").replace("\\", "/")).name
    ext = Path(filename).suffix.lower()

    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unsupported file type '{ext}'. Allowed formats: {', '.join(ALLOWED_EXTENSIONS)}"
        )

    # Read file content once for disk caching and object storage upload
    try:
        content = await file.read(settings.PDF_MAX_FILE_SIZE_BYTES + 1) if ext == ".pdf" else await file.read()
    except Exception as e:
        logger.exception(f"Failed to read uploaded file: {e}")
        raise HTTPException(status_code=500, detail="Failed to read uploaded file.")

    if ext == ".pdf" and len(content) > settings.PDF_MAX_FILE_SIZE_BYTES:
        raise HTTPException(413, "PDF exceeds the upload size limit.")

    temp_file_path = None
    try:
        with tempfile.NamedTemporaryFile(mode="wb", suffix=ext, dir=settings.UPLOAD_DIR, delete=False) as buffer:
            temp_file_path = Path(buffer.name)
            buffer.write(content)
    except Exception as e:
        logger.exception(f"Failed to save temp file: {e}")
        if temp_file_path is not None:
            try:
                temp_file_path.unlink(missing_ok=True)
            except OSError:
                logger.warning("Could not remove failed temporary upload", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to save uploaded file.")

    try:
        # Reject unsafe PDFs before persisting the raw file or indexing anything.
        pages = await asyncio.to_thread(rag_service.extract_text_from_file, temp_file_path) if ext == ".pdf" else None
        storage_url = ""
        try:
            from app.services.storage_service import storage_service
            storage_key = f"documents/{session_id}/{uuid.uuid4().hex}{ext}"
            storage_url, _ = storage_service.upload_file(
                file_bytes=content,
                destination_key=storage_key,
                content_type=file.content_type or "application/octet-stream"
            )
        except Exception as e:
            logger.warning(f"Could not upload raw document to storage service: {e}", exc_info=True)

        # Ingest and Index
        ingest = partial(rag_service.process_and_index_document, file_path=temp_file_path,
                         filename=filename, session_id=session_id, user_id=user_id, storage_url=storage_url)
        if ext == ".pdf":
            doc_metadata = await asyncio.to_thread(ingest, extracted_pages=pages)
        else:
            doc_metadata = ingest()

        doc_metadata.storage_url = download_url(doc_metadata.document_id, principal, "document")
        return DocumentUploadResponse(
            document=doc_metadata,
            message=f"Document '{filename}' uploaded and vectorized successfully ({doc_metadata.total_chunks} chunks)."
        )
    except PDFProcessingError as e:
        raise HTTPException(e.status_code, str(e)) from None
    except Exception as e:
        logger.exception(f"Error processing document: {e}")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        # Cleanup temp file
        if temp_file_path.exists():
            try:
                os.remove(temp_file_path)
            except OSError:
                logger.warning("Could not remove temporary upload", exc_info=True)

@router.get("/list", response_model=DocumentListResponse)
async def list_documents(session_id: str, principal: Principal = Depends(require_principal)):
    """
    List all documents attached to the specified session.
    """
    check_session(session_id, principal)
    session = session_store_repo.get_or_create_session(session_id)
    docs = []
    for doc_id in session.document_ids:
        metadata = session_store_repo.get_document_metadata(doc_id)
        if metadata:
            docs.append(metadata.model_copy(update={"storage_url": download_url(doc_id, principal, "document")}))

    return DocumentListResponse(documents=docs, total_count=len(docs))

@router.get("/{document_id}/chunks", response_model=DocumentChunksResponse)
async def get_document_chunks(document_id: str, principal: Principal = Depends(require_principal)):
    """
    Retrieve all chunk breakdown and text preview for an indexed document.
    """
    check_asset(document_id, principal, "document")
    metadata = session_store_repo.get_document_metadata(document_id)
    raw_chunks = vector_store_repo.get_document_chunks(document_id)
    filename = metadata.filename if metadata else "Document"

    chunk_items = [
        DocumentChunkItem(
            chunk_id=c["chunk_id"],
            chunk_index=c["chunk_index"],
            page_number=c.get("page_number"),
            text=c["text"]
        )
        for c in raw_chunks
    ]

    return DocumentChunksResponse(
        document_id=document_id,
        filename=filename,
        total_chunks=len(chunk_items),
        chunks=chunk_items
    )

@router.delete("/{document_id}")
async def delete_document(document_id: str, session_id: str, principal: Principal = Depends(require_principal)):
    """
    Delete a document and purge its vectors from ChromaDB.
    """
    row = check_asset(document_id, principal, "document")
    check_session(session_id, principal)
    if row["session_id"] != session_id:
        raise HTTPException(404, "Document not found in this session.")
    vector_store_repo.delete_document(document_id)
    session_store_repo.remove_document(document_id)
    chat_history_service.touch_session(session_id)
    return {"message": f"Document '{document_id}' removed successfully."}

@router.post("/clear-all")
async def clear_all_documents(principal: Principal = Depends(require_admin)):
    """
    Purge all vector embeddings from ChromaDB and clear document records.
    """
    vector_store_repo.clear_all()
    return {"message": "All vectors and collections cleared from ChromaDB successfully."}


