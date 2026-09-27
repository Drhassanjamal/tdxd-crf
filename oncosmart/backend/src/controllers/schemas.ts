import { z } from 'zod';

/** Shared request validation schemas (zod). */
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected date YYYY-MM-DD');
export const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, 'Expected time HH:MM');
export const uuid = z.uuid();
const optText = (max = 500) => z.string().trim().max(max).nullish().transform((v) => (v === '' ? null : v));
const optNum = z.number().finite().nullish();

export const loginSchema = z.object({ email: z.string().trim().min(3).max(200), password: z.string().min(1).max(200) });
export const changePasswordSchema = z.object({ currentPassword: z.string().min(1), newPassword: z.string().min(8).max(200) });

export const patientSchema = z.object({
  mrn: z.string().trim().min(2).max(40),
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  fullNameAr: optText(160),
  dateOfBirth: isoDate,
  sex: z.enum(['MALE', 'FEMALE']),
  phone: optText(30),
  governorate: optText(80),
  address: optText(300),
  preferredLanguage: z.enum(['en', 'ar']).optional(),
  emergencyContactName: optText(120),
  emergencyContactPhone: optText(30),
  emergencyContactRelation: optText(60),
  primaryOncologistId: uuid.nullish(),
  noKnownAllergies: z.boolean().optional(),
  heightCm: z.number().gt(30).lt(260).nullish(),
  weightKg: z.number().gt(1).lt(400).nullish(),
});

export const allergySchema = z.object({
  allergen: z.string().trim().min(2).max(120),
  allergenType: z.enum(['DRUG', 'FOOD', 'ENVIRONMENTAL', 'OTHER']).optional(),
  reaction: optText(300),
  severity: z.enum(['MILD', 'MODERATE', 'SEVERE', 'UNKNOWN']).optional(),
  notes: optText(500),
});

export const createPatientSchema = patientSchema.extend({ allergies: z.array(allergySchema).max(20).optional() });

export const patientQuerySchema = z.object({
  search: z.string().max(100).optional(),
  cancerType: z.string().max(80).optional(),
  oncologistId: uuid.optional(),
  status: z.string().max(40).optional(),
  protocolId: uuid.optional(),
  appointmentDate: isoDate.optional(),
  page: z.number().int().min(1).optional(),
  pageSize: z.number().int().min(1).max(200).optional(),
});

export const patientStatusSchema = z.object({
  status: z.enum(['ACTIVE_TREATMENT', 'TREATMENT_COMPLETED', 'ON_HOLD', 'DISCONTINUED', 'FOLLOW_UP', 'PALLIATIVE_CARE', 'DECEASED']),
  reason: optText(300),
});

export const diagnosisSchema = z.object({
  primaryCancer: z.string().trim().min(2).max(200),
  cancerType: z.string().trim().min(2).max(80),
  icd10Code: optText(20),
  histology: optText(200),
  stage: optText(60),
  biomarkers: optText(500),
  diagnosisDate: isoDate.nullish(),
  oncologistId: uuid.nullish(),
  isPrimary: z.boolean().optional(),
  notes: optText(1000),
});

export const planSchema = z.object({
  protocolId: uuid,
  diagnosisId: uuid.nullish(),
  intent: z.enum(['CURATIVE', 'ADJUVANT', 'NEOADJUVANT', 'PALLIATIVE', 'MAINTENANCE']).optional(),
  cycleLengthDays: z.number().int().min(1).max(365).optional(),
  plannedCycles: z.number().int().min(1).max(100).optional(),
  startDate: isoDate,
  notes: optText(1000),
});

export const planUpdateSchema = z.object({
  status: z.enum(['ACTIVE', 'COMPLETED', 'ON_HOLD', 'DISCONTINUED']).optional(),
  plannedCycles: z.number().int().min(1).max(100).optional(),
  notes: optText(1000),
  physicianId: uuid.optional(),
  nextDueDate: isoDate.nullish(),
});

export const labsSchema = z.object({
  collectedAt: z.string().min(10).max(40),
  results: z.array(z.object({ code: z.string().max(20), value: z.number().finite() })).min(1).max(30),
  notes: optText(500),
});

