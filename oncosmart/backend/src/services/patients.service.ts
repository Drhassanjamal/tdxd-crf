import { Db, pool, q, q1 } from '../db/pool';
import { AuthUser } from '../middleware/auth';
import { addDays, ageFrom, todayInTz } from '../utils/dates';
import { conflict, notFound, validationError } from '../utils/errors';
import { can } from '../utils/permissions';
import { Actor, audit, diff } from './audit.service';
import { getSettings } from './settings.service';

// -----------------------------------------------------------------------------
// Registry
// -----------------------------------------------------------------------------
export interface PatientQuery {
  search?: string;
  cancerType?: string;
  oncologistId?: string;
  status?: string;
  protocolId?: string;
  appointmentDate?: string;
  page?: number;
  pageSize?: number;
}

export async function queryPatients(f: PatientQuery, user: AuthUser) {
  const s = await getSettings();
  const today = todayInTz(s.timezone);
  const params: unknown[] = [today];
  const where: string[] = [];
  const add = (sql: string, v: unknown) => {
    params.push(v);
    where.push(sql.replace(/\?/g, `$${params.length}`));
  };
  if (f.search?.trim()) {
    const term = f.search.trim();
    const digits = term.replace(/\D/g, '');
    params.push(`%${term.toLowerCase()}%`);
    const i = params.length;
    let cond = `(lower(p.first_name || ' ' || p.last_name) LIKE $${i} OR lower(p.mrn) LIKE $${i} OR lower(p.patient_code) LIKE $${i} OR coalesce(p.full_name_ar,'') LIKE $${i}`;
    if (digits.length >= 4) {
      params.push(`%${digits.slice(-9)}%`);
      cond += ` OR regexp_replace(coalesce(p.phone,''), '\\D', '', 'g') LIKE $${params.length}`;
    }
    where.push(`${cond})`);
  }
  const clinical = can(user.role, 'clinical.read');
  if (f.cancerType && clinical) add('d.cancer_type = ?', f.cancerType);
  if (f.oncologistId) add('p.primary_oncologist_id = ?', f.oncologistId);
  if (f.status) add('p.status = ?', f.status);
  if (f.protocolId) add('tp.protocol_id = ?', f.protocolId);
  if (f.appointmentDate) {
    add(
      "EXISTS (SELECT 1 FROM appointments ax WHERE ax.patient_id = p.id AND ax.appointment_date = ? AND ax.status NOT IN ('CANCELLED'))",
      f.appointmentDate,
    );
  }
  const pageSize = Math.min(f.pageSize ?? 50, 200);
  const page = Math.max(f.page ?? 1, 1);
  const base = `
    FROM patients p
    LEFT JOIN users u ON u.id = p.primary_oncologist_id
    LEFT JOIN LATERAL (SELECT primary_cancer, cancer_type FROM diagnoses WHERE patient_id = p.id
                        ORDER BY is_primary DESC, diagnosis_date DESC NULLS LAST LIMIT 1) d ON true
    LEFT JOIN LATERAL (SELECT * FROM treatment_plans WHERE patient_id = p.id
                        ORDER BY (status = 'ACTIVE') DESC, start_date DESC LIMIT 1) tp ON true
    LEFT JOIN protocols pr ON pr.id = tp.protocol_id
    LEFT JOIN LATERAL (SELECT appointment_date, start_time::text AS start_time FROM appointments
                        WHERE patient_id = p.id AND appointment_date >= $1
                          AND status IN ('SCHEDULED','CONFIRMED','ARRIVED','IN_PREPARATION','IN_TREATMENT','NEEDS_RESCHEDULING')
                        ORDER BY appointment_date, start_time LIMIT 1) na ON true
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}`;
  const [{ total }] = await q<{ total: number }>(pool, `SELECT count(*)::int AS total ${base}`, params);
  const rows = await q(
    pool,
    `SELECT p.id, p.patient_code, p.mrn, p.first_name, p.last_name, p.full_name_ar, p.date_of_birth, p.sex, p.phone, p.status,
            u.full_name AS oncologist_name, p.primary_oncologist_id,
            ${clinical ? 'd.primary_cancer, d.cancer_type,' : 'NULL AS primary_cancer, NULL AS cancer_type,'}
            tp.id AS plan_id, pr.id AS protocol_id, pr.name AS protocol_name, pr.is_demo AS protocol_is_demo,
            tp.current_cycle, tp.planned_cycles, tp.next_cycle, tp.status AS plan_status,
            na.appointment_date AS next_appointment_date, na.start_time AS next_appointment_time
       ${base}
      ORDER BY p.last_name, p.first_name
      LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
    params,
  );
  return { rows: rows.map((r) => ({ ...r, age: ageFrom(r.date_of_birth, today) })), total, page, pageSize };
}

// -----------------------------------------------------------------------------
// Demographics
// -----------------------------------------------------------------------------
export interface PatientInput {
  mrn: string;
  firstName: string;
  lastName: string;
  fullNameAr?: string | null;
  dateOfBirth: string;
  sex: 'MALE' | 'FEMALE';
  phone?: string | null;
  governorate?: string | null;
  address?: string | null;
  preferredLanguage?: 'en' | 'ar';
  emergencyContactName?: string | null;
  emergencyContactPhone?: string | null;
  emergencyContactRelation?: string | null;
  primaryOncologistId?: string | null;
  noKnownAllergies?: boolean;
  heightCm?: number | null;
  weightKg?: number | null;
}

const toColumns = (p: Partial<PatientInput>) => ({
  mrn: p.mrn?.trim().toUpperCase(),
  first_name: p.firstName?.trim(),
  last_name: p.lastName?.trim(),
  full_name_ar: p.fullNameAr,
  date_of_birth: p.dateOfBirth,
  sex: p.sex,
  phone: p.phone,
  governorate: p.governorate,
  address: p.address,
  preferred_language: p.preferredLanguage,
  emergency_contact_name: p.emergencyContactName,
  emergency_contact_phone: p.emergencyContactPhone,
  emergency_contact_relation: p.emergencyContactRelation,
  primary_oncologist_id: p.primaryOncologistId,
  no_known_allergies: p.noKnownAllergies,
  height_cm: p.heightCm,
  weight_kg: p.weightKg,
});

export async function createPatient(
  db: Db,
  input: PatientInput & { allergies?: { allergen: string; reaction?: string | null; severity?: string; allergenType?: string }[] },
  actor: Actor,
) {
  const s = await getSettings();
  if (input.dateOfBirth > todayInTz(s.timezone)) throw validationError('Date of birth cannot be in the future.');
  if (input.noKnownAllergies && input.allergies?.length) throw validationError('Cannot record allergies and “no known allergies” together.');
  const cols = Object.entries(toColumns(input)).filter(([, v]) => v !== undefined);
  const names = cols.map(([k]) => k).concat('created_by');
  const values = cols.map(([, v]) => v).concat(actor.id);
  const patient = await q1(
    db,
    `INSERT INTO patients (${names.join(',')}) VALUES (${names.map((_, i) => `$${i + 1}`).join(',')}) RETURNING *`,
    values,
  );
  for (const a of input.allergies ?? []) {
    await db.query(
      `INSERT INTO allergies (patient_id, allergen, allergen_type, reaction, severity, recorded_by) VALUES ($1,$2,$3,$4,$5,$6)`,
      [patient.id, a.allergen, a.allergenType ?? 'DRUG', a.reaction ?? null, a.severity ?? 'UNKNOWN', actor.id],
    );
  }
  await audit(db, actor, {
    action: 'PATIENT_CREATED',
    entityType: 'patient',
    entityId: patient.id,
    patientId: patient.id,
    description: `${patient.patient_code} / ${patient.mrn}`,
    next: { mrn: patient.mrn, name: `${patient.first_name} ${patient.last_name}`, dob: patient.date_of_birth, sex: patient.sex },
  });
  return patient;
}

export async function updatePatient(db: Db, id: string, input: Partial<PatientInput>, actor: Actor) {
  const before = await q1(db, 'SELECT * FROM patients WHERE id=$1 FOR UPDATE', [id]);
  if (!before) throw notFound('Patient');
  const cols = Object.entries(toColumns(input)).filter(([, v]) => v !== undefined);
  if (!cols.length) return before;
  if (input.noKnownAllergies) {
    const act = await q1(db, 'SELECT count(*)::int AS n FROM allergies WHERE patient_id=$1 AND is_active', [id]);
    if (act.n > 0) throw validationError('Patient has active allergies — inactivate them before marking “no known allergies”.');
  }
  const after = await q1(
    db,
    `UPDATE patients SET ${cols.map(([k], i) => `${k}=$${i + 2}`).join(', ')} WHERE id=$1 RETURNING *`,
    [id, ...cols.map(([, v]) => v)],
  );
  const d = diff(before, Object.fromEntries(cols.map(([k]) => [k, after[k]])));
  if (d.changed) {
    await audit(db, actor, { action: 'PATIENT_UPDATED', entityType: 'patient', entityId: id, patientId: id, previous: d.prev, next: d.next });
  }
  return after;
}

export async function setPatientStatus(db: Db, id: string, status: string, reason: string | null, actor: Actor) {
  const before = await q1(db, 'SELECT status FROM patients WHERE id=$1', [id]);
  if (!before) throw notFound('Patient');
  await db.query('UPDATE patients SET status=$2 WHERE id=$1', [id, status]);
  await audit(db, actor, {
    action: 'PATIENT_STATUS_CHANGED',
    entityType: 'patient',
    entityId: id,
    patientId: id,
    description: reason ?? undefined,
    previous: { status: before.status },
    next: { status },
  });
}

export async function getPatient(db: Db, id: string, user: AuthUser) {
  const s = await getSettings();
  const today = todayInTz(s.timezone);
  const p = await q1(
    db,
    `SELECT p.*, u.full_name AS oncologist_name FROM patients p LEFT JOIN users u ON u.id = p.primary_oncologist_id WHERE p.id=$1`,
    [id],
  );
  if (!p) throw notFound('Patient');
  const clinical = can(user.role, 'clinical.read');
  const [allergies, plans, nextAppointment, diagnoses] = await Promise.all([
    q(db, `SELECT a.*, u.full_name AS recorded_by_name FROM allergies a LEFT JOIN users u ON u.id = a.recorded_by
            WHERE a.patient_id=$1 AND a.is_active ORDER BY a.created_at`, [id]),
    listPlans(db, id),
    q1(db, `SELECT a.id, a.appointment_date, a.start_time::text AS start_time, a.status, c.name AS chair_name, a.cycle_number, a.day_number
              FROM appointments a LEFT JOIN chairs c ON c.id = a.chair_id
             WHERE a.patient_id=$1 AND a.appointment_date >= $2
               AND a.status IN ('SCHEDULED','CONFIRMED','ARRIVED','IN_PREPARATION','IN_TREATMENT','NEEDS_RESCHEDULING')
             ORDER BY a.appointment_date, a.start_time LIMIT 1`, [id, today]),
    clinical ? listDiagnoses(db, id) : Promise.resolve([]),
  ]);
  return {
    ...p,
    age: ageFrom(p.date_of_birth, today),
    allergies,
    diagnoses,
    plans,
    activePlan: plans.find((x: any) => x.status === 'ACTIVE') ?? null,
    nextAppointment,
    clinicalAccess: clinical,
  };
}

// -----------------------------------------------------------------------------
// Allergies
// -----------------------------------------------------------------------------
export async function addAllergy(
  db: Db,
  patientId: string,
  a: { allergen: string; allergenType?: string; reaction?: string | null; severity?: string; notes?: string | null },
  actor: Actor,
) {
  const row = await q1(
    db,
    `INSERT INTO allergies (patient_id, allergen, allergen_type, reaction, severity, notes, recorded_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [patientId, a.allergen.trim(), a.allergenType ?? 'DRUG', a.reaction ?? null, a.severity ?? 'UNKNOWN', a.notes ?? null, actor.id],
  );
  await db.query('UPDATE patients SET no_known_allergies=false WHERE id=$1', [patientId]);
  await audit(db, actor, { action: 'ALLERGY_ADDED', entityType: 'allergy', entityId: row.id, patientId, next: a });
  return row;
}

export async function inactivateAllergy(db: Db, allergyId: string, reason: string, actor: Actor) {
  const row = await q1(
    db,
    `UPDATE allergies SET is_active=false, inactivated_by=$2, inactivated_at=now(), notes = concat_ws(' | ', notes, $3::text)
      WHERE id=$1 AND is_active RETURNING *`,
    [allergyId, actor.id, `Inactivated: ${reason}`],
  );
  if (!row) throw notFound('Active allergy');
  await audit(db, actor, { action: 'ALLERGY_INACTIVATED', entityType: 'allergy', entityId: allergyId, patientId: row.patient_id, description: reason, previous: { allergen: row.allergen } });
  return row;
}

// -----------------------------------------------------------------------------
// Diagnoses
// -----------------------------------------------------------------------------
export interface DiagnosisInput {
  primaryCancer: string;
  cancerType: string;
  icd10Code?: string | null;
  histology?: string | null;
  stage?: string | null;
  biomarkers?: string | null;
  diagnosisDate?: string | null;
  oncologistId?: string | null;
  isPrimary?: boolean;
  notes?: string | null;
}

export async function listDiagnoses(db: Db, patientId: string) {
  return q(
    db,
    `SELECT d.*, u.full_name AS oncologist_name FROM diagnoses d LEFT JOIN users u ON u.id = d.oncologist_id
      WHERE d.patient_id=$1 ORDER BY d.is_primary DESC, d.diagnosis_date DESC NULLS LAST`,
    [patientId],
  );
}

export async function createDiagnosis(db: Db, patientId: string, d: DiagnosisInput, actor: Actor) {
  const exists = await q1(db, 'SELECT id FROM patients WHERE id=$1', [patientId]);
  if (!exists) throw notFound('Patient');
  if (d.isPrimary !== false) await db.query('UPDATE diagnoses SET is_primary=false WHERE patient_id=$1', [patientId]);
  const row = await q1(
    db,
    `INSERT INTO diagnoses (patient_id, primary_cancer, cancer_type, icd10_code, histology, stage, biomarkers, diagnosis_date,
                            oncologist_id, is_primary, notes, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
    [patientId, d.primaryCancer, d.cancerType, d.icd10Code ?? null, d.histology ?? null, d.stage ?? null, d.biomarkers ?? null,
      d.diagnosisDate ?? null, d.oncologistId ?? actor.id, d.isPrimary !== false, d.notes ?? null, actor.id],
  );
  await db.query('UPDATE patients SET primary_oncologist_id = COALESCE(primary_oncologist_id, $2) WHERE id=$1', [patientId, row.oncologist_id]);
  await audit(db, actor, { action: 'DIAGNOSIS_CREATED', entityType: 'diagnosis', entityId: row.id, patientId, next: d });
  return row;
}

export async function updateDiagnosis(db: Db, id: string, d: Partial<DiagnosisInput>, actor: Actor) {
  const before = await q1(db, 'SELECT * FROM diagnoses WHERE id=$1', [id]);
  if (!before) throw notFound('Diagnosis');
  const map: Record<string, unknown> = {
    primary_cancer: d.primaryCancer,
    cancer_type: d.cancerType,
    icd10_code: d.icd10Code,
    histology: d.histology,
    stage: d.stage,
    biomarkers: d.biomarkers,
    diagnosis_date: d.diagnosisDate,
    oncologist_id: d.oncologistId,
    notes: d.notes,
  };
  const cols = Object.entries(map).filter(([, v]) => v !== undefined);
  if (!cols.length) return before;
  const after = await q1(db, `UPDATE diagnoses SET ${cols.map(([k], i) => `${k}=$${i + 2}`).join(', ')} WHERE id=$1 RETURNING *`, [
    id,
    ...cols.map(([, v]) => v),
  ]);
  const df = diff(before, Object.fromEntries(cols.map(([k]) => [k, after[k]])));
  if (df.changed) await audit(db, actor, { action: 'DIAGNOSIS_UPDATED', entityType: 'diagnosis', entityId: id, patientId: before.patient_id, previous: df.prev, next: df.next });
  return after;
}

// -----------------------------------------------------------------------------
// Treatment plans
// -----------------------------------------------------------------------------
export async function listPlans(db: Db, patientId: string) {
  return q(
    db,
    `SELECT tp.*, pr.name AS protocol_name, pr.code AS protocol_code, pr.is_demo AS protocol_is_demo, pr.treatment_days,
            pr.estimated_duration_min, u.full_name AS physician_name, d.primary_cancer
       FROM treatment_plans tp
       JOIN protocols pr ON pr.id = tp.protocol_id
       LEFT JOIN users u ON u.id = tp.physician_id
       LEFT JOIN diagnoses d ON d.id = tp.diagnosis_id
      WHERE tp.patient_id=$1
      ORDER BY (tp.status='ACTIVE') DESC, tp.start_date DESC`,
    [patientId],
  );
}

export async function createPlan(
  db: Db,
  patientId: string,
  input: { protocolId: string; diagnosisId?: string | null; intent?: string; cycleLengthDays?: number; plannedCycles?: number; startDate: string; notes?: string | null },
  actor: Actor,
) {
  const protocol = await q1(db, 'SELECT * FROM protocols WHERE id=$1', [input.protocolId]);
  if (!protocol || !protocol.is_active) throw validationError('Select an active protocol for the treatment plan.');
  if (input.diagnosisId) {
    const dx = await q1(db, 'SELECT patient_id FROM diagnoses WHERE id=$1', [input.diagnosisId]);
    if (!dx || dx.patient_id !== patientId) throw validationError('Diagnosis does not belong to this patient.');
  }
  const active = await q1(db, `SELECT id FROM treatment_plans WHERE patient_id=$1 AND status='ACTIVE'`, [patientId]);
  if (active) throw conflict('Patient already has an active treatment plan. Complete, hold or discontinue it first.');
  const cycleLength = input.cycleLengthDays ?? protocol.cycle_length_days;
  const planned = input.plannedCycles ?? protocol.planned_cycles;
  const lastDay = Math.max(...(protocol.treatment_days ?? [1]));
  const plannedEnd = addDays(input.startDate, (planned - 1) * cycleLength + lastDay - 1);
  const firstDay = Math.min(...(protocol.treatment_days ?? [1]));
  const plan = await q1(
    db,
    `INSERT INTO treatment_plans (patient_id, diagnosis_id, protocol_id, intent, cycle_length_days, planned_cycles, start_date,
                                  planned_end_date, next_cycle, next_day, next_due_date, physician_id, notes, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,1,$9,$10,$11,$12,$11) RETURNING *`,
    [patientId, input.diagnosisId ?? null, protocol.id, input.intent ?? protocol.intent, cycleLength, planned, input.startDate,
      plannedEnd, firstDay, addDays(input.startDate, firstDay - 1), actor.id, input.notes ?? null],
  );
  await db.query(`UPDATE patients SET status='ACTIVE_TREATMENT', primary_oncologist_id = COALESCE(primary_oncologist_id, $2) WHERE id=$1 AND status IN ('ACTIVE_TREATMENT','FOLLOW_UP','ON_HOLD')`, [patientId, actor.id]);
  await audit(db, actor, {
    action: 'TREATMENT_PLAN_CREATED',
    entityType: 'treatment_plan',
    entityId: plan.id,
    patientId,
    description: `${protocol.name} — ${planned} cycles × ${cycleLength} days from ${input.startDate}`,
    next: { protocol: protocol.name, intent: plan.intent, cycleLength, planned, startDate: input.startDate },
  });
  return plan;
}

export async function updatePlan(
  db: Db,
  id: string,
  input: { status?: string; plannedCycles?: number; notes?: string | null; physicianId?: string; nextDueDate?: string | null },
  actor: Actor,
) {
  const before = await q1(db, 'SELECT * FROM treatment_plans WHERE id=$1 FOR UPDATE', [id]);
  if (!before) throw notFound('Treatment plan');
  if (input.plannedCycles !== undefined && input.plannedCycles < before.current_cycle) {
    throw validationError(`Planned cycles cannot be fewer than the cycles already given (${before.current_cycle}).`);
  }
  if (input.status === 'ACTIVE' && before.status !== 'ACTIVE') {
    const other = await q1(db, `SELECT id FROM treatment_plans WHERE patient_id=$1 AND status='ACTIVE' AND id<>$2`, [before.patient_id, id]);
    if (other) throw conflict('Another treatment plan is already active for this patient.');
  }
  const map: Record<string, unknown> = {
    status: input.status,
    planned_cycles: input.plannedCycles,
    notes: input.notes,
    physician_id: input.physicianId,
    next_due_date: input.nextDueDate,
  };
  const cols = Object.entries(map).filter(([, v]) => v !== undefined);
  if (!cols.length) return before;
  const after = await q1(db, `UPDATE treatment_plans SET ${cols.map(([k], i) => `${k}=$${i + 2}`).join(', ')} WHERE id=$1 RETURNING *`, [
    id,
    ...cols.map(([, v]) => v),
  ]);
  if (input.plannedCycles !== undefined) {
    const protocol = await q1(db, 'SELECT treatment_days FROM protocols WHERE id=$1', [after.protocol_id]);
    const lastDay = Math.max(...(protocol.treatment_days ?? [1]));
    await db.query('UPDATE treatment_plans SET planned_end_date=$2 WHERE id=$1', [
      id,
      addDays(after.start_date, (after.planned_cycles - 1) * after.cycle_length_days + lastDay - 1),
    ]);
    if (after.next_cycle === null && after.planned_cycles > after.current_cycle) {
      await db.query('UPDATE treatment_plans SET next_cycle=$2, next_day=$3 WHERE id=$1', [id, after.current_cycle + 1, Math.min(...(protocol.treatment_days ?? [1]))]);
    }
  }
  const d = diff(before, Object.fromEntries(cols.map(([k]) => [k, after[k]])));
  if (d.changed) await audit(db, actor, { action: 'TREATMENT_PLAN_MODIFIED', entityType: 'treatment_plan', entityId: id, patientId: before.patient_id, previous: d.prev, next: d.next });
  return after;
}

// -----------------------------------------------------------------------------
// Labs, vitals, notes
// -----------------------------------------------------------------------------
export async function listLabs(db: Db, patientId: string) {
  const definitions = await q(db, 'SELECT * FROM lab_test_definitions WHERE is_active ORDER BY sort_order');
  const results = await q(
    db,
    `SELECT r.*, u.full_name AS entered_by_name FROM laboratory_results r LEFT JOIN users u ON u.id = r.entered_by
      WHERE r.patient_id=$1 ORDER BY r.collected_at DESC LIMIT 600`,
    [patientId],
  );
  return { definitions, results };
}

export async function addLabResults(
  db: Db,
  patientId: string,
  input: { collectedAt: string; results: { code: string; value: number }[]; notes?: string | null },
  actor: Actor,
) {
  const defs = await q(db, 'SELECT * FROM lab_test_definitions WHERE code = ANY($1)', [input.results.map((r) => r.code)]);
  if (!input.results.length) throw validationError('Enter at least one laboratory value.');
  const inserted = [];
  for (const r of input.results) {
    const def = defs.find((d) => d.code === r.code);
    if (!def) throw validationError(`Unknown laboratory test ${r.code}.`);
    if (!Number.isFinite(r.value) || r.value < 0) throw validationError(`Invalid value for ${def.name}.`);
    inserted.push(
      await q1(
        db,
        `INSERT INTO laboratory_results (patient_id, test_code, value, unit, ref_low, ref_high, collected_at, source, notes, entered_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'MANUAL',$8,$9) RETURNING *`,
        [patientId, def.code, r.value, def.unit, def.ref_low, def.ref_high, input.collectedAt, input.notes ?? null, actor.id],
      ),
    );
  }
  await audit(db, actor, {
    action: 'LAB_RESULTS_ENTERED',
    entityType: 'laboratory_result',
    patientId,
    description: `${inserted.length} result(s) collected ${input.collectedAt}`,
    next: input.results,
  });
  return inserted;
}

export async function listVitals(db: Db, patientId: string) {
  return q(
    db,
    `SELECT v.*, u.full_name AS recorded_by_name, o.order_number, o.cycle_number, o.day_number
       FROM vital_signs v LEFT JOIN users u ON u.id = v.recorded_by LEFT JOIN treatment_orders o ON o.id = v.treatment_order_id
      WHERE v.patient_id=$1 ORDER BY v.measured_at DESC LIMIT 300`,
    [patientId],
  );
}

export interface VitalsInput {
  phase: 'PRE' | 'DURING' | 'POST' | 'OTHER';
  measuredAt?: string | null;
  treatmentOrderId?: string | null;
  administrationId?: string | null;
  bpSystolic?: number | null;
  bpDiastolic?: number | null;
  heartRate?: number | null;
  respRate?: number | null;
  temperatureC?: number | null;
  spo2?: number | null;
  weightKg?: number | null;
  painScore?: number | null;
  notes?: string | null;
}

export async function addVitals(db: Db, patientId: string, v: VitalsInput, actor: Actor) {
  const measures = [v.bpSystolic, v.bpDiastolic, v.heartRate, v.respRate, v.temperatureC, v.spo2, v.weightKg, v.painScore];
  if (measures.every((m) => m === null || m === undefined)) throw validationError('Enter at least one vital sign.');
  if ((v.bpSystolic == null) !== (v.bpDiastolic == null)) throw validationError('Enter both systolic and diastolic blood pressure.');
  let appointmentId: string | null = null;
  if (v.treatmentOrderId) {
    const o = await q1(db, 'SELECT patient_id FROM treatment_orders WHERE id=$1', [v.treatmentOrderId]);
    if (!o || o.patient_id !== patientId) throw validationError('Order does not belong to this patient.');
    const a = await q1(db, `SELECT id FROM appointments WHERE treatment_order_id=$1 AND status <> 'CANCELLED' LIMIT 1`, [v.treatmentOrderId]);
    appointmentId = a?.id ?? null;
  }
  const row = await q1(
    db,
    `INSERT INTO vital_signs (patient_id, treatment_order_id, administration_id, appointment_id, phase, measured_at, bp_systolic,
                              bp_diastolic, heart_rate, resp_rate, temperature_c, spo2, weight_kg, pain_score, notes, recorded_by)
     VALUES ($1,$2,$3,$4,$5,COALESCE($6::timestamptz, now()),$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
    [patientId, v.treatmentOrderId ?? null, v.administrationId ?? null, appointmentId, v.phase, v.measuredAt ?? null, v.bpSystolic ?? null,
      v.bpDiastolic ?? null, v.heartRate ?? null, v.respRate ?? null, v.temperatureC ?? null, v.spo2 ?? null, v.weightKg ?? null,
      v.painScore ?? null, v.notes ?? null, actor.id],
  );
  await audit(db, actor, { action: 'VITAL_SIGNS_RECORDED', entityType: 'vital_signs', entityId: row.id, patientId, description: `${v.phase}`, next: v });
  return row;
}

export async function listNotes(db: Db, patientId: string) {
  return q(
    db,
    `SELECT n.*, u.full_name AS author_name, u.role_code AS author_role, o.order_number
       FROM patient_notes n JOIN users u ON u.id = n.author_id LEFT JOIN treatment_orders o ON o.id = n.treatment_order_id
      WHERE n.patient_id=$1 ORDER BY n.created_at DESC`,
    [patientId],
  );
}

export async function addNote(db: Db, patientId: string, n: { content: string; noteType?: string; treatmentOrderId?: string | null }, actor: Actor) {
  const type = n.noteType ?? (actor.role === 'PHYSICIAN' ? 'PHYSICIAN' : actor.role === 'NURSE' ? 'NURSING' : 'GENERAL');
  const row = await q1(
    db,
    `INSERT INTO patient_notes (patient_id, author_id, note_type, content, treatment_order_id) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [patientId, actor.id, type, n.content.trim(), n.treatmentOrderId ?? null],
  );
  await audit(db, actor, { action: 'NOTE_ADDED', entityType: 'patient_note', entityId: row.id, patientId, description: type });
  return row;
}

// -----------------------------------------------------------------------------
// History, appointments, timeline
// -----------------------------------------------------------------------------
export async function treatmentHistory(db: Db, patientId: string) {
  return q(
    db,
    `SELECT ad.id, ad.treatment_order_id, o.order_number, COALESCE(ad.start_time, o.treatment_started_at)::date AS date,
            o.planned_date, o.protocol_name, o.cycle_number, o.day_number, ad.drug_name, ad.planned_dose,
            ad.dose_administered, ad.dose_unit, ad.route, ad.diluent, ad.volume_ml, ad.planned_duration_min,
            ad.start_time, ad.end_time, ad.status, ad.reaction, ad.reaction_details, ad.not_given_reason,
            pb.full_name AS physician_name, ab.full_name AS approved_by_name, nu.full_name AS nurse_name, i.dose_percent,
            o.status AS order_status
       FROM administrations ad
       JOIN treatment_orders o ON o.id = ad.treatment_order_id
       JOIN treatment_order_items i ON i.id = ad.treatment_order_item_id
       LEFT JOIN users pb ON pb.id = o.prescribed_by
       LEFT JOIN users ab ON ab.id = o.approved_by
       LEFT JOIN users nu ON nu.id = COALESCE(ad.completed_by, ad.started_by)
      WHERE ad.patient_id=$1
      ORDER BY o.cycle_number DESC, o.day_number DESC, ad.sequence`,
    [patientId],
  );
}

export async function patientAppointments(db: Db, patientId: string) {
  return q(
    db,
    `SELECT a.id, a.appointment_number, a.appointment_date, a.start_time::text AS start_time, a.duration_minutes, a.status,
            a.cycle_number, a.day_number, a.appointment_type, a.cancel_reason, c.name AS chair_name, pr.name AS protocol_name,
            u.full_name AS physician_name, a.treatment_order_id,
            (SELECT n.status FROM notifications n WHERE n.appointment_id = a.id AND n.status NOT IN ('CANCELLED','PENDING')
              ORDER BY n.scheduled_for DESC LIMIT 1) AS whatsapp_status
       FROM appointments a LEFT JOIN chairs c ON c.id = a.chair_id LEFT JOIN protocols pr ON pr.id = a.protocol_id
       LEFT JOIN users u ON u.id = a.physician_id
      WHERE a.patient_id=$1 ORDER BY a.appointment_date DESC, a.start_time DESC`,
    [patientId],
  );
}

export async function patientTimeline(db: Db, patientId: string, user: AuthUser) {
  const clinical = can(user.role, 'clinical.read');
  const events: { date: string; type: string; title: string; detail?: string; refType?: string; refId?: string; status?: string }[] = [];
  const patient = await q1(db, 'SELECT created_at FROM patients WHERE id=$1', [patientId]);
  if (!patient) throw notFound('Patient');
  events.push({ date: new Date(patient.created_at).toISOString().slice(0, 10), type: 'REGISTERED', title: 'Registered in chemotherapy unit' });
  if (clinical) {
    for (const d of await listDiagnoses(db, patientId)) {
      if (d.diagnosis_date) {
        events.push({ date: d.diagnosis_date, type: 'DIAGNOSIS', title: 'Diagnosis', detail: `${d.primary_cancer}${d.stage ? ` — ${d.stage}` : ''}`, refType: 'diagnosis', refId: d.id });
      }
    }
  }
  for (const p of await listPlans(db, patientId)) {
    events.push({
      date: new Date(p.created_at).toISOString().slice(0, 10),
      type: 'PLAN',
      title: 'Treatment plan created',
      detail: `${p.protocol_name} — ${p.planned_cycles} cycles`,
      refType: 'plan',
      refId: p.id,
    });
  }
  const orders = await q(
    db,
    `SELECT id, cycle_number, day_number, planned_date, status, protocol_name, completed_at FROM treatment_orders
      WHERE patient_id=$1 AND status <> 'CANCELLED' ORDER BY planned_date`,
    [patientId],
  );
  for (const o of orders) {
    events.push({
      date: o.completed_at ? new Date(o.completed_at).toISOString().slice(0, 10) : o.planned_date,
      type: o.status === 'COMPLETED' ? 'CYCLE' : 'ORDER',
      title: `Cycle ${o.cycle_number}${o.day_number > 1 ? ` Day ${o.day_number}` : ''}`,
      detail: o.protocol_name,
      status: o.status,
      refType: clinical ? 'order' : undefined,
      refId: clinical ? o.id : undefined,
    });
  }
  if (clinical) {
    const evs = await q(db, 'SELECT id, occurred_at, event_type, severity, treatment_order_id FROM treatment_events WHERE patient_id=$1', [patientId]);
    for (const e of evs) {
      events.push({
        date: new Date(e.occurred_at).toISOString().slice(0, 10),
        type: 'EVENT',
        title: 'Treatment event',
        detail: `${e.event_type.replace(/_/g, ' ').toLowerCase()} (${e.severity.toLowerCase()})`,
        refType: 'order',
        refId: e.treatment_order_id,
      });
    }
  }
  const s = await getSettings();
  const upcoming = await q(
    db,
    `SELECT id, appointment_date, cycle_number, day_number, status FROM appointments
      WHERE patient_id=$1 AND appointment_date >= $2 AND status IN ('SCHEDULED','CONFIRMED','NEEDS_RESCHEDULING')
        AND treatment_order_id IS NULL`,
    [patientId, todayInTz(s.timezone)],
  );
  for (const a of upcoming) {
    events.push({
      date: a.appointment_date,
      type: 'APPOINTMENT',
      title: 'Upcoming appointment',
      detail: a.cycle_number ? `C${a.cycle_number}D${a.day_number}` : undefined,
      status: a.status,
      refType: 'appointment',
      refId: a.id,
    });
  }
  return events.sort((a, b) => a.date.localeCompare(b.date));
}
