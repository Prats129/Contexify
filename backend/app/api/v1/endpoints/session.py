from fastapi import APIRouter, HTTPException, status
from typing import List
from pydantic import BaseModel
from app.schemas.session import (
    ChatSessionCreate,
    ChatSessionResponse,
    ChatSessionUpdate,
    SessionHistoryResponse
)
from app.services.chat_history_service import chat_history_service

router = APIRouter()

class TitleUpdatePayload(BaseModel):
    title: str

@router.post("/create", response_model=ChatSessionResponse, status_code=status.HTTP_201_CREATED)
async def create_session(req: ChatSessionCreate):
    """
    Create a new chat conversation thread for a given user.
    """
    session = chat_history_service.create_session(
        user_id=req.user_id,
        title=req.title or "New Conversation",
        mode=req.mode
    )
    return session

@router.get("/list", response_model=List[ChatSessionResponse])
async def list_sessions(user_id: str):
    """
    List all chat sessions for a given user ordered by most recently active.
    """
    return chat_history_service.list_user_sessions(user_id)

@router.get("/{session_id}/history", response_model=SessionHistoryResponse)
async def get_session_history(session_id: str):
    """
    Get full message history, citations, and attached documents for a session.
    """
    history = chat_history_service.get_session_history(session_id)
    if not history:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Chat session '{session_id}' not found."
        )
    return history

@router.patch("/{session_id}/title")
async def update_session_title(session_id: str, payload: TitleUpdatePayload):
    """
    Rename a chat conversation thread.
    """
    if not payload.title.strip():
        raise HTTPException(status_code=400, detail="Title cannot be empty.")
    success = chat_history_service.update_session_title(session_id, payload.title.strip())
    if not success:
        raise HTTPException(status_code=404, detail="Session not found.")
    return {"message": "Title updated successfully", "title": payload.title.strip()}

@router.delete("/{session_id}")
async def delete_session(session_id: str):
    """
    Delete a chat session and cascade delete its messages and document associations.
    """
    success = chat_history_service.delete_session(session_id)
    if not success:
        raise HTTPException(status_code=404, detail="Session not found.")
    return {"message": f"Session '{session_id}' deleted successfully."}
