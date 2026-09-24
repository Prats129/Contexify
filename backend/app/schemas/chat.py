from pydantic import BaseModel, Field, model_validator
from typing import List, Optional, Literal, Dict, Any
from enum import Enum
from app.schemas.document import ChunkMetadata

class ChatMode(str, Enum):
    AUTO = "AUTO"
    DOCUMENT_RAG = "DOCUMENT_RAG"
    WEB_SEARCH = "WEB_SEARCH"
    MULTIMODAL = "MULTIMODAL"
    IMAGE_GENERATION = "IMAGE_GENERATION"

class MediaAttachment(BaseModel):
    id: Optional[str] = None
    url: str
    file_type: str = "image"
    file_name: Optional[str] = None
    mime_type: Optional[str] = "image/png"
    file_size_bytes: Optional[int] = 0
    media_type: Optional[str] = "upload" # "upload" | "generated"
    prompt: Optional[str] = None

class ChatRequest(BaseModel):
    session_id: str = Field(..., description="Unique identifier for chat thread")
    message: Optional[str] = Field(default=None, description="User question or query")
    query: Optional[str] = Field(default=None, description="Alternative field for user query")
    mode: Optional[ChatMode] = Field(default=ChatMode.AUTO)
    attachments: Optional[List[MediaAttachment]] = Field(default_factory=list, description="Attached media such as images or documents")

    @model_validator(mode="before")
    @classmethod
    def resolve_message_or_query(cls, data: Any) -> Any:
        if isinstance(data, dict):
            msg = data.get("message") or data.get("query")
            if msg:
                data["message"] = str(msg)
                data["query"] = str(msg)
        return data

class Citation(BaseModel):
    document_id: str
    filename: str
    page_number: Optional[int] = None
    chunk_index: int
    snippet: str
    similarity_score: float

class StreamChunkResponse(BaseModel):
    event: Literal["token", "citations", "media", "error", "done"]
    data: str
    citations: Optional[List[Citation]] = None
    media: Optional[MediaAttachment] = None

class SessionState(BaseModel):
    session_id: str
    mode: ChatMode
    document_ids: List[str] = []
    messages: List[Dict[str, Any]] = []
    created_at: str
