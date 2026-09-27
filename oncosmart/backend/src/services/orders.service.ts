import { Db, pool, q, q1 } from '../db/pool';
import { AuthUser } from '../middleware/auth';
import { ageFrom, todayInTz } from '../utils/dates';
import { conflict, notFound, validationError } from '../utils/errors';
import { can } from '../utils/permissions';
import { Actor, audit } from './audit.service';
import { occupyChair, releaseChair } from './chair.service';
import { bsaMosteller, calculateDose, cockcroftGault, DoseUnit, estimateVials } from './doseCalculator';
import { suggestNext } from './nextCycle';
import { getSettings } from './settings.service';
import { ClinicalWarning, evaluateWarnings, requiresAcknowledgement, WarningItem, WarningLab } from './warningEngine';
import { suggestChair } from './appointment.service';
import { cancelPendingForAppointment } from './notification.service';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------
export interface OrderItemOverride {
  protocolDrugId: string;
  include?: boolean;
  dosePercent?: number;
  finalDose?: number | null;
  modificationReason?: string | null;
  diluent?: string | null;
  finalVolumeMl?: number | null;
  infusionDurationMin?: number | null;
}

export interface OrderInput {
  treatmentPlanId: string;
  cycleNumber: number;
  dayNumber: number;
  plannedDate: string;
  heightCm?: number | null;
  weightKg?: number | null;
  gfr?: number | null;
  gfrSource?: string | null;
  items?: OrderItemOverride[];
  premedications?: string | null;
  hydration?: string | null;
  supportiveMedications?: string | null;
  specialInstructions?: string | null;
  clinicalNotes?: string | null;
}

interface ComputedItem {
  protocolDrugId: string;
  drugId: string | null;
  sequence: number;
  drugName: string;
  doseValue: number;
  doseUnit: DoseUnit;
  basisValue: number | null;
  calculatedDose: number | null;
  dosePercent: number;
  roundingRule: string;
  roundedDose: number | null;
  finalDose: number | null;
  isManuallyAdjusted: boolean;
  modificationReason: string | null;
  formula: string;
  calculationError: string | null;
  previousFinalDose: number | null;
  route: string;
  administrationMethod: string | null;
  diluent: string | null;
  finalVolumeMl: number | null;
  infusionDurationMin: number | null;
  premedicationRequired: boolean;
  specialInstructions: string | null;
}

// -----------------------------------------------------------------------------
// Context loading
// -----------------------------------------------------------------------------
async function loadPlanContext(db: Db, planId: string) {
  const plan = await q1(db, 'SELECT * FROM treatment_plans WHERE id=$1', [planId]);
  if (!plan) throw validationError('Cannot create a treatment order without a valid treatment plan / protocol.');
  const protocol = await q1(db, 'SELECT * FROM protocols WHERE id=$1', [plan.protocol_id]);
  if (!protocol) throw validationError('Cannot create a treatment order without a protocol.');
  const drugs = await q(db, 'SELECT * FROM protocol_drugs WHERE protocol_id=$1 ORDER BY sequence', [protocol.id]);
  const patient = await q1(db, 'SELECT * FROM patients WHERE id=$1', [plan.patient_id]);
  return { plan, protocol, drugs, patient };
}

async function previousCompletedOrder(db: Db, planId: string, cycle: number, day: number, excludeId?: string) {
  const prev = await q1(
    db,
    `SELECT * FROM treatment_orders
      WHERE treatment_plan_id=$1 AND status='COMPLETED' AND ($4::uuid IS NULL OR id <> $4)
        AND (cycle_number < $2 OR (cycle_number = $2 AND day_number < $3))
      ORDER BY cycle_number DESC, day_number DESC LIMIT 1`,
    [planId, cycle, day, excludeId ?? null],
  );
  if (!prev) return null;
  const items = await q(db, 'SELECT drug_name, final_dose, dose_value, dose_unit FROM treatment_order_items WHERE treatment_order_id=$1', [prev.id]);
  return { ...prev, items };
}

async function patientSafetyData(db: Db, patientId: string, plannedDate: string) {
  const allergies = await q(db, `SELECT allergen, severity, reaction FROM allergies WHERE patient_id=$1 AND is_active`, [patientId]);
  const labs = await q<WarningLab>(
    db,
    `SELECT r.test_code AS code, d.name, r.value, r.unit, r.ref_low AS "refLow", r.ref_high AS "refHigh",
            r.collected_at AS "collectedAt"
       FROM laboratory_results r JOIN lab_test_definitions d ON d.code = r.test_code
      WHERE r.patient_id=$1 AND r.collected_at >= ($2::date - interval '60 days') AND r.collected_at < ($2::date + interval '2 days')
      ORDER BY r.collected_at DESC`,
    [patientId, plannedDate],
  );
  return { allergies, labs: labs.map((l) => ({ ...l, collectedAt: new Date(l.collectedAt).toISOString() })) };
}

function computeItems(
  drugs: any[],
  protocol: any,
  dayNumber: number,
  overrides: OrderItemOverride[] | undefined,
  basis: { bsa: number | null; weightKg: number | null; gfr: number | null },
  previous: { items: any[] } | null,
): ComputedItem[] {
  const byId = new Map((overrides ?? []).map((o) => [o.protocolDrugId, o]));
  const forDay = drugs.filter((d) => (d.treatment_days ?? [1]).includes(dayNumber));
  const result: ComputedItem[] = [];
  for (const d of forDay) {
    const ov = byId.get(d.id);
    if (ov && ov.include === false) continue;
    const dosePercent = ov?.dosePercent ?? 100;
    const roundingRule = d.rounding_rule ?? protocol.default_rounding_rule ?? 'NEAREST_1';
    const calc = calculateDose({
      drugName: d.drug_name,
      doseValue: Number(d.dose_value),
      doseUnit: d.dose_unit,
      bsa: basis.bsa,
      weightKg: basis.weightKg,
      gfr: basis.gfr,
      dosePercent,
      roundingRule,
    });
    const manual = ov?.finalDose !== undefined && ov?.finalDose !== null && calc.ok && Number(ov.finalDose) !== calc.roundedDose;
    const prev = previous?.items.find((p) => p.drug_name.toLowerCase() === d.drug_name.toLowerCase());
    result.push({
      protocolDrugId: d.id,
      drugId: d.drug_id,
      sequence: d.sequence,
      drugName: d.drug_name,
      doseValue: Number(d.dose_value),
      doseUnit: d.dose_unit,
      basisValue: calc.basisValue,
      calculatedDose: calc.calculatedDose,
      dosePercent,
      roundingRule,
      roundedDose: calc.roundedDose,
      finalDose: manual ? Number(ov!.finalDose) : calc.roundedDose,
      isManuallyAdjusted: !!manual,
      modificationReason: ov?.modificationReason?.trim() || null,
      formula: calc.formula,
      calculationError: calc.ok ? null : calc.error ?? 'Calculation failed',
      previousFinalDose: prev ? Number(prev.final_dose) : null,
      route: d.route,
      administrationMethod: d.administration_method,
      diluent: ov?.diluent !== undefined ? ov.diluent || null : d.diluent,
      finalVolumeMl: ov?.finalVolumeMl !== undefined ? ov.finalVolumeMl ?? null : d.final_volume_ml,
      infusionDurationMin: ov?.infusionDurationMin !== undefined ? ov.infusionDurationMin ?? null : d.infusion_duration_min,
      premedicationRequired: d.premedication_required,
      specialInstructions: d.special_instructions,
    });
  }
  return result;
}

