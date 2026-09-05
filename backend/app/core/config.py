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
    DEFAULT_EMBEDDING_MODEL: str = "gemini-embedding-001"
    DEFAULT_LLM_MODEL: str = "gemini-3.5-flash"
    FALLBACK_LLM_MODELS: list[str] = ["gemini-3.6-flash", "gemini-3.5-flash-lite"]
    GOOGLE_CLIENT_ID: str = Field(default="", env="GOOGLE_CLIENT_ID")

    # SMTP Email Configuration
    SMTP_HOST: str = Field(default="", env="SMTP_HOST")
    SMTP_PORT: int = Field(default=587, env="SMTP_PORT")
    SMTP_USER: str = Field(default="", env="SMTP_USER")
    SMTP_PASSWORD: str = Field(default="", env="SMTP_PASSWORD")
    SMTP_FROM_EMAIL: str = Field(default="noreply@contexify.ai", env="SMTP_FROM_EMAIL")
    SMTP_FROM_NAME: str = Field(default="Contexify", env="SMTP_FROM_NAME")
    SMTP_USE_TLS: bool = Field(default=True, env="SMTP_USE_TLS")
    SMTP_USE_SSL: bool = Field(default=False, env="SMTP_USE_SSL")

    # OTP Authentication Settings
    OTP_EXPIRY_SECONDS: int = 180  # 3 minutes
    OTP_RESEND_COOLDOWN_SECONDS: int = 30  # 0.5 minute between OTP resends
    OTP_MAX_ATTEMPTS: int = 3

    model_config = SettingsConfigDict(
        env_file=[str(BASE_DIR / ".env"), ".env"],
        env_file_encoding="utf-8",
        extra="ignore"
    )

settings = Settings()

# Ensure directories exist
settings.DATA_DIR.mkdir(parents=True, exist_ok=True)
settings.CHROMA_PERSIST_DIR.mkdir(parents=True, exist_ok=True)
settings.UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
