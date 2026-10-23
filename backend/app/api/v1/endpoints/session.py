import uuid
from typing import List, Optional, Union

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.core.security import (
    Principal,
    check_session,
    check_user_claim,
    download_url,
    ensure_session,
    present_attachment,
    require_admin,
    require_principal,
    require_user,
)
from app.repositories.session_store import session_store_repo
from app.schemas.session import (
    ChatSessionCreate,
    ChatSessionResponse,
    ModeUpdatePayload,
    PaginatedChatSessionsResponse,
    PinUpdatePayload,
    SessionHistoryResponse,
    TitleUpdatePayload,
)
from app.services.chat_history_service import chat_history_service

router = APIRouter()


@router.post(
    "/create", response_model=ChatSessionResponse, status_code=status.HTTP_201_CREATED
)
def create_session(
    req: ChatSessionCreate, principal: Principal = Depends(require_user)
):
    check_user_claim(req.user_id, principal)
    session_id = req.session_id or str(uuid.uuid4())
    ensure_session(
        session_id,
        principal,
        req.mode,
        req.title or "New Conversation",
        bool(req.is_temporary),
    )
    return chat_history_service.get_session(session_id)


@router.post("/purge-temporary")
def purge_temporary_sessions(principal: Principal = Depends(require_admin)):
    """
    Manually or cron-triggered purge of expired temporary chat sessions.
    """
    count = chat_history_service.purge_expired_temporary_sessions()
    return {
        "message": f"Completed cleanup for {count} chat session(s).",
        "purged_count": count,
    }


@router.get(
    "/list",
    response_model=Union[PaginatedChatSessionsResponse, List[ChatSessionResponse]],
)
def list_sessions(
    user_id: str = Query(..., description="ID of the user"),
    limit: Optional[int] = Query(None, ge=1, le=100, description="Page size limit"),
    offset: int = Query(0, ge=0, description="Offset for pagination"),
    search: Optional[str] = Query(
        None, description="Optional search term to filter chat titles"
    ),
    sort_by: Optional[str] = Query(
        "last_created", description="Sort order: 'last_created' or 'first_created'"
    ),
    paginate: Optional[bool] = Query(
        None, description="Explicitly request paginated object format"
    ),
    principal: Principal = Depends(require_user),
):
    """
    List chat sessions for a given user ordered by pinned status and creation order.
    Supports limit/offset pagination, real-time title search, and sort_by (last_created / first_created).
    """
    check_user_claim(user_id, principal)
    user_id = principal.user_id
    is_paginated_requested = (
        paginate is True
        or limit is not None
        or (search is not None and search.strip() != "")
    )

    if not user_id or user_id.startswith("guest"):
        if is_paginated_requested:
            return PaginatedChatSessionsResponse(
                sessions=[], total=0, has_more=False, limit=limit, offset=offset
            )
        return []

    sessions, total = chat_history_service.list_user_sessions(
        user_id=user_id, limit=limit, offset=offset, search=search, sort_by=sort_by
    )

    has_more = (offset + len(sessions)) < total if limit is not None else False

    if is_paginated_requested:
        return PaginatedChatSessionsResponse(
            sessions=sessions,
            total=total,
            has_more=has_more,
            limit=limit,
            offset=offset,
        )

    return sessions


@router.get("/{session_id}/history", response_model=SessionHistoryResponse)
def get_session_history(
    session_id: str, principal: Principal = Depends(require_principal)
):
    """
    Get full message history, citations, and attached documents for a session.
    """
    check_session(session_id, principal)
    history = chat_history_service.get_session_history(session_id)
    if not history:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Chat session '{session_id}' not found.",
        )
    for message in history.messages:
        attachments = []
        for attachment in message.attachments or []:
            try:
                attachments.append(present_attachment(attachment, principal))
            except HTTPException as error:
                if error.status_code not in (400, 404):
                    raise
        message.attachments = attachments
    for doc in history.documents:
        if doc.storage_url:
            doc.storage_url = download_url(doc.document_id, principal, "document")
    return history


@router.patch("/{session_id}/title")
def update_session_title(
    session_id: str,
    payload: TitleUpdatePayload,
    principal: Principal = Depends(require_principal),
):
    """
    Rename a chat conversation thread.
    """
    check_session(session_id, principal)
    if not payload.title.strip():
        raise HTTPException(status_code=400, detail="Title cannot be empty.")
    success = chat_history_service.update_session_title(
        session_id, payload.title.strip()
    )
    if not success:
        raise HTTPException(status_code=404, detail="Session not found.")
    return {"message": "Title updated successfully", "title": payload.title.strip()}


@router.patch("/{session_id}/pin")
def toggle_pin_session(
    session_id: str,
    payload: PinUpdatePayload,
    principal: Principal = Depends(require_principal),
):
    """
    Pin or unpin a chat conversation thread.
    """
    check_session(session_id, principal)
    success = chat_history_service.toggle_pin_session(session_id, payload.is_pinned)
    if not success:
        raise HTTPException(status_code=404, detail="Session not found.")
    return {
        "message": "Session pin status updated",
        "session_id": session_id,
        "is_pinned": payload.is_pinned,
    }


@router.patch("/{session_id}/mode")
def update_session_mode(
    session_id: str,
    payload: ModeUpdatePayload,
    principal: Principal = Depends(require_principal),
):
    """
    Update the active chat mode (DOCUMENT_RAG or WEB_SEARCH) for a session.
    """
    check_session(session_id, principal)
    session_store_repo.set_session_mode(session_id, payload.mode)
    return {"message": "Session mode updated successfully", "mode": payload.mode}


@router.delete("/{session_id}/messages")
def clear_session_messages(
    session_id: str, principal: Principal = Depends(require_principal)
):
    """
    Clear all messages in a session while keeping documents and the session intact.
    """
    check_session(session_id, principal)
    chat_history_service.clear_session_messages(session_id)
    return {"message": f"All messages cleared for session '{session_id}'."}


@router.delete("/{session_id}")
def delete_session(session_id: str, principal: Principal = Depends(require_principal)):
    """
    Delete a chat session and cascade delete its messages and document associations.
    """
    check_session(session_id, principal)
    success = chat_history_service.delete_session(session_id)
    if not success:
        raise HTTPException(status_code=404, detail="Session not found.")
    return {
        "message": "Chat removed. Temporary file cleanup will be retried automatically if needed."
    }
