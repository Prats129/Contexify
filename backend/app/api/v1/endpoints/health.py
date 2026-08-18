from fastapi import APIRouter
from app.core.config import settings

router = APIRouter()

@router.get("/")
async def health_check():
    """System health check endpoint."""
    return {
        "status": "online",
        "project": settings.PROJECT_NAME,
        "chroma_dir": str(settings.CHROMA_PERSIST_DIR),
        "has_gemini_key": bool(settings.GEMINI_API_KEY)
    }
