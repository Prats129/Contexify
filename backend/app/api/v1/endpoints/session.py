from fastapi import APIRouter, HTTPException, status, Query
from typing import List, Optional, Union
from app.schemas.session import (
    ChatSessionCreate,
    ChatSessionResponse,
    ChatSessionUpdate,
    SessionHistoryResponse,
    TitleUpdatePayload,
    ModeUpdatePayload,
    PinUpdatePayload,
    PaginatedChatSessionsResponse
)
from app.services.chat_history_service import chat_history_service
from app.services.user_service import user_service
from app.repositories.session_store import session_store_repo

router = APIRouter()

@router.post("/create", response_model=ChatSessionResponse, status_code=status.HTTP_201_CREATED)
async def create_session(req: ChatSessionCreate):
    """
    Create a new chat conversation thread for a registered user.
    Guest users cannot create multiple chat sessions.
    """
    if not req.user_id or req.user_id.startswith("guest"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Guest users cannot create new chat conversations. Please sign in to create and manage multiple chats."
        )
    
    user = user_service.get_user_by_id(req.user_id)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User account not found. Please sign in first."
        )

    session = chat_history_service.create_session(
        user_id=req.user_id,
        session_id=req.session_id,
        title=req.title or "New Conversation",
        mode=req.mode,
        is_temporary=bool(req.is_temporary)
    )
    return session

@router.post("/purge-temporary")
async def purge_temporary_sessions():
    """
    Manually or cron-triggered purge of expired temporary chat sessions.
    """
    count = chat_history_service.purge_expired_temporary_sessions()
    return {"message": f"Purged {count} expired temporary session(s).", "purged_count": count}

@router.get("/list", response_model=Union[PaginatedChatSessionsResponse, List[ChatSessionResponse]])
async def list_sessions(
    user_id: str = Query(..., description="ID of the user"),
    limit: Optional[int] = Query(None, ge=1, le=100, description="Page size limit"),
    offset: int = Query(0, ge=0, description="Offset for pagination"),
    search: Optional[str] = Query(None, description="Optional search term to filter chat titles"),
    sort_by: Optional[str] = Query("last_created", description="Sort order: 'last_created' or 'first_created'"),
    paginate: Optional[bool] = Query(None, description="Explicitly request paginated object format")
):
    """
    List chat sessions for a given user ordered by pinned status and creation order.
    Supports limit/offset pagination, real-time title search, and sort_by (last_created / first_created).
    """
    is_paginated_requested = paginate is True or limit is not None or (search is not None and search.strip() != "")

    if not user_id or user_id.startswith("guest"):
        if is_paginated_requested:
            return PaginatedChatSessionsResponse(
                sessions=[],
                total=0,
                has_more=False,
                limit=limit,
                offset=offset
            )
        return []

    sessions, total = chat_history_service.list_user_sessions(
        user_id=user_id,
        limit=limit,
        offset=offset,
        search=search,
        sort_by=sort_by
    )

    has_more = (offset + len(sessions)) < total if limit is not None else False

    if is_paginated_requested:
        return PaginatedChatSessionsResponse(
            sessions=sessions,
            total=total,
            has_more=has_more,
            limit=limit,
            offset=offset
        )

    return sessions

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

@router.patch("/{session_id}/pin")
async def toggle_pin_session(session_id: str, payload: PinUpdatePayload):
    """
    Pin or unpin a chat conversation thread.
    """
    success = chat_history_service.toggle_pin_session(session_id, payload.is_pinned)
    if not success:
        raise HTTPException(status_code=404, detail="Session not found.")
    return {"message": "Session pin status updated", "session_id": session_id, "is_pinned": payload.is_pinned}

@router.patch("/{session_id}/mode")
async def update_session_mode(session_id: str, payload: ModeUpdatePayload):
    """
    Update the active chat mode (DOCUMENT_RAG or WEB_SEARCH) for a session.
    """
    session_store_repo.set_session_mode(session_id, payload.mode)
    return {"message": "Session mode updated successfully", "mode": payload.mode}

@router.delete("/{session_id}/messages")
async def clear_session_messages(session_id: str):
    """
    Clear all messages in a session while keeping documents and the session intact.
    """
    chat_history_service.clear_session_messages(session_id)
    return {"message": f"All messages cleared for session '{session_id}'."}

@router.delete("/{session_id}")
async def delete_session(session_id: str):
    """
    Delete a chat session and cascade delete its messages and document associations.
    """
    success = chat_history_service.delete_session(session_id)
    if not success:
        raise HTTPException(status_code=404, detail="Session not found.")
    return {"message": f"Session '{session_id}' deleted successfully."}

