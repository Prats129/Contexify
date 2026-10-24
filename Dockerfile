# -------------------------------------------------------------
# Stage 1: Build the React + Vite Frontend
# -------------------------------------------------------------
FROM node:22-alpine@sha256:fe4f6d74e20370acb04ad889077d14d0f64a9c8ea6a42bc60cddf1e844699914 AS frontend-builder
WORKDIR /frontend

# Copy package manifests and install dependencies
COPY frontend/package.json frontend/package-lock.json frontend/.npmrc ./
RUN npm ci

# Copy source code and build production assets
COPY frontend/index.html frontend/tsconfig.json frontend/tsconfig.node.json frontend/vite.config.ts ./
COPY frontend/src/ ./src/
COPY frontend/public/ ./public/
# Public browser settings only; backend secrets belong in the runtime environment.
ARG VITE_GOOGLE_CLIENT_ID=""
ARG VITE_API_BASE_URL=""
RUN npm run build

# -------------------------------------------------------------
# Stage 2: Production Python Backend + Static Frontend
# -------------------------------------------------------------
FROM python:3.11-slim@sha256:b7a9e5f6a93d6d4a31f129bbd4bdee69efccb6ded0fb230d78aafaf37af98377

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=7860 \
    DATA_DIR=/data \
    DB_MODE=cloud

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install Python requirements
COPY backend/requirements.txt ./backend/requirements.txt
RUN pip install --no-cache-dir --require-hashes -r ./backend/requirements.txt

# Copy backend application code
COPY backend/app/ ./backend/app/

# Copy built frontend assets from stage 1 into workspace frontend/dist
COPY --from=frontend-builder /frontend/dist ./frontend/dist

# Hugging Face Spaces runs as user ID 1000
RUN useradd -m -u 1000 user && \
    mkdir -p /app/backend/data /data && \
    chown -R user:user /app /data

USER user
ENV HOME=/home/user \
    PATH=/home/user/.local/bin:$PATH

WORKDIR /app/backend

EXPOSE 7860

CMD ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "7860"]
