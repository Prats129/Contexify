import json

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse

from app.core.security import (
    Principal,
    check_asset,
    check_user_claim,
    ensure_session,
    present_attachment,
    require_principal,
)
from app.schemas.chat import ChatMode, ChatRequest, MediaAttachment
from app.services.orchestrator import chat_orchestrator
from app.services.storage_service import storage_service

router = APIRouter()

@router.post("/stream")
async def chat_stream(request: ChatRequest, principal: Principal = Depends(require_principal)):
    """
    Server-Sent Events (SSE) streaming chat endpoint.
    Streams tokens, citations, and status events in real-time.
    """
    check_user_claim(request.user_id, principal)
    ensure_session(request.session_id, principal, request.mode or ChatMode.AUTO)
    request.user_id = principal.user_id
    attachments = []
    for attachment in request.attachments or []:
        kind = "document" if attachment.file_type == "document" else "media"
        row = check_asset(attachment.id or "", principal, kind)
        key = storage_service.owned_storage_key(row, kind)
        attachments.append(attachment.model_copy(update={"url": key, "file_name": row["filename"],
                                                          "mime_type": row.get("mime_type", "application/octet-stream")}))
    request.attachments = attachments

    async def authorized_stream():
        async for frame in chat_orchestrator.route_and_stream(request, principal):
            if frame.startswith("data: "):
                event = json.loads(frame[6:])
                if event.get("event") == "media" and event.get("media"):
                    attachment = present_attachment(MediaAttachment(**event["media"]), principal)
                    event["media"] = attachment.model_dump()
                    frame = f"data: {json.dumps(event)}\n\n"
            yield frame

    return StreamingResponse(
        authorized_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"
        }
    )
