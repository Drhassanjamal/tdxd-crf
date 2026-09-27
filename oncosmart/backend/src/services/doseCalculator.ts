/**
 * OncoSmart dose calculation engine.
 *
 * SAFETY: every value produced here is a CALCULATED DOSE THAT REQUIRES PHYSICIAN
 * VERIFICATION. The engine never prescribes — it only applies the arithmetic the
 * prescriber configured (dose per unit, dose %, rounding rule). No clinical rules
 * (dose caps, dose modifications, GFR caps) are applied automatically.
 *
 * Pure functions, no I/O — unit tested in tests/doseCalculator.test.ts.
 */

export type DoseUnit = 'MG' | 'MG_M2' | 'MG_KG' | 'AUC';

export type RoundingRule =
  | 'NONE'
  | 'NEAREST_0_1'
  | 'NEAREST_0_5'
  | 'NEAREST_1'
  | 'NEAREST_5'
  | 'NEAREST_10'
  | 'NEAREST_25'
  | 'NEAREST_50';

export const ROUNDING_RULES: { code: RoundingRule; label: string; step: number | null }[] = [
  { code: 'NONE', label: 'No rounding (2 decimals)', step: null },
  { code: 'NEAREST_0_1', label: 'Nearest 0.1 mg', step: 0.1 },
  { code: 'NEAREST_0_5', label: 'Nearest 0.5 mg', step: 0.5 },
  { code: 'NEAREST_1', label: 'Nearest 1 mg', step: 1 },
  { code: 'NEAREST_5', label: 'Nearest 5 mg', step: 5 },
  { code: 'NEAREST_10', label: 'Nearest 10 mg', step: 10 },
  { code: 'NEAREST_25', label: 'Nearest 25 mg', step: 25 },
  { code: 'NEAREST_50', label: 'Nearest 50 mg', step: 50 },
];

export const DOSE_UNIT_LABEL: Record<DoseUnit, string> = {
  MG: 'mg',
  MG_M2: 'mg/m²',
  MG_KG: 'mg/kg',
  AUC: 'AUC',
};

/** Decimal-safe rounding to `dp` places. */
export function roundTo(value: number, dp: number): number {
  return Number(Math.round(Number(`${value}e${dp}`)) + `e-${dp}`);
}

export function isValidHeight(h: unknown): h is number {
  return typeof h === 'number' && Number.isFinite(h) && h > 30 && h < 260;
}

export function isValidWeight(w: unknown): w is number {
  return typeof w === 'number' && Number.isFinite(w) && w > 1 && w < 400;
}

/**
 * Mosteller formula: BSA (m²) = sqrt((height(cm) × weight(kg)) / 3600).
 * Returned rounded to 2 decimals (the value displayed and used in calculations).
 */
export function bsaMosteller(heightCm: number, weightKg: number): number {
  if (!isValidHeight(heightCm)) throw new RangeError('Height must be between 30 and 260 cm');
  if (!isValidWeight(weightKg)) throw new RangeError('Weight must be between 1 and 400 kg');
  return roundTo(Math.sqrt((heightCm * weightKg) / 3600), 2);
}

export function applyRounding(value: number, rule: RoundingRule | string): number {
  const def = ROUNDING_RULES.find((r) => r.code === rule);
  if (!def || def.step === null) return roundTo(value, 2);
  const stepped = Math.round(roundTo(value / def.step, 6)) * def.step;
  return roundTo(stepped, def.step < 1 ? 1 : 0);
}

export interface DoseInput {
  drugName?: string;
  doseValue: number;
  doseUnit: DoseUnit;
  bsa?: number | null;
  weightKg?: number | null;
  gfr?: number | null;
  dosePercent?: number;
  roundingRule: RoundingRule | string;
}

export interface DoseResult {
  ok: boolean;
  error?: string;
  basisValue: number | null;
  /** Exact calculated dose at 100 % — always preserved. */
  calculatedDose: number | null;
  /** After dose % (before rounding). */
  adjustedDose: number | null;
  /** After dose % and rounding rule. */
  roundedDose: number | null;
  roundingRule: string;
  formula: string;
}

const fmt = (n: number, dp = 2) => roundTo(n, dp).toFixed(dp);

