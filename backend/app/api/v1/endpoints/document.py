import os
import shutil
from pathlib import Path
from typing import Optional
from fastapi import APIRouter, UploadFile, File, Form, HTTPException, status
from app.core.config import settings
from app.core.logging import logger
from app.schemas.document import (
    DocumentUploadResponse,
    DocumentListResponse,
    DocumentChunksResponse,
    DocumentChunkItem
)
from app.services.rag_service import rag_service
from app.services.chat_history_service import chat_history_service
from app.repositories.session_store import session_store_repo
from app.repositories.vector_store import vector_store_repo

router = APIRouter()

ALLOWED_EXTENSIONS = {".pdf", ".txt", ".md", ".csv", ".json", ".log"}

@router.post("/upload", response_model=DocumentUploadResponse, status_code=status.HTTP_201_CREATED)
async def upload_document(
    file: UploadFile = File(...),
    session_id: str = Form(...),
    user_id: Optional[str] = Form(None)
):
    """
    Upload and index a document (PDF, TXT, MD, CSV, JSON, LOG) into the RAG vector knowledge base.
    """
    filename = file.filename or "uploaded_document"
    ext = Path(filename).suffix.lower()

    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unsupported file type '{ext}'. Allowed formats: {', '.join(ALLOWED_EXTENSIONS)}"
        )

    # Save temp file
    temp_file_path = settings.UPLOAD_DIR / f"{session_id}_{filename}"
    try:
        with open(temp_file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
    except Exception as e:
        logger.error(f"Failed to save file: {e}")
        raise HTTPException(status_code=500, detail="Failed to save uploaded file.")

    try:
        # Ingest and Index
        doc_metadata = rag_service.process_and_index_document(
            file_path=temp_file_path,
            filename=filename,
            session_id=session_id,
            user_id=user_id
        )

        return DocumentUploadResponse(
            document=doc_metadata,
            message=f"Document '{filename}' uploaded and vectorized successfully ({doc_metadata.total_chunks} chunks)."
        )
    except Exception as e:
        logger.error(f"Error processing document: {e}")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        # Cleanup temp file
        if temp_file_path.exists():
            try:
                os.remove(temp_file_path)
            except Exception:
                pass

@router.get("/list", response_model=DocumentListResponse)
async def list_documents(session_id: str):
    """
    List all documents attached to the specified session.
    """
    session = session_store_repo.get_or_create_session(session_id)
    docs = []
    for doc_id in session.document_ids:
        metadata = session_store_repo.get_document_metadata(doc_id)
        if metadata:
            docs.append(metadata)

    return DocumentListResponse(documents=docs, total_count=len(docs))

@router.get("/{document_id}/chunks", response_model=DocumentChunksResponse)
async def get_document_chunks(document_id: str):
    """
    Retrieve all chunk breakdown and text preview for an indexed document.
    """
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
async def delete_document(document_id: str, session_id: str):
    """
    Delete a document and purge its vectors from ChromaDB.
    """
    vector_store_repo.delete_document(document_id)
    session_store_repo.remove_document(document_id)
    chat_history_service.touch_session(session_id)
    return {"message": f"Document '{document_id}' removed successfully."}

@router.post("/clear-all")
async def clear_all_documents():
    """
    Purge all vector embeddings from ChromaDB and clear document records.
    """
    vector_store_repo.clear_all()
    return {"message": "All vectors and collections cleared from ChromaDB successfully."}


