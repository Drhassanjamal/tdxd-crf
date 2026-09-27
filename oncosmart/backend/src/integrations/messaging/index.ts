import { env } from '../../config/env';
import { MockWhatsAppProvider } from './mockWhatsApp.provider';
import { MessagingProvider } from './types';
import { WhatsAppCloudProvider } from './whatsappCloud.provider';

let provider: MessagingProvider | null = null;

/** Returns the configured messaging provider (mock by default). Swap here for SMS / e-mail / other vendors. */
export function getMessagingProvider(): MessagingProvider {
  if (!provider) {
    provider = env.MESSAGING_PROVIDER === 'whatsapp_cloud' ? new WhatsAppCloudProvider() : new MockWhatsAppProvider();
  }
  return provider;
}

export * from './types';
