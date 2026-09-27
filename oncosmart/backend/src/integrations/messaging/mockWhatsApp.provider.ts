import crypto from 'node:crypto';
import { MessagingProvider, normalizePhone, OutboundMessage, SendResult } from './types';

/**
 * MOCK WhatsApp provider — NO MESSAGE IS EVER SENT.
 *
 * Simulates the behaviour of the WhatsApp Business API so the full reminder /
 * confirmation workflow can be demonstrated: it validates the phone number,
 * returns a fake message id, and (optionally) the notification worker advances
 * the status SENT → DELIVERED → READ. Patient replies are simulated from the UI.
 */
export class MockWhatsAppProvider implements MessagingProvider {
  readonly name = 'mock_whatsapp';
  readonly simulatesReceipts = true;

  async send(message: OutboundMessage): Promise<SendResult> {
    const to = normalizePhone(message.to);
    if (!to) return { status: 'FAILED', failureReason: 'Invalid or missing phone number' };
    return { status: 'SENT', providerMessageId: `mock.wamid.${crypto.randomUUID()}` };
  }
}
