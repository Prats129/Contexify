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
│   ├── app/
│   │   ├── api/             # FastAPI routers & endpoints
│   │   ├── core/            # Config, settings, logging
│   │   ├── db/              # Database models, connection & migrations
│   │   ├── repositories/    # Database query abstractions
│   │   ├── schemas/         # Pydantic models & request/response schemas
│   │   ├── services/        # RAG, ChromaDB, Web Search & LLM logic
│   │   └── main.py          # FastAPI application entrypoint
│   ├── data/
│   │   ├── chroma_db/       # Persistent Chroma vector store
│   │   └── uploads/         # Ingested documents
│   ├── venv/                # Python virtual environment
│   └── verify_rag.py        # Automated test & verification script
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── Chat/        # Chat container, message bubbles, input
│   │   │   ├── Modals/      # User account & auth modals
│   │   │   └── Sidebar/     # History, document dropzone, mode selector
│   │   ├── services/        # API clients & SSE streaming handler
│   │   ├── styles/          # Design system & CSS modules
│   │   ├── types/           # TypeScript interfaces & types
│   │   ├── App.tsx          # Root UI coordinator
│   │   └── main.tsx         # React DOM entrypoint
│   ├── index.html           # HTML template
│   ├── package.json         # Node.js dependencies & scripts
│   ├── tsconfig.json        # TypeScript configuration
│   └── vite.config.ts       # Vite build & proxy configuration
└── README.md                # Project documentation
```

---

## 🚀 Getting Started

### Prerequisites
- **Python 3.11+**
- **Node.js 18+** & **npm** (or `pnpm`)

---

### 1. Backend Setup

1. **Navigate to the backend directory and activate the virtual environment**:
   - **Windows (PowerShell)**:
     ```powershell
     cd backend
     .\venv\Scripts\Activate.ps1
     ```
   - **Windows (CMD)**:
     ```cmd
     cd backend
     venv\Scripts\activate.bat
     ```
   - **Linux / macOS**:
     ```bash
     cd backend
     source venv/bin/activate
     ```

2. **Environment Variables**:
   Create a `.env` file inside `backend/` or at the root:
   ```env
   GEMINI_API_KEY=your_gemini_api_key_here
   ```

3. **Start the FastAPI Server**:
   ```bash
   uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
   ```
   The backend API will be available at `http://127.0.0.1:8000` (Swagger docs at `http://127.0.0.1:8000/docs`).

---

### 2. Frontend Setup

1. **Navigate to the frontend directory**:
   ```bash
   cd frontend
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Start the development server**:
   ```bash
   npm run dev
   ```
   The frontend will be accessible at `http://localhost:5173`. Requests to `/api` are automatically proxied to the backend at `http://127.0.0.1:8000`.

4. **Production Build**:
   ```bash
   npm run build
   ```

---

## 🧪 Verification & Testing

To test document upload, vector indexing, ChromaDB retrieval, SSE streaming, and web search integration:

```bash
python backend/verify_rag.py
```

---

## 📜 License

This project is licensed under the MIT License.
