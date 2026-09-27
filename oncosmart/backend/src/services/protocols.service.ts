import { Db, pool, q, q1 } from '../db/pool';
import { notFound, validationError } from '../utils/errors';
import { Actor, audit } from './audit.service';
import { ROUNDING_RULES } from './doseCalculator';

export interface ProtocolDrugInput {
  sequence: number;
  drugName: string;
  drugId?: string | null;
  doseValue: number;
  doseUnit: 'MG' | 'MG_M2' | 'MG_KG' | 'AUC';
  route: 'IV' | 'PO' | 'SC' | 'IM';
  administrationMethod?: string | null;
  diluent?: string | null;
  finalVolumeMl?: number | null;
  infusionDurationMin?: number | null;
  treatmentDays?: number[];
  premedicationRequired?: boolean;
  roundingRule?: string | null;
  specialInstructions?: string | null;
}

export interface ProtocolInput {
  code: string;
  name: string;
  cancerType: string;
  intent: string;
  cycleLengthDays: number;
  plannedCycles: number;
  treatmentDays?: number[];
  estimatedDurationMin?: number | null;
  premedications?: string | null;
  hydration?: string | null;
  supportiveMedications?: string | null;
  specialInstructions?: string | null;
  requiredLabs?: string[];
  defaultRoundingRule?: string;
  isDemo?: boolean;
  isActive?: boolean;
  drugs: ProtocolDrugInput[];
}

export async function listProtocols(includeInactive = false) {
  const protocols = await q(
    pool,
    `SELECT p.*, (SELECT count(*)::int FROM treatment_plans tp WHERE tp.protocol_id = p.id AND tp.status='ACTIVE') AS active_plans
       FROM protocols p ${includeInactive ? '' : 'WHERE p.is_active'} ORDER BY p.name`,
  );
  const drugs = await q(pool, 'SELECT * FROM protocol_drugs ORDER BY protocol_id, sequence');
  return protocols.map((p) => ({ ...p, drugs: drugs.filter((d) => d.protocol_id === p.id) }));
}

export async function getProtocol(db: Db, id: string) {
  const p = await q1(db, 'SELECT * FROM protocols WHERE id=$1', [id]);
  if (!p) throw notFound('Protocol');
  const drugs = await q(db, 'SELECT * FROM protocol_drugs WHERE protocol_id=$1 ORDER BY sequence', [id]);
  return { ...p, drugs };
}

function validate(input: ProtocolInput) {
  if (!input.drugs.length) throw validationError('A protocol must contain at least one drug.');
  const seqs = new Set<number>();
  for (const d of input.drugs) {
    if (seqs.has(d.sequence)) throw validationError(`Duplicate sequence number ${d.sequence}.`);
    seqs.add(d.sequence);
    if (d.roundingRule && !ROUNDING_RULES.some((r) => r.code === d.roundingRule)) throw validationError(`Unknown rounding rule ${d.roundingRule}.`);
    const days = d.treatmentDays ?? [1];
    if (days.some((x) => x < 1 || x > input.cycleLengthDays)) throw validationError(`${d.drugName}: treatment day outside the cycle length.`);
  }
  if (input.defaultRoundingRule && !ROUNDING_RULES.some((r) => r.code === input.defaultRoundingRule)) {
    throw validationError(`Unknown rounding rule ${input.defaultRoundingRule}.`);
  }
}

