from pydantic import BaseModel, Field, model_validator
from typing import List, Optional, Any
from app.schemas.chat import ChatMode, Citation, MediaAttachment, normalize_chat_mode
from app.schemas.document import DocumentMetadata

class ChatSessionCreate(BaseModel):
    user_id: str
    title: Optional[str] = "New Conversation"
    mode: Optional[ChatMode] = ChatMode.AUTO
    is_temporary: Optional[bool] = False

    @model_validator(mode="before")
    @classmethod
    def resolve_mode(cls, data: Any) -> Any:
        if isinstance(data, dict) and "mode" in data:
            data["mode"] = normalize_chat_mode(data.get("mode"), default=ChatMode.AUTO)
        return data

class ChatSessionUpdate(BaseModel):
    title: Optional[str] = None
    mode: Optional[ChatMode] = None

    @model_validator(mode="before")
    @classmethod
    def resolve_mode(cls, data: Any) -> Any:
        if isinstance(data, dict) and "mode" in data and data.get("mode") is not None:
            data["mode"] = normalize_chat_mode(data.get("mode"), default=None)
        return data

class TitleUpdatePayload(BaseModel):
    title: str = Field(..., min_length=1, max_length=100, description="New title for the session")

class ModeUpdatePayload(BaseModel):
    mode: ChatMode = Field(default=ChatMode.AUTO, description="Target chat mode (AUTO, DOCUMENT_RAG, WEB_SEARCH, MULTIMODAL, IMAGE_GENERATION)")

    @model_validator(mode="before")
    @classmethod
    def resolve_mode(cls, data: Any) -> Any:
        if isinstance(data, dict) and "mode" in data:
            data["mode"] = normalize_chat_mode(data.get("mode"), default=ChatMode.AUTO)
        return data


class ChatSessionResponse(BaseModel):
    id: str
    user_id: str
    title: str
    mode: ChatMode
    is_temporary: bool = False
    expires_at: Optional[str] = None
    created_at: str
    updated_at: str
    message_count: int = 0
    document_count: int = 0

class MessageResponse(BaseModel):
    id: str
    session_id: str
    role: str
    content: str
    citations: Optional[List[Citation]] = None
    attachments: Optional[List[MediaAttachment]] = None
    created_at: str

class SessionHistoryResponse(BaseModel):
    session: ChatSessionResponse
    messages: List[MessageResponse]
    documents: List[DocumentMetadata]
