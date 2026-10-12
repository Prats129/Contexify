# Project overview

Audit: 2026-10-12, commit `0c7cd717c262b4fd5afcd1d785815cb53066c85e`. [Coverage](review-coverage.md) distinguishes static review, isolated checks and outstanding verification.

## Purpose

Contexify provides conversational AI through web and mobile clients: general chat, document retrieval with citations, search-assisted answers, image analysis and image generation. Registered profiles add stored conversations, titles/pins, avatars and an attachment library. Guest chats use process memory; temporary registered chats are stored with expiry and hidden from the ordinary history list. Uploaded data can persist in both cases.

No repository evidence establishes billing, organizations, role-based access, webhooks, a durable queue or a background ingestion worker. Actual users, scale, business model and operational requirements remain unknown.

## Stack and package boundaries

| Boundary | Version evidence | Entry point |
| --- | --- | --- |
| Root | Private npm package 1.0.0; concurrently 8.2.2 resolved; no workspaces | package.json orchestrates independent packages |
| Backend | Python 3.11 Docker base; requirements use lower bounds, no lock | backend/app/main.py |
| Web | React/DOM ^18.3.1; Vite ^8.2.2; Tailwind/@tailwindcss/vite ^4.3.3; TS ^5.5.3, resolved 5.9.3 | index.html → src/main.tsx → App.tsx |
| Mobile | Expo ~57.0.21; RN 0.86.3; React 19.2.3; TS ~6.0.3 | index.ts → App.tsx |
| SQL | sqlite3 or libsql-client/Turso | db/database.py |
| Retrieval | ChromaDB or Pinecone; Google GenAI embeddings | repositories/vector_store.py, services/rag_service.py |
| Storage/providers | boto3/R2 or local files; Google GenAI text/vision/Imagen; Brevo/SMTP | services/* |
| Web evidence | requests, BeautifulSoup, XML parsing | RSS/Bing/DuckDuckGo snippets |

Observed installed backend metadata: Python 3.11.9, FastAPI 0.141.1, Starlette 1.3.1, Pydantic 2.13.5, python-multipart 0.0.32, pypdf 6.17.0, ChromaDB 1.5.9, google-genai 2.22.0, requests 2.34.2, httpx 0.28.1, libsql-client 0.3.1, Pinecone 10.0.0 and boto3 1.43.98. These are local observations, not deployment pins. AUD-012 identifies applicable PDF advisories; AUD-027 covers reproducibility.

Node 22.13.0 supported both passing TS checks. Installed Vite/plugin engines require ^20.19.0 or >=22.12.0; RN requires ^20.19.4, ^22.13.0, ^24.3.0 or >=25.0.0. README's Node 18 minimum is insufficient.

## Environment and configuration

[config.py](../backend/app/core/config.py) loads backend/.env and a working-directory .env. Actual values were not inspected.

| Concern | Keys and defaults |
| --- | --- |
| AI | GEMINI_API_KEY; DEFAULT_LLM_MODEL/FALLBACK_LLM_MODELS; DEFAULT_EMBEDDING_MODEL/EMBEDDING_DIMENSION; DEFAULT_IMAGE_MODEL/FALLBACK_IMAGE_MODELS |
| SQL/vector selection | DB_MODE; DATABASE_TYPE/VECTOR_STORE_TYPE overrides; TURSO_DATABASE_URL/TURSO_AUTH_TOKEN; PINECONE_API_KEY/PINECONE_INDEX_NAME |
| Object files | DATA_DIR; STORAGE_MODE; CLOUDFLARE_R2_* account/endpoint/credentials/bucket/public URL |
| Identity/mail | GOOGLE_CLIENT_ID; BREVO_*; SMTP_* |
| OTP | expiry 180 seconds, resend cooldown 30 seconds, max attempts 3; actual counter defect AUD-003 |
| RAG | CHUNK_SIZE 800 characters; nominal CHUNK_OVERLAP 150; TOP_K_RETRIEVAL 4; SIMILARITY_THRESHOLD 0.2 |
| Retention | temporary expiry 3 days; cleanup every 6 hours while running |
| Browser | VITE_API_BASE_URL and VITE_GOOGLE_CLIENT_ID; dev /api proxy |
| Mobile | EXPO_PUBLIC_API_URL; environment/dev-tool flags; saved server override wins |

Configured model strings include gemini-3.5-flash, gemini-3-flash-preview, gemini-embedding-001 and Imagen 3 variants. Availability/quotas were not verified. Comments refer to different model versions.

Local SQL uses DATA_DIR/app.db; Chroma uses DATA_DIR/chroma_db. SQL/vector selection and object storage selection are independent. Missing cloud configuration can select local persistence; this is not a verified recovery strategy.

## Build and deployment processes

These describe existing commands; they were not executed in the audit.

| Purpose | Mechanism | Side effects |
| --- | --- | --- |
| Web/API development | npm run dev; API 8001, Vite 8000 | starts services and initializes backend state |
| Include mobile | dev:all or dev:mobile | starts Expo |
| Web production build | build:frontend → tsc -b, vite build | writes build/config artifacts |
| Setup | setup; setup:mobile separately | installs dependencies, creates venv |
| Combined hosting | Docker Node web stage + Python runtime; Uvicorn 7860 | image build; /data persistence is deployment-dependent |
| Separate web hosting | frontend/vercel.json SPA rewrite | needs explicit API base URL; no API proxy defined |
| Native builds | deploy:mobile, deploy:mobile:bundle, deploy:mobile:ios | EAS build/config changes |
| OTA | update:mobile | publishes to preview channel/environment |
| Reset | db:reset | destructive |

No tracked CI, volume/backup deployment manifest or versioned migration framework exists. Schema CREATE/ALTER checks run at startup. Docker/Vercel/EAS files show intended delivery paths, not evidence of a working deployment.

## README corrections and strengths

Verified document formats: PDF, TXT, MD, CSV, JSON, LOG. No DOCX parser or scanned-PDF OCR exists in ingestion; the mobile picker nevertheless includes DOCX. Every PDF page is iterated, so the historical “first pages only” complaint is not a confirmed extraction limit. Active camera capture, voice input and KaTeX were not found. Temporary chats are not zero-SQL storage. A secure API identity boundary and global rate limiting are absent.

Preserve FastAPI schemas/services, parameterized SQL, salted password hashing/constant-time comparison, citation/page metadata, typed client boundaries, web history pagination/debounce, native FlatList, streaming and the local/cloud adapter approach. Current problems justify incremental repairs, not a stack replacement. See [architecture](architecture.md), [findings](audit/technical-findings.md), [roadmap](audit/prioritized-roadmap.md).

