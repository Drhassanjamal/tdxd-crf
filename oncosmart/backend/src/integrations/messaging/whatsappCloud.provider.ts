import crypto from 'node:crypto';
import { env } from '../../config/env';
import { InboundEvent, MessagingProvider, normalizePhone, OutboundMessage, PatientResponse, SendResult } from './types';

/**
 * WhatsApp Business Cloud API provider — INTEGRATION SKELETON (not exercised in the demo).
 *
 * Activate with MESSAGING_PROVIDER=whatsapp_cloud and the WHATSAPP_* environment
 * variables. Business-initiated reminders must use a template pre-approved by Meta
 * (WHATSAPP_TEMPLATE_NAME) with quick-reply buttons whose payloads are
 * CONFIRM / RESCHEDULE / CANCEL. Verify the payload format against the current
 * Meta documentation before go-live.
 */
export class WhatsAppCloudProvider implements MessagingProvider {
  readonly name = 'whatsapp_cloud';
  readonly simulatesReceipts = false;

  constructor() {
    if (!env.WHATSAPP_PHONE_NUMBER_ID || !env.WHATSAPP_ACCESS_TOKEN) {
      throw new Error('WhatsApp Cloud provider selected but WHATSAPP_PHONE_NUMBER_ID / WHATSAPP_ACCESS_TOKEN are not set');
    }
  }

  async send(message: OutboundMessage): Promise<SendResult> {
    const to = normalizePhone(message.to);
    if (!to) return { status: 'FAILED', failureReason: 'Invalid or missing phone number' };
    const payload = {
      messaging_product: 'whatsapp',
      to: to.replace('+', ''),
      type: 'template',
      template: {
        name: env.WHATSAPP_TEMPLATE_NAME,
        language: { code: message.language === 'ar' ? 'ar' : 'en' },
        components: [
          {
            type: 'body',
            parameters: (message.templateParams ?? []).map((text) => ({ type: 'text', text })),
          },
        ],
      },
    };
    const res = await fetch(`${env.WHATSAPP_API_BASE_URL}/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok) return { status: 'FAILED', failureReason: json?.error?.message ?? `HTTP ${res.status}` };
    return { status: 'SENT', providerMessageId: json?.messages?.[0]?.id };
  }
}

/** Validates the X-Hub-Signature-256 header of an incoming webhook. */
export function verifyWebhookSignature(rawBody: Buffer, signatureHeader: string | undefined): boolean {
  if (!env.WHATSAPP_APP_SECRET || !signatureHeader?.startsWith('sha256=')) return false;
  const expected = crypto.createHmac('sha256', env.WHATSAPP_APP_SECRET).update(rawBody).digest('hex');
  const given = signatureHeader.slice(7);
  return expected.length === given.length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(given));
}

/** Translates a WhatsApp Cloud webhook body into provider-agnostic inbound events. */
export function parseWhatsAppWebhook(body: any): InboundEvent[] {
  const events: InboundEvent[] = [];
  for (const entry of body?.entry ?? []) {
    for (const change of entry?.changes ?? []) {
      const value = change?.value ?? {};
      for (const s of value.statuses ?? []) {
        const status = String(s.status ?? '').toUpperCase();
        if (['SENT', 'DELIVERED', 'READ', 'FAILED'].includes(status)) {
          events.push({ kind: 'STATUS', providerMessageId: s.id, status: status as any, reason: s.errors?.[0]?.title });
        }
      }
      for (const m of value.messages ?? []) {
        const payload: string | undefined = m.button?.payload ?? m.interactive?.button_reply?.id;
        const response = payload?.toUpperCase() as PatientResponse | undefined;
        if (response && ['CONFIRM', 'RESCHEDULE', 'CANCEL'].includes(response)) {
          events.push({ kind: 'REPLY', providerMessageId: m.context?.id, from: m.from, response });
        }
      }
    }
  }
  return events;
}
