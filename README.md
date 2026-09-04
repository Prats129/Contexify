# Contexify 🧠⚡

**Contexify** is an enterprise-grade AI knowledge engine combining Document Retrieval-Augmented Generation (RAG) and real-time Web Search. Powered by a high-performance **FastAPI** backend with **ChromaDB** vector storage and a sleek, modern **React + TypeScript (Vite) + Tailwind CSS** frontend.

---

## 🌟 Key Features & Enhancements

### ⏱️ 1. ChatGPT-Style Prompt Timeline & Chat Pagination
- **Vertical Tick Rail**: Minimalist vertical indicator rail pinned along the right edge of the viewport with real-time active prompt tracking.
- **Interactive Hover Flyout Menu**: Hovering over the rail smoothly expands a floating dark-mode card listing all user prompts with intelligent truncation.
- **Direct Jump & Focus Glow**: Clicking any prompt line or tick triggers a smooth scroll directly to that question, accompanied by a momentary focus pulse animation.
- **Stepwise Turn Navigation**: Quick previous/next prompt pagination chevrons (`▲` / `▼`) for rapid scanning across long conversations.
- **Side-by-Side Drawer Coexistence**: Adaptive layout spacing ensuring seamless simultaneous usage of both the Prompt Timeline and the Sources drawer.

### 🔍 2. Interactive Perplexity-Style Citation Engine
- **Collapsible Sources Card**: Real-time right-hand sources card with dual controls (collapse into a compact pill bar or hide completely).
- **Rich Source Attribution**: Verifiable citations with auto-detected domain favicons, source URLs with external link navigation, and matching text previews.
- **Optimized Chat Layout**: Fluid conversation column with docked input container strictly below messages, preserving a clean workspace.

### 📄 3. Document-Grounded RAG (`DOCUMENT_RAG`)
- **Multi-Format Ingestion**: Upload PDF, TXT, MD, CSV, JSON, and DOCX files with native drag-and-drop workspace overlay.
- **Vector Search with ChromaDB**: Semantic chunking, persistent vector embeddings, and similarity-scored context injection.
- **Document Management**: Multi-document attachments, per-document deletion, and isolated user workspace scoping.

### 🌐 4. Real-Time Live Web Search (`WEB_SEARCH`)
- **Web Grounding Engine**: Real-time search query formulation and synthesis (default search mode).
- **Multi-Turn Conversation Memory**: Context-aware chat history retention across message turns within each session.

### 👥 5. Advanced Authentication & User Management
- **One-Click Google OAuth 2.0**: Direct Sign In and Sign Up with Google, automatic account provisioning, and Google avatar profile synchronization.
- **Email OTP Passwordless Login**: Secure 6-digit one-time passcode login dispatched directly to the user's registered email with resend cooldown and attempt rate limiting.
- **Self-Service Password Reset via OTP**: Logged-out password recovery via verified email OTP with validation disallowing reuse of existing passwords.
- **High-Performance Async Email Dispatch**: Non-blocking asynchronous SMTP delivery (`asyncio.create_task`) yielding near-instant `<15ms` UI transitions.
- **Enterprise-Grade Password Security**: Cryptographic PBKDF2-HMAC-SHA256 password hashing with 100,000 iterations, 16-byte unique cryptographic salts, and timing-attack-safe comparison (`secrets.compare_digest`).
- **Streamlined Authentication Modal**: Clean sub-method switcher pills (`[ 🔒 Password ] [ ✉️ Email OTP ]`), official Google integration, and ephemeral Guest mode.
- **Profile Photo & Avatar Studio**: Custom profile picture uploads (PNG, JPG, WEBP, GIF up to 2MB) with live preview, removal, and fallback initials.
- **Relational Session Scoping**: Isolated chat sessions, message history, and custom themes tied securely to user accounts.

### 🎨 6. Theme & Appearance Customization
- **Theme Modes**: One-click switching between Dark Mode and Light Mode.
- **Accent Color Palettes**: 7 vibrant accent color themes (*Ocean Blue, Royal Purple, Emerald Forest, Sunset Rose, Amber Gold, Cyan Wave, Indigo Night*).
- **Access Control**: Appearance preferences are securely tied to authenticated user accounts.

### 💻 7. Modern Tech Stack
- **Frontend**: React 18, TypeScript 5, Vite, Tailwind CSS, `react-icons`, Google Identity Services, and Server-Sent Events (SSE) streaming.
- **Backend**: Python 3.11+, FastAPI, ChromaDB, Google Gemini API, SQLite / aiosqlite, and Pydantic v2.

---

## 📁 Project Structure