function toWarningItems(items: ComputedItem[]): WarningItem[] {
  return items.map((i) => ({
    drugName: i.drugName,
    doseUnit: i.doseUnit,
    route: i.route,
    finalDose: i.finalDose,
    calculationError: i.calculationError,
    diluent: i.diluent,
    finalVolumeMl: i.finalVolumeMl,
    infusionDurationMin: i.infusionDurationMin,
    administrationMethod: i.administrationMethod,
    dosePercent: i.dosePercent,
    isManuallyAdjusted: i.isManuallyAdjusted,
    modificationReason: i.modificationReason,
    previousFinalDose: i.previousFinalDose,
    premedicationRequired: i.premedicationRequired,
  }));
}

function thresholds(s: Awaited<ReturnType<typeof getSettings>>) {
  return {
    doseDifferencePct: Number(s.dose_difference_threshold_pct),
    weightChangePct: Number(s.weight_change_threshold_pct),
    labValidityDays: Number(s.lab_validity_days),
    calvertGfrReview: Number(s.calvert_gfr_review_threshold),
  };
}

// -----------------------------------------------------------------------------
// Preview (calculation + warnings, nothing saved)
// -----------------------------------------------------------------------------
export async function previewOrder(db: Db, input: OrderInput, excludeOrderId?: string) {
  const s = await getSettings();
  const { plan, protocol, drugs, patient } = await loadPlanContext(db, input.treatmentPlanId);
  const heightCm = input.heightCm ?? null;
  const weightKg = input.weightKg ?? null;
  let bsa: number | null = null;
  let bsaError: string | null = null;
  if (heightCm !== null || weightKg !== null) {
    try {
      bsa = bsaMosteller(Number(heightCm), Number(weightKg));
    } catch (e) {
      bsaError = (e as Error).message;
    }
  }
  const previous = await previousCompletedOrder(db, plan.id, input.cycleNumber, input.dayNumber, excludeOrderId);
  const items = computeItems(drugs, protocol, input.dayNumber, input.items, { bsa, weightKg, gfr: input.gfr ?? null }, previous);
  const safety = await patientSafetyData(db, patient.id, input.plannedDate);
  const premedications = input.premedications !== undefined ? input.premedications : protocol.premedications;
  const warnings = evaluateWarnings({
    thresholds: thresholds(s),
    plannedDate: input.plannedDate,
    orderStatus: null,
    noKnownAllergies: patient.no_known_allergies,
    allergies: safety.allergies,
    requiredLabs: protocol.required_labs ?? [],
    labs: safety.labs,
    items: toWarningItems(items),
    weightKg,
    gfr: input.gfr ?? null,
    gfrSource: input.gfrSource ?? null,
    premedications,
    previous: previous
      ? { weightKg: previous.weight_kg, plannedDate: previous.planned_date, cycleNumber: previous.cycle_number, dayNumber: previous.day_number }
      : null,
    cycleNumber: input.cycleNumber,
    dayNumber: input.dayNumber,
    plannedCycles: plan.planned_cycles,
    cycleLengthDays: plan.cycle_length_days,
    isDemoProtocol: protocol.is_demo,
  });
  // Reference-only renal helpers (never applied automatically)
  const latestCreat = safety.labs.find((l) => l.code === 'CREAT');
  const latestEgfr = safety.labs.find((l) => l.code === 'EGFR');
  const today = todayInTz(s.timezone);
  const crcl =
    latestCreat && weightKg
      ? cockcroftGault({
          ageYears: ageFrom(patient.date_of_birth, today),
          weightKg,
          sex: patient.sex,
          creatinineMgDl: latestCreat.value,
        })
      : null;
  if (!items.length) {
    warnings.unshift({
      code: 'NO_DRUGS_FOR_DAY',
      severity: 'CRITICAL',
      message: `The protocol has no drugs configured for day ${input.dayNumber}.`,
    });
  }
  return {
    plan,
    protocol: {
      id: protocol.id,
      name: protocol.name,
      code: protocol.code,
      isDemo: protocol.is_demo,
      treatmentDays: protocol.treatment_days,
      premedications: protocol.premedications,
      hydration: protocol.hydration,
      supportiveMedications: protocol.supportive_medications,
      specialInstructions: protocol.special_instructions,
      requiredLabs: protocol.required_labs,
    },
    heightCm,
    weightKg,
    bsa,
    bsaError,
    items,
    warnings,
    requiresAcknowledgement: requiresAcknowledgement(warnings),
    previous: previous
      ? {
          id: previous.id,
          cycleNumber: previous.cycle_number,
          dayNumber: previous.day_number,
          plannedDate: previous.planned_date,
          weightKg: previous.weight_kg,
          bsa: previous.bsa_m2,
          items: previous.items,
        }
      : null,
    renalReference: {
      latestCreatinine: latestCreat ? { value: latestCreat.value, unit: latestCreat.unit, collectedAt: latestCreat.collectedAt } : null,
      latestEgfr: latestEgfr ? { value: latestEgfr.value, unit: latestEgfr.unit, collectedAt: latestEgfr.collectedAt } : null,
      cockcroftGault: crcl,
    },
  };
}

function assertItemsValid(items: ComputedItem[], bsaError: string | null) {
  if (!items.length) throw validationError('Cannot create a treatment order without drugs for this protocol day.');
  if (bsaError) throw validationError(bsaError);
  const failed = items.find((i) => i.calculationError);
  if (failed) throw validationError(`${failed.drugName}: ${failed.calculationError}`);
  for (const i of items) {
    if ((i.dosePercent !== 100 || i.isManuallyAdjusted) && !i.modificationReason) {
      throw validationError(`${i.drugName}: a reason is required when the dose is modified or manually adjusted.`);
    }
    if (!(Number(i.finalDose) > 0)) throw validationError(`${i.drugName}: final dose must be greater than zero.`);
  }
}

async function insertItems(db: Db, orderId: string, items: ComputedItem[]) {
  for (const i of items) {
    await db.query(
      `INSERT INTO treatment_order_items (treatment_order_id, protocol_drug_id, drug_id, sequence, drug_name, dose_value, dose_unit,
          dose_basis_value, calculated_dose, dose_percent, rounding_rule, rounded_dose, final_dose, is_manually_adjusted,
          dose_modification_reason, calculation_formula, previous_final_dose, route, administration_method, diluent,
          final_volume_ml, infusion_duration_min, premedication_required, special_instructions)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)`,
      [
        orderId,
        i.protocolDrugId,
        i.drugId,
        i.sequence,
        i.drugName,
        i.doseValue,
        i.doseUnit,
        i.basisValue,
        i.calculatedDose,
        i.dosePercent,
        i.roundingRule,
        i.roundedDose,
        i.finalDose,
        i.isManuallyAdjusted,
        i.modificationReason,
        i.formula,
        i.previousFinalDose,
        i.route,
        i.administrationMethod,
        i.diluent,
        i.finalVolumeMl,
        i.infusionDurationMin,
        i.premedicationRequired,
        i.specialInstructions,
      ],
    );
  }
}

