import { env } from '../config/env';
import { autoProgressMockReceipts, processQueue } from '../services/notification.service';

let timer: NodeJS.Timeout | null = null;
let running = false;

/**
 * Notification queue worker: sends due WhatsApp/SMS messages (24 h, 2 h, same-day
 * reminders) through the configured provider. In production this can be moved
 * to a separate process or a job scheduler without code changes.
 */
export function startNotificationWorker() {
  if (timer || env.DISABLE_WORKER) return;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await processQueue();
      if (env.MOCK_WHATSAPP_AUTO_PROGRESS) await autoProgressMockReceipts();
    } catch (err) {
      console.error('[notification-worker]', (err as Error).message);
    } finally {
      running = false;
    }
  };
  timer = setInterval(tick, env.NOTIFICATION_WORKER_INTERVAL_MS);
  setTimeout(tick, 1500);
}

export function stopNotificationWorker() {
  if (timer) clearInterval(timer);
  timer = null;
}
