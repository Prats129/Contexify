# -------------------------------------------------------------
# Stage 1: Build the React + Vite Frontend
# -------------------------------------------------------------
FROM node:20-alpine AS frontend-builder
WORKDIR /frontend

# Copy package manifests and install dependencies
COPY frontend/package*.json ./
RUN npm ci || npm install

# Copy source code and build production assets
COPY frontend/ ./
RUN npm run build

# -------------------------------------------------------------
# Stage 2: Production Python Backend + Static Frontend
# -------------------------------------------------------------
FROM python:3.11-slim

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
RUN pip install --no-cache-dir -r ./backend/requirements.txt

# Copy backend application code
COPY backend/ ./backend/

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
