import { describe, expect, it } from 'vitest';
import { applyRounding, bsaMosteller, calculateDose, cockcroftGault, estimateVials } from '../src/services/doseCalculator';

describe('Mosteller BSA', () => {
  it('matches the specification example (170 cm, 70 kg → 1.82 m²)', () => {
    expect(bsaMosteller(170, 70)).toBe(1.82);
  });
  it('rejects implausible measurements', () => {
    expect(() => bsaMosteller(10, 70)).toThrow();
    expect(() => bsaMosteller(170, 0)).toThrow();
  });
});

describe('dose calculation', () => {
  it('mg/m² = dose × BSA, preserving the exact value and rounding separately', () => {
    const r = calculateDose({ doseValue: 85, doseUnit: 'MG_M2', bsa: 1.82, roundingRule: 'NEAREST_1' });
    expect(r.ok).toBe(true);
    expect(r.calculatedDose).toBe(154.7);
    expect(r.roundedDose).toBe(155);
    expect(r.formula).toContain('85 mg/m² × 1.82 m²');
  });
  it('mg/kg = dose × weight', () => {
    const r = calculateDose({ doseValue: 2, doseUnit: 'MG_KG', weightKg: 70, roundingRule: 'NONE' });
    expect(r.calculatedDose).toBe(140);
    expect(r.roundedDose).toBe(140);
  });
  it('flat mg dose is unchanged', () => {
    expect(calculateDose({ doseValue: 200, doseUnit: 'MG', roundingRule: 'NEAREST_1' }).roundedDose).toBe(200);
  });
  it('Calvert AUC = target × (GFR + 25)', () => {
    const r = calculateDose({ doseValue: 5, doseUnit: 'AUC', gfr: 80, roundingRule: 'NEAREST_10' });
    expect(r.calculatedDose).toBe(525);
    expect(r.roundedDose).toBe(530);
  });
  it('AUC dosing without GFR is refused (clinician input required)', () => {
    const r = calculateDose({ doseValue: 5, doseUnit: 'AUC', gfr: null, roundingRule: 'NEAREST_10' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/GFR/);
  });
  it('mg/m² without BSA is refused', () => {
    expect(calculateDose({ doseValue: 85, doseUnit: 'MG_M2', bsa: null, roundingRule: 'NEAREST_1' }).ok).toBe(false);
  });
  it('dose percentage is applied before rounding; calculated dose stays at 100 %', () => {
    const r = calculateDose({ doseValue: 85, doseUnit: 'MG_M2', bsa: 1.82, dosePercent: 80, roundingRule: 'NEAREST_1' });
    expect(r.calculatedDose).toBe(154.7);
    expect(r.adjustedDose).toBe(123.76);
    expect(r.roundedDose).toBe(124);
  });
  it('rejects out-of-range dose percentages', () => {
    expect(calculateDose({ doseValue: 85, doseUnit: 'MG_M2', bsa: 1.8, dosePercent: 200, roundingRule: 'NEAREST_1' }).ok).toBe(false);
  });
});

describe('rounding rules', () => {
  it('163.2 mg → 163 mg with nearest-1 (specification example)', () => {
    expect(applyRounding(163.2, 'NEAREST_1')).toBe(163);
  });
  it.each([
    ['NEAREST_5', 163.2, 165],
    ['NEAREST_10', 541.5, 540],
    ['NEAREST_0_5', 12.3, 12.5],
    ['NONE', 154.7049, 154.7],
  ])('%s(%d) = %d', (rule, v, expected) => {
    expect(applyRounding(v as number, rule as string)).toBe(expected);
  });
});

describe('reference helpers', () => {
  it('Cockcroft–Gault estimate (female factor 0.85)', () => {
    expect(cockcroftGault({ ageYears: 60, weightKg: 72, sex: 'MALE', creatinineMgDl: 1 })).toBe(80);
    expect(cockcroftGault({ ageYears: 60, weightKg: 72, sex: 'FEMALE', creatinineMgDl: 1 })).toBe(68);
  });
  it('vial estimate minimises waste, then vial count', () => {
    const v = estimateVials(155, [50, 100]);
    expect(v?.totalMg).toBe(200);
    expect(v?.vials).toBe(2);
    expect(estimateVials(326, [30, 100, 300])?.totalMg).toBe(330);
  });
});
