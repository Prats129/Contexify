# Contexify 🧠⚡

**Contexify** is an enterprise-grade AI knowledge engine combining Document Retrieval-Augmented Generation (RAG) and real-time Web Search. Powered by a high-performance **FastAPI** backend with **ChromaDB** vector storage and a sleek, modern **React + TypeScript (Vite) + Tailwind CSS** frontend.

---

## 🌟 Key Features & Enhancements

### 🔍 1. Interactive Perplexity-Style Citation Engine
- **Collapsible Sources Card**: Real-time right-hand sources card with dual controls (collapse into a compact pill bar or hide completely).
- **Rich Source Attribution**: Verifiable citations with auto-detected domain favicons, source URLs with external link navigation, and matching text previews.
- **Optimized Chat Layout**: Fluid conversation column with docked input container strictly below messages, preserving a clean workspace.

### 📄 2. Document-Grounded RAG (`DOCUMENT_RAG`)
- **Multi-Format Ingestion**: Upload PDF, TXT, MD, CSV, JSON, and DOCX files with native drag-and-drop workspace overlay.
- **Vector Search with ChromaDB**: Semantic chunking, persistent vector embeddings, and similarity-scored context injection.
- **Document Management**: Multi-document attachments, per-document deletion, and isolated user workspace scoping.

### 🌐 3. Real-Time Live Web Search (`WEB_SEARCH`)
- **Web Grounding Engine**: Real-time search query formulation and synthesis (default search mode).
- **Crisp & Concise Output**: Synthesized answers calibrated for fast readability, offering in-depth explanations on demand.
- **Multi-Turn Conversation Memory**: Context-aware chat history retention across message turns within each session.

### 👥 4. Authentication & Profile Management
- **User Accounts & Guest Mode**:
  - **Authenticated Users**: Persistent relational chat sessions, profile customization, and session history management.
  - **Guest Access**: Ephemeral, memory-only session mode with zero database footprint.
- **Profile Photo & Avatar Studio**: Upload custom profile photos (PNG, JPG, WEBP, GIF up to 2MB) with live circular preview, photo removal, and fallback initials.
- **Account Security**: Password updates with old password verification and bcrypt encryption.
- **Chat Management**: "Clear Chat" feature to reset message history while preserving active uploaded documents.

### 🎨 5. Theme & Appearance Customization
- **Theme Modes**: One-click switching between Dark Mode and Light Mode.
- **Accent Color Palettes**: 7 vibrant accent color themes (*Ocean Blue, Royal Purple, Emerald Forest, Sunset Rose, Amber Gold, Cyan Wave, Indigo Night*).
- **Access Control**: Appearance preferences are securely tied to authenticated user accounts.

### 💻 6. Modern Tech Stack
- **Frontend**: React 18, TypeScript 5, Vite, Tailwind CSS, `react-icons`, and Server-Sent Events (SSE) streaming.
- **Backend**: Python 3.11+, FastAPI, ChromaDB, Google Gemini API, SQLite / SQLAlchemy, and Pydantic v2.

---

## 📁 Project Structure

```text
Contexify/
├── backend/
│   ├── app/
│   │   ├── api/v1/          # Endpoints (auth, users, sessions, chat, documents, health)
│   │   ├── core/            # Config, security (JWT, hashing), database session
│   │   ├── models/          # SQLAlchemy relational models (User, Session, Message, Doc)
│   │   ├── schemas/         # Pydantic data contracts
│   │   └── services/        # LLM (Gemini), RAG, ChromaDB embeddings, Web search
│   ├── data/
│   │   ├── chroma_db/       # Persistent Chroma vector store (git-ignored)
│   │   ├── uploads/         # Uploaded documents and avatars (git-ignored)
│   │   └── contexify.db     # SQLite relational database
│   ├── requirements.txt     # Python backend dependencies
│   ├── reset_db.py          # Database & vector store reset utility
│   ├── verify_rag.py        # Automated RAG & LLM verification script
│   └── verify_persistence.py# Database & auth persistence test script
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── Chat/        # ChatWorkspace, MessageList, MessageItem, SourcesPopover, ChatInput, ChatHeader
│   │   │   ├── Sidebar/     # Sidebar, SessionHistory, DocumentList, UserProfileCard
│   │   │   └── Modals/      # UserModal (Login, Register, Profile, Security, Themes)
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
Create a `.env` file in `backend/.env` (or copy from `backend/.env.example`):

```env
GEMINI_API_KEY=your_google_gemini_api_key_here
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

This project is licensed under the MIT License.