// -----------------------------------------------------------------------------
// Create / update
// -----------------------------------------------------------------------------
export async function createOrder(db: Db, input: OrderInput, actor: Actor, submit: boolean) {
  const preview = await previewOrder(db, input);
  const { plan, protocol } = preview;
  if (plan.status !== 'ACTIVE') throw conflict('The treatment plan is not active. Reactivate it before creating an order.');
  assertItemsValid(preview.items, preview.bsaError);
  const diagnosis = plan.diagnosis_id ? await q1(db, 'SELECT id FROM diagnoses WHERE id=$1', [plan.diagnosis_id]) : null;
  const order = await q1(
    db,
    `INSERT INTO treatment_orders (patient_id, treatment_plan_id, protocol_id, diagnosis_id, protocol_name, protocol_version, intent,
        cycle_number, day_number, planned_date, height_cm, weight_kg, bsa_m2, gfr_ml_min, gfr_source, status,
        premedications, hydration, supportive_medications, special_instructions, clinical_notes, warnings,
        prescribed_by, submitted_by, submitted_at, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$23)
     RETURNING id, order_number`,
    [
      plan.patient_id,
      plan.id,
      protocol.id,
      diagnosis?.id ?? null,
      protocol.name,
      (await q1(db, 'SELECT version FROM protocols WHERE id=$1', [protocol.id]))?.version ?? 1,
      plan.intent,
      input.cycleNumber,
      input.dayNumber,
      input.plannedDate,
      preview.heightCm,
      preview.weightKg,
      preview.bsa,
      input.gfr ?? null,
      input.gfrSource ?? null,
      submit ? 'PENDING_REVIEW' : 'DRAFT',
      input.premedications !== undefined ? input.premedications : protocol.premedications,
      input.hydration !== undefined ? input.hydration : protocol.hydration,
      input.supportiveMedications !== undefined ? input.supportiveMedications : protocol.supportiveMedications,
      input.specialInstructions !== undefined ? input.specialInstructions : protocol.specialInstructions,
      input.clinicalNotes ?? null,
      JSON.stringify(preview.warnings),
      actor.id,
      submit ? actor.id : null,
      submit ? new Date() : null,
    ],
  );
  await insertItems(db, order.id, preview.items);
  // Keep latest measurements on the patient record
  if (preview.heightCm && preview.weightKg) {
    await db.query('UPDATE patients SET height_cm=$2, weight_kg=$3 WHERE id=$1', [plan.patient_id, preview.heightCm, preview.weightKg]);
  }
  // Link to an existing appointment for the same plan/cycle/day without an order
  await db.query(
    `UPDATE appointments SET treatment_order_id=$1
      WHERE id = (SELECT id FROM appointments WHERE treatment_plan_id=$2 AND cycle_number=$3 AND day_number=$4
                   AND treatment_order_id IS NULL AND status NOT IN ('CANCELLED','NO_SHOW','COMPLETED') LIMIT 1)`,
    [order.id, plan.id, input.cycleNumber, input.dayNumber],
  );
  await audit(db, actor, {
    action: 'TREATMENT_ORDER_CREATED',
    entityType: 'treatment_order',
    entityId: order.id,
    patientId: plan.patient_id,
    description: `${order.order_number} — ${protocol.name} C${input.cycleNumber}D${input.dayNumber}${submit ? ' (submitted for review)' : ' (draft)'}`,
    next: {
      cycle: input.cycleNumber,
      day: input.dayNumber,
      plannedDate: input.plannedDate,
      heightCm: preview.heightCm,
      weightKg: preview.weightKg,
      bsa: preview.bsa,
      doses: preview.items.map((i) => ({ drug: i.drugName, calculated: i.calculatedDose, final: i.finalDose, pct: i.dosePercent })),
    },
  });
  if (submit) {
    await audit(db, actor, { action: 'TREATMENT_ORDER_SUBMITTED', entityType: 'treatment_order', entityId: order.id, patientId: plan.patient_id });
  }
  return order;
}

export async function updateOrder(db: Db, id: string, input: Omit<OrderInput, 'treatmentPlanId'>, actor: Actor) {
  const existing = await q1(db, 'SELECT * FROM treatment_orders WHERE id=$1 FOR UPDATE', [id]);
  if (!existing) throw notFound('Treatment order');
  if (!['DRAFT', 'PENDING_REVIEW'].includes(existing.status)) {
    throw conflict('Only draft or pending-review orders can be edited. Hold the order and create a new one if changes are needed.');
  }
  const full: OrderInput = { ...input, treatmentPlanId: existing.treatment_plan_id };
  const preview = await previewOrder(db, full, id);
  assertItemsValid(preview.items, preview.bsaError);
  const oldItems = await q(db, 'SELECT drug_name, final_dose, dose_percent FROM treatment_order_items WHERE treatment_order_id=$1 ORDER BY sequence', [id]);
  await db.query('DELETE FROM treatment_order_items WHERE treatment_order_id=$1', [id]);
  await insertItems(db, id, preview.items);
  await db.query(
    `UPDATE treatment_orders SET cycle_number=$2, day_number=$3, planned_date=$4, height_cm=$5, weight_kg=$6, bsa_m2=$7,
            gfr_ml_min=$8, gfr_source=$9, premedications=$10, hydration=$11, supportive_medications=$12,
            special_instructions=$13, clinical_notes=$14, warnings=$15
      WHERE id=$1`,
    [
      id,
      input.cycleNumber,
      input.dayNumber,
      input.plannedDate,
      preview.heightCm,
      preview.weightKg,
      preview.bsa,
      input.gfr ?? null,
      input.gfrSource ?? null,
      input.premedications !== undefined ? input.premedications : existing.premedications,
      input.hydration !== undefined ? input.hydration : existing.hydration,
      input.supportiveMedications !== undefined ? input.supportiveMedications : existing.supportive_medications,
      input.specialInstructions !== undefined ? input.specialInstructions : existing.special_instructions,
      input.clinicalNotes !== undefined ? input.clinicalNotes : existing.clinical_notes,
      JSON.stringify(preview.warnings),
    ],
  );
  const doseChanges = preview.items
    .map((i) => {
      const old = oldItems.find((o) => o.drug_name === i.drugName);
      return old && Number(old.final_dose) !== Number(i.finalDose)
        ? { drug: i.drugName, from: Number(old.final_dose), to: i.finalDose, reason: i.modificationReason }
        : null;
    })
    .filter(Boolean);
  await audit(db, actor, {
    action: 'TREATMENT_ORDER_UPDATED',
    entityType: 'treatment_order',
    entityId: id,
    patientId: existing.patient_id,
    previous: { weightKg: existing.weight_kg, heightCm: existing.height_cm, bsa: existing.bsa_m2, doses: oldItems },
    next: { weightKg: preview.weightKg, heightCm: preview.heightCm, bsa: preview.bsa, doses: preview.items.map((i) => ({ drug_name: i.drugName, final_dose: i.finalDose, dose_percent: i.dosePercent })) },
  });
  if (doseChanges.length) {
    await audit(db, actor, {
      action: 'DOSE_CHANGED',
      entityType: 'treatment_order',
      entityId: id,
      patientId: existing.patient_id,
      previous: doseChanges.map((d: any) => ({ drug: d.drug, dose: d.from })),
      next: doseChanges.map((d: any) => ({ drug: d.drug, dose: d.to, reason: d.reason })),
    });
  }
  return { id };
}