export const vitalsSchema = z.object({
  phase: z.enum(['PRE', 'DURING', 'POST', 'OTHER']),
  measuredAt: z.string().max(40).nullish(),
  treatmentOrderId: uuid.nullish(),
  administrationId: uuid.nullish(),
  bpSystolic: z.number().int().min(40).max(300).nullish(),
  bpDiastolic: z.number().int().min(20).max(200).nullish(),
  heartRate: z.number().int().min(20).max(250).nullish(),
  respRate: z.number().int().min(4).max(80).nullish(),
  temperatureC: z.number().min(30).max(45).nullish(),
  spo2: z.number().int().min(40).max(100).nullish(),
  weightKg: z.number().gt(1).lt(400).nullish(),
  painScore: z.number().int().min(0).max(10).nullish(),
  notes: optText(500),
});

export const noteSchema = z.object({
  content: z.string().trim().min(2).max(5000),
  noteType: z.enum(['PHYSICIAN', 'NURSING', 'GENERAL']).optional(),
  treatmentOrderId: uuid.nullish(),
});

const orderItemOverride = z.object({
  protocolDrugId: uuid,
  include: z.boolean().optional(),
  dosePercent: z.number().gt(0).max(150).optional(),
  finalDose: z.number().gt(0).max(100000).nullish(),
  modificationReason: optText(300),
  diluent: optText(120),
  finalVolumeMl: z.number().gt(0).max(5000).nullish(),
  infusionDurationMin: z.number().int().gt(0).max(10080).nullish(),
});

export const orderSchema = z.object({
  treatmentPlanId: uuid,
  cycleNumber: z.number().int().min(1).max(100),
  dayNumber: z.number().int().min(1).max(365),
  plannedDate: isoDate,
  heightCm: z.number().gt(30).lt(260).nullish(),
  weightKg: z.number().gt(1).lt(400).nullish(),
  gfr: z.number().gt(0).max(250).nullish(),
  gfrSource: optText(120),
  items: z.array(orderItemOverride).max(30).optional(),
  premedications: optText(2000),
  hydration: optText(2000),
  supportiveMedications: optText(2000),
  specialInstructions: optText(2000),
  clinicalNotes: optText(2000),
  submit: z.boolean().optional(),
});

export const approveSchema = z.object({ acknowledgeWarnings: z.boolean().default(false), note: optText(500) });
export const reasonSchema = z.object({ reason: z.string().trim().min(3).max(500) });
export const delaySchema = z.object({ reason: z.string().trim().min(3).max(500), delayedUntil: isoDate.nullish() });
export const verifySchema = z.object({ checklist: z.record(z.string(), z.boolean()) });
export const completeSchema = z.object({
  adverseEvent: z.boolean(),
  adverseEventDetails: optText(1000),
  notes: optText(2000),
  disposition: z.enum(['HOME', 'ADMITTED', 'TRANSFERRED_ER', 'OBSERVATION', 'OTHER']),
});
export const administrationSchema = z.object({
  doseAdministered: z.number().gt(0).max(100000).nullish(),
  notes: optText(1000),
  observations: optText(1000),
  reaction: z.boolean().optional(),
  reactionDetails: optText(1000),
  reason: optText(500),
});
export const eventSchema = z.object({
  eventType: z.enum(['INFUSION_REACTION', 'HYPERSENSITIVITY', 'EXTRAVASATION', 'NAUSEA_VOMITING', 'VASOVAGAL', 'DEVICE_ISSUE', 'OTHER']),
  severity: z.enum(['MILD', 'MODERATE', 'SEVERE', 'LIFE_THREATENING']),
  description: z.string().trim().min(3).max(2000),
  actionTaken: optText(2000),
  physicianNotified: z.boolean().optional(),
  administrationId: uuid.nullish(),
});

export const appointmentSchema = z.object({
  patientId: uuid,
  treatmentPlanId: uuid.nullish(),
  protocolId: uuid.nullish(),
  cycleNumber: z.number().int().min(1).max(100).nullish(),
  dayNumber: z.number().int().min(1).max(365).nullish(),
  appointmentType: z.enum(['CHEMOTHERAPY', 'IMMUNOTHERAPY', 'SUPPORTIVE_CARE', 'HYDRATION', 'PROCEDURE', 'OTHER']).optional(),
  appointmentDate: isoDate,
  startTime: hhmm,
  durationMinutes: z.number().int().min(10).max(720).optional(),
  chairId: uuid.nullish(),
  physicianId: uuid.nullish(),
  notes: optText(1000),
});
export const appointmentUpdateSchema = z.object({
  appointmentDate: isoDate.optional(),
  startTime: hhmm.optional(),
  durationMinutes: z.number().int().min(10).max(720).optional(),
  chairId: uuid.nullish(),
  physicianId: uuid.nullish(),
  notes: optText(1000),
  appointmentType: z.enum(['CHEMOTHERAPY', 'IMMUNOTHERAPY', 'SUPPORTIVE_CARE', 'HYDRATION', 'PROCEDURE', 'OTHER']).optional(),
});
export const appointmentStatusSchema = z.object({ status: z.enum(['CONFIRMED', 'NO_SHOW', 'NEEDS_RESCHEDULING', 'SCHEDULED']) });
export const rangeSchema = z.object({ from: isoDate, to: isoDate });

