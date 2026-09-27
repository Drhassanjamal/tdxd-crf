#!/usr/bin/env bash
# Runs once when the codespace is created: install, configure, migrate + seed demo data, build.
set -euo pipefail
cd "$(dirname "$0")/../oncosmart"

DB_URL="${ONCOSMART_DATABASE_URL:-postgres://oncosmart:oncosmart_demo@localhost:5432/oncosmart}"

if [ ! -f .env ]; then
  echo "[oncosmart] writing .env for the Codespaces database"
  JWT=$(node -e "console.log(require('crypto').randomBytes(48).toString('hex'))")
  cat > .env <<ENV
NODE_ENV=development
PORT=4000
DATABASE_URL=${DB_URL}
JWT_SECRET=${JWT}
JWT_EXPIRES_IN=8h
COOKIE_SECURE=false
DEMO_MODE=true
SEED_DEMO_PASSWORD=Demo@2026
MESSAGING_PROVIDER=mock
MOCK_WHATSAPP_AUTO_PROGRESS=true
NOTIFICATION_WORKER_INTERVAL_MS=10000
ENV
fi

echo "[oncosmart] installing dependencies"
npm ci --no-audit --no-fund

echo "[oncosmart] waiting for PostgreSQL"
for i in $(seq 1 60); do
  if node -e "const {Client}=require('pg');const c=new Client({connectionString:process.argv[1]});c.connect().then(()=>c.end()).then(()=>process.exit(0)).catch(()=>process.exit(1))" "$DB_URL"; then
    break
  fi
  sleep 2
done

echo "[oncosmart] applying migrations and loading synthetic demo data"
npm run db:seed

echo "[oncosmart] building"
npm run build

echo "[oncosmart] setup complete"