// -----------------------------------------------------------------------------
// Live warnings for a stored order
// -----------------------------------------------------------------------------
export async function liveWarnings(db: Db, order: any, items: any[], appointment: any | null): Promise<ClinicalWarning[]> {
  const s = await getSettings();
  const plan = await q1(db, 'SELECT planned_cycles, cycle_length_days FROM treatment_plans WHERE id=$1', [order.treatment_plan_id]);
  const protocol = await q1(db, 'SELECT required_labs, is_demo FROM protocols WHERE id=$1', [order.protocol_id]);
  const patient = await q1(db, 'SELECT no_known_allergies FROM patients WHERE id=$1', [order.patient_id]);
  const safety = await patientSafetyData(db, order.patient_id, order.planned_date);
  const previous = await previousCompletedOrder(db, order.treatment_plan_id, order.cycle_number, order.day_number, order.id);
  let chairConflict: string | null = null;
  if (appointment?.chair_id && ['ARRIVED', 'IN_PREPARATION'].includes(appointment.status)) {
    const chair = await q1(db, 'SELECT name, status, current_appointment_id FROM chairs WHERE id=$1', [appointment.chair_id]);
    if (chair?.status === 'OUT_OF_SERVICE') {
      chairConflict = `${chair.name} is out of service — reassign the chair.`;
    } else if (chair?.current_appointment_id && chair.current_appointment_id !== appointment.id && ['RESERVED', 'PREPARING', 'INFUSING'].includes(chair.status)) {
      chairConflict = `Chair already assigned to another patient: ${chair.name} is currently ${chair.status.toLowerCase()} — reassign or wait for release.`;
    }
  }
  return evaluateWarnings({
    thresholds: thresholds(s),
    plannedDate: order.planned_date,
    orderStatus: order.status,
    noKnownAllergies: patient?.no_known_allergies ?? false,
    allergies: safety.allergies,
    requiredLabs: protocol?.required_labs ?? [],
    labs: safety.labs,
    items: items.map((i) => ({
      drugName: i.drug_name,
      doseUnit: i.dose_unit,
      route: i.route,
      finalDose: Number(i.final_dose),
      diluent: i.diluent,
      finalVolumeMl: i.final_volume_ml,
      infusionDurationMin: i.infusion_duration_min,
      administrationMethod: i.administration_method,
      dosePercent: Number(i.dose_percent),
      isManuallyAdjusted: i.is_manually_adjusted,
      modificationReason: i.dose_modification_reason,
      previousFinalDose: previous?.items.find((p: any) => p.drug_name.toLowerCase() === i.drug_name.toLowerCase())?.final_dose ?? null,
      premedicationRequired: i.premedication_required,
    })),
    weightKg: order.weight_kg,
    gfr: order.gfr_ml_min,
    gfrSource: order.gfr_source,
    premedications: order.premedications,
    previous: previous
      ? { weightKg: previous.weight_kg, plannedDate: previous.planned_date, cycleNumber: previous.cycle_number, dayNumber: previous.day_number }
      : null,
    cycleNumber: order.cycle_number,
    dayNumber: order.day_number,
    plannedCycles: plan?.planned_cycles ?? order.cycle_number,
    cycleLengthDays: plan?.cycle_length_days ?? 21,
    isDemoProtocol: protocol?.is_demo ?? false,
    chairConflict,
  });
}

// -----------------------------------------------------------------------------
// Detail
// -----------------------------------------------------------------------------
function allowedActions(order: any, role: AuthUser['role'], hasAppointment: boolean) {
  const a: string[] = [];
  const st = order.status as string;
  if (can(role, 'orders.prescribe')) {
    if (['DRAFT', 'PENDING_REVIEW'].includes(st)) a.push('edit');
    if (st === 'DRAFT') a.push('submit');
    if (st === 'PENDING_REVIEW') a.push('approve', 'return');
    if (['APPROVED', 'READY_FOR_PREPARATION', 'PREPARED', 'READY_FOR_ADMINISTRATION'].includes(st)) a.push('delay');
    if (['HELD', 'DELAYED'].includes(st)) a.push('resume');
    if (!['COMPLETED', 'CANCELLED', 'IN_PROGRESS'].includes(st)) a.push('cancel');
  }
  if (can(role, 'orders.hold') && ['APPROVED', 'READY_FOR_PREPARATION', 'PREPARED', 'READY_FOR_ADMINISTRATION'].includes(st)) a.push('hold');
  if (can(role, 'orders.nursing')) {
    if (st === 'APPROVED') a.push('release');
    if (st === 'READY_FOR_PREPARATION') a.push('prepared');
    if (st === 'PREPARED') a.push('verify');
    if (st === 'READY_FOR_ADMINISTRATION' && hasAppointment) a.push('start');
    if (st === 'IN_PROGRESS') a.push('administer', 'complete');
  }
  if (can(role, 'events.report') && ['READY_FOR_ADMINISTRATION', 'IN_PROGRESS', 'COMPLETED'].includes(st)) a.push('report_event');
  if (can(role, 'vitals.write') && !['CANCELLED'].includes(st)) a.push('vitals');
  return a;
}

