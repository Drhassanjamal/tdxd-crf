/**
 * Hospital EMR integration — INTEGRATION PLACEHOLDER (not implemented).
 * Implement against the hospital EMR (HL7 v2 ADT, FHIR, or vendor API).
 */
export interface EmrAdapter {
  lookupPatientByMrn(mrn: string): Promise<{ mrn: string; firstName: string; lastName: string; dateOfBirth: string; sex: 'MALE' | 'FEMALE' } | null>;
  pushTreatmentSummary(patientId: string, summary: unknown): Promise<void>;
}

export class NotConfiguredEmrAdapter implements EmrAdapter {
  async lookupPatientByMrn(): Promise<null> {
    return null;
  }
  async pushTreatmentSummary(): Promise<void> {
    throw new Error('EMR integration not configured');
  }
}
