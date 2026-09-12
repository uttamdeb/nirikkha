# --- stage 1: build Next.js -------------------------------------------------
FROM node:20-bookworm-slim AS web

WORKDIR /web
COPY web/package.json web/package-lock.json* ./
RUN npm ci --no-audit --no-fund 2>/dev/null || npm install --no-audit --no-fund
COPY web/ ./
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# --- stage 2: Node + Python runtime -----------------------------------------
FROM node:20-bookworm-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=8080 \
    API_PORT=8100

RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 python3-pip python3-venv curl \
  && rm -rf /var/lib/apt/lists/* \
  && ln -sf /usr/bin/python3 /usr/bin/python

WORKDIR /app

RUN pip3 install --break-system-packages --no-cache-dir \
      "fastapi>=0.115" "uvicorn[standard]>=0.32" "pydantic>=2.9" "httpx>=0.27" \
      "python-multipart>=0.0.12" "google-genai>=0.8" "openai>=1.55"

COPY api/app ./app
COPY --from=web /web /app/web
COPY web/scripts/start-prod.sh /app/start-prod.sh
RUN chmod +x /app/start-prod.sh

EXPOSE 8080
CMD ["/app/start-prod.sh"]