export async function getOrderDetail(db: Db, id: string, user: AuthUser) {
  const order = await q1(
    db,
    `SELECT o.*, pb.full_name AS prescribed_by_name, ab.full_name AS approved_by_name, nv.full_name AS nurse_verified_by_name,
            rb.full_name AS released_by_name, prb.full_name AS prepared_by_name, sb.full_name AS treatment_started_by_name,
            cb.full_name AS completed_by_name, hb.full_name AS held_by_name, cab.full_name AS cancelled_by_name,
            wab.full_name AS warnings_acknowledged_by_name
       FROM treatment_orders o
       LEFT JOIN users pb ON pb.id = o.prescribed_by
       LEFT JOIN users ab ON ab.id = o.approved_by
       LEFT JOIN users nv ON nv.id = o.nurse_verified_by
       LEFT JOIN users rb ON rb.id = o.released_by
       LEFT JOIN users prb ON prb.id = o.prepared_by
       LEFT JOIN users sb ON sb.id = o.treatment_started_by
       LEFT JOIN users cb ON cb.id = o.completed_by
       LEFT JOIN users hb ON hb.id = o.held_by
       LEFT JOIN users cab ON cab.id = o.cancelled_by
       LEFT JOIN users wab ON wab.id = o.warnings_acknowledged_by
      WHERE o.id=$1`,
    [id],
  );
  if (!order) throw notFound('Treatment order');
  const s = await getSettings();
  const [items, patient, allergies, diagnosis, plan, protocol, administrations, vitals, events, appointment] = await Promise.all([
    q(db, 'SELECT * FROM treatment_order_items WHERE treatment_order_id=$1 ORDER BY sequence', [id]),
    q1(db, 'SELECT id, patient_code, mrn, first_name, last_name, full_name_ar, date_of_birth, sex, no_known_allergies, height_cm, weight_kg, status FROM patients WHERE id=$1', [order.patient_id]),
    q(db, 'SELECT id, allergen, allergen_type, reaction, severity FROM allergies WHERE patient_id=$1 AND is_active ORDER BY created_at', [order.patient_id]),
    order.diagnosis_id ? q1(db, 'SELECT * FROM diagnoses WHERE id=$1', [order.diagnosis_id]) : Promise.resolve(null),
    q1(db, 'SELECT * FROM treatment_plans WHERE id=$1', [order.treatment_plan_id]),
    q1(db, 'SELECT id, code, name, cancer_type, intent, cycle_length_days, planned_cycles, is_demo, version, required_labs FROM protocols WHERE id=$1', [order.protocol_id]),
    q(db, `SELECT ad.*, sb.full_name AS started_by_name, cb.full_name AS completed_by_name
             FROM administrations ad LEFT JOIN users sb ON sb.id = ad.started_by LEFT JOIN users cb ON cb.id = ad.completed_by
            WHERE ad.treatment_order_id=$1 ORDER BY ad.sequence`, [id]),
    q(db, `SELECT v.*, u.full_name AS recorded_by_name FROM vital_signs v LEFT JOIN users u ON u.id = v.recorded_by
            WHERE v.treatment_order_id=$1 ORDER BY v.measured_at`, [id]),
    q(db, `SELECT e.*, u.full_name AS reported_by_name FROM treatment_events e LEFT JOIN users u ON u.id = e.reported_by
            WHERE e.treatment_order_id=$1 ORDER BY e.occurred_at`, [id]),
    q1(db, `SELECT a.id, a.appointment_number, a.appointment_date, a.start_time::text AS start_time, a.duration_minutes, a.status,
                   a.chair_id, c.name AS chair_name, a.arrived_at
              FROM appointments a LEFT JOIN chairs c ON c.id = a.chair_id
             WHERE a.treatment_order_id=$1 AND a.status NOT IN ('CANCELLED') ORDER BY a.appointment_date DESC LIMIT 1`, [id]),
  ]);
  const previous = await previousCompletedOrder(db, order.treatment_plan_id, order.cycle_number, order.day_number, id);
  const warnings = await liveWarnings(db, order, items, appointment);
  // Approximate vial requirements (pharmacy planning only)
  const products = await q(
    db,
    `SELECT d.id AS drug_id, d.generic_name, dp.strength FROM drug_products dp JOIN drugs d ON d.id = dp.drug_id WHERE dp.is_active`,
  );
  const vialEstimates: Record<string, unknown> = {};
  for (const it of items) {
    const strengths = products
      .filter((p) => (it.drug_id ? p.drug_id === it.drug_id : p.generic_name.toLowerCase() === it.drug_name.toLowerCase()))
      .map((p) => Number(p.strength));
    vialEstimates[it.id] = strengths.length ? estimateVials(Number(it.final_dose), strengths) : null;
  }
  const today = todayInTz(s.timezone);
  return {
    order,
    items,
    patient: patient ? { ...patient, age: ageFrom(patient.date_of_birth, today), allergies } : null,
    diagnosis,
    plan,
    protocol,
    administrations,
    vitals,
    events,
    appointment,
    previous: previous
      ? {
          id: previous.id,
          orderNumber: previous.order_number,
          cycleNumber: previous.cycle_number,
          dayNumber: previous.day_number,
          plannedDate: previous.planned_date,
          weightKg: previous.weight_kg,
          bsa: previous.bsa_m2,
          items: previous.items,
        }
      : null,
    warnings,
    requiresAcknowledgement: requiresAcknowledgement(warnings),
    vialEstimates,
    checklist: s.pretreatment_checklist,
    allowedActions: allowedActions(order, user.role, !!appointment),
    serverTime: new Date().toISOString(),
  };
}

// -----------------------------------------------------------------------------
// Workflow transitions
// -----------------------------------------------------------------------------
async function lockOrder(db: Db, id: string) {
  const o = await q1(db, 'SELECT * FROM treatment_orders WHERE id=$1 FOR UPDATE', [id]);
  if (!o) throw notFound('Treatment order');
  return o;
}

function requireStatus(order: any, allowed: string[], message: string) {
  if (!allowed.includes(order.status)) throw conflict(message);
}

async function linkedAppointment(db: Db, orderId: string) {
  return q1(
    db,
    `SELECT * FROM appointments WHERE treatment_order_id=$1 AND status NOT IN ('CANCELLED','NO_SHOW') ORDER BY appointment_date DESC LIMIT 1`,
    [orderId],
  );
}

async function logTransition(db: Db, actor: Actor, order: any, action: string, to: string, extra?: Record<string, unknown>) {
  await audit(db, actor, {
    action,
    entityType: 'treatment_order',
    entityId: order.id,
    patientId: order.patient_id,
    description: `${order.order_number}: ${order.status} → ${to}`,
    previous: { status: order.status },
    next: { status: to, ...(extra ?? {}) },
  });
}

export async function submitOrder(db: Db, id: string, actor: Actor) {
  const o = await lockOrder(db, id);
  requireStatus(o, ['DRAFT'], 'Only draft orders can be submitted for review.');
  await db.query(`UPDATE treatment_orders SET status='PENDING_REVIEW', submitted_by=$2, submitted_at=now() WHERE id=$1`, [id, actor.id]);
  await logTransition(db, actor, o, 'TREATMENT_ORDER_SUBMITTED', 'PENDING_REVIEW');
}

export async function approveOrder(db: Db, id: string, actor: Actor, p: { acknowledgeWarnings: boolean; note?: string | null }) {
  const o = await lockOrder(db, id);
  if (o.status === 'DRAFT') throw conflict('Submit the order for review before approval.');
  requireStatus(o, ['PENDING_REVIEW'], 'Only orders pending review can be approved.');
  const items = await q(db, 'SELECT * FROM treatment_order_items WHERE treatment_order_id=$1 ORDER BY sequence', [id]);
  // Completeness checks — cannot approve an incomplete order
  const problems: string[] = [];
  if (!items.length) problems.push('no drugs on the order');
  if (items.some((i) => i.dose_unit === 'MG_M2') && !(o.bsa_m2 > 0)) problems.push('height/weight/BSA missing');
  if (items.some((i) => i.dose_unit === 'MG_KG') && !(o.weight_kg > 0)) problems.push('weight missing');
  if (items.some((i) => i.dose_unit === 'AUC') && !(o.gfr_ml_min > 0)) problems.push('GFR input missing for AUC dosing');
  for (const i of items) {
    if (!(Number(i.final_dose) > 0)) problems.push(`${i.drug_name}: no final dose`);
    if (i.route === 'IV' && i.administration_method !== 'BOLUS' && !i.infusion_duration_min) {
      problems.push(`${i.drug_name}: infusion duration not configured`);
    }
  }
  if (problems.length) {
    throw validationError(`Cannot approve an incomplete treatment order: ${problems.join('; ')}.`, { problems });
  }
  const appointment = await linkedAppointment(db, id);
  const warnings = (await liveWarnings(db, o, items, appointment)).filter((w) => w.code !== 'NOT_APPROVED');
  if (requiresAcknowledgement(warnings) && !p.acknowledgeWarnings) {
    throw validationError('This order has clinical warnings. Review and acknowledge all warnings before approval.', { warnings });
  }
  await db.query(
    `UPDATE treatment_orders SET status='APPROVED', approved_by=$2, approved_at=now(), approval_note=$3, warnings=$4,
            warnings_acknowledged_by = CASE WHEN $5 THEN $2::uuid ELSE NULL END,
            warnings_acknowledged_at = CASE WHEN $5 THEN now() ELSE NULL END
      WHERE id=$1`,
    [id, actor.id, p.note ?? null, JSON.stringify(warnings), requiresAcknowledgement(warnings)],
  );
  await logTransition(db, actor, o, 'TREATMENT_ORDER_APPROVED', 'APPROVED', {
    warningsAcknowledged: warnings.filter((w) => w.severity !== 'INFO').map((w) => w.code),
  });
}

