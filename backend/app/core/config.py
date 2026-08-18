import os
from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import Field

BASE_DIR = Path(__file__).resolve().parent.parent.parent
WORKSPACE_DIR = BASE_DIR.parent

class Settings(BaseSettings):
    BASE_DIR: Path = BASE_DIR
    WORKSPACE_DIR: Path = WORKSPACE_DIR
    PROJECT_NAME: str = "Enterprise AI RAG & Web Search Engine"
    API_V1_STR: str = "/api/v1"
    
    # Security & CORS
    CORS_ORIGINS: list[str] = ["*"]
    
    # RAG Settings
    CHUNK_SIZE: int = 800
    CHUNK_OVERLAP: int = 150
    TOP_K_RETRIEVAL: int = 4
    SIMILARITY_THRESHOLD: float = 0.2
    
    # Vector DB Storage
    DATA_DIR: Path = BASE_DIR / "data"
    CHROMA_PERSIST_DIR: Path = BASE_DIR / "data" / "chroma_db"
    UPLOAD_DIR: Path = BASE_DIR / "data" / "uploads"
    
    # API Keys & Models
    GEMINI_API_KEY: str = Field(default="", env="GEMINI_API_KEY")
    DEFAULT_EMBEDDING_MODEL: str = "models/text-embedding-004"
    DEFAULT_LLM_MODEL: str = "gemini-3.1-flash-lite"
    
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore"
    )

settings = Settings()

# Ensure directories exist
settings.DATA_DIR.mkdir(parents=True, exist_ok=True)
settings.CHROMA_PERSIST_DIR.mkdir(parents=True, exist_ok=True)
settings.UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
