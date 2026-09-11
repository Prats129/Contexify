# Contexify 🧠⚡

**Contexify** is an enterprise-grade AI knowledge engine combining Document Retrieval-Augmented Generation (RAG) and real-time live Web Search across both modern **Web** and native **Mobile (iOS & Android)** platforms.

Powered by a high-performance **FastAPI** backend, **Turso Cloud Database** for relational storage, **Pinecone Serverless Vector Store** for semantic retrieval, and clients built with **React + TypeScript + Tailwind CSS** (Web) and **React Native + Expo** (Mobile).

---

## 🌟 Key Features

### 🔍 Live Web Search & Grounding

- Real-time search query synthesis powered by Google Gemini.
- Inline Perplexity-style numeric citations and source links.
- Collapsible interactive citation cards and rich source previews.

### 📄 Document-Grounded RAG

- Upload PDF, TXT, MD, CSV, and DOCX files for semantic Q&A.
- Calibrated 768-dimensional Gemini embeddings with **Pinecone Serverless** vector search.
- Automatic local **ChromaDB** fallback when offline or in local mode.

### 📱 Native Mobile Application (iOS & Android)

- Built with **React Native (0.86)** and **Expo SDK 57**.
- **Real-Time SSE Streaming**: Token-by-token streaming with cancellation support and idempotent response finalization.
- **Fluid Native Gestures**: PanResponder swipe-to-dismiss bottom sheets for Citations, User Profile, and slide-out navigation Drawer.
- **Haptic Feedback**: Integrated `expo-haptics` for button taps, copy actions, and stream completion cues.
- **Collapsible Drawer Sections**: Accordion toggles with animated chevrons for recent chat sessions and attached documents.
- **Dynamic Server Configuration**: In-app modal to connect to custom LAN IP addresses or test servers over local Wi-Fi.

### 👥 Enterprise Authentication & Profile Management

- **Google OAuth 2.0** one-click sign-in with profile synchronization.
- **Email OTP Passwordless Login** via Brevo HTTPS API with rate limiting and resend cooldowns.
- **Self-Service Password Reset** with cryptographic email OTP tokens.
- **PBKDF2-HMAC-SHA256** password hashing with 100,000 iterations and unique cryptographic salts.
- **Custom User Profiles**: In-app avatar photo upload, display name editing, and theme persistence.
- **Turso Cloud Database** (`libsql`) for distributed relational data persistence.

### 🎨 Dynamic Theming & Multi-Accent Palettes

- Seamless **Dark Mode** and **Light Mode** switching.
- **7 Curated Accent Color Palettes** (_Ocean Blue, Royal Purple, Emerald Forest, Sunset Rose, Amber Gold, Cyan Wave, Indigo Night_) dynamically applied in real-time across both Web and Mobile.

### ⏱️ Desktop Experience & Controls

- **ChatGPT-Style Prompt Timeline**: Vertical indicator rail pinned to the viewport with real-time tracking, hover flyout menu, direct jump with pulse animation, and stepwise pagination chevrons (`▲`/`▼`).
- **Custom Glassmorphic Modals**: Theme-adaptive modals for logout, session deletion, and alerts.
- **Instant Stream Cancellation**: Abort stream generation on demand.

---

## 💻 Tech Stack

| Layer            | Technologies                                                                                                 |
| :--------------- | :----------------------------------------------------------------------------------------------------------- |
| **Web Frontend** | React 18, TypeScript, Vite, Tailwind CSS, Lucide Icons (`react-icons`)                                       |
| **Mobile App**   | React Native 0.86, Expo SDK 57, TypeScript, Expo Haptics, Vector Icons                                       |
| **Backend**      | Python 3.11+, FastAPI, Uvicorn, Pydantic v2                                                                  |
| **Databases**    | **Turso** (Cloud SQLite via `libsql`), **Pinecone** (Serverless Vector Index), **ChromaDB** (Local Fallback) |
| **AI / LLM**     | Google Gemini (`gemini-2.5-flash`, `gemini-embedding-001` with 768-dim calibration)                          |
| **Auth & Email** | Google OAuth 2.0, Brevo HTTPS REST API (Port 443 OTP Dispatch), Async SMTP                                   |

---

## 🚀 Quick Start

### Prerequisites

- **Python 3.11+**
- **Node.js 18+** & **npm**
- _(For Mobile testing)_: **Expo Go** app installed on iOS or Android, or an active simulator.

### 1. Installation

Clone the repository and install dependencies from the root directory:

```bash
git clone https://github.com/Prats129/Contexify.git
cd Contexify

# Install root orchestrator and frontend dependencies
npm install
npm run setup

# Install mobile dependencies
npm run setup:mobile
```

### 2. Environment Configuration

#### Backend Configuration

Create a `backend/.env` file:

