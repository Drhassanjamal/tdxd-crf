import { pool, q, q1 } from '../../db/pool';
import { AI_LABEL, AssistantOutput, AssistantSection, ClinicalAssistantProvider } from './types';

/**
 * Deterministic placeholder engine: summarises ONLY data recorded in OncoSmart.
 * It does not infer diagnoses, doses or guidelines. Replace with a governed
 * AI provider in the future without changing the API contract.
 */
export class RuleBasedAssistant implements ClinicalAssistantProvider {
  readonly name = 'rule-based-placeholder (no AI model connected)';

  async summarizePatient(patientId: string): Promise<AssistantOutput> {
    const p = await q1(pool, 'SELECT * FROM patients WHERE id=$1', [patientId]);
    const dx = await q1(pool, 'SELECT * FROM diagnoses WHERE patient_id=$1 ORDER BY is_primary DESC LIMIT 1', [patientId]);
    const plan = await q1(
      pool,
      `SELECT tp.*, pr.name AS protocol_name FROM treatment_plans tp JOIN protocols pr ON pr.id = tp.protocol_id
        WHERE tp.patient_id=$1 ORDER BY (tp.status='ACTIVE') DESC, tp.start_date DESC LIMIT 1`,
      [patientId],
    );
    const orders = await q(
      pool,
      `SELECT o.*, (SELECT json_agg(json_build_object('drug', i.drug_name, 'dose', i.final_dose, 'pct', i.dose_percent) ORDER BY i.sequence)
                      FROM treatment_order_items i WHERE i.treatment_order_id = o.id) AS items
         FROM treatment_orders o WHERE o.patient_id=$1 AND o.status='COMPLETED' ORDER BY o.cycle_number, o.day_number`,
      [patientId],
    );
    const labs = await q(
      pool,
      `SELECT DISTINCT ON (r.test_code) r.test_code, d.name, r.value, r.unit, r.ref_low, r.ref_high, r.collected_at
         FROM laboratory_results r JOIN lab_test_definitions d ON d.code = r.test_code
        WHERE r.patient_id=$1 ORDER BY r.test_code, r.collected_at DESC`,
      [patientId],
    );
    const events = await q(pool, 'SELECT * FROM treatment_events WHERE patient_id=$1 ORDER BY occurred_at', [patientId]);
    const reactions = await q(pool, `SELECT drug_name, reaction_details, start_time FROM administrations WHERE patient_id=$1 AND reaction`, [patientId]);
    const allergies = await q(pool, 'SELECT allergen FROM allergies WHERE patient_id=$1 AND is_active', [patientId]);

    const sections: AssistantSection[] = [];
    sections.push({
      id: 'TREATMENT_HISTORY',
      title: 'Treatment history summary',
      items: plan
        ? [
            `${plan.protocol_name}: ${plan.cycles_completed} of ${plan.planned_cycles} planned cycles completed (plan ${plan.status.toLowerCase()}).`,
            ...orders.slice(-3).map((o) => `C${o.cycle_number}D${o.day_number} on ${new Date(o.completed_at).toISOString().slice(0, 10)}: ${(o.items ?? []).map((i: any) => `${i.drug} ${i.dose} mg${Number(i.pct) !== 100 ? ` (${i.pct}%)` : ''}`).join(', ')}.`),
          ]
        : ['No treatment plan recorded.'],
    });
    const missing: string[] = [];
    if (!dx) missing.push('No diagnosis recorded.');
    else {
      if (!dx.stage) missing.push('Diagnosis stage not recorded.');
      if (!dx.histology) missing.push('Histology not recorded.');
      if (!dx.icd10_code) missing.push('ICD-10 code not recorded.');
    }
    if (!p.no_known_allergies && !allergies.length) missing.push('Allergy status not documented.');
    if (!p.height_cm || !p.weight_kg) missing.push('Height/weight not recorded.');
    if (!p.phone) missing.push('Patient phone number missing (reminders cannot be sent).');
    if (!p.emergency_contact_phone) missing.push('Emergency contact not recorded.');
    sections.push({ id: 'MISSING_INFORMATION', title: 'Missing information', items: missing.length ? missing : ['No missing core information detected.'] });
    const abnormal = labs.filter((l) => (l.ref_low !== null && l.value < l.ref_low) || (l.ref_high !== null && l.value > l.ref_high));
    sections.push({
      id: 'ABNORMAL_LABS',
      title: 'Latest laboratory values outside configured reference range',
      items: abnormal.length
        ? abnormal.map((l) => `${l.name}: ${l.value} ${l.unit} (ref ${l.ref_low ?? '—'}–${l.ref_high ?? '—'}) on ${new Date(l.collected_at).toISOString().slice(0, 10)}`)
        : ['No out-of-range values among the latest results.'],
    });
    const cmp: string[] = [];
    if (orders.length >= 2) {
      const [prev, last] = orders.slice(-2);
      cmp.push(`Weight ${prev.weight_kg} → ${last.weight_kg} kg; BSA ${prev.bsa_m2 ?? '—'} → ${last.bsa_m2 ?? '—'} m².`);
      for (const i of last.items ?? []) {
        const pi = (prev.items ?? []).find((x: any) => x.drug === i.drug);
        if (pi && Number(pi.dose) !== Number(i.dose)) cmp.push(`${i.drug}: ${pi.dose} → ${i.dose} mg.`);
      }
      if (cmp.length === 1) cmp.push('No dose differences between the last two completed cycles.');
    } else cmp.push('Fewer than two completed cycles — no comparison available.');
    sections.push({ id: 'CYCLE_COMPARISON', title: 'Comparison with previous cycle', items: cmp });
    const docs: string[] = [];
    for (const o of orders) {
      if (!o.nurse_verified_by) docs.push(`C${o.cycle_number}D${o.day_number}: completed without recorded nurse verification.`);
      if (!o.approved_by) docs.push(`C${o.cycle_number}D${o.day_number}: completed without recorded physician approval.`);
    }
    sections.push({ id: 'DOCUMENTATION', title: 'Documentation consistency', items: docs.length ? docs : ['No documentation inconsistencies detected in completed orders.'] });
    const tox = [
      ...events.map((e) => `${new Date(e.occurred_at).toISOString().slice(0, 10)}: ${e.event_type.replace(/_/g, ' ').toLowerCase()} (${e.severity.toLowerCase()}) — ${e.description}`),
      ...reactions.map((r) => `${r.start_time ? new Date(r.start_time).toISOString().slice(0, 10) : ''}: reaction during ${r.drug_name} — ${r.reaction_details ?? ''}`),
    ];
    sections.push({ id: 'TOXICITY_HISTORY', title: 'Recorded toxicity / events', items: tox.length ? tox : ['No treatment events recorded.'] });
    sections.push({
      id: 'MDT_SUMMARY',
      title: 'MDT summary draft',
      items: [
        `${p.first_name} ${p.last_name}, ${p.sex === 'MALE' ? 'male' : 'female'}, MRN ${p.mrn}.`,
        dx ? `Diagnosis: ${dx.primary_cancer}${dx.stage ? `, ${dx.stage}` : ''}${dx.histology ? `, ${dx.histology}` : ''}${dx.biomarkers ? `; biomarkers: ${dx.biomarkers}` : ''}.` : 'Diagnosis: not recorded.',
        plan ? `Current treatment: ${plan.protocol_name} (${plan.intent.toLowerCase()}), ${plan.cycles_completed}/${plan.planned_cycles} cycles.` : 'No current treatment plan.',
        'Discussion points: to be completed by the treating physician.',
      ],
    });
    return {
      label: AI_LABEL,
      engine: this.name,
      generatedAt: new Date().toISOString(),
      disclaimer: 'Placeholder engine: summarises recorded data only; no AI model is connected and no clinical recommendations are made.',
      sections,
    };
  }
}
