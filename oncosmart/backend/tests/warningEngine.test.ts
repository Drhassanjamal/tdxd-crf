import { describe, expect, it } from 'vitest';
import { evaluateWarnings, requiresAcknowledgement, WarningContext } from '../src/services/warningEngine';

const base = (over: Partial<WarningContext> = {}): WarningContext => ({
  thresholds: { doseDifferencePct: 10, weightChangePct: 5, labValidityDays: 7, calvertGfrReview: 125 },
  plannedDate: '2026-09-27',
  orderStatus: 'APPROVED',
  noKnownAllergies: true,
  allergies: [],
  requiredLabs: ['ANC', 'PLT'],
  labs: [
    { code: 'ANC', name: 'ANC', value: 3.2, unit: '×10⁹/L', refLow: 2, refHigh: 7.5, collectedAt: '2026-09-26T08:00:00Z' },
    { code: 'PLT', name: 'Platelets', value: 220, unit: '×10⁹/L', refLow: 150, refHigh: 400, collectedAt: '2026-09-26T08:00:00Z' },
  ],
  items: [{ drugName: 'Oxaliplatin', doseUnit: 'MG_M2', route: 'IV', finalDose: 155, diluent: 'Dextrose 5%', finalVolumeMl: 500, infusionDurationMin: 120, administrationMethod: 'INFUSION', dosePercent: 100 }],
  weightKg: 70,
  cycleNumber: 2,
  dayNumber: 1,
  plannedCycles: 12,
  cycleLengthDays: 14,
  isDemoProtocol: false,
  previous: { weightKg: 70, plannedDate: '2026-09-13', cycleNumber: 1, dayNumber: 1 },
  ...over,
});
const codes = (ctx: WarningContext) => evaluateWarnings(ctx).map((w) => w.code);

describe('warning engine', () => {
  it('produces no warnings for a clean order', () => {
    expect(codes(base())).toEqual([]);
  });
  it('flags documented allergy and a drug match as critical', () => {
    const w = evaluateWarnings(base({ noKnownAllergies: false, allergies: [{ allergen: 'Oxaliplatin' }] }));
    expect(w.map((x) => x.code)).toEqual(expect.arrayContaining(['ALLERGY_DOCUMENTED', 'ALLERGY_DRUG_MATCH']));
    expect(w.find((x) => x.code === 'ALLERGY_DRUG_MATCH')?.severity).toBe('CRITICAL');
  });
  it('flags undocumented allergy status', () => {
    expect(codes(base({ noKnownAllergies: false }))).toContain('ALLERGY_NOT_DOCUMENTED');
  });
  it('flags missing and stale required labs', () => {
    expect(codes(base({ labs: [] }))).toContain('LABS_MISSING');
    const stale = base().labs.map((l) => ({ ...l, collectedAt: '2026-09-01T08:00:00Z' }));
    expect(codes(base({ labs: stale }))).toContain('LABS_MISSING');
  });
  it('flags values outside the configured reference range without applying rules', () => {
    const labs = base().labs.map((l) => (l.code === 'ANC' ? { ...l, value: 1.1 } : l));
    const w = evaluateWarnings(base({ labs }));
    expect(w.find((x) => x.code === 'LABS_ABNORMAL')?.message).toMatch(/ANC 1.1/);
  });
  it('flags dose difference vs previous cycle beyond threshold', () => {
    const items = [{ ...base().items[0], previousFinalDose: 130 }];
    expect(codes(base({ items }))).toContain('DOSE_DIFFERENCE');
    const small = [{ ...base().items[0], previousFinalDose: 150 }];
    expect(codes(base({ items: small }))).not.toContain('DOSE_DIFFERENCE');
  });
  it('flags significant weight change', () => {
    expect(codes(base({ weightKg: 64 }))).toContain('WEIGHT_CHANGE');
  });
  it('flags renal function abnormality', () => {
    const labs = [...base().labs, { code: 'EGFR', name: 'eGFR', value: 45, unit: 'mL/min', refLow: 60, refHigh: null, collectedAt: '2026-09-26T08:00:00Z' }];
    expect(codes(base({ labs }))).toContain('RENAL_REVIEW');
  });
  it('flags orders that are not physician-approved', () => {
    expect(codes(base({ orderStatus: 'PENDING_REVIEW' }))).toContain('NOT_APPROVED');
  });
  it('flags unconfigured pharmacy fields instead of guessing them', () => {
    const items = [{ ...base().items[0], diluent: null, infusionDurationMin: null }];
    const w = evaluateWarnings(base({ items })).find((x) => x.code === 'NOT_CONFIGURED');
    expect(w?.message).toMatch(/Not configured — clinician\/pharmacy input required/);
  });
  it('flags an interval shorter than the protocol cycle length', () => {
    expect(codes(base({ plannedDate: '2026-09-20' }))).toContain('EARLY_CYCLE');
  });
  it('flags Calvert dosing for verification and high GFR input for review', () => {
    const items = [{ ...base().items[0], drugName: 'Carboplatin', doseUnit: 'AUC' }];
    const c = codes(base({ items, gfr: 140, gfrSource: 'CrCl' }));
    expect(c).toEqual(expect.arrayContaining(['CALVERT_VERIFY', 'GFR_ABOVE_REVIEW_THRESHOLD']));
  });
  it('chair conflict and demo protocol labels', () => {
    expect(codes(base({ chairConflict: 'Chair already assigned to another patient.', isDemoProtocol: true }))).toEqual(['CHAIR_CONFLICT', 'DEMO_PROTOCOL']);
  });
  it('requires acknowledgement only for warning/critical (never cancels)', () => {
    expect(requiresAcknowledgement(evaluateWarnings(base({ isDemoProtocol: true })))).toBe(false);
    expect(requiresAcknowledgement(evaluateWarnings(base({ weightKg: 60 })))).toBe(true);
  });
});