async function insertDrugs(db: Db, protocolId: string, drugs: ProtocolDrugInput[]) {
  for (const d of drugs) {
    const drug = d.drugId
      ? { id: d.drugId }
      : await q1(db, 'SELECT id FROM drugs WHERE lower(generic_name) = lower($1)', [d.drugName]);
    await db.query(
      `INSERT INTO protocol_drugs (protocol_id, drug_id, sequence, drug_name, dose_value, dose_unit, route, administration_method,
          diluent, final_volume_ml, infusion_duration_min, treatment_days, premedication_required, rounding_rule, special_instructions)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [protocolId, drug?.id ?? null, d.sequence, d.drugName.trim(), d.doseValue, d.doseUnit, d.route, d.administrationMethod ?? null,
        d.diluent || null, d.finalVolumeMl ?? null, d.infusionDurationMin ?? null, d.treatmentDays ?? [1], !!d.premedicationRequired,
        d.roundingRule || null, d.specialInstructions || null],
    );
  }
}

export async function createProtocol(db: Db, input: ProtocolInput, actor: Actor) {
  validate(input);
  const treatmentDays = input.treatmentDays ?? [...new Set(input.drugs.flatMap((d) => d.treatmentDays ?? [1]))].sort((a, b) => a - b);
  const p = await q1(
    db,
    `INSERT INTO protocols (code, name, cancer_type, intent, cycle_length_days, planned_cycles, treatment_days, estimated_duration_min,
        premedications, hydration, supportive_medications, special_instructions, required_labs, default_rounding_rule, is_demo,
        is_active, created_by, updated_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$17) RETURNING *`,
    [input.code.trim().toUpperCase(), input.name.trim(), input.cancerType, input.intent, input.cycleLengthDays, input.plannedCycles,
      treatmentDays, input.estimatedDurationMin ?? null, input.premedications || null, input.hydration || null,
      input.supportiveMedications || null, input.specialInstructions || null, input.requiredLabs ?? [], input.defaultRoundingRule ?? 'NEAREST_1',
      input.isDemo ?? true, input.isActive ?? true, actor.id],
  );
  await insertDrugs(db, p.id, input.drugs);
  await audit(db, actor, { action: 'PROTOCOL_CREATED', entityType: 'protocol', entityId: p.id, description: p.name, next: input });
  return getProtocol(db, p.id);
}

/** Updating a protocol creates a new version. Existing orders keep their snapshot and are unaffected. */
export async function updateProtocol(db: Db, id: string, input: ProtocolInput, actor: Actor) {
  validate(input);
  const before = await getProtocol(db, id);
  const treatmentDays = input.treatmentDays ?? [...new Set(input.drugs.flatMap((d) => d.treatmentDays ?? [1]))].sort((a, b) => a - b);
  await db.query(
    `UPDATE protocols SET name=$2, cancer_type=$3, intent=$4, cycle_length_days=$5, planned_cycles=$6, treatment_days=$7,
            estimated_duration_min=$8, premedications=$9, hydration=$10, supportive_medications=$11, special_instructions=$12,
            required_labs=$13, default_rounding_rule=$14, is_demo=$15, is_active=$16, version=version+1, updated_by=$17
      WHERE id=$1`,
    [id, input.name.trim(), input.cancerType, input.intent, input.cycleLengthDays, input.plannedCycles, treatmentDays,
      input.estimatedDurationMin ?? null, input.premedications || null, input.hydration || null, input.supportiveMedications || null,
      input.specialInstructions || null, input.requiredLabs ?? [], input.defaultRoundingRule ?? 'NEAREST_1', input.isDemo ?? before.is_demo,
      input.isActive ?? before.is_active, actor.id],
  );
  // Replace drug rows; order items reference protocol_drugs with ON DELETE SET NULL and keep their own snapshot.
  await db.query('DELETE FROM protocol_drugs WHERE protocol_id=$1', [id]);
  await insertDrugs(db, id, input.drugs);
  const after = await getProtocol(db, id);
  await audit(db, actor, {
    action: 'PROTOCOL_UPDATED',
    entityType: 'protocol',
    entityId: id,
    description: `${after.name} v${before.version} → v${after.version}`,
    previous: before,
    next: after,
  });
  return after;
}

export async function setProtocolActive(db: Db, id: string, isActive: boolean, actor: Actor) {
  const p = await q1(db, 'UPDATE protocols SET is_active=$2, updated_by=$3 WHERE id=$1 RETURNING id, name', [id, isActive, actor.id]);
  if (!p) throw notFound('Protocol');
  await audit(db, actor, { action: isActive ? 'PROTOCOL_ACTIVATED' : 'PROTOCOL_DEACTIVATED', entityType: 'protocol', entityId: id, description: p.name });
  return p;
}

export async function listDrugCatalog() {
  const drugs = await q(pool, 'SELECT * FROM drugs ORDER BY generic_name');
  const products = await q(pool, 'SELECT * FROM drug_products ORDER BY strength');
  const batches = await q(pool, 'SELECT * FROM inventory_batches ORDER BY expiry_date');
  return drugs.map((d) => ({
    ...d,
    products: products
      .filter((p) => p.drug_id === d.id)
      .map((p) => ({ ...p, batches: batches.filter((b) => b.drug_product_id === p.id) })),
  }));
}
