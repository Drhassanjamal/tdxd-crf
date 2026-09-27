/**
 * OncoSmart safety warning engine.
 *
 * Warnings NEVER cancel or block treatment automatically — they surface issues
 * that require clinician review and acknowledgement. Thresholds come from unit
 * settings; no clinical dose-modification rules are invented here. Comparisons
 * are purely data-driven (documented allergies, configured reference ranges,
 * previous cycle values, configured protocol cycle length).
 */

export type WarningSeverity = 'CRITICAL' | 'WARNING' | 'INFO';

export interface ClinicalWarning {
  code: string;
  severity: WarningSeverity;
  message: string;
  params?: Record<string, string | number>;
  drug?: string;
}

export interface WarningLab {
  code: string;
  name: string;
  value: number;
  unit: string;
  refLow: number | null;
  refHigh: number | null;
  collectedAt: string; // ISO timestamp
}

export interface WarningItem {
  drugName: string;
  doseUnit: string;
  route: string;
  finalDose: number | null;
  calculationError?: string | null;
  diluent?: string | null;
  finalVolumeMl?: number | null;
  infusionDurationMin?: number | null;
  administrationMethod?: string | null;
  dosePercent?: number;
  isManuallyAdjusted?: boolean;
  modificationReason?: string | null;
  previousFinalDose?: number | null;
  premedicationRequired?: boolean;
}

export interface WarningContext {
  thresholds: {
    doseDifferencePct: number;
    weightChangePct: number;
    labValidityDays: number;
    calvertGfrReview: number;
  };
  plannedDate: string;
  orderStatus?: string | null;
  noKnownAllergies: boolean;
  allergies: { allergen: string; severity?: string | null; reaction?: string | null }[];
  requiredLabs: string[];
  labs: WarningLab[];
  items: WarningItem[];
  weightKg?: number | null;
  gfr?: number | null;
  gfrSource?: string | null;
  premedications?: string | null;
  previous?: { weightKg: number | null; plannedDate: string; cycleNumber: number; dayNumber: number } | null;
  cycleNumber: number;
  dayNumber: number;
  plannedCycles: number;
  cycleLengthDays: number;
  isDemoProtocol: boolean;
  chairConflict?: string | null;
}

const RENAL_CODES = ['CREAT', 'EGFR'];
const NOT_CONFIGURED = 'Not configured — clinician/pharmacy input required';

function withinValidity(collectedAt: string, plannedDate: string, validityDays: number) {
  const collected = new Date(collectedAt).getTime();
  const plannedEnd = new Date(`${plannedDate}T23:59:59Z`).getTime() + 12 * 3600 * 1000; // tolerate tz offset
  const earliest = new Date(`${plannedDate}T00:00:00Z`).getTime() - validityDays * 86400000 - 12 * 3600 * 1000;
  return collected <= plannedEnd && collected >= earliest;
}

function isAbnormal(l: WarningLab) {
  return (l.refLow !== null && l.value < l.refLow) || (l.refHigh !== null && l.value > l.refHigh);
}

function labLabel(l: WarningLab) {
  const flag = l.refLow !== null && l.value < l.refLow ? 'L' : 'H';
  const range = `${l.refLow ?? '—'}–${l.refHigh ?? '—'}`;
  return `${l.name} ${l.value} ${l.unit} (${flag}; ref ${range})`;
}

/** Tokens of an allergen string that are specific enough to match against a drug name. */
function allergenMatchesDrug(allergen: string, drug: string) {
  const a = allergen.toLowerCase();
  const d = drug.toLowerCase();
  if (a.includes(d) || d.includes(a)) return true;
  return a
    .split(/[^a-z؀-ۿ]+/)
    .filter((t) => t.length >= 5)
    .some((t) => d.includes(t));
}

