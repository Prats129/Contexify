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
    DATA_DIR: Path = Field(default_factory=lambda: Path(os.environ.get("DATA_DIR", str(BASE_DIR / "data"))))
    
    @property
    def CHROMA_PERSIST_DIR(self) -> Path:
        return self.DATA_DIR / "chroma_db"

    @property
    def UPLOAD_DIR(self) -> Path:
        return self.DATA_DIR / "uploads"

    @property
    def MEDIA_DIR(self) -> Path:
        return self.DATA_DIR / "media"

    @property
    def UPLOAD_IMAGE_DIR(self) -> Path:
        return self.MEDIA_DIR / "uploads"

    @property
    def GENERATED_IMAGE_DIR(self) -> Path:
        return self.MEDIA_DIR / "generated"
    
    # API Keys & Models
    GEMINI_API_KEY: str = Field(default="", env="GEMINI_API_KEY")
    DEFAULT_EMBEDDING_MODEL: str = "gemini-embedding-001"
    EMBEDDING_DIMENSION: int = 768
    DEFAULT_LLM_MODEL: str = "gemini-3.5-flash"
    FALLBACK_LLM_MODELS: list[str] = ["gemini-3-flash-preview"]
    DEFAULT_IMAGE_MODEL: str = "imagen-3.0-generate-002"
    FALLBACK_IMAGE_MODELS: list[str] = ["imagen-3.0-generate-001", "imagen-3.0-fast-generate-001"]
    GOOGLE_CLIENT_ID: str = Field(default="", env="GOOGLE_CLIENT_ID")

    # Database & Vector Store Execution Mode: "local" (SQLite + ChromaDB) or "cloud" (Turso + Pinecone)
    DB_MODE: str = Field(default="local", env="DB_MODE")
    VECTOR_STORE_TYPE: str = Field(default="", env="VECTOR_STORE_TYPE")  # Optional override: "chromadb" | "pinecone"
    DATABASE_TYPE: str = Field(default="", env="DATABASE_TYPE")          # Optional override: "sqlite" | "turso"

    # Object Storage Mode: "cloudflare" (Cloudflare R2 S3-compatible) or "local" (local disk)
    STORAGE_MODE: str = Field(default="cloudflare", env="STORAGE_MODE")

    # Cloudflare R2 Object Storage Configuration (S3-Compatible)
    CLOUDFLARE_R2_ACCOUNT_ID: str = Field(default="", env="CLOUDFLARE_R2_ACCOUNT_ID")
    CLOUDFLARE_R2_ACCESS_KEY_ID: str = Field(default="", env="CLOUDFLARE_R2_ACCESS_KEY_ID")
    CLOUDFLARE_R2_SECRET_ACCESS_KEY: str = Field(default="", env="CLOUDFLARE_R2_SECRET_ACCESS_KEY")
    CLOUDFLARE_R2_BUCKET_NAME: str = Field(default="contexify", env="CLOUDFLARE_R2_BUCKET_NAME")
    CLOUDFLARE_R2_PUBLIC_URL: str = Field(default="", env="CLOUDFLARE_R2_PUBLIC_URL")
    CLOUDFLARE_R2_ENDPOINT_URL: str = Field(default="", env="CLOUDFLARE_R2_ENDPOINT_URL")

    @property
    def r2_endpoint_url(self) -> str:
        if self.CLOUDFLARE_R2_ENDPOINT_URL:
            return self.CLOUDFLARE_R2_ENDPOINT_URL.strip().rstrip("/")
        if self.CLOUDFLARE_R2_ACCOUNT_ID:
            return f"https://{self.CLOUDFLARE_R2_ACCOUNT_ID.strip()}.r2.cloudflarestorage.com"
        return ""

    @property
    def is_cloudflare_r2_configured(self) -> bool:
        mode = (self.STORAGE_MODE or "").strip().lower()
        if mode in ["local", "disk"]:
            return False
        return bool(
            self.CLOUDFLARE_R2_ACCESS_KEY_ID
            and self.CLOUDFLARE_R2_SECRET_ACCESS_KEY
            and self.CLOUDFLARE_R2_BUCKET_NAME
            and (self.CLOUDFLARE_R2_ACCOUNT_ID or self.CLOUDFLARE_R2_ENDPOINT_URL)
        )

    # Turso Cloud Database Configuration
    TURSO_DATABASE_URL: str = Field(default="", env="TURSO_DATABASE_URL")
    TURSO_AUTH_TOKEN: str = Field(default="", env="TURSO_AUTH_TOKEN")

    # Pinecone Vector Database Configuration
    PINECONE_API_KEY: str = Field(default="", env="PINECONE_API_KEY")
    PINECONE_INDEX_NAME: str = Field(default="contexify", env="PINECONE_INDEX_NAME")

    # Brevo HTTP Email API (Port 443 - Bypasses Render & cloud host SMTP port blocking)
    BREVO_API_KEY: str = Field(default="", env="BREVO_API_KEY")
    BREVO_FROM_EMAIL: str = Field(default="contexifyindia@gmail.com", env="BREVO_FROM_EMAIL")
    BREVO_FROM_NAME: str = Field(default="Contexify", env="BREVO_FROM_NAME")

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

    # Temporary Chat Retention Settings
    TEMPORARY_CHAT_RETENTION_DAYS: int = 3  # Temporary conversations automatically purged after 3 days

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
settings.MEDIA_DIR.mkdir(parents=True, exist_ok=True)
settings.UPLOAD_IMAGE_DIR.mkdir(parents=True, exist_ok=True)
settings.GENERATED_IMAGE_DIR.mkdir(parents=True, exist_ok=True)
