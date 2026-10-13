import asyncio
import sys
from contextlib import asynccontextmanager, suppress
from pathlib import Path

# Add backend directory to Python path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.api.v1.endpoints import chat, document, health, media, session, user
from app.core.config import settings
from app.core.logging import logger
from app.db.database import init_db
from app.services.chat_history_service import chat_history_service


async def _periodic_temporary_cleanup():
    while True:
        try:
            await asyncio.sleep(21600)  # Every 6 hours
            chat_history_service.purge_expired_temporary_sessions()
        except asyncio.CancelledError:
            break
        except Exception:
            logger.exception("Error in periodic temporary cleanup")


@asynccontextmanager
async def lifespan(application: FastAPI):
    logger.info(f"Starting {settings.PROJECT_NAME}...")
    init_db()
    try:
        chat_history_service.purge_expired_temporary_sessions()
    except Exception:
        logger.warning("Initial temporary chat purge notice", exc_info=True)
    cleanup_task = asyncio.create_task(_periodic_temporary_cleanup())
    logger.info("API documentation available at /docs")
    try:
        yield
    finally:
        cleanup_task.cancel()
        with suppress(asyncio.CancelledError):
            await cleanup_task


app = FastAPI(
    title=settings.PROJECT_NAME,
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
    lifespan=lifespan,
)

# Configure CORS and middlewares
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
app.include_router(media.router, prefix=f"{settings.API_V1_STR}/media", tags=["Media"])
app.include_router(chat.router, prefix=f"{settings.API_V1_STR}/chat", tags=["Chat"])

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
        if full_path.startswith(("api/", "docs", "redoc", "openapi.json")):
            raise HTTPException(status_code=404, detail="Not Found")
        candidate = (frontend_dist / full_path).resolve()
        if not candidate.is_relative_to(frontend_dist.resolve()):
            raise HTTPException(status_code=404, detail="Not Found")
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
