from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from app.schemas.chat import ChatRequest, ChatMode
from app.services.orchestrator import chat_orchestrator

router = APIRouter()

@router.post("/stream")
async def chat_stream(request: ChatRequest):
    """
    Server-Sent Events (SSE) streaming chat endpoint.
    Streams tokens, citations, and status events in real-time.
    """
    return StreamingResponse(
        chat_orchestrator.route_and_stream(request),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"
        }
    )
