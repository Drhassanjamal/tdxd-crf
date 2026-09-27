#!/usr/bin/env bash
# Runs every time the codespace starts: (re)starts OncoSmart on port 4000 in the background.
cd "$(dirname "$0")/../oncosmart" || exit 1
LOG=/tmp/oncosmart-server.log
STAMP=backend/dist/.source-rev
REV=$(git rev-parse HEAD 2>/dev/null || echo unknown)
# Self-heal if the one-time setup did not finish
if [ ! -f backend/dist/src/server.js ] || [ ! -f frontend/dist/index.html ]; then
  bash ../.devcontainer/post-create.sh >> "$LOG" 2>&1 || true
# Rebuild when the checked-out code changed since the last build (e.g. after pulling new commits)
elif [ "$(cat "$STAMP" 2>/dev/null)" != "$REV" ]; then
  {
    echo "[oncosmart] code changed since the last build — reinstalling and rebuilding"
    npm ci --no-audit --no-fund && npm run db:migrate && npm run build && echo "$REV" > "$STAMP"
  } >> "$LOG" 2>&1 || true
fi
# Stop a previous instance and wait for it to release the port
pkill -f "node dist/src/serve[r].js" 2>/dev/null || true
for i in $(seq 1 20); do
  pgrep -f "node dist/src/serve[r].js" > /dev/null || break
  sleep 0.5
done
# Listen on all interfaces, and let the Codespaces editor's port preview embed the page
export HOST=0.0.0.0
export FRAME_ANCESTORS="https://*.github.dev https://*.vscode-cdn.net"
# Start detached so it survives this script
nohup setsid npm start >> "$LOG" 2>&1 < /dev/null &
if [ -n "${CODESPACE_NAME:-}" ]; then
  URL="https://${CODESPACE_NAME}-4000.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:-app.github.dev}/"
else
  URL="http://localhost:4000/"
fi
# Wait until both the API and the web app answer so the port is detected and forwarded
for i in $(seq 1 90); do
  if node -e 'Promise.all([fetch("http://127.0.0.1:4000/api/health"), fetch("http://127.0.0.1:4000/")]).then(async ([api, web]) => process.exit(api.ok && web.ok && (await web.text()).includes("id=\"root\"") ? 0 : 1)).catch(() => process.exit(1))'; then
    echo "[oncosmart] running: $URL (log: $LOG)"
    exit 0
  fi
  sleep 2
done
echo "[oncosmart] server did not start — see $LOG"
