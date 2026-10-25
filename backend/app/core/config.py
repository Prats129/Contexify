import os
from pathlib import Path
from typing import Self

from pydantic import Field, ValidationInfo, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parent.parent.parent
WORKSPACE_DIR = BASE_DIR.parent


class Settings(BaseSettings):
    BASE_DIR: Path = BASE_DIR
    WORKSPACE_DIR: Path = WORKSPACE_DIR
    PROJECT_NAME: str = "Enterprise AI RAG & Web Search Engine"
    API_V1_STR: str = "/api/v1"

    # Security & CORS
    CORS_ORIGINS: list[str] = ["*"]

    MODEL_HISTORY_MESSAGES: int = Field(default=40, ge=10, le=200)
    SESSION_CACHE_MAX_ENTRIES: int = Field(default=128, ge=1, le=4096)
    DOCUMENT_CACHE_MAX_ENTRIES: int = Field(default=512, ge=1, le=16384)
    SESSION_CACHE_TTL_SECONDS: int = Field(default=1800, ge=1)
    DOCUMENT_MAX_FILE_SIZE_BYTES: int = Field(default=25 * 1024 * 1024, ge=1)
    DOCUMENT_MAX_TEXT_CHARS: int = Field(default=2_000_000, ge=1)
    DOCUMENT_MAX_CONCURRENT_INGESTIONS: int = Field(default=2, ge=1, le=16)
    DOCUMENT_MAX_CHUNKS: int = Field(default=5000, ge=1, le=20000)

    # RAG Settings
    CHUNK_SIZE: int = 800
    CHUNK_OVERLAP: int = 150
    TOP_K_RETRIEVAL: int = 4
    SIMILARITY_THRESHOLD: float = 0.2

    PDF_MAX_FILE_SIZE_BYTES: int = Field(default=25 * 1024 * 1024, ge=1)
    PDF_MAX_PAGES: int = Field(default=1000, ge=1)
    PDF_MAX_TEXT_CHARS: int = Field(default=2_000_000, ge=1)
    PDF_PARSE_TIMEOUT_SECONDS: float = Field(default=30, ge=0.1, le=300)
    PDF_PARSE_MEMORY_MB: int = Field(default=256, ge=64, le=4096)
    PDF_MAX_CONCURRENT_PARSERS: int = Field(default=2, ge=1, le=16)

    # Vector DB Storage
    DATA_DIR: Path = Field(
        default_factory=lambda: Path(os.environ.get("DATA_DIR", str(BASE_DIR / "data")))
    )

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
    # Workers AI credentials are separate from R2's S3 access keys.
    CLOUDFLARE_AI_ACCOUNT_ID: str = ""
    CLOUDFLARE_AI_API_TOKEN: str = ""
    IMAGE_GENERATION_TIMEOUT_SECONDS: float = Field(default=120, ge=1, le=300)
    IMAGE_GENERATION_MAX_ATTEMPTS: int = Field(default=3, ge=1, le=3)
    GOOGLE_CLIENT_ID: str = Field(default="", env="GOOGLE_CLIENT_ID")

    # Database & Vector Store Execution Mode: "local" (SQLite + ChromaDB) or "cloud" (Turso + Pinecone)
    DB_MODE: str = Field(default="local", env="DB_MODE")
    VECTOR_STORE_TYPE: str = Field(
        default="", env="VECTOR_STORE_TYPE"
    )  # Optional override: "chromadb" | "pinecone"
    DATABASE_TYPE: str = Field(
        default="", env="DATABASE_TYPE"
    )  # Optional override: "sqlite" | "turso"

    # Object Storage Mode: "cloudflare" (Cloudflare R2 S3-compatible) or "local" (local disk)
    # Unspecified mode preserves existing R2 deployments; fresh installs use local disk.
    STORAGE_MODE: str = Field(default="", env="STORAGE_MODE")

    # Cloudflare R2 Object Storage Configuration (S3-Compatible)
    CLOUDFLARE_R2_ACCOUNT_ID: str = Field(default="", env="CLOUDFLARE_R2_ACCOUNT_ID")
    CLOUDFLARE_R2_ACCESS_KEY_ID: str = Field(
        default="", env="CLOUDFLARE_R2_ACCESS_KEY_ID"
    )
    CLOUDFLARE_R2_SECRET_ACCESS_KEY: str = Field(
        default="", env="CLOUDFLARE_R2_SECRET_ACCESS_KEY"
    )
    CLOUDFLARE_R2_BUCKET_NAME: str = Field(
        default="contexify", env="CLOUDFLARE_R2_BUCKET_NAME"
    )
    CLOUDFLARE_R2_PUBLIC_URL: str = Field(default="", env="CLOUDFLARE_R2_PUBLIC_URL")
    CLOUDFLARE_R2_ENDPOINT_URL: str = Field(
        default="", env="CLOUDFLARE_R2_ENDPOINT_URL"
    )

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
    BREVO_FROM_EMAIL: str = Field(
        default="contexifyindia@gmail.com", env="BREVO_FROM_EMAIL"
    )
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

    AUTH_SESSION_TTL_SECONDS: int = Field(default=604800, ge=60)
    GUEST_SESSION_TTL_SECONDS: int = Field(default=86400, ge=60)
    DOWNLOAD_TICKET_TTL_SECONDS: int = Field(default=3600, ge=60, le=86400)
    ADMIN_USER_IDS: list[str] = []

    # OTP Authentication Settings
    OTP_EXPIRY_SECONDS: int = 180  # 3 minutes
    OTP_RESEND_COOLDOWN_SECONDS: int = 30  # 0.5 minute between OTP resends
    OTP_MAX_ATTEMPTS: int = 3
    OTP_MAX_SENDS_PER_HOUR: int = Field(default=5, ge=1)

    # Shared token-bucket capacities; each refills over the named period.
    RATE_LIMIT_AUTH_PER_MINUTE: int = Field(default=30, ge=1)
    RATE_LIMIT_LOGIN_PER_15_MINUTES: int = Field(default=10, ge=1)
    RATE_LIMIT_GUEST_PER_HOUR: int = Field(default=10, ge=1)
    RATE_LIMIT_AI_PER_MINUTE: int = Field(default=20, ge=1)
    RATE_LIMIT_AI_PER_DAY: int = Field(default=200, ge=1)
    RATE_LIMIT_GUEST_AI_PER_MINUTE: int = Field(default=5, ge=1)
    RATE_LIMIT_GUEST_AI_PER_DAY: int = Field(default=20, ge=1)
    RATE_LIMIT_AI_IP_PER_MINUTE: int = Field(default=60, ge=1)
    RATE_LIMIT_AI_GLOBAL_PER_DAY: int = Field(default=1000, ge=1)

    # Temporary Chat Retention Settings
    TEMPORARY_CHAT_RETENTION_DAYS: int = (
        3  # Temporary conversations automatically purged after 3 days
    )

    @field_validator(
        "DB_MODE", "DATABASE_TYPE", "VECTOR_STORE_TYPE", "STORAGE_MODE", mode="before"
    )
    @classmethod
    def normalize_storage_modes(cls, value: object, info: ValidationInfo) -> str:
        aliases = {
            "DB_MODE": {
                "local": "local",
                "sqlite": "local",
                "chroma": "local",
                "chromadb": "local",
                "cloud": "cloud",
                "turso-pinecone": "cloud",
                "turso": "cloud",
                "pinecone": "cloud",
                "production": "cloud",
            },
            "DATABASE_TYPE": {
                "": "",
                "local": "sqlite",
                "sqlite": "sqlite",
                "turso": "turso",
            },
            "VECTOR_STORE_TYPE": {
                "": "",
                "local": "chromadb",
                "chroma": "chromadb",
                "chromadb": "chromadb",
                "pinecone": "pinecone",
            },
            "STORAGE_MODE": {
                "": "",
                "local": "local",
                "disk": "local",
                "cloudflare": "cloudflare",
                "r2": "cloudflare",
            },
        }
        normalized = str(value).strip().lower()
        field = info.field_name or ""
        if normalized not in aliases[field]:
            raise ValueError(
                f"Unsupported {info.field_name}; select a documented storage mode."
            )
        return aliases[field][normalized]

    @model_validator(mode="after")
    def validate_selected_backends(self) -> Self:
        if not self.STORAGE_MODE:
            r2_values = (
                self.CLOUDFLARE_R2_ACCOUNT_ID,
                self.CLOUDFLARE_R2_ENDPOINT_URL,
                self.CLOUDFLARE_R2_ACCESS_KEY_ID,
                self.CLOUDFLARE_R2_SECRET_ACCESS_KEY,
            )
            self.STORAGE_MODE = (
                "cloudflare" if any(value.strip() for value in r2_values) else "local"
            )

        def configured(name: str) -> bool:
            value = str(getattr(self, name, "")).strip()
            if name in ("PINECONE_INDEX_NAME", "CLOUDFLARE_R2_BUCKET_NAME"):
                return bool(value)
            return bool(value) and not value.lower().startswith(
                ("your_", "paste_", "changeme")
            )

        required = []
        database = self.DATABASE_TYPE or (
            "turso" if self.DB_MODE == "cloud" else "sqlite"
        )
        vectors = self.VECTOR_STORE_TYPE or (
            "pinecone" if self.DB_MODE == "cloud" else "chromadb"
        )
        if database == "turso":
            required += ["TURSO_DATABASE_URL", "TURSO_AUTH_TOKEN"]
        if vectors == "pinecone":
            required += ["PINECONE_API_KEY", "PINECONE_INDEX_NAME"]
        if self.STORAGE_MODE == "cloudflare":
            required += [
                "CLOUDFLARE_R2_ACCESS_KEY_ID",
                "CLOUDFLARE_R2_SECRET_ACCESS_KEY",
                "CLOUDFLARE_R2_BUCKET_NAME",
            ]
            if not (
                configured("CLOUDFLARE_R2_ACCOUNT_ID")
                or configured("CLOUDFLARE_R2_ENDPOINT_URL")
            ):
                required += ["CLOUDFLARE_R2_ACCOUNT_ID or CLOUDFLARE_R2_ENDPOINT_URL"]
        missing = [name for name in required if not configured(name)]
        if missing:
            raise ValueError("Selected storage backends require: " + ", ".join(missing))
        return self

    model_config = SettingsConfigDict(
        env_file=[str(BASE_DIR / ".env"), ".env"],
        env_file_encoding="utf-8",
        extra="ignore",
        hide_input_in_errors=True,
    )


settings = Settings()

# Ensure directories exist
settings.DATA_DIR.mkdir(parents=True, exist_ok=True)
settings.CHROMA_PERSIST_DIR.mkdir(parents=True, exist_ok=True)
settings.UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
settings.MEDIA_DIR.mkdir(parents=True, exist_ok=True)
settings.UPLOAD_IMAGE_DIR.mkdir(parents=True, exist_ok=True)
settings.GENERATED_IMAGE_DIR.mkdir(parents=True, exist_ok=True)
