# --- stage 1: build the SPA -------------------------------------------------
FROM node:20-slim AS web

WORKDIR /web
COPY web/package.json web/package-lock.json* ./
RUN npm ci --no-audit --no-fund 2>/dev/null || npm install --no-audit --no-fund

COPY web/ ./
# No VITE_* here on purpose: the client reads its configuration from /api/config
# at runtime, so this image is not bound to any one project.
RUN npm run build

# --- stage 2: API + static --------------------------------------------------
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

RUN pip install --no-cache-dir \
      "fastapi>=0.115" "uvicorn[standard]>=0.32" "pydantic>=2.9" "httpx>=0.27" \
      "python-multipart>=0.0.12" "google-genai>=0.8" "openai>=1.55"

COPY api/app ./app
COPY --from=web /web/dist ./static

ENV STATIC_DIR=/app/static \
    PORT=8080
EXPOSE 8080

CMD exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT} --workers 1
