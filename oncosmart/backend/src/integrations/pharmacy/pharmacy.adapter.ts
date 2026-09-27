/**
 * Pharmacy / inventory — INTEGRATION PLACEHOLDER.
 * The database already contains drugs, drug_products and inventory_batches; an
 * adapter can synchronise stock, reserve vials and send approved orders for
 * compounding. Vial estimates are calculated in services/doseCalculator.estimateVials.
 */
export interface PharmacyAdapter {
  sendOrderForPreparation(orderId: string): Promise<{ externalReference: string }>;
  getStock(drugName: string): Promise<{ strength: number; quantity: number; expiry: string; batch: string }[]>;
}

export class NotConfiguredPharmacyAdapter implements PharmacyAdapter {
  async sendOrderForPreparation(): Promise<{ externalReference: string }> {
    throw new Error('Pharmacy integration not configured');
  }
  async getStock(): Promise<{ strength: number; quantity: number; expiry: string; batch: string }[]> {
    return [];
  }
}