export function evaluateWarnings(ctx: WarningContext): ClinicalWarning[] {
  const w: ClinicalWarning[] = [];
  const push = (x: ClinicalWarning) => w.push(x);

  // --- Approval status --------------------------------------------------------
  if (ctx.orderStatus === 'DRAFT' || ctx.orderStatus === 'PENDING_REVIEW') {
    push({ code: 'NOT_APPROVED', severity: 'CRITICAL', message: 'Treatment order has not been approved by physician.' });
  } else if (ctx.orderStatus === 'HELD' || ctx.orderStatus === 'DELAYED') {
    push({ code: 'ORDER_ON_HOLD', severity: 'CRITICAL', message: 'Treatment order is on hold / delayed — physician review required.' });
  }

  // --- Calculation completeness ----------------------------------------------
  for (const it of ctx.items) {
    if (it.calculationError) {
      push({
        code: 'CALCULATION_INCOMPLETE',
        severity: 'CRITICAL',
        drug: it.drugName,
        message: `${it.drugName}: dose cannot be calculated — ${it.calculationError}.`,
        params: { drug: it.drugName, reason: it.calculationError },
      });
    }
  }

  // --- Allergies ---------------------------------------------------------------
  if (ctx.allergies.length) {
    const list = ctx.allergies.map((a) => a.allergen).join(', ');
    push({
      code: 'ALLERGY_DOCUMENTED',
      severity: 'WARNING',
      message: `Patient has documented allergy: ${list}.`,
      params: { allergens: list },
    });
    for (const it of ctx.items) {
      const match = ctx.allergies.find((a) => allergenMatchesDrug(a.allergen, it.drugName));
      if (match) {
        push({
          code: 'ALLERGY_DRUG_MATCH',
          severity: 'CRITICAL',
          drug: it.drugName,
          message: `Documented allergy "${match.allergen}" matches ordered drug ${it.drugName} — physician review required.`,
          params: { allergen: match.allergen, drug: it.drugName },
        });
      }
    }
  } else if (!ctx.noKnownAllergies) {
    push({ code: 'ALLERGY_NOT_DOCUMENTED', severity: 'WARNING', message: 'Allergy status has not been documented.' });
  }

  // --- Laboratory ----------------------------------------------------------------
  const validLabs = ctx.labs.filter((l) => withinValidity(l.collectedAt, ctx.plannedDate, ctx.thresholds.labValidityDays));
  const latestValid = new Map<string, WarningLab>();
  for (const l of validLabs) {
    const cur = latestValid.get(l.code);
    if (!cur || new Date(l.collectedAt) > new Date(cur.collectedAt)) latestValid.set(l.code, l);
  }
  const missing = ctx.requiredLabs.filter((code) => !latestValid.has(code));
  if (missing.length) {
    push({
      code: 'LABS_MISSING',
      severity: 'WARNING',
      message: `Required laboratory information is missing (no result within ${ctx.thresholds.labValidityDays} days): ${missing.join(', ')}.`,
      params: { tests: missing.join(', '), days: ctx.thresholds.labValidityDays },
    });
  }
  const abnormal = [...latestValid.values()].filter((l) => isAbnormal(l) && !RENAL_CODES.includes(l.code));
  if (abnormal.length) {
    const list = abnormal.map(labLabel).join('; ');
    push({
      code: 'LABS_ABNORMAL',
      severity: 'WARNING',
      message: `Laboratory values outside reference range — physician review: ${list}.`,
      params: { values: list },
    });
  }

  // --- Renal function --------------------------------------------------------------
  const renalAbnormal = [...latestValid.values()].filter((l) => RENAL_CODES.includes(l.code) && isAbnormal(l));
  if (renalAbnormal.length) {
    const list = renalAbnormal.map(labLabel).join('; ');
    push({ code: 'RENAL_REVIEW', severity: 'WARNING', message: `Renal function requires physician review: ${list}.`, params: { values: list } });
  }
  const aucItems = ctx.items.filter((i) => i.doseUnit === 'AUC');
  if (aucItems.length && ctx.gfr) {
    push({
      code: 'CALVERT_VERIFY',
      severity: 'INFO',
      message: `Calvert (AUC) dose uses GFR ${ctx.gfr} mL/min (source: ${ctx.gfrSource || 'not stated'}). This calculation requires clinician verification and appropriate renal function input.`,
      params: { gfr: ctx.gfr, source: ctx.gfrSource || '—' },
    });
    if (ctx.gfr > ctx.thresholds.calvertGfrReview) {
      push({
        code: 'GFR_ABOVE_REVIEW_THRESHOLD',
        severity: 'WARNING',
        message: `GFR input (${ctx.gfr} mL/min) exceeds the configured review threshold of ${ctx.thresholds.calvertGfrReview} mL/min — physician review of the Calvert calculation required.`,
        params: { gfr: ctx.gfr, threshold: ctx.thresholds.calvertGfrReview },
      });
    }
  }

  // --- Weight change ------------------------------------------------------------------
  if (ctx.previous?.weightKg && ctx.weightKg) {
    const pct = ((ctx.weightKg - ctx.previous.weightKg) / ctx.previous.weightKg) * 100;
    if (Math.abs(pct) > ctx.thresholds.weightChangePct) {
      push({
        code: 'WEIGHT_CHANGE',
        severity: 'WARNING',
        message: `Weight has changed significantly from previous treatment: ${ctx.previous.weightKg} → ${ctx.weightKg} kg (${pct > 0 ? '+' : ''}${pct.toFixed(1)}%).`,
        params: { from: ctx.previous.weightKg, to: ctx.weightKg, pct: pct.toFixed(1) },
      });
    }
  }

  // --- Dose difference vs previous cycle -------------------------------------------------
  for (const it of ctx.items) {
    if (it.previousFinalDose && it.finalDose) {
      const pct = ((it.finalDose - it.previousFinalDose) / it.previousFinalDose) * 100;
      if (Math.abs(pct) > ctx.thresholds.doseDifferencePct) {
        push({
          code: 'DOSE_DIFFERENCE',
          severity: 'WARNING',
          drug: it.drugName,
          message: `${it.drugName}: current dose ${it.finalDose} mg differs from previous cycle (${it.previousFinalDose} mg) by ${pct > 0 ? '+' : ''}${pct.toFixed(1)}%.`,
          params: { drug: it.drugName, current: it.finalDose, previous: it.previousFinalDose, pct: pct.toFixed(1) },
        });
      }
    }
    if (it.dosePercent !== undefined && it.dosePercent !== 100) {
      push({
        code: 'DOSE_MODIFIED',
        severity: 'INFO',
        drug: it.drugName,
        message: `${it.drugName}: dose prescribed at ${it.dosePercent}% of protocol dose${it.modificationReason ? ` — ${it.modificationReason}` : ''}.`,
        params: { drug: it.drugName, pct: it.dosePercent },
      });
    }
    if (it.isManuallyAdjusted) {
      push({
        code: 'DOSE_MANUALLY_ADJUSTED',
        severity: 'INFO',
        drug: it.drugName,
        message: `${it.drugName}: final dose manually adjusted by prescriber${it.modificationReason ? ` — ${it.modificationReason}` : ''}.`,
        params: { drug: it.drugName },
      });
    }
    // Configuration completeness — never guess missing pharmacy information
    if (it.route === 'IV') {
      const missingFields: string[] = [];
      if (!it.infusionDurationMin && it.administrationMethod !== 'BOLUS') missingFields.push('infusion duration');
      if (!it.diluent) missingFields.push('diluent');
      if (!it.finalVolumeMl) missingFields.push('final volume');
      if (missingFields.length) {
        push({
          code: 'NOT_CONFIGURED',
          severity: missingFields.includes('infusion duration') ? 'WARNING' : 'INFO',
          drug: it.drugName,
          message: `${it.drugName}: ${missingFields.join(', ')} — ${NOT_CONFIGURED}.`,
          params: { drug: it.drugName, fields: missingFields.join(', ') },
        });
      }
    }
  }
  if (ctx.items.some((i) => i.premedicationRequired) && !ctx.premedications) {
    push({
      code: 'PREMEDICATION_NOT_CONFIGURED',
      severity: 'WARNING',
      message: `Premedication is flagged as required but no premedication is configured — ${NOT_CONFIGURED}.`,
    });
  }

  // --- Cycle / schedule checks ---------------------------------------------------------------
  if (ctx.cycleNumber > ctx.plannedCycles) {
    push({
      code: 'CYCLE_EXCEEDS_PLAN',
      severity: 'WARNING',
      message: `Cycle ${ctx.cycleNumber} exceeds the ${ctx.plannedCycles} planned cycles of the treatment plan.`,
      params: { cycle: ctx.cycleNumber, planned: ctx.plannedCycles },
    });
  }
  if (ctx.previous && ctx.dayNumber === 1 && ctx.previous.cycleNumber < ctx.cycleNumber) {
    const prevD1 = new Date(`${ctx.previous.plannedDate}T00:00:00Z`).getTime() - (ctx.previous.dayNumber - 1) * 86400000;
    const interval = Math.round((new Date(`${ctx.plannedDate}T00:00:00Z`).getTime() - prevD1) / 86400000);
    const expected = ctx.cycleLengthDays * (ctx.cycleNumber - ctx.previous.cycleNumber);
    if (interval < expected) {
      push({
        code: 'EARLY_CYCLE',
        severity: 'WARNING',
        message: `Interval since previous cycle Day 1 is ${interval} days — shorter than the protocol cycle length (${expected} days).`,
        params: { interval, expected },
      });
    }
  }

  if (ctx.chairConflict) {
    push({ code: 'CHAIR_CONFLICT', severity: 'WARNING', message: ctx.chairConflict });
  }

  if (ctx.isDemoProtocol) {
    push({ code: 'DEMO_PROTOCOL', severity: 'INFO', message: 'DEMO PROTOCOL — NOT FOR CLINICAL USE.' });
  }

  const order = { CRITICAL: 0, WARNING: 1, INFO: 2 } as const;
  return w.sort((a, b) => order[a.severity] - order[b.severity]);
}

export function requiresAcknowledgement(warnings: ClinicalWarning[]) {
  return warnings.some((x) => (x.severity === 'CRITICAL' || x.severity === 'WARNING') && x.code !== 'NOT_APPROVED');
}