export function calculateDose(input: DoseInput): DoseResult {
  const pct = input.dosePercent ?? 100;
  const base: DoseResult = {
    ok: false,
    basisValue: null,
    calculatedDose: null,
    adjustedDose: null,
    roundedDose: null,
    roundingRule: input.roundingRule,
    formula: '',
  };
  if (!(input.doseValue > 0)) return { ...base, error: 'Dose value must be greater than zero' };
  if (!(pct > 0 && pct <= 150)) return { ...base, error: 'Dose percentage must be between 1 and 150 %' };

  let calculated: number;
  let formula: string;
  let basis: number | null = null;

  switch (input.doseUnit) {
    case 'MG':
      calculated = input.doseValue;
      formula = `Flat dose ${input.doseValue} mg`;
      break;
    case 'MG_M2':
      if (!input.bsa || input.bsa <= 0) return { ...base, error: 'BSA required (height and weight missing or invalid)' };
      basis = input.bsa;
      calculated = input.doseValue * input.bsa;
      formula = `${input.doseValue} mg/m² × ${fmt(input.bsa)} m² = ${fmt(calculated)} mg`;
      break;
    case 'MG_KG':
      if (!input.weightKg || !isValidWeight(input.weightKg)) return { ...base, error: 'Valid weight required' };
      basis = input.weightKg;
      calculated = input.doseValue * input.weightKg;
      formula = `${input.doseValue} mg/kg × ${input.weightKg} kg = ${fmt(calculated)} mg`;
      break;
    case 'AUC':
      if (input.gfr === null || input.gfr === undefined || !(input.gfr > 0) || input.gfr > 250) {
        return { ...base, error: 'GFR input required for Calvert (AUC) calculation — clinician must enter renal function' };
      }
      basis = input.gfr;
      calculated = input.doseValue * (input.gfr + 25);
      formula = `Calvert: AUC ${input.doseValue} × (GFR ${input.gfr} + 25) = ${fmt(calculated)} mg`;
      break;
    default:
      return { ...base, error: `Unsupported dose unit ${String(input.doseUnit)}` };
  }

  const calculatedDose = roundTo(calculated, 4);
  const adjusted = roundTo((calculated * pct) / 100, 4);
  if (pct !== 100) formula += ` × ${pct}% = ${fmt(adjusted)} mg`;
  const rounded = applyRounding(adjusted, input.roundingRule);
  if (rounded <= 0) return { ...base, error: 'Rounded dose is zero — check rounding rule' };
  const ruleLabel = ROUNDING_RULES.find((r) => r.code === input.roundingRule)?.label ?? input.roundingRule;
  formula += ` → ${rounded} mg (${ruleLabel})`;

  return {
    ok: true,
    basisValue: basis,
    calculatedDose,
    adjustedDose: adjusted,
    roundedDose: rounded,
    roundingRule: input.roundingRule,
    formula,
  };
}

/**
 * Cockcroft–Gault creatinine clearance ESTIMATE (mL/min), offered only as a
 * reference helper for the prescriber. Never applied automatically.
 */
export function cockcroftGault(p: { ageYears: number; weightKg: number; sex: 'MALE' | 'FEMALE'; creatinineMgDl: number }) {
  if (!(p.creatinineMgDl > 0) || !isValidWeight(p.weightKg) || !(p.ageYears > 0)) return null;
  const crcl = ((140 - p.ageYears) * p.weightKg) / (72 * p.creatinineMgDl);
  return roundTo(p.sex === 'FEMALE' ? crcl * 0.85 : crcl, 1);
}

/**
 * Approximate vial requirement for a dose given available vial strengths (mg).
 * Minimises total drug drawn (least waste), then the number of vials.
 * For pharmacy planning only — pharmacy must confirm.
 */
export function estimateVials(dose: number, strengths: number[]) {
  const sizes = [...new Set(strengths.filter((s) => s > 0))].sort((a, b) => b - a).slice(0, 4);
  if (!sizes.length || !(dose > 0)) return null;
  let best: { counts: number[]; total: number; vials: number } | null = null;
  const maxCounts = sizes.map((s) => Math.ceil(dose / s));
  const counts = new Array(sizes.length).fill(0);
  const search = (i: number) => {
    if (i === sizes.length) {
      const total = counts.reduce((sum, c, k) => sum + c * sizes[k], 0);
      if (total + 1e-9 < dose) return;
      const vials = counts.reduce((a, b) => a + b, 0);
      if (!best || total < best.total - 1e-9 || (Math.abs(total - best.total) < 1e-9 && vials < best.vials)) {
        best = { counts: [...counts], total, vials };
      }
      return;
    }
    for (let c = 0; c <= maxCounts[i]; c++) {
      counts[i] = c;
      search(i + 1);
    }
    counts[i] = 0;
  };
  search(0);
  if (!best) return null;
  const b = best as { counts: number[]; total: number; vials: number };
  return {
    combination: sizes.map((s, k) => ({ strength: s, count: b.counts[k] })).filter((c) => c.count > 0),
    totalMg: roundTo(b.total, 2),
    wasteMg: roundTo(b.total - dose, 2),
    vials: b.vials,
  };
}
