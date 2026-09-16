import sys
from pathlib import Path

# Add backend directory to Python path
backend_dir = Path(__file__).resolve().parent.parent
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from app.core.config import settings
from app.core.logging import logger
from app.db.database import init_db
from app.api.v1.endpoints import document, chat, health, user, session

app = FastAPI(
    title=settings.PROJECT_NAME,
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc"
)

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# API Routers
app.include_router(health.router, prefix=f"{settings.API_V1_STR}/health", tags=["Health"])
app.include_router(user.router, prefix=f"{settings.API_V1_STR}/user", tags=["Users"])
app.include_router(session.router, prefix=f"{settings.API_V1_STR}/session", tags=["Sessions"])
app.include_router(document.router, prefix=f"{settings.API_V1_STR}/document", tags=["Documents"])
app.include_router(chat.router, prefix=f"{settings.API_V1_STR}/chat", tags=["Chat"])

from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

# Check for production frontend build
frontend_dist = settings.WORKSPACE_DIR / "frontend" / "dist"

if frontend_dist.exists() and (frontend_dist / "index.html").exists():
    # Mount /assets if it exists
    assets_dir = frontend_dist / "assets"
    if assets_dir.exists():
        app.mount("/assets", StaticFiles(directory=str(assets_dir)), name="assets")

    # SPA catch-all route: serves static files or index.html for client routing
    @app.get("/{full_path:path}")
    async def serve_frontend(full_path: str):
        if full_path.startswith("api/") or full_path.startswith("docs") or full_path.startswith("redoc") or full_path.startswith("openapi.json"):
            raise HTTPException(status_code=404, detail="Not Found")
        candidate = frontend_dist / full_path
        if candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(frontend_dist / "index.html")
else:
    @app.get("/")
    async def root():
        return {
            "status": "online",
            "service": settings.PROJECT_NAME,
            "version": "1.0.0",
            "api_docs": "/docs",
            "frontend_dev_url": "http://localhost:8000"
        }

import asyncio
from app.services.chat_history_service import chat_history_service

_cleanup_task: asyncio.Task = None

async def _periodic_temporary_cleanup():
    while True:
        try:
            await asyncio.sleep(21600)  # Every 6 hours
            chat_history_service.purge_expired_temporary_sessions()
        except asyncio.CancelledError:
            break
        except Exception as e:
            logger.error(f"Error in periodic temporary cleanup: {e}")

@app.on_event("startup")
async def startup_event():
    global _cleanup_task
    logger.info(f"Starting {settings.PROJECT_NAME}...")
    init_db()
    # Run initial cleanup of expired temporary conversations
    try:
        chat_history_service.purge_expired_temporary_sessions()
    except Exception as e:
        logger.warning(f"Initial temporary chat purge notice: {e}")
    # Launch periodic background cleanup
    _cleanup_task = asyncio.create_task(_periodic_temporary_cleanup())
    logger.info("API documentation available at /docs")

@app.on_event("shutdown")
async def shutdown_event():
    global _cleanup_task
    if _cleanup_task and not _cleanup_task.done():
        _cleanup_task.cancel()
