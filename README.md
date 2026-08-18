# Knowledge AI Engine (RAG & Web Search)

An enterprise Retrieval-Augmented Generation (RAG) and real-time Search platform with a Python FastAPI backend and a responsive Vanilla JavaScript / CSS frontend.

---

## 🌟 Features

- **Document Grounded RAG (`DOCUMENT_RAG`)**:
  - Upload documents (PDF, TXT, MD, CSV, etc.).
  - Vector indexing & chunking powered by ChromaDB.
  - Streaming answers with verifiable source snippets and similarity match percentages.
- **Live Web Search (`WEB_SEARCH`)**:
  - Real-time search query generation and streaming responses.
- **Modern Vanilla UI**:
  - Drag-and-drop document upload drawer.
  - Interactive mode switching.
  - Real-time Server-Sent Events (SSE) streaming chat.
  - Zero Node.js / npm dependencies needed for frontend.

---

## 📁 Project Structure

```text
├── backend/
│   ├── app/                 # FastAPI application (API endpoints, services, schemas)
│   ├── data/
│   │   ├── chroma_db/       # Persistent Chroma vector store
│   │   └── uploads/         # Uploaded documents
│   ├── venv/                # Python virtual environment
│   └── verify_rag.py        # Pipeline & endpoint verification test script
├── frontend/
│   ├── index.html           # Main UI entrypoint
│   └── src/
│       ├── app.js           # UI logic & DOM orchestration
│       ├── services/api.js  # API & SSE streaming service
│       └── styles/main.css  # App styles & theme
├── data/
│   ├── issues               # Documented feedback & planned improvements
│   └── sample_book.txt      # Sample document for verification testing
├── .gitignore               # Git ignore rules
└── README.md                # Project documentation
```

---

## 🚀 Getting Started

### 1. Prerequisites
- **Python 3.11+** installed.
- *(Note: Node.js / `npm` is **not required** because the frontend is pure HTML, CSS, and vanilla JS).*

---

### 2. Backend Setup

1. **Activate the Python virtual environment**:
   - **Windows (PowerShell)**:
     ```powershell
     backend\venv\Scripts\Activate.ps1
     ```
   - **Windows (CMD)**:
     ```cmd
     backend\venv\Scripts\activate.bat
     ```
   - **Linux / macOS**:
     ```bash
     source backend/venv/bin/activate
     ```

2. **Environment Variables**:
   Create a `.env` file in the root or `backend/` directory if configuring external LLM/Search API keys (e.g. Gemini, OpenAI, or Serper):
   ```env
   GEMINI_API_KEY=your_gemini_api_key_here
   ```

3. **Start the FastAPI Server**:
   ```bash
   uvicorn app.main:app --reload --port 8000
   ```

---

### 3. Frontend Setup

The frontend runs directly in any modern browser without needing `npm install` or a build step:
- If served by FastAPI's static mount, navigate to: `http://127.0.0.1:8000/`
- Or open [frontend/index.html](file:///e:/New%20folder%20%282%29/frontend/index.html) using any lightweight static server (e.g., Python `python -m http.server 3000` or VS Code Live Server).

---

### 4. Running Verification Tests

To verify document upload, vector indexing, document RAG SSE streaming, and web search integration:

```bash
python backend/verify_rag.py
```