export async function returnOrder(db: Db, id: string, actor: Actor, reason: string) {
  const o = await lockOrder(db, id);
  requireStatus(o, ['PENDING_REVIEW'], 'Only orders pending review can be returned to draft.');
  await db.query(`UPDATE treatment_orders SET status='DRAFT', approval_note=$2 WHERE id=$1`, [id, reason]);
  await logTransition(db, actor, o, 'TREATMENT_ORDER_RETURNED', 'DRAFT', { reason });
}

export async function releaseForPreparation(db: Db, id: string, actor: Actor) {
  const o = await lockOrder(db, id);
  if (['DRAFT', 'PENDING_REVIEW'].includes(o.status)) throw conflict('Treatment order has not been approved by physician.');
  requireStatus(o, ['APPROVED'], 'Only approved orders can be released for preparation.');
  await db.query(`UPDATE treatment_orders SET status='READY_FOR_PREPARATION', released_by=$2, released_at=now() WHERE id=$1`, [id, actor.id]);
  const appt = await linkedAppointment(db, id);
  if (appt && ['SCHEDULED', 'CONFIRMED', 'ARRIVED', 'NEEDS_RESCHEDULING'].includes(appt.status)) {
    await db.query(`UPDATE appointments SET status='IN_PREPARATION', arrived_at=COALESCE(arrived_at, now()) WHERE id=$1`, [appt.id]);
    await cancelPendingForAppointment(db, appt.id);
    if (appt.chair_id) await occupyChair(db, appt.chair_id, appt.id, 'PREPARING', actor);
  }
  await logTransition(db, actor, o, 'TREATMENT_RELEASED_FOR_PREPARATION', 'READY_FOR_PREPARATION');
}

export async function markPrepared(db: Db, id: string, actor: Actor) {
  const o = await lockOrder(db, id);
  requireStatus(o, ['READY_FOR_PREPARATION'], 'Only orders released for preparation can be marked prepared.');
  await db.query(`UPDATE treatment_orders SET status='PREPARED', prepared_by=$2, prepared_at=now() WHERE id=$1`, [id, actor.id]);
  await logTransition(db, actor, o, 'TREATMENT_PREPARED', 'PREPARED');
}

export async function verifyOrder(db: Db, id: string, actor: Actor, checklist: Record<string, boolean>) {
  const o = await lockOrder(db, id);
  requireStatus(o, ['PREPARED'], 'Only prepared orders can be nurse-verified.');
  const s = await getSettings();
  const missing = s.pretreatment_checklist.filter((c) => !checklist[c.id]);
  if (missing.length) {
    throw validationError(`Pre-treatment checklist incomplete: ${missing.map((m) => m.en).join('; ')}.`, { missing: missing.map((m) => m.id) });
  }
  const pre = await q1(db, `SELECT 1 FROM vital_signs WHERE treatment_order_id=$1 AND phase='PRE' LIMIT 1`, [id]);
  if (!pre) throw validationError('Record pre-treatment vital signs before nurse verification.');
  await db.query(
    `UPDATE treatment_orders SET status='READY_FOR_ADMINISTRATION', nurse_verified_by=$2, nurse_verified_at=now(), pretreatment_checklist=$3 WHERE id=$1`,
    [id, actor.id, JSON.stringify({ items: checklist, completedAt: new Date().toISOString(), by: actor.id })],
  );
  await logTransition(db, actor, o, 'TREATMENT_NURSE_VERIFIED', 'READY_FOR_ADMINISTRATION');
}

export async function startTreatment(db: Db, id: string, actor: Actor) {
  const o = await lockOrder(db, id);
  if (['DRAFT', 'PENDING_REVIEW'].includes(o.status)) throw conflict('Cannot start a treatment without physician approval.');
  if (['APPROVED', 'READY_FOR_PREPARATION', 'PREPARED'].includes(o.status)) {
    throw conflict('Cannot start treatment: the order must be prepared and nurse-verified first.');
  }
  requireStatus(o, ['READY_FOR_ADMINISTRATION'], `Cannot start treatment from status ${o.status}.`);
  const appt = await linkedAppointment(db, id);
  if (!appt) throw conflict('Cannot start treatment: no appointment is linked to this order.');
  if (!appt.chair_id) throw conflict('Assign a chair to the appointment before starting treatment.');
  await occupyChair(db, appt.chair_id, appt.id, 'INFUSING', actor);
  await db.query(`UPDATE treatment_orders SET status='IN_PROGRESS', treatment_started_by=$2, treatment_started_at=now() WHERE id=$1`, [id, actor.id]);
  await db.query(`UPDATE appointments SET status='IN_TREATMENT', arrived_at=COALESCE(arrived_at, now()) WHERE id=$1`, [appt.id]);
  const items = await q(db, 'SELECT * FROM treatment_order_items WHERE treatment_order_id=$1 ORDER BY sequence', [id]);
  for (const i of items) {
    await db.query(
      `INSERT INTO administrations (treatment_order_id, treatment_order_item_id, patient_id, appointment_id, sequence, drug_name,
          planned_dose, dose_unit, route, diluent, volume_ml, planned_duration_min)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT (treatment_order_item_id) DO NOTHING`,
      [id, i.id, o.patient_id, appt.id, i.sequence, i.drug_name, i.final_dose, i.final_dose_unit, i.route, i.diluent, i.final_volume_ml, i.infusion_duration_min],
    );
  }
  await logTransition(db, actor, o, 'TREATMENT_STARTED', 'IN_PROGRESS', { appointmentId: appt.id, chairId: appt.chair_id });
}

