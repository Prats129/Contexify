import os
import sys
from pathlib import Path

# Add backend directory to Python path
backend_dir = Path(__file__).resolve().parent.parent
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from app.core.config import settings
from app.core.logging import logger
from app.api.v1.endpoints import document, chat, health

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
app.include_router(document.router, prefix=f"{settings.API_V1_STR}/document", tags=["Documents"])
app.include_router(chat.router, prefix=f"{settings.API_V1_STR}/chat", tags=["Chat"])

# Mount Frontend static files
FRONTEND_DIR = settings.WORKSPACE_DIR / "frontend"
if FRONTEND_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(FRONTEND_DIR)), name="static")

@app.get("/")
async def root():
    index_file = FRONTEND_DIR / "index.html"
    if index_file.exists():
        return FileResponse(index_file)
    return {"message": "Enterprise RAG API Engine is running. Access /docs for API schema."}

@app.on_event("startup")
async def startup_event():
    logger.info(f"Starting {settings.PROJECT_NAME}...")
    logger.info(f"API documentation available at /docs")