```text
Contexify/
├── backend/
│   ├── app/
│   │   ├── api/v1/          # Endpoints (auth, users, sessions, chat, documents, health)
│   │   ├── core/            # Config, security (PBKDF2 hashing, salts), database connection
│   │   ├── db/              # SQLite database schema, initialization, and migrations
│   │   ├── schemas/         # Pydantic data contracts (Users, Auth, Chat, Documents)
│   │   └── services/        # LLM (Gemini), RAG, ChromaDB embeddings, Email (SMTP), User service
│   ├── data/
│   │   ├── chroma_db/       # Persistent Chroma vector store (git-ignored)
│   │   ├── uploads/         # Uploaded documents and avatars (git-ignored)
│   │   └── app.db           # SQLite relational database
│   ├── requirements.txt     # Python backend dependencies
│   ├── verify_otp_auth.py   # Automated Email OTP test suite
│   ├── verify_password_reset.py # Automated Password Reset test suite
│   ├── verify_google_auth.py# Automated Google OAuth test suite
│   └── verify_rag.py        # Automated RAG & LLM verification script
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── Chat/        # ChatWorkspace, MessageList, MessageItem, ChatPromptTimeline, SourcesPopover, ChatInput, ChatHeader
│   │   │   ├── Sidebar/     # Sidebar, SessionHistory, DocumentList, UserProfileCard
│   │   │   └── Modals/      # UserModal (Google Auth, Password Login, Email OTP, Password Reset, Profile)
│   │   ├── context/         # ThemeContext (Mode & Accent palette management)
│   │   ├── services/        # API client & SSE streaming services
│   │   └── types/           # TypeScript interface definitions
│   ├── package.json         # Frontend dependencies & Vite scripts
│   ├── tsconfig.json        # TypeScript configuration
│   └── vite.config.ts       # Vite configuration & backend API proxy
├── package.json             # Monorepo root script runner (concurrently)
└── README.md                # Project documentation
```

---

## 🚀 Getting Started

### Prerequisites
- **Python 3.11+**
- **Node.js 18+** & **npm**

---

### 1. Install & Setup Project
From the repository root (`Contexify/`):

```powershell
# Install root script runner and setup both frontend & backend virtualenv
npm install
npm run setup
```

---

### 2. Configure Environment Variables

1. In `backend/.env` (or copy from `backend/.env.example`):
   ```env
   # Gemini API Key (Required for LLM & embeddings)
   GEMINI_API_KEY=your_google_gemini_api_key_here

   # Google OAuth 2.0 (Optional - for Google Sign-In)
   GOOGLE_CLIENT_ID=your_client_id.apps.googleusercontent.com

   # SMTP Email Settings (Optional - for Email OTP & Password Reset)
   SMTP_HOST=sandbox.smtp.mailtrap.io
   SMTP_PORT=2525
   SMTP_USER=your_smtp_user
   SMTP_PASSWORD=your_smtp_password
   SMTP_FROM_EMAIL=noreply@contexify.ai
   SMTP_FROM_NAME=Contexify
   SMTP_USE_TLS=True
   ```

2. In `frontend/.env`:
   ```env
   VITE_GOOGLE_CLIENT_ID=your_client_id.apps.googleusercontent.com
   ```

---

### 3. Run the Application
Start both the FastAPI backend and Vite frontend concurrently:

```powershell
npm run dev
```

* **Frontend Application**: [http://localhost:8000](http://localhost:8000)
* **FastAPI Backend**: [http://127.0.0.1:8001](http://127.0.0.1:8001)
* **Interactive API Documentation (Swagger UI)**: [http://127.0.0.1:8001/docs](http://127.0.0.1:8001/docs)

---

## 🛠️ Available NPM Scripts

Run all common commands from the repository root:

| Command | Description |
| :--- | :--- |
| **`npm run dev`** | Runs **both** FastAPI backend and React frontend concurrently. |
| **`npm run dev:backend`** | Runs only the FastAPI backend server (with auto-reload). |
| **`npm run dev:frontend`** | Runs only the Vite frontend dev server (with HMR). |
| **`npm run setup`** | Installs frontend dependencies, creates backend `venv`, and installs Python packages. |
| **`npm run setup:backend`** | Creates backend `venv` and installs `requirements.txt`. |
| **`npm run build:frontend`** | Compiles TypeScript and builds the production bundle into `frontend/dist/`. |
| **`npm run db:reset`** | Runs `reset_db.py` to clear ChromaDB vector embeddings, uploaded files, and chat history. |

---

## 🧪 Verification & Testing

Verify vector indexing, retrieval accuracy, and database persistence:

```powershell
# From backend directory with venv activated:
python verify_rag.py
python verify_persistence.py
```

---

## 📜 License

Copyright © 2026 Contexify. All rights reserved.