export async function completeTreatment(
  db: Db,
  id: string,
  actor: Actor,
  p: { adverseEvent: boolean; adverseEventDetails?: string | null; notes?: string | null; disposition: string },
) {
  const o = await lockOrder(db, id);
  requireStatus(o, ['IN_PROGRESS'], 'Only treatments in progress can be completed.');
  const admins = await q(db, 'SELECT * FROM administrations WHERE treatment_order_id=$1 ORDER BY sequence', [id]);
  // Continuous infusions (e.g. ambulatory pump) may still be running when the chair session ends.
  const items = await q(db, 'SELECT id, administration_method FROM treatment_order_items WHERE treatment_order_id=$1', [id]);
  const ciItemIds = new Set(items.filter((i) => i.administration_method === 'CONTINUOUS_INFUSION').map((i) => i.id));
  const blocking = admins.filter(
    (a) =>
      !['COMPLETED', 'NOT_GIVEN', 'STOPPED'].includes(a.status) &&
      !(ciItemIds.has(a.treatment_order_item_id) && a.status === 'IN_PROGRESS'),
  );
  if (blocking.length) {
    throw validationError(
      `Cannot complete treatment: administration not documented for ${blocking.map((a) => a.drug_name).join(', ')}. Record start/end times or mark as not given.`,
    );
  }
  const incomplete = admins.filter((a) => a.status === 'COMPLETED' && (!a.start_time || !a.end_time || !(Number(a.dose_administered) > 0)));
  if (incomplete.length) throw validationError(`Administration record incomplete for ${incomplete.map((a) => a.drug_name).join(', ')}.`);
  if (p.adverseEvent && !p.adverseEventDetails?.trim()) throw validationError('Describe the adverse event.');

  const s = await getSettings();
  const completed = await q1(
    db,
    `UPDATE treatment_orders SET status='COMPLETED', completed_by=$2, completed_at=now(),
            treatment_duration_min = GREATEST(0, round(extract(epoch FROM (now() - treatment_started_at)) / 60))::int,
            adverse_event=$3, adverse_event_details=$4, completion_notes=$5, disposition=$6
      WHERE id=$1 RETURNING *`,
    [id, actor.id, p.adverseEvent, p.adverseEventDetails ?? null, p.notes ?? null, p.disposition],
  );
  const appt = await linkedAppointment(db, id);
  let chairStatus: string | null = null;
  if (appt) {
    await db.query(`UPDATE appointments SET status='COMPLETED' WHERE id=$1`, [appt.id]);
    if (appt.chair_id) chairStatus = await releaseChair(db, appt.chair_id, appt.id, actor, 'TREATMENT_COMPLETED');
  }
  // Update treatment plan progress + next-cycle suggestion
  const plan = await q1(db, 'SELECT * FROM treatment_plans WHERE id=$1 FOR UPDATE', [o.treatment_plan_id]);
  const protocol = await q1(db, 'SELECT name, treatment_days, estimated_duration_min FROM protocols WHERE id=$1', [o.protocol_id]);
  const next = suggestNext({
    treatmentDays: protocol.treatment_days,
    cycleLengthDays: plan.cycle_length_days,
    plannedCycles: plan.planned_cycles,
    cycle: o.cycle_number,
    day: o.day_number,
    date: todayInTz(s.timezone),
  });
  const cyclesCompleted = await q1(
    db,
    `SELECT count(DISTINCT cycle_number)::int AS n FROM treatment_orders WHERE treatment_plan_id=$1 AND status='COMPLETED'`,
    [plan.id],
  );
  await db.query(
    `UPDATE treatment_plans SET current_cycle=$2, current_day=$3, cycles_completed=$4, next_cycle=$5, next_day=$6, next_due_date=$7 WHERE id=$1`,
    [plan.id, o.cycle_number, o.day_number, cyclesCompleted.n, next?.cycle ?? null, next?.day ?? null, next?.dueDate ?? null],
  );
  await logTransition(db, actor, o, 'TREATMENT_COMPLETED', 'COMPLETED', {
    durationMin: completed.treatment_duration_min,
    adverseEvent: p.adverseEvent,
    disposition: p.disposition,
  });
  let suggestion = null;
  if (next) {
    const startTime = appt?.start_time ? String(appt.start_time).slice(0, 5) : '09:00';
    const duration = appt?.duration_minutes ?? protocol.estimated_duration_min ?? s.default_appointment_duration_min;
    const chair = await suggestChair(db, next.dueDate, startTime, duration);
    suggestion = {
      ...next,
      treatmentPlanId: plan.id,
      protocolId: o.protocol_id,
      protocolName: protocol.name,
      startTime,
      durationMinutes: duration,
      physicianId: plan.physician_id,
      suggestedChairId: chair?.id ?? null,
      suggestedChairName: chair?.name ?? null,
    };
  }
  return { chairStatus, nextSuggestion: suggestion, allCyclesComplete: !next };
}

export async function holdOrder(db: Db, id: string, actor: Actor, reason: string, kind: 'HELD' | 'DELAYED', delayedUntil?: string | null) {
  const o = await lockOrder(db, id);
  requireStatus(o, ['APPROVED', 'READY_FOR_PREPARATION', 'PREPARED', 'READY_FOR_ADMINISTRATION'], 'This order cannot be held in its current status.');
  await db.query(
    `UPDATE treatment_orders SET status=$2, status_before_hold=status, hold_reason=$3, held_by=$4, held_at=now(),
            delay_reason = CASE WHEN $2='DELAYED' THEN $3 ELSE delay_reason END, delayed_until=$5
      WHERE id=$1`,
    [id, kind, reason, actor.id, delayedUntil ?? null],
  );
  await logTransition(db, actor, o, kind === 'HELD' ? 'TREATMENT_ORDER_HELD' : 'TREATMENT_ORDER_DELAYED', kind, { reason, delayedUntil });
}

/** Resuming a held/delayed order requires a new physician approval (returns to PENDING_REVIEW). */
export async function resumeOrder(db: Db, id: string, actor: Actor) {
  const o = await lockOrder(db, id);
  requireStatus(o, ['HELD', 'DELAYED'], 'Only held or delayed orders can be resumed.');
  await db.query(
    `UPDATE treatment_orders SET status='PENDING_REVIEW', approved_by=NULL, approved_at=NULL, released_by=NULL, released_at=NULL,
            prepared_by=NULL, prepared_at=NULL, nurse_verified_by=NULL, nurse_verified_at=NULL, pretreatment_checklist=NULL
      WHERE id=$1`,
    [id],
  );
  await logTransition(db, actor, o, 'TREATMENT_ORDER_RESUMED', 'PENDING_REVIEW', { note: 'Re-approval required' });
}

export async function cancelOrder(db: Db, id: string, actor: Actor, reason: string) {
  const o = await lockOrder(db, id);
  if (['COMPLETED', 'CANCELLED', 'IN_PROGRESS'].includes(o.status)) throw conflict('This order cannot be cancelled in its current status.');
  await db.query(
    `UPDATE treatment_orders SET status='CANCELLED', cancelled_reason=$2, cancelled_by=$3, cancelled_at=now() WHERE id=$1`,
    [id, reason, actor.id],
  );
  await db.query(`UPDATE appointments SET treatment_order_id=NULL WHERE treatment_order_id=$1 AND status NOT IN ('COMPLETED')`, [id]);
  await logTransition(db, actor, o, 'TREATMENT_ORDER_CANCELLED', 'CANCELLED', { reason });
}

// -----------------------------------------------------------------------------
// Administration (per drug) — nursing documentation & infusion timer
// -----------------------------------------------------------------------------
async function lockAdministration(db: Db, id: string) {
  const a = await q1(
    db,
    `SELECT ad.*, o.status AS order_status, o.order_number, i.administration_method
       FROM administrations ad JOIN treatment_orders o ON o.id = ad.treatment_order_id
       JOIN treatment_order_items i ON i.id = ad.treatment_order_item_id
      WHERE ad.id=$1 FOR UPDATE OF ad`,
    [id],
  );
  if (!a) throw notFound('Administration record');
  return a;
}