export const chairSchema = z.object({
  code: z.string().trim().min(1).max(20),
  name: z.string().trim().min(1).max(60),
  zone: optText(60),
  chairType: z.enum(['RECLINER', 'BED', 'ISOLATION']).optional(),
  sortOrder: z.number().int().min(0).max(999).optional(),
});
export const chairUpdateSchema = chairSchema.omit({ code: true }).partial().extend({ isActive: z.boolean().optional() });
export const chairStatusSchema = z.object({
  status: z.enum(['AVAILABLE', 'RESERVED', 'CLEANING', 'OUT_OF_SERVICE', 'PREPARING', 'INFUSING']),
  note: optText(300),
});

const protocolDrugSchema = z.object({
  sequence: z.number().int().min(1).max(50),
  drugName: z.string().trim().min(2).max(120),
  drugId: uuid.nullish(),
  doseValue: z.number().gt(0).max(100000),
  doseUnit: z.enum(['MG', 'MG_M2', 'MG_KG', 'AUC']),
  route: z.enum(['IV', 'PO', 'SC', 'IM']),
  administrationMethod: z.enum(['INFUSION', 'BOLUS', 'CONTINUOUS_INFUSION', 'ORAL', 'INJECTION']).nullish(),
  diluent: optText(120),
  finalVolumeMl: z.number().gt(0).max(5000).nullish(),
  infusionDurationMin: z.number().int().gt(0).max(10080).nullish(),
  treatmentDays: z.array(z.number().int().min(1).max(365)).min(1).optional(),
  premedicationRequired: z.boolean().optional(),
  roundingRule: z.string().max(20).nullish(),
  specialInstructions: optText(1000),
});
export const protocolSchema = z.object({
  code: z.string().trim().min(2).max(40),
  name: z.string().trim().min(3).max(160),
  cancerType: z.string().trim().min(2).max(80),
  intent: z.enum(['CURATIVE', 'ADJUVANT', 'NEOADJUVANT', 'PALLIATIVE', 'MAINTENANCE']),
  cycleLengthDays: z.number().int().min(1).max(365),
  plannedCycles: z.number().int().min(1).max(100),
  treatmentDays: z.array(z.number().int().min(1).max(365)).optional(),
  estimatedDurationMin: z.number().int().min(10).max(720).nullish(),
  premedications: optText(2000),
  hydration: optText(2000),
  supportiveMedications: optText(2000),
  specialInstructions: optText(2000),
  requiredLabs: z.array(z.string().max(20)).max(20).optional(),
  defaultRoundingRule: z.string().max(20).optional(),
  isDemo: z.boolean().optional(),
  isActive: z.boolean().optional(),
  drugs: z.array(protocolDrugSchema).min(1).max(30),
});

export const userSchema = z.object({
  email: z.email().max(200),
  password: z.string().min(8).max(200),
  fullName: z.string().trim().min(2).max(120),
  fullNameAr: optText(120),
  role: z.enum(['ADMIN', 'PHYSICIAN', 'NURSE', 'RECEPTION']),
  title: optText(40),
  phone: optText(30),
});
export const userUpdateSchema = z.object({
  fullName: z.string().trim().min(2).max(120).optional(),
  fullNameAr: optText(120),
  role: z.enum(['ADMIN', 'PHYSICIAN', 'NURSE', 'RECEPTION']).optional(),
  title: optText(40),
  phone: optText(30),
  isActive: z.boolean().optional(),
});
export const passwordSchema = z.object({ password: z.string().min(8).max(200) });

export const simulateSchema = z.object({ event: z.enum(['DELIVERED', 'READ', 'FAILED', 'CONFIRM', 'RESCHEDULE', 'CANCEL']) });
export const searchSchema = z.object({ q: z.string().max(100) });
