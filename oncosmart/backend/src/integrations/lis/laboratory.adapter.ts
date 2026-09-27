/**
 * Laboratory information system (LIS) — INTEGRATION PLACEHOLDER.
 * Results imported through an adapter should be stored with source='LIS_IMPORT'.
 */
export interface LabResultImport {
  testCode: string; // must map to lab_test_definitions.code
  value: number;
  unit: string;
  collectedAt: string;
  externalId?: string;
}

export interface LaboratoryAdapter {
  fetchResults(mrn: string, since: Date): Promise<LabResultImport[]>;
}

export class NotConfiguredLaboratoryAdapter implements LaboratoryAdapter {
  async fetchResults(): Promise<LabResultImport[]> {
    return [];
  }
}
