# Contexify 🧠⚡

**Contexify** is an enterprise-grade AI knowledge engine combining Document Retrieval-Augmented Generation (RAG) and real-time Web Search. Powered by a high-performance **FastAPI** backend with **ChromaDB** vector storage and a sleek, modern **React + TypeScript (Vite)** frontend.

---

## 🌟 Key Features

### 📄 1. Document-Grounded RAG (`DOCUMENT_RAG`)
- **Multi-Format Ingestion**: Upload PDF, TXT, MD, CSV, and DOCX files with drag-and-drop support.
- **Vector Search with ChromaDB**: Automatic text extraction, semantic chunking, and embedding into ChromaDB.
- **Accurate Citations & Metrics**: Real-time streaming answers with verifiable source snippets, document references, and similarity match percentages.

### 🌐 2. Live Web Search Engine (`WEB_SEARCH`)
- Real-time search query formulation and web synthesis.
- Streaming responses with live source links and search grounding.

### 👥 3. User & Session Management
- **Guest & User Accounts**: Fast guest access or authenticated user profile support.
- **Persistent Chat History**: Session switching, deletion, and conversation tagging saved in a relational database.

### 💻 4. Modern React + TypeScript UI
- **Tech Stack**: React 18, TypeScript 5, Vite 8, `react-icons`, and modular CSS.
- **Real-Time Streaming**: Smooth Server-Sent Events (SSE) token streaming.
- **Glassmorphism / Dark Theme**: Premium dark-mode UI with intuitive layout, status indicators, and responsive modals.

---

## 📁 Project Structure

```text
Contexify/
├── backend/
│   ├── app/                 # FastAPI routers, services, repositories & models
│   ├── data/
│   │   ├── chroma_db/       # Persistent Chroma vector store (git-ignored)
│   │   └── uploads/         # Ingested documents (git-ignored)
│   ├── requirements.txt     # Python backend dependencies
│   ├── reset_db.py          # Database & vector store reset utility
│   ├── verify_rag.py        # Automated RAG & LLM verification script
│   └── verify_persistence.py# Database & auth persistence verification
├── frontend/
│   ├── src/                 # React UI components, styling, services & state
│   ├── package.json         # Frontend dependencies & Vite scripts
│   ├── tsconfig.json        # TypeScript configuration
│   └── vite.config.ts       # Vite build & API proxy configuration
├── .vscode/
│   └── tasks.json           # IDE compound task runner (separate tabs)
├── package.json             # Root monorepo script runner
└── README.md                # Project documentation
```

---

## 🚀 Getting Started

### Prerequisites
- **Python 3.11+**
- **Node.js 18+** & **npm**

---

### 1. Install & Setup Project
From the root repository folder (`Contexify/`), run:

```powershell
# Install root runner and automatically set up frontend & backend virtualenv
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
Start both backend and frontend servers with a single command:

```powershell
npm run dev
```

* **Frontend App**: `http://localhost:8000`
* **FastAPI Backend**: `http://127.0.0.1:8001`
* **Interactive API Docs (Swagger)**: `http://127.0.0.1:8001/docs`

---

## 🛠️ Available Root NPM Scripts

All common workflows can be executed directly from the root `Contexify/` directory:

| Command | Description |
| :--- | :--- |
| **`npm run dev`** | Starts **both** FastAPI backend and React frontend concurrently. |
| **`npm run dev:backend`** | Starts only the FastAPI backend server (with auto-reload). |
| **`npm run dev:frontend`** | Starts only the Vite frontend dev server (with HMR). |
| **`npm run setup`** | Installs frontend dependencies, creates backend `venv`, and installs all Python requirements. |
| **`npm run setup:backend`** | Creates backend `venv` and installs all `requirements.txt` packages. |
| **`npm run build:frontend`** | Builds the production bundle of the React frontend into `frontend/dist/`. |
| **`npm run db:reset`** | Runs `backend/reset_db.py` to wipe ChromaDB vectors, uploaded files, and chat history. |

---

## 🧪 Verification & Testing

To test document ingestion, Chroma vector retrieval, and authentication persistence:

```powershell
# From backend directory with venv activated:
python verify_rag.py
python verify_persistence.py
```

---

## 📜 License

This project is licensed under the MIT License.
