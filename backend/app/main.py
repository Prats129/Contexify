import sys
from pathlib import Path

# Add backend directory to Python path
backend_dir = Path(__file__).resolve().parent.parent
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

from fastapi import FastAPI
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

@app.get("/")
async def root():
    return {
        "status": "online",
        "service": settings.PROJECT_NAME,
        "version": "1.0.0",
        "api_docs": "/docs",
        "frontend_dev_url": "http://localhost:8000"
    }

@app.on_event("startup")
async def startup_event():
    logger.info(f"Starting {settings.PROJECT_NAME}...")
    init_db()
    logger.info("API documentation available at /docs")
