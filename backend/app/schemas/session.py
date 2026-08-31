from pydantic import BaseModel, Field
from typing import List, Optional
from app.schemas.chat import ChatMode, Citation
from app.schemas.document import DocumentMetadata

class ChatSessionCreate(BaseModel):
    user_id: str
    title: Optional[str] = "New Conversation"
    mode: Optional[ChatMode] = ChatMode.WEB_SEARCH

class ChatSessionUpdate(BaseModel):
    title: Optional[str] = None
    mode: Optional[ChatMode] = None

class TitleUpdatePayload(BaseModel):
    title: str = Field(..., min_length=1, max_length=100, description="New title for the session")

class ModeUpdatePayload(BaseModel):
    mode: ChatMode = Field(..., description="Target chat mode (DOCUMENT_RAG or WEB_SEARCH)")


class ChatSessionResponse(BaseModel):
    id: str
    user_id: str
    title: str
    mode: ChatMode
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
    created_at: str

class SessionHistoryResponse(BaseModel):
    session: ChatSessionResponse
    messages: List[MessageResponse]
    documents: List[DocumentMetadata]
