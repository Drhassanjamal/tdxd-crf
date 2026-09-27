import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

/**
 * Environment configuration. Secrets are ONLY read from the environment
 * (or a local, git-ignored .env file) — never hardcoded.
 */

function findBackendRoot(start: string): string {
  let dir = start;
  for (let i = 0; i < 6; i++) {
    const pkg = path.join(dir, 'package.json');
    if (fs.existsSync(pkg)) {
      try {
        const name = JSON.parse(fs.readFileSync(pkg, 'utf8')).name;
        if (name === '@oncosmart/backend') return dir;
      } catch {
        /* ignore */
      }
    }
    dir = path.dirname(dir);
  }
  return process.cwd();
}

export const BACKEND_ROOT = findBackendRoot(__dirname);
export const PROJECT_ROOT = path.resolve(BACKEND_ROOT, '..');

for (const candidate of [path.join(BACKEND_ROOT, '.env'), path.join(PROJECT_ROOT, '.env')]) {
  if (fs.existsSync(candidate)) {
    try {
      process.loadEnvFile(candidate);
    } catch {
      /* ignore malformed file; explicit env vars still apply */
    }
  }
}

const bool = (v: string | undefined, fallback: boolean) =>
  v === undefined || v === '' ? fallback : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());

const NODE_ENV = process.env.NODE_ENV ?? 'development';
const isProduction = NODE_ENV === 'production';

let jwtSecret = process.env.JWT_SECRET ?? '';
if (!jwtSecret) {
  if (isProduction) {
    throw new Error('JWT_SECRET must be set in production. Generate one with: openssl rand -hex 48');
  }
  // Development convenience: ephemeral random secret (sessions reset on restart).
  jwtSecret = crypto.randomBytes(48).toString('hex');
  if (process.env.VITEST === undefined) {
    console.warn('[config] JWT_SECRET not set — using an ephemeral development secret.');
  }
}

if (!process.env.DATABASE_URL && isProduction) {
  throw new Error('DATABASE_URL must be set in production.');
}

export const env = {
  NODE_ENV,
  isProduction,
  PORT: Number(process.env.PORT ?? 4000),
  // Listen on all interfaces so container port forwarding (Docker, Codespaces) can reach the server
  HOST: process.env.HOST || '0.0.0.0',
  // Extra origins allowed to embed the app in a frame (CSP frame-ancestors). Empty = framing blocked.
  // Only the Codespaces start script sets this, for the editor's port preview.
  FRAME_ANCESTORS: (process.env.FRAME_ANCESTORS ?? '').split(/[\s,]+/).filter(Boolean),
  DATABASE_URL: process.env.DATABASE_URL ?? 'postgres://oncosmart@localhost:5432/oncosmart',
  JWT_SECRET: jwtSecret,
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN ?? '8h',
  COOKIE_SECURE: bool(process.env.COOKIE_SECURE, isProduction),
  DEMO_MODE: bool(process.env.DEMO_MODE, true),
  SEED_DEMO_PASSWORD: process.env.SEED_DEMO_PASSWORD ?? 'Demo@2026',
  MESSAGING_PROVIDER: (process.env.MESSAGING_PROVIDER ?? 'mock') as 'mock' | 'whatsapp_cloud',
  MOCK_WHATSAPP_AUTO_PROGRESS: bool(process.env.MOCK_WHATSAPP_AUTO_PROGRESS, true),
  WHATSAPP_API_BASE_URL: process.env.WHATSAPP_API_BASE_URL ?? 'https://graph.facebook.com/v20.0',
  WHATSAPP_PHONE_NUMBER_ID: process.env.WHATSAPP_PHONE_NUMBER_ID ?? '',
  WHATSAPP_ACCESS_TOKEN: process.env.WHATSAPP_ACCESS_TOKEN ?? '',
  WHATSAPP_APP_SECRET: process.env.WHATSAPP_APP_SECRET ?? '',
  WHATSAPP_VERIFY_TOKEN: process.env.WHATSAPP_VERIFY_TOKEN ?? '',
  WHATSAPP_TEMPLATE_NAME: process.env.WHATSAPP_TEMPLATE_NAME ?? 'chemo_appointment_reminder',
  NOTIFICATION_WORKER_INTERVAL_MS: Number(process.env.NOTIFICATION_WORKER_INTERVAL_MS ?? 10000),
  DISABLE_WORKER: bool(process.env.DISABLE_WORKER, false),
};