```env
# Google Gemini API (Required for LLM & embeddings)
GEMINI_API_KEY=your_gemini_api_key_here

# Database & Vector Store Execution Mode
# "local" (default: uses local SQLite + local ChromaDB)
# "cloud" (uses Turso Cloud DB + Pinecone Serverless)
DB_MODE=local

# Turso Cloud Database (Required when DB_MODE=cloud)
TURSO_DATABASE_URL=libsql://your-db.aws-region.turso.io
TURSO_AUTH_TOKEN=your_turso_jwt_token_here

# Pinecone Vector Store (Required when DB_MODE=cloud)
PINECONE_API_KEY=your_pinecone_api_key_here
PINECONE_INDEX_NAME=contexify

# Google OAuth 2.0 (Optional)
GOOGLE_CLIENT_ID=your_google_client_id.apps.googleusercontent.com

# Brevo HTTPS Email API (Recommended for cloud hosts - bypasses SMTP port blocks)
BREVO_API_KEY=xkeysib-your_brevo_api_key_here
BREVO_FROM_EMAIL=your_verified_sender@gmail.com
BREVO_FROM_NAME=Contexify

# SMTP Email Relay (Optional fallback - for local Mailtrap testing)
# SMTP_HOST=sandbox.smtp.mailtrap.io
# SMTP_PORT=2525
# SMTP_USER=your_smtp_user
# SMTP_PASSWORD=your_smtp_password
```

#### Frontend Configuration

Create a `frontend/.env` file:

```env
VITE_GOOGLE_CLIENT_ID=your_google_client_id.apps.googleusercontent.com
```

### 3. Running the Applications

#### Option A: Run Full Stack (Backend + Web Frontend + Mobile)

```bash
npm run dev:all
```

#### Option B: Run Web Full Stack (Backend + Web Frontend)

```bash
npm run dev
```

- **Web Application**: [http://localhost:8000](http://localhost:8000)
- **FastAPI Backend**: [http://127.0.0.1:8001](http://127.0.0.1:8001)
- **Swagger Docs**: [http://127.0.0.1:8001/docs](http://127.0.0.1:8001/docs)

#### Option C: Run Mobile App (Expo)

```bash
npm run dev:mobile
```

- Scan the QR code in your terminal using the **Expo Go** app (Android) or **Camera** (iOS).
- To connect the mobile app to your backend, ensure your phone and computer are on the same Wi-Fi network. Open the Server Config modal (gear icon) in the mobile app and specify your computer's LAN IP (e.g., `http://192.168.1.X:8001/api/v1`).

---

## 📁 Project Structure

```text
Contexify/
├── backend/
│   ├── app/
│   │   ├── api/v1/          # REST & SSE API endpoints (chat, auth, user, sessions, docs)
│   │   ├── core/            # App settings, security, and CORS configuration
│   │   ├── db/              # Database schema & SQLite/Turso connections
│   │   ├── repositories/    # Data stores (Turso relational, Pinecone/Chroma vector)
│   │   ├── schemas/         # Pydantic data models & request/response contracts
│   │   └── services/        # Orchestrator, RAG, Gemini LLM, Email service
│   ├── requirements.txt     # Backend Python dependencies
│   └── reset_db.py          # Database reset and schema migration script
├── frontend/
│   ├── src/
│   │   ├── components/      # Chat workspace, Sidebar, Modals, Timeline rail
│   │   ├── context/         # ThemeContext, ConfirmContext
│   │   ├── services/        # API client & SSE streaming service
│   │   └── types/           # TypeScript interfaces
│   └── package.json         # Frontend dependencies & Vite configuration
├── mobile/
│   ├── assets/              # App icons, splash screens, and branding
│   ├── src/
│   │   ├── components/      # Header, ChatInput, MessageItem, DrawerMenu, Modals
│   │   ├── services/        # Mobile API client with SSE XMLHttpRequest streaming
│   │   ├── theme/           # Dynamic accent color tokens & dark/light palettes
│   │   └── types/           # Mobile TypeScript definitions
│   ├── App.tsx              # Root React Native mobile component
│   ├── app.json             # Expo application configuration
│   └── package.json         # Mobile dependencies (React Native, Expo SDK)
├── package.json             # Root monorepo orchestrator
└── README.md                # Project documentation
```

---

## 🛠️ Available Scripts

Run these commands from the repository root:

| Command                  | Description                                                                              |
| :----------------------- | :--------------------------------------------------------------------------------------- |
| `npm run dev:all`        | Concurrently runs Backend (port 8001), Web Frontend (port 8000), and Mobile Expo server. |
| `npm run dev`            | Concurrently runs Backend and Web Frontend.                                              |
| `npm run dev:backend`    | Starts only the FastAPI server on `0.0.0.0:8001` with hot reload.                        |
| `npm run dev:frontend`   | Starts only the Vite Web frontend dev server on port 8000.                               |
| `npm run dev:mobile`     | Starts the Expo mobile development bundler for iOS/Android.                              |
| `npm run build:frontend` | Type-checks and builds the production frontend bundle into `frontend/dist/`.             |
| `npm run setup`          | Installs frontend npm packages and sets up the Python virtual environment.               |
| `npm run setup:backend`  | Creates the Python venv and installs `requirements.txt`.                                 |
| `npm run setup:mobile`   | Installs mobile Expo packages in `mobile/`.                                              |
| `npm run deploy:mobile`  | 🚀 1-command build: generates free standalone Android APK installer.                     |
| `npm run deploy:mobile:bundle` | Builds production Android App Bundle (.aab) for Google Play Console.               |
| `npm run deploy:mobile:ios`    | Builds iOS production IPA for Apple TestFlight / App Store.                         |
| `npm run db:reset`       | Drops and re-initializes all local database tables.                                      |

---

## 📜 License

This project is licensed under the MIT License. Copyright © 2026 Contexify.
