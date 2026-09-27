/**
 * HL7 FHIR R4 mapping — INTEGRATION PLACEHOLDER.
 * Maps OncoSmart records to FHIR resources for future EMR / HIE interoperability.
 * Validate against the target system's FHIR profile before production use.
 */
export function toFhirPatient(p: any, hospitalSystem = 'urn:oncosmart:mrn') {
  return {
    resourceType: 'Patient',
    id: p.id,
    identifier: [
      { system: hospitalSystem, value: p.mrn },
      { system: 'urn:oncosmart:patient-id', value: p.patient_code },
    ],
    name: [
      { use: 'official', family: p.last_name, given: [p.first_name] },
      ...(p.full_name_ar ? [{ use: 'official', text: p.full_name_ar, extension: [{ url: 'http://hl7.org/fhir/StructureDefinition/language', valueCode: 'ar' }] }] : []),
    ],
    gender: p.sex === 'MALE' ? 'male' : p.sex === 'FEMALE' ? 'female' : 'unknown',
    birthDate: p.date_of_birth,
    telecom: p.phone ? [{ system: 'phone', value: p.phone, use: 'mobile' }] : [],
    address: p.governorate ? [{ state: p.governorate, text: p.address ?? undefined, country: 'IQ' }] : [],
    communication: [{ language: { coding: [{ system: 'urn:ietf:bcp:47', code: p.preferred_language }] }, preferred: true }],
    deceasedBoolean: p.status === 'DECEASED',
    meta: { tag: p.is_demo ? [{ system: 'urn:oncosmart:tags', code: 'DEMO', display: 'Synthetic demo data' }] : [] },
  };
}

export function toFhirAllergy(a: any, patientId: string) {
  return {
    resourceType: 'AllergyIntolerance',
    id: a.id,
    patient: { reference: `Patient/${patientId}` },
    code: { text: a.allergen },
    category: [a.allergen_type === 'DRUG' ? 'medication' : a.allergen_type === 'FOOD' ? 'food' : 'environment'],
    criticality: a.severity === 'SEVERE' ? 'high' : a.severity === 'UNKNOWN' ? 'unable-to-assess' : 'low',
    reaction: a.reaction ? [{ description: a.reaction }] : undefined,
  };
}
