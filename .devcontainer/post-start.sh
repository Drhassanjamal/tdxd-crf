#!/usr/bin/env bash
# Runs every time the codespace starts: (re)starts OncoSmart on port 4000 in the background.
cd "$(dirname "$0")/../oncosmart" || exit 1
LOG=/tmp/oncosmart-server.log

# Self-heal if the one-time setup did not finish
if [ ! -f backend/dist/src/server.js ] || [ ! -d frontend/dist ]; then
  bash ../.devcontainer/post-create.sh >> "$LOG" 2>&1 || true
fi

# Stop a previous instance, then start detached so it survives this script
pkill -f "node dist/src/serve[r].js" 2>/dev/null || true
nohup setsid npm start >> "$LOG" 2>&1 < /dev/null &

# Wait until the API answers so the port is detected and forwarded
for i in $(seq 1 60); do
  if node -e "fetch('http://localhost:4000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"; then
    echo "[oncosmart] running on port 4000 (log: $LOG)"
    exit 0
  fi
  sleep 2
done
echo "[oncosmart] server did not start — see $LOG"
