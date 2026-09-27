/**
 * Provider-agnostic messaging contracts.
 *
 * INTEGRATION POINT: to connect a real channel (WhatsApp Business API, SMS gateway,
 * e-mail), implement `MessagingProvider` and register it in ./index.ts. The rest of
 * the system (queue, reminders, appointment confirmation) does not change.
 */

export type NotificationStatus = 'PENDING' | 'SENT' | 'DELIVERED' | 'READ' | 'FAILED' | 'CANCELLED';
export type PatientResponse = 'CONFIRM' | 'RESCHEDULE' | 'CANCEL';

export interface InteractiveOption {
  id: PatientResponse;
  title: string;
}

export interface OutboundMessage {
  notificationId: string;
  to: string | null;
  language: 'en' | 'ar';
  body: string;
  notificationType: string;
  interactiveOptions?: InteractiveOption[];
  /** Ordered template variables — used by providers that require pre-approved templates. */
  templateParams?: string[];
}

export interface SendResult {
  status: 'SENT' | 'FAILED';
  providerMessageId?: string;
  failureReason?: string;
}

export type InboundEvent =
  | { kind: 'STATUS'; providerMessageId: string; status: 'SENT' | 'DELIVERED' | 'READ' | 'FAILED'; reason?: string }
  | { kind: 'REPLY'; providerMessageId?: string; from?: string; response: PatientResponse };

export interface MessagingProvider {
  readonly name: string;
  /** True when the provider simulates delivery receipts itself (mock only). */
  readonly simulatesReceipts: boolean;
  send(message: OutboundMessage): Promise<SendResult>;
}

/** Normalises Iraqi / international numbers to E.164 (+9647XXXXXXXXX). Returns null if invalid. */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let p = raw.replace(/[\s\-().]/g, '');
  if (p.startsWith('00')) p = `+${p.slice(2)}`;
  if (/^07\d{9}$/.test(p)) p = `+964${p.slice(1)}`;
  if (/^9647\d{9}$/.test(p)) p = `+${p}`;
  return /^\+\d{8,15}$/.test(p) ? p : null;
}
