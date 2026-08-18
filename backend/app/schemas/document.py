from pydantic import BaseModel, Field
from typing import List, Optional
from datetime import datetime

class DocumentMetadata(BaseModel):
    document_id: str
    filename: str
    file_type: str
    file_size_bytes: int
    total_chunks: int
    uploaded_at: str

class DocumentUploadResponse(BaseModel):
    document: DocumentMetadata
    message: str

class DocumentListResponse(BaseModel):
    documents: List[DocumentMetadata]
    total_count: int

class ChunkMetadata(BaseModel):
    document_id: str
    filename: str
    chunk_index: int
    page_number: Optional[int] = None
    source_excerpt: str
    similarity_score: float
