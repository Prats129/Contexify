# Contexify 🧠⚡

**Contexify** is an enterprise-grade AI knowledge engine combining Document Retrieval-Augmented Generation (RAG) and real-time live Web Search. Built with a **FastAPI** backend, **Turso Cloud Database** for relational storage, **Pinecone Serverless Vector Store** for semantic search, and a modern **React + TypeScript + Tailwind CSS** frontend.

---

## 🌟 Key Features

- **🔍 Live Web Search & Grounding**: Real-time query synthesis with inline Perplexity-style citations, source favicons, and collapsible citation cards.
- **📄 Document-Grounded RAG**: Upload PDF, TXT, MD, CSV, and DOCX files. Powered by **Pinecone Serverless** vector search using calibrated 768-dimensional Gemini embeddings, with automatic local **ChromaDB** fallback.
- **⏱️ ChatGPT-Style Prompt Timeline**: Vertical indicator rail pinned to the viewport with real-time tracking, hover flyout menu, direct jump with pulse animation, and stepwise pagination chevrons (`▲`/`▼`).
- **🛡️ Custom Glassmorphic Modals**: Completely eliminates browser `alert()` and `confirm()` dialogs in favor of sleek, theme-adaptive modals (centered logout with user details, delete chat with title highlight, and non-blocking error notices).
- **👥 Enterprise Authentication**:
  - **Google OAuth 2.0** one-click sign-in with profile synchronization.
  - **Email OTP Passwordless Login** with rate limiting and resend cooldowns.
  - **Self-Service Password Reset** via email OTP.
  - **PBKDF2-HMAC-SHA256** password hashing with 100,000 iterations and unique cryptographic salts.
  - **Turso Cloud Database** (`libsql`) for distributed relational persistence.
- **🎨 Theme & Personalization**: Dark Mode and Light Mode with 7 curated accent color palettes (*Ocean Blue, Royal Purple, Emerald Forest, Sunset Rose, Amber Gold, Cyan Wave, Indigo Night*).
- **⚡ Real-Time Streaming Controls**: Server-Sent Events (SSE) streaming with instantaneous Stop Generation support.

---

## 💻 Tech Stack

| Layer | Technologies |
| :--- | :--- |
| **Frontend** | React 18, TypeScript, Vite, Tailwind CSS, Lucide Icons (`react-icons`) |
| **Backend** | Python 3.11+, FastAPI, Uvicorn, Pydantic v2 |
| **Databases** | **Turso** (Cloud SQLite via `libsql`), **Pinecone** (Serverless Vector Index), **ChromaDB** (Fallback) |
| **AI / LLM** | Google Gemini (`gemini-3.5-flash`, `gemini-embedding-001` with 768-dim calibration) |
| **Auth & Email** | Google OAuth 2.0, Async SMTP (Mailtrap / Gmail) |

---

## 🚀 Quick Start

### Prerequisites
- **Python 3.11+**
- **Node.js 18+** & **npm**

### 1. Installation
Clone the repository and install all dependencies from the root directory:

```bash
git clone https://github.com/Prats129/Contexify.git
cd Contexify

npm install
npm run setup
```

### 2. Environment Configuration

Create a `backend/.env` file:

```env
# Google Gemini API (Required for LLM & embeddings)
GEMINI_API_KEY=your_gemini_api_key_here

# Turso Cloud Database (Required for users & sessions)
TURSO_DATABASE_URL=libsql://your-db.aws-region.turso.io
TURSO_AUTH_TOKEN=your_turso_jwt_token_here

# Pinecone Vector Store (Required for RAG)
PINECONE_API_KEY=your_pinecone_api_key_here
PINECONE_INDEX_NAME=contexify

# Google OAuth 2.0 (Optional)
GOOGLE_CLIENT_ID=your_google_client_id.apps.googleusercontent.com

# SMTP Email Relay (Optional - for Email OTP & Password Reset)
SMTP_HOST=sandbox.smtp.mailtrap.io
SMTP_PORT=2525
SMTP_USER=your_smtp_user
SMTP_PASSWORD=your_smtp_password
SMTP_FROM_EMAIL=noreply@contexify.ai
SMTP_FROM_NAME=Contexify
SMTP_USE_TLS=True
```

Create a `frontend/.env` file:

```env
VITE_GOOGLE_CLIENT_ID=your_google_client_id.apps.googleusercontent.com
```

### 3. Run the Development Server

```bash
npm run dev
```

- **Frontend Application**: [http://localhost:8000](http://localhost:8000)
- **FastAPI Backend Server**: [http://127.0.0.1:8001](http://127.0.0.1:8001)
- **Interactive Swagger Docs**: [http://127.0.0.1:8001/docs](http://127.0.0.1:8001/docs)

---

## 📁 Project Structure

```text
Contexify/
├── backend/
│   ├── app/
│   │   ├── api/v1/          # REST & SSE API routes (chat, auth, sessions, docs)
│   │   ├── core/            # App configuration and security utilities
│   │   ├── db/              # Database schema & initialization
│   │   ├── repositories/    # Data stores (Turso relational, Pinecone/Chroma vector)
│   │   ├── schemas/         # Pydantic data models & contracts
│   │   └── services/        # Orchestrator, RAG, Gemini LLM, Email service
│   └── requirements.txt     # Backend Python dependencies
├── frontend/
│   ├── src/
│   │   ├── components/      # Chat workspace, Sidebar, Custom Modals
│   │   ├── context/         # ThemeContext, ConfirmContext
│   │   ├── services/        # API client & SSE streaming service
│   │   └── types/           # TypeScript interface definitions
│   └── package.json         # Frontend dependencies & Vite configuration
├── package.json             # Root monorepo script runner
└── README.md                # Project documentation
```

---

## 🛠️ Available Scripts

Run these commands from the repository root:

| Command | Description |
| :--- | :--- |
| `npm run dev` | Starts both backend (port 8001) and frontend (port 8000) concurrently. |
| `npm run dev:backend` | Starts only the FastAPI server with hot-reload. |
| `npm run dev:frontend` | Starts only the Vite frontend dev server. |
| `npm run build:frontend`| Type-checks and builds the production frontend bundle into `frontend/dist/`. |
| `npm run setup` | Installs frontend packages and sets up the Python virtual environment. |

---

## 📜 License

This project is licensed under the MIT License. Copyright © 2026 Contexify.
