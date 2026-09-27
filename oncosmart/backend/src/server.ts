import { env } from './config/env';
import { createApp } from './app';
import { pool } from './db/pool';
import { startNotificationWorker, stopNotificationWorker } from './jobs/notificationWorker';

async function main() {
  await pool.query('SELECT 1');
  const app = createApp();
  const server = app.listen(env.PORT, env.HOST, () => {
    console.log(`[oncosmart] API listening on http://${env.HOST}:${env.PORT} (${env.NODE_ENV}${env.DEMO_MODE ? ', DEMO MODE' : ''})`);
    console.log(`[oncosmart] messaging provider: ${env.MESSAGING_PROVIDER}`);
  });
  startNotificationWorker();
  const shutdown = () => {
    stopNotificationWorker();
    server.close(() => pool.end().then(() => process.exit(0)));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('[oncosmart] failed to start:', err.message);
  console.error('Is PostgreSQL running and DATABASE_URL correct? Run `npm run db:migrate` first.');
  process.exit(1);
});