export async function administrationAction(
  db: Db,
  id: string,
  action: 'start' | 'pause' | 'resume' | 'complete' | 'stop' | 'not_given',
  actor: Actor,
  p: { doseAdministered?: number | null; notes?: string | null; observations?: string | null; reaction?: boolean; reactionDetails?: string | null; reason?: string | null },
) {
  const a = await lockAdministration(db, id);
  const ciOpenAfterCompletion = a.order_status === 'COMPLETED' && a.administration_method === 'CONTINUOUS_INFUSION' && a.status === 'IN_PROGRESS';
  if (a.order_status !== 'IN_PROGRESS' && !ciOpenAfterCompletion) {
    throw conflict('Administration can only be documented while the treatment is in progress.');
  }
  const transitions: Record<string, string[]> = {
    start: ['NOT_STARTED'],
    pause: ['IN_PROGRESS'],
    resume: ['PAUSED'],
    complete: ['IN_PROGRESS', 'PAUSED'],
    stop: ['IN_PROGRESS', 'PAUSED'],
    not_given: ['NOT_STARTED'],
  };
  if (!transitions[action].includes(a.status)) throw conflict(`Cannot ${action.replace('_', ' ')} ${a.drug_name} from status ${a.status}.`);
  if ((action === 'stop' || action === 'not_given') && !p.reason?.trim()) throw validationError('A reason is required.');
  if (p.reaction && !p.reactionDetails?.trim()) throw validationError('Describe the reaction.');
  switch (action) {
    case 'start':
      await db.query(`UPDATE administrations SET status='IN_PROGRESS', start_time=now(), started_by=$2 WHERE id=$1`, [id, actor.id]);
      break;
    case 'pause':
      await db.query(`UPDATE administrations SET status='PAUSED', paused_at=now(), notes=COALESCE($2, notes) WHERE id=$1`, [id, p.notes ?? null]);
      break;
    case 'resume':
      await db.query(
        `UPDATE administrations SET status='IN_PROGRESS',
                total_paused_seconds = total_paused_seconds + GREATEST(0, extract(epoch FROM (now() - paused_at))::int), paused_at=NULL
          WHERE id=$1`,
        [id],
      );
      break;
    case 'complete':
    case 'stop': {
      const dose = p.doseAdministered ?? (action === 'complete' ? a.planned_dose : null);
      if (action === 'complete' && !(Number(dose) > 0)) throw validationError('Dose administered is required.');
      if (dose !== null && dose !== undefined && Number(dose) > Number(a.planned_dose) * 1.001) {
        throw validationError('Dose administered cannot exceed the physician-approved dose.');
      }
      await db.query(
        `UPDATE administrations SET status=$2, end_time=now(), completed_by=$3, dose_administered=$4,
                total_paused_seconds = total_paused_seconds + CASE WHEN paused_at IS NOT NULL THEN GREATEST(0, extract(epoch FROM (now() - paused_at))::int) ELSE 0 END,
                paused_at=NULL, notes=COALESCE($5, notes), observations=COALESCE($6, observations), reaction=$7,
                reaction_details=$8, not_given_reason = CASE WHEN $2='STOPPED' THEN $9 ELSE not_given_reason END
          WHERE id=$1`,
        [id, action === 'complete' ? 'COMPLETED' : 'STOPPED', actor.id, dose, p.notes ?? null, p.observations ?? null, !!p.reaction, p.reactionDetails ?? null, p.reason ?? null],
      );
      break;
    }
    case 'not_given':
      await db.query(`UPDATE administrations SET status='NOT_GIVEN', not_given_reason=$2, completed_by=$3 WHERE id=$1`, [id, p.reason, actor.id]);
      break;
  }
  await audit(db, actor, {
    action: `ADMINISTRATION_${action.toUpperCase()}`,
    entityType: 'administration',
    entityId: id,
    patientId: a.patient_id,
    description: `${a.order_number}: ${a.drug_name}`,
    previous: { status: a.status },
    next: { dose: p.doseAdministered, reaction: p.reaction, reason: p.reason },
  });
  return q1(db, 'SELECT * FROM administrations WHERE id=$1', [id]);
}

export async function reportEvent(
  db: Db,
  orderId: string,
  actor: Actor,
  p: { eventType: string; severity: string; description: string; actionTaken?: string | null; physicianNotified?: boolean; administrationId?: string | null },
) {
  const o = await q1(db, 'SELECT id, patient_id, order_number FROM treatment_orders WHERE id=$1', [orderId]);
  if (!o) throw notFound('Treatment order');
  const ev = await q1(
    db,
    `INSERT INTO treatment_events (patient_id, treatment_order_id, administration_id, event_type, severity, description, action_taken,
                                   physician_notified, reported_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [o.patient_id, orderId, p.administrationId ?? null, p.eventType, p.severity, p.description, p.actionTaken ?? null, !!p.physicianNotified, actor.id],
  );
  await audit(db, actor, {
    action: 'TREATMENT_EVENT_REPORTED',
    entityType: 'treatment_event',
    entityId: ev.id,
    patientId: o.patient_id,
    description: `${o.order_number}: ${p.eventType} (${p.severity})`,
    next: p,
  });
  return ev;
}

export async function listOrders(f: { status?: string; from?: string; to?: string; patientId?: string; limit?: number }) {
  const params: unknown[] = [];
  const where: string[] = [];
  if (f.status) {
    params.push(f.status.split(','));
    where.push(`o.status = ANY($${params.length})`);
  }
  if (f.from) {
    params.push(f.from);
    where.push(`o.planned_date >= $${params.length}`);
  }
  if (f.to) {
    params.push(f.to);
    where.push(`o.planned_date <= $${params.length}`);
  }
  if (f.patientId) {
    params.push(f.patientId);
    where.push(`o.patient_id = $${params.length}`);
  }
  return q(
    pool,
    `SELECT o.id, o.order_number, o.patient_id, o.protocol_name, o.cycle_number, o.day_number, o.planned_date, o.status,
            o.bsa_m2, o.weight_kg, o.prescribed_at, o.approved_at, o.completed_at, o.created_at,
            p.mrn, p.patient_code, p.first_name, p.last_name, p.full_name_ar,
            pb.full_name AS prescribed_by_name, ab.full_name AS approved_by_name, pr.is_demo AS protocol_is_demo,
            jsonb_array_length(o.warnings) AS warning_count,
            (SELECT count(*)::int FROM jsonb_array_elements(o.warnings) w WHERE w->>'severity' IN ('CRITICAL','WARNING')) AS significant_warning_count
       FROM treatment_orders o
       JOIN patients p ON p.id = o.patient_id
       JOIN protocols pr ON pr.id = o.protocol_id
       LEFT JOIN users pb ON pb.id = o.prescribed_by
       LEFT JOIN users ab ON ab.id = o.approved_by
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY o.planned_date DESC, o.created_at DESC
      LIMIT ${Math.min(f.limit ?? 300, 1000)}`,
    params,
  );
}
