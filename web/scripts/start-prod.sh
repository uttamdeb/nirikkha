#!/bin/sh
set -eu

API_PORT="${API_PORT:-8100}"
export API_PROXY_URL="http://127.0.0.1:${API_PORT}"

# FastAPI on loopback; Next listens on Cloud Run $PORT.
uvicorn app.main:app --host 127.0.0.1 --port "$API_PORT" --workers 1 &
API_PID=$!

shutdown() {
  kill "$API_PID" 2>/dev/null || true
}
trap shutdown EXIT INT TERM

# Wait until the API accepts connections (config + rewrites).
i=0
while [ "$i" -lt 60 ]; do
  if curl -sf "http://127.0.0.1:${API_PORT}/api/config" >/dev/null 2>&1; then
    break
  fi
  i=$((i + 1))
  sleep 0.5
done

cd /app/web
exec ./node_modules/.bin/next start -H 0.0.0.0 -p "${PORT:-8080}"
