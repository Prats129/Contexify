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

import uuid

MODE_ALIASES: Dict[str, ChatMode] = {
    "DOC": ChatMode.DOCUMENT_RAG,
    "RAG": ChatMode.DOCUMENT_RAG,
    "DOCUMENT": ChatMode.DOCUMENT_RAG,
    "DOCUMENT_RAG": ChatMode.DOCUMENT_RAG,
    "WEB": ChatMode.WEB_SEARCH,
    "SEARCH": ChatMode.WEB_SEARCH,
    "WEB_SEARCH": ChatMode.WEB_SEARCH,
    "VISION": ChatMode.MULTIMODAL,
    "MULTIMODAL": ChatMode.MULTIMODAL,
    "DRAW": ChatMode.IMAGE_GENERATION,
    "IMAGE": ChatMode.IMAGE_GENERATION,
    "IMAGE_GENERATION": ChatMode.IMAGE_GENERATION,
    "AUTO": ChatMode.AUTO,
}

def normalize_chat_mode(val: Any, default: Optional[ChatMode] = ChatMode.AUTO) -> Optional[ChatMode]:
    """Normalize strings, aliases, or enum members to a valid ChatMode instance."""
    if val is None:
        return default
    if isinstance(val, ChatMode):
        return val
    if isinstance(val, str):
        cleaned = val.strip().upper()
        if cleaned in MODE_ALIASES:
            return MODE_ALIASES[cleaned]
        try:
            return ChatMode(cleaned)
        except ValueError:
            return default
    return default

class MediaAttachment(BaseModel):
    id: Optional[str] = None
    url: str = ""
    file_type: str = "image"
    file_name: Optional[str] = None
    mime_type: Optional[str] = "image/png"
    file_size_bytes: Optional[int] = 0
    media_type: Optional[str] = "upload" # "upload" | "generated"
    prompt: Optional[str] = None

class ChatRequest(BaseModel):
    session_id: str = Field(default_factory=lambda: f"guest_{uuid.uuid4().hex[:12]}", description="Unique identifier for chat thread")
    user_id: Optional[str] = Field(default=None, description="Optional ID of authenticated user")
    message: Optional[str] = Field(default="", description="User question or query")
    query: Optional[str] = Field(default="", description="Alternative field for user query")
    mode: Optional[ChatMode] = Field(default=ChatMode.AUTO)
    attachments: Optional[List[MediaAttachment]] = Field(default_factory=list, description="Attached media such as images or documents")

    @model_validator(mode="before")
    @classmethod
    def resolve_chat_request(cls, data: Any) -> Any:
        if isinstance(data, dict):
            # 1. Fallback for session_id
            sid = data.get("session_id")
            if not sid:
                data["session_id"] = f"guest_{uuid.uuid4().hex[:12]}"
            else:
                data["session_id"] = str(sid)

            # 2. Case-insensitive mode resolution and aliases
            data["mode"] = normalize_chat_mode(data.get("mode"), default=ChatMode.AUTO)

            # 3. Resolve user_id if provided
            uid = data.get("user_id")
            if uid:
                data["user_id"] = str(uid).strip()

            # 4. Resolve message or query
            msg = data.get("message") or data.get("query") or ""
            data["message"] = str(msg)
            data["query"] = str(msg)

            # 5. Clean attachments
            raw_att = data.get("attachments")
            if isinstance(raw_att, list):
                clean_att = []
                for a in raw_att:
                    if isinstance(a, dict):
                        # Ensure url exists or map from uri
                        if not a.get("url"):
                            a["url"] = a.get("uri") or a.get("file_url") or ""
                        clean_att.append(a)
                data["attachments"] = clean_att
            elif raw_att is None:
                data["attachments"] = []

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
