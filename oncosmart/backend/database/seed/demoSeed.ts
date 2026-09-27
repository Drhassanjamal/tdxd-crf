/**
 * SYNTHETIC DEMO DATA — fictional patients only. NOT real patient data.
 *
 * Builds a realistic chemotherapy-unit day relative to "today" (unit time zone):
 *  - 5 demo users (+1 extra physician/nurse), 6 chairs, 3 DEMO protocols, drug catalogue
 *  - 10 fictional patients with diagnoses, treatment plans, previous cycles,
 *    labs, vitals, administrations, notifications and audit entries
 *  - today's schedule with patients waiting, in preparation, in treatment and completed
 *  - warning scenarios: allergy/drug match, missing labs, dose & weight change,
 *    renal review, order awaiting approval, chair conflict, delayed start, failed message
 *
 * Today's scenarios are created through the REAL service layer (the same code the
 * API uses), so workflow rules and audit logging are exercised by the seed itself.
 */
import bcrypt from 'bcryptjs';
import type { PoolClient } from 'pg';
import { pool, q, q1 } from '../../src/db/pool';
import { env } from '../../src/config/env';
import { Actor } from '../../src/services/audit.service';
import { bsaMosteller, calculateDose, cockcroftGault } from '../../src/services/doseCalculator';
import { getSettings, invalidateSettingsCache } from '../../src/services/settings.service';
import * as orders from '../../src/services/orders.service';
import * as appts from '../../src/services/appointment.service';
import { addVitals } from '../../src/services/patients.service';
import { addDays, ageFrom, localToUtc, minutesToTime, timeInTz, timeToMinutes, todayInTz } from '../../src/utils/dates';

// Fixed IDs for demo accounts so sessions survive a demo reset.
export const DEMO_USER_IDS = {
  admin: '00000000-0000-4000-8000-000000000001',
  doctor: '00000000-0000-4000-8000-000000000002',
  nurse: '00000000-0000-4000-8000-000000000003',
  reception: '00000000-0000-4000-8000-000000000004',
  doctor2: '00000000-0000-4000-8000-000000000005',
  nurse2: '00000000-0000-4000-8000-000000000006',
};

// Deterministic PRNG so the dataset is reproducible
function mulberry32(a: number) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20260926);
const jitter = (base: number, spread: number, dp = 1) => Number((base + (rand() * 2 - 1) * spread).toFixed(dp));

const DATA_TABLES = [
  'audit_logs', 'notifications', 'patient_notes', 'treatment_events', 'vital_signs', 'administrations', 'laboratory_results',
  'treatment_order_items', 'treatment_orders', 'appointments', 'treatment_plans', 'diagnoses', 'allergies', 'patient_identifiers',
  'patients', 'chairs', 'protocol_drugs', 'protocols', 'inventory_batches', 'drug_products', 'drugs', 'users',
];

const STANDARD_LABS: Record<string, [number, number, number]> = {
  HB: [12.6, 0.8, 1], WBC: [6.2, 1.2, 1], ANC: [3.6, 0.8, 1], PLT: [235, 45, 0], CREAT: [0.85, 0.12, 2], EGFR: [92, 8, 0],
  AST: [26, 6, 0], ALT: [24, 6, 0], ALP: [85, 15, 0], BILI: [0.6, 0.15, 1], ALB: [4.0, 0.2, 1],
};

export async function seedDemoData(log = console.log) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`TRUNCATE ${DATA_TABLES.join(', ')} RESTART IDENTITY CASCADE`);
    await client.query('ALTER SEQUENCE patient_code_seq RESTART WITH 1001');
    await client.query('ALTER SEQUENCE treatment_order_seq RESTART WITH 1');
    await client.query('ALTER SEQUENCE appointment_seq RESTART WITH 1');
    invalidateSettingsCache();
    await build(client, log);
    await client.query('COMMIT');
    invalidateSettingsCache();
    log('[seed] demo data loaded (SYNTHETIC — NOT FOR CLINICAL USE)');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function build(db: PoolClient, log: (m: string) => void) {
  const s = await getSettings(db);
  const tz = s.timezone;
  const today = todayInTz(tz);
  const at = (date: string, time: string) => localToUtc(date, time, tz);
  const now = new Date();
  const minsAgo = (m: number) => new Date(now.getTime() - m * 60000);

  // ------------------------------------------------------------------ users
  const hash = await bcrypt.hash(env.SEED_DEMO_PASSWORD, 11);
  const users: [string, string, string, string, string, string][] = [
    [DEMO_USER_IDS.admin, 'admin@demo.local', 'Demo Administrator', 'مدير النظام (تجريبي)', 'ADMIN', ''],
    [DEMO_USER_IDS.doctor, 'doctor@demo.local', 'Dr. Layla Hameed', 'د. ليلى حميد', 'PHYSICIAN', 'Consultant Medical Oncologist'],
    [DEMO_USER_IDS.nurse, 'nurse@demo.local', 'Huda Kareem', 'هدى كريم', 'NURSE', 'Chemotherapy Nurse'],
    [DEMO_USER_IDS.reception, 'reception@demo.local', 'Rana Adel', 'رنا عادل', 'RECEPTION', 'Unit Receptionist'],
    [DEMO_USER_IDS.doctor2, 'doctor2@demo.local', 'Dr. Karim Jawad', 'د. كريم جواد', 'PHYSICIAN', 'Medical Oncologist'],
    [DEMO_USER_IDS.nurse2, 'nurse2@demo.local', 'Ali Sabah', 'علي صباح', 'NURSE', 'Chemotherapy Nurse'],
  ];
  for (const [id, email, name, nameAr, role, title] of users) {
    await db.query(
      `INSERT INTO users (id, email, password_hash, full_name, full_name_ar, role_code, title, password_changed_at, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7, now(), now() - interval '120 days')`,
      [id, email, hash, name, nameAr, role, title || null],
    );
  }
  const actor = (id: string, email: string, role: string): Actor => ({ id, email, role, ip: '127.0.0.1', userAgent: 'demo-seed' });
  const DR = actor(DEMO_USER_IDS.doctor, 'doctor@demo.local', 'PHYSICIAN');
  const DR2 = actor(DEMO_USER_IDS.doctor2, 'doctor2@demo.local', 'PHYSICIAN');
  const RN = actor(DEMO_USER_IDS.nurse, 'nurse@demo.local', 'NURSE');
  const RN2 = actor(DEMO_USER_IDS.nurse2, 'nurse2@demo.local', 'NURSE');
  const RC = actor(DEMO_USER_IDS.reception, 'reception@demo.local', 'RECEPTION');

  // ------------------------------------------------------------------ chairs
  const chairIds: string[] = [];
  for (let i = 1; i <= 6; i++) {
    const c = await q1(
      db,
      `INSERT INTO chairs (code, name, zone, chair_type, sort_order) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [`CH-${String(i).padStart(2, '0')}`, `Chair ${i}`, i <= 3 ? 'Bay A' : 'Bay B', i === 6 ? 'BED' : 'RECLINER', i],
    );
    chairIds.push(c.id);
  }
  const chair = (n: number) => chairIds[n - 1];

  // ------------------------------------------------------------------ drug catalogue (demo inventory)
  const catalogue: [string, string, number[]][] = [
    ['Oxaliplatin', 'Platinum compound', [50, 100]],
    ['Leucovorin', 'Folate analogue (calcium folinate)', [50, 100, 300]],
    ['Fluorouracil', 'Antimetabolite', [500, 1000]],
    ['Paclitaxel', 'Taxane', [30, 100, 300]],
    ['Carboplatin', 'Platinum compound', [150, 450]],
    ['Pembrolizumab', 'Anti-PD-1 monoclonal antibody', [100]],
  ];
  const drugIds: Record<string, string> = {};
  for (const [name, cls, strengths] of catalogue) {
    const d = await q1(db, `INSERT INTO drugs (generic_name, drug_class, notes) VALUES ($1,$2,'DEMO catalogue entry') RETURNING id`, [name, cls]);
    drugIds[name] = d.id;
    for (const st of strengths) {
      const p = await q1(
        db,
        `INSERT INTO drug_products (drug_id, brand_name, manufacturer, strength, vial_size_ml) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [d.id, `${name} (demo)`, 'Demo Pharma Ltd.', st, name === 'Pembrolizumab' ? 4 : null],
      );
      await db.query(
        `INSERT INTO inventory_batches (drug_product_id, batch_number, expiry_date, quantity_on_hand, location, received_at)
         VALUES ($1,$2,$3,$4,'Chemo pharmacy (demo)',$5)`,
        [p.id, `DEMO-${name.slice(0, 3).toUpperCase()}-${st}`, addDays(today, 240 + st), 10 + Math.round(rand() * 30), addDays(today, -30)],
      );
    }
  }

  // ------------------------------------------------------------------ protocols (DEMO — NOT FOR CLINICAL USE)
  const DEMO_NOTE = 'DEMO PROTOCOL — NOT FOR CLINICAL USE. Illustrative values for software demonstration only; all protocol content must be configured and verified by the hospital oncology and pharmacy team.';
  async function protocol(p: any, drugs: any[]) {
    const row = await q1(
      db,
      `INSERT INTO protocols (code, name, cancer_type, intent, cycle_length_days, planned_cycles, treatment_days, estimated_duration_min,
          premedications, hydration, supportive_medications, special_instructions, required_labs, default_rounding_rule, is_demo, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,'{1}',$7,$8,$9,$10,$11,$12,$13,true,$14) RETURNING *`,
      [p.code, p.name, p.cancerType, p.intent, p.cycleLength, p.cycles, p.duration, p.premed ?? null, p.hydration ?? null,
        p.supportive ?? null, DEMO_NOTE, p.labs, p.rounding ?? 'NEAREST_1', DEMO_USER_IDS.admin],
    );
    const inserted = [];
    for (const d of drugs) {
      inserted.push(
        await q1(
          db,
          `INSERT INTO protocol_drugs (protocol_id, drug_id, sequence, drug_name, dose_value, dose_unit, route, administration_method,
              diluent, final_volume_ml, infusion_duration_min, premedication_required, rounding_rule, special_instructions)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
          [row.id, drugIds[d.catalog], d.seq, d.name, d.dose, d.unit, 'IV', d.method, d.diluent ?? null, d.volume ?? null,
            d.minutes ?? null, !!d.premed, d.rounding ?? null, d.note ?? null],
        ),
      );
    }
    return { ...row, drugs: inserted };
  }
  const FOLFOX = await protocol(
    {
      code: 'DEMO-FOLFOX', name: 'FOLFOX-like demonstration protocol', cancerType: 'Colorectal', intent: 'ADJUVANT', cycleLength: 14,
      cycles: 12, duration: 240, labs: ['HB', 'ANC', 'PLT', 'CREAT', 'BILI', 'ALT'],
      premed: 'DEMO placeholder: antiemetic premedication per institutional antiemetic policy — configure locally.',
      supportive: 'DEMO placeholder: take-home antiemetics per institutional policy — configure locally.',
    },
    [
      { seq: 1, catalog: 'Oxaliplatin', name: 'Oxaliplatin', dose: 85, unit: 'MG_M2', method: 'INFUSION', diluent: 'Dextrose 5%', volume: 500, minutes: 120, premed: true },
      { seq: 2, catalog: 'Leucovorin', name: 'Leucovorin', dose: 400, unit: 'MG_M2', method: 'INFUSION', diluent: 'Dextrose 5%', volume: 250, minutes: 120 },
      { seq: 3, catalog: 'Fluorouracil', name: 'Fluorouracil (bolus)', dose: 400, unit: 'MG_M2', method: 'BOLUS', minutes: null },
      { seq: 4, catalog: 'Fluorouracil', name: 'Fluorouracil (46-h infusion)', dose: 2400, unit: 'MG_M2', method: 'CONTINUOUS_INFUSION', minutes: 2760, rounding: 'NEAREST_10', note: 'Ambulatory infusion pump — disconnection documented separately.' },
    ],
  );
  const CARBOPACLI = await protocol(
    {
      code: 'DEMO-CARBO-PACLI', name: 'Carboplatin/Paclitaxel-like demonstration protocol', cancerType: 'Ovarian', intent: 'PALLIATIVE', cycleLength: 21,
      cycles: 6, duration: 300, labs: ['HB', 'ANC', 'PLT', 'CREAT', 'EGFR', 'BILI'],
      premed: 'DEMO placeholder: hypersensitivity premedication before paclitaxel per institutional policy — configure locally.',
      supportive: 'DEMO placeholder: antiemetics per institutional policy — configure locally.',
    },
    [
      { seq: 1, catalog: 'Paclitaxel', name: 'Paclitaxel', dose: 175, unit: 'MG_M2', method: 'INFUSION', diluent: 'Sodium chloride 0.9%', volume: 500, minutes: 180, premed: true, note: 'Administration set / filter requirements per pharmacy (demo).' },
      { seq: 2, catalog: 'Carboplatin', name: 'Carboplatin', dose: 5, unit: 'AUC', method: 'INFUSION', diluent: 'Dextrose 5%', volume: 250, minutes: 60, rounding: 'NEAREST_10' },
    ],
  );
  const PEMBRO = await protocol(
    {
      code: 'DEMO-PEMBRO', name: 'Pembrolizumab-like demonstration protocol', cancerType: 'Lung', intent: 'PALLIATIVE', cycleLength: 21,
      cycles: 35, duration: 60, labs: ['HB', 'ANC', 'PLT', 'CREAT', 'ALT', 'AST', 'BILI', 'TSH'],
    },
    [{ seq: 1, catalog: 'Pembrolizumab', name: 'Pembrolizumab', dose: 200, unit: 'MG', method: 'INFUSION', diluent: 'Sodium chloride 0.9%', volume: null, minutes: 30 }],
  );

  // ------------------------------------------------------------------ patients
  interface Pt {
    key: string; first: string; last: string; ar: string; sex: 'MALE' | 'FEMALE'; dob: string; mrn: string; phone: string | null;
    gov: string; lang: 'ar' | 'en'; height: number; weight: number; physician: Actor; nka?: boolean;
    allergies?: { allergen: string; reaction: string; severity: string; type?: string }[];
    dx: { primary: string; type: string; icd: string; histology: string; stage: string; biomarkers: string; daysAgo: number };
    emergency: [string, string, string];
  }
  const P: Pt[] = [
    { key: 'sara', first: 'Sara', last: 'Hassan', ar: 'سارة حسن', sex: 'FEMALE', dob: '1974-03-12', mrn: 'DEMO-102', phone: '+964 770 000 0102', gov: 'Baghdad', lang: 'ar', height: 162, weight: 64, physician: DR,
      allergies: [{ allergen: 'Iodinated contrast media', reaction: 'Urticaria', severity: 'MODERATE', type: 'OTHER' }],
      dx: { primary: 'Non-small cell lung cancer (adenocarcinoma)', type: 'Lung', icd: 'C34.1', histology: 'Adenocarcinoma', stage: 'Stage IV (cT2N2M1b)', biomarkers: 'PD-L1 TPS 60%; EGFR/ALK negative (demo)', daysAgo: 110 },
      emergency: ['Hassan Ali', '+964 770 000 1102', 'Husband'] },
    { key: 'omar', first: 'Omar', last: 'Kareem', ar: 'عمر كريم', sex: 'MALE', dob: '1965-07-02', mrn: 'DEMO-103', phone: '+964 771 000 0103', gov: 'Basra', lang: 'ar', height: 176, weight: 71, physician: DR,
      allergies: [{ allergen: 'Paclitaxel', reaction: 'Mild flushing during cycle 1 infusion', severity: 'MILD', type: 'DRUG' }],
      dx: { primary: 'Non-small cell lung cancer (squamous)', type: 'Lung', icd: 'C34.3', histology: 'Squamous cell carcinoma', stage: 'Stage IIIB', biomarkers: 'PD-L1 TPS 10% (demo)', daysAgo: 45 },
      emergency: ['Mariam Kareem', '+964 771 000 1103', 'Daughter'] },
    { key: 'zainab', first: 'Zainab', last: 'Abbas', ar: 'زينب عباس', sex: 'FEMALE', dob: '1981-11-20', mrn: 'DEMO-104', phone: '+964 780 000 0104', gov: 'Najaf', lang: 'ar', height: 158, weight: 60, physician: DR, nka: true,
      dx: { primary: 'Adenocarcinoma of sigmoid colon', type: 'Colorectal', icd: 'C18.7', histology: 'Adenocarcinoma, moderately differentiated', stage: 'Stage III (pT3N1aM0)', biomarkers: 'MSS; RAS wild-type (demo)', daysAgo: 60 },
      emergency: ['Abbas Mohammed', '+964 780 000 1104', 'Father'] },
    { key: 'mustafa', first: 'Mustafa', last: 'Jaber', ar: 'مصطفى جابر', sex: 'MALE', dob: '1968-01-15', mrn: 'DEMO-105', phone: '+964 750 000 0105', gov: 'Erbil', lang: 'en', height: 172, weight: 82, physician: DR2, nka: true,
      dx: { primary: 'Adenocarcinoma of ascending colon', type: 'Colorectal', icd: 'C18.2', histology: 'Adenocarcinoma', stage: 'Stage III (pT4aN1bM0)', biomarkers: 'MSS (demo)', daysAgo: 95 },
      emergency: ['Sana Jaber', '+964 750 000 1105', 'Wife'] },
    { key: 'fatima', first: 'Fatima', last: 'Mahdi', ar: 'فاطمة مهدي', sex: 'FEMALE', dob: '1969-05-30', mrn: 'DEMO-106', phone: '+964 770 000 0106', gov: 'Karbala', lang: 'ar', height: 160, weight: 68, physician: DR, nka: true,
      dx: { primary: 'High-grade serous ovarian carcinoma', type: 'Ovarian', icd: 'C56.9', histology: 'High-grade serous carcinoma', stage: 'FIGO IIIC', biomarkers: 'BRCA1/2 negative (demo)', daysAgo: 80 },
      emergency: ['Mahdi Salih', '+964 770 000 1106', 'Brother'] },
    { key: 'hussein', first: 'Hussein', last: 'Kadhim', ar: 'حسين كاظم', sex: 'MALE', dob: '1960-09-09', mrn: 'DEMO-107', phone: '+964 781 000 0107', gov: 'Babil', lang: 'ar', height: 170, weight: 75, physician: DR2, nka: true,
      dx: { primary: 'Non-small cell lung cancer (adenocarcinoma)', type: 'Lung', icd: 'C34.9', histology: 'Adenocarcinoma', stage: 'Stage IV', biomarkers: 'PD-L1 TPS 80% (demo)', daysAgo: 70 },
      emergency: ['Kadhim Hussein', '+964 781 000 1107', 'Son'] },
    { key: 'ali', first: 'Ali', last: 'Rahim', ar: 'علي رحيم', sex: 'MALE', dob: '1977-12-01', mrn: 'DEMO-108', phone: '0770-12', gov: 'Diyala', lang: 'ar', height: 180, weight: 88, physician: DR,
      allergies: [{ allergen: 'Penicillin', reaction: 'Rash', severity: 'MODERATE', type: 'DRUG' }],
      dx: { primary: 'Adenocarcinoma of rectosigmoid junction', type: 'Colorectal', icd: 'C19', histology: 'Adenocarcinoma', stage: 'Stage III', biomarkers: 'MSS (demo)', daysAgo: 120 },
      emergency: ['Rahim Jassim', '+964 770 000 1108', 'Father'] },
    { key: 'maryam', first: 'Maryam', last: 'Yousif', ar: 'مريم يوسف', sex: 'FEMALE', dob: '1986-04-18', mrn: 'DEMO-109', phone: '+964 790 000 0109', gov: 'Nineveh', lang: 'en', height: 165, weight: 58, physician: DR2, nka: true,
      dx: { primary: 'Adenocarcinoma of transverse colon', type: 'Colorectal', icd: 'C18.4', histology: 'Adenocarcinoma', stage: 'Stage III (pT3N1bM0)', biomarkers: 'MSS (demo)', daysAgo: 250 },
      emergency: ['Yousif Hanna', '+964 790 000 1109', 'Father'] },
    { key: 'karrar', first: 'Karrar', last: 'Abdulameer', ar: 'كرار عبد الأمير', sex: 'MALE', dob: '1971-02-25', mrn: 'DEMO-110', phone: '+964 772 000 0110', gov: 'Wasit', lang: 'ar', height: 168, weight: 70, physician: DR, nka: true,
      dx: { primary: 'Non-small cell lung cancer (adenocarcinoma)', type: 'Lung', icd: 'C34.1', histology: 'Adenocarcinoma', stage: 'Stage IV', biomarkers: 'PD-L1 TPS 55% (demo)', daysAgo: 150 },
      emergency: ['Zahra Ali', '+964 772 000 1110', 'Wife'] },
    { key: 'noor', first: 'Noor', last: 'Salman', ar: 'نور سلمان', sex: 'FEMALE', dob: '1963-08-08', mrn: 'DEMO-111', phone: '+964 773 000 0111', gov: 'Anbar', lang: 'ar', height: 155, weight: 62, physician: DR, nka: true,
      dx: { primary: 'High-grade serous ovarian carcinoma', type: 'Ovarian', icd: 'C56.9', histology: 'High-grade serous carcinoma', stage: 'FIGO IV', biomarkers: 'BRCA pending (demo)', daysAgo: 20 },
      emergency: ['Salman Dawood', '+964 773 000 1111', 'Husband'] },
  ];

  const patientIds: Record<string, string> = {};
  const diagnosisIds: Record<string, string> = {};
  for (const p of P) {
    const created = addDays(today, -(p.dx.daysAgo - 5));
    const row = await q1(
      db,
      `INSERT INTO patients (mrn, first_name, last_name, full_name_ar, date_of_birth, sex, phone, governorate, address, preferred_language,
          emergency_contact_name, emergency_contact_phone, emergency_contact_relation, no_known_allergies, primary_oncologist_id,
          height_cm, weight_kg, is_demo, created_by, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,true,$18,$19) RETURNING id`,
      [p.mrn, p.first, p.last, p.ar, p.dob, p.sex, p.phone, p.gov, `${p.gov} (demo address)`, p.lang, ...p.emergency, !!p.nka,
        p.physician.id, p.height, p.weight, DEMO_USER_IDS.reception, at(created, '09:15')],
    );
    patientIds[p.key] = row.id;
    for (const a of p.allergies ?? []) {
      await db.query(
        `INSERT INTO allergies (patient_id, allergen, allergen_type, reaction, severity, recorded_by, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [row.id, a.allergen, a.type ?? 'DRUG', a.reaction, a.severity, DEMO_USER_IDS.nurse, at(created, '09:30')],
      );
    }
    const dx = await q1(
      db,
      `INSERT INTO diagnoses (patient_id, primary_cancer, cancer_type, icd10_code, histology, stage, biomarkers, diagnosis_date, oncologist_id,
                              created_by, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9,$10) RETURNING id`,
      [row.id, p.dx.primary, p.dx.type, p.dx.icd, p.dx.histology, p.dx.stage, p.dx.biomarkers, addDays(today, -p.dx.daysAgo), p.physician.id, at(created, '11:00')],
    );
    diagnosisIds[p.key] = dx.id;
    await db.query(
      `INSERT INTO audit_logs (occurred_at, user_id, user_email, user_role, action, entity_type, entity_id, patient_id, description, new_value)
       VALUES ($1,$2,'reception@demo.local','RECEPTION','PATIENT_CREATED','patient',$3::text,$3::uuid,$4,$5)`,
      [at(created, '09:15'), DEMO_USER_IDS.reception, row.id, `${p.mrn} (demo seed)`, JSON.stringify({ mrn: p.mrn, name: `${p.first} ${p.last}` })],
    );
  }
  const pt = (k: string) => P.find((x) => x.key === k)!;

  // ------------------------------------------------------------------ helpers
  async function insertLabs(patientId: string, date: string, overrides: Record<string, number> = {}, codes = Object.keys(STANDARD_LABS)) {
    const defs = await q(db, 'SELECT * FROM lab_test_definitions');
    for (const code of [...new Set([...codes, ...Object.keys(overrides)])]) {
      const def = defs.find((d) => d.code === code);
      if (!def) continue;
      const [base, spread, dp] = STANDARD_LABS[code] ?? [2.0, 0.3, 2];
      const value = overrides[code] ?? jitter(base, spread, dp);
      await db.query(
        `INSERT INTO laboratory_results (patient_id, test_code, value, unit, ref_low, ref_high, collected_at, source, entered_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'DEMO',$8)`,
        [patientId, code, value, def.unit, def.ref_low, def.ref_high, at(date, '08:30'), DEMO_USER_IDS.nurse],
      );
    }
  }

  async function createPlan(key: string, proto: any, startDate: string, physician: Actor) {
    const plan = await q1(
      db,
      `INSERT INTO treatment_plans (patient_id, diagnosis_id, protocol_id, intent, cycle_length_days, planned_cycles, start_date,
          planned_end_date, next_cycle, next_day, next_due_date, physician_id, created_by, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,1,1,$7,$9,$9,$10) RETURNING *`,
      [patientIds[key], diagnosisIds[key], proto.id, proto.intent, proto.cycle_length_days, proto.planned_cycles, startDate,
        addDays(startDate, (proto.planned_cycles - 1) * proto.cycle_length_days), physician.id, at(addDays(startDate, -5), '13:00')],
    );
    await db.query(
      `INSERT INTO audit_logs (occurred_at, user_id, user_email, user_role, action, entity_type, entity_id, patient_id, description)
       VALUES ($1,$2,$3,'PHYSICIAN','TREATMENT_PLAN_CREATED','treatment_plan',$4,$5,$6)`,
      [at(addDays(startDate, -5), '13:00'), physician.id, physician.email, plan.id, patientIds[key], `${proto.name} (demo seed)`],
    );
    return plan;
  }

  const lastDoses: Record<string, Record<string, number>> = {};
  let rotatingChair = 0;

  /** Inserts a fully documented, completed historical cycle (direct SQL, back-dated). */
  async function historicalCycle(key: string, plan: any, proto: any, cycle: number, date: string, o: {
    weight: number; gfr?: number; pct?: Record<string, [number, string]>; reaction?: string; labs?: Record<string, number>; slot?: string; nurse?: Actor;
  }) {
    const p = pt(key);
    const patientId = patientIds[key];
    const nurse = o.nurse ?? (cycle % 2 ? RN : RN2);
    await insertLabs(patientId, addDays(date, -1), o.labs, proto.required_labs.concat(['WBC']));
    const bsa = bsaMosteller(p.height, o.weight);
    const slot = o.slot ?? ['08:00', '08:30', '09:00', '09:30'][cycle % 4];
    const chairId = chair((rotatingChair++ % 6) + 1);
    const t0 = timeToMinutes(slot);
    const ts = (offsetMin: number) => at(date, minutesToTime(t0 + offsetMin));
    const items = proto.drugs.map((d: any) => {
      const [pct, reason] = o.pct?.[d.drug_name] ?? [100, null];
      const rule = d.rounding_rule ?? proto.default_rounding_rule;
      const c = calculateDose({ doseValue: Number(d.dose_value), doseUnit: d.dose_unit, bsa, weightKg: o.weight, gfr: o.gfr ?? null, dosePercent: pct, roundingRule: rule });
      if (!c.ok) throw new Error(`seed calc failed ${d.drug_name}: ${c.error}`);
      return { d, c, pct, reason, rule };
    });
    // Admin timeline: sequential infusions (continuous infusion starts last and runs 46 h)
    let cursor = 45;
    const adminTimes = items.map(({ d }: any) => {
      const start = cursor;
      const dur = d.administration_method === 'BOLUS' ? 5 : d.infusion_duration_min ?? 30;
      const end = start + dur;
      if (d.administration_method !== 'CONTINUOUS_INFUSION') cursor = end + 5;
      return { start, end };
    });
    const sessionEnd = Math.max(...adminTimes.map((t: any, i: number) => (items[i].d.administration_method === 'CONTINUOUS_INFUSION' ? t.start + 10 : t.end))) + 5;
    const order = await q1(
      db,
      `INSERT INTO treatment_orders (patient_id, treatment_plan_id, protocol_id, diagnosis_id, protocol_name, protocol_version, intent,
          cycle_number, day_number, planned_date, height_cm, weight_kg, bsa_m2, gfr_ml_min, gfr_source, status, premedications, hydration,
          supportive_medications, special_instructions, warnings, prescribed_by, prescribed_at, submitted_by, submitted_at, approved_by, approved_at,
          released_by, released_at, prepared_by, prepared_at, nurse_verified_by, nurse_verified_at, pretreatment_checklist,
          treatment_started_by, treatment_started_at, completed_by, completed_at, treatment_duration_min, adverse_event, adverse_event_details,
          disposition, created_by, created_at)
       VALUES ($1,$2,$3,$4,$5,1,$6,$7,1,$8,$9,$10,$11,$12,$13,'COMPLETED',$14,$15,$16,$17,'[]',$18,$19,$18,$19,$18,$20,$21,$22,$21,$23,$21,$24,$25,
               $21,$26,$21,$27,$28,$29,$30,'HOME',$18,$19) RETURNING id`,
      [patientId, plan.id, proto.id, diagnosisIds[key], proto.name, proto.intent, cycle, date, p.height, o.weight, bsa, o.gfr ?? null,
        o.gfr ? 'Cockcroft–Gault estimate (demo)' : null, proto.premedications, proto.hydration, proto.supportive_medications,
        proto.special_instructions, plan.physician_id, at(addDays(date, -1), '14:00'), at(addDays(date, -1), '16:30'), nurse.id, ts(5), ts(35),
        ts(40), JSON.stringify({ items: Object.fromEntries(s.pretreatment_checklist.map((c) => [c.id, true])), completedAt: ts(40), by: nurse.id }),
        ts(45), ts(sessionEnd), sessionEnd - 45, !!o.reaction, o.reaction ?? null],
    );
    const prev = lastDoses[key] ?? {};
    for (let i = 0; i < items.length; i++) {
      const { d, c, pct, reason, rule } = items[i];
      const item = await q1(
        db,
        `INSERT INTO treatment_order_items (treatment_order_id, protocol_drug_id, drug_id, sequence, drug_name, dose_value, dose_unit,
            dose_basis_value, calculated_dose, dose_percent, rounding_rule, rounded_dose, final_dose, dose_modification_reason,
            calculation_formula, previous_final_dose, route, administration_method, diluent, final_volume_ml, infusion_duration_min,
            premedication_required, special_instructions)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22) RETURNING id`,
        [order.id, d.id, d.drug_id, d.sequence, d.drug_name, d.dose_value, d.dose_unit, c.basisValue, c.calculatedDose, pct, rule,
          c.roundedDose, reason, c.formula, prev[d.drug_name] ?? null, d.route, d.administration_method, d.diluent, d.final_volume_ml,
          d.infusion_duration_min, d.premedication_required, d.special_instructions],
      );
      const t = adminTimes[i];
      const isCi = d.administration_method === 'CONTINUOUS_INFUSION';
      const reacted = o.reaction && d.drug_name === 'Paclitaxel';
      await db.query(
        `INSERT INTO administrations (treatment_order_id, treatment_order_item_id, patient_id, sequence, drug_name, planned_dose,
            dose_administered, route, diluent, volume_ml, planned_duration_min, status, start_time, end_time, started_by, completed_by,
            reaction, reaction_details, notes, total_paused_seconds)
         VALUES ($1,$2,$3,$4,$5,$6,$6,$7,$8,$9,$10,'COMPLETED',$11,$12,$13,$13,$14,$15,$16,$17)`,
        [order.id, item.id, patientId, d.sequence, d.drug_name, c.roundedDose, d.route, d.diluent, d.final_volume_ml, d.infusion_duration_min,
          ts(t.start), isCi ? new Date(ts(t.start).getTime() + 2760 * 60000) : ts(t.end + (reacted ? 15 : 0)), nurse.id, !!reacted,
          reacted ? o.reaction : null, isCi ? 'Ambulatory pump connected in unit; disconnected at 46 h (demo)' : null, reacted ? 900 : 0],
      );
      prev[d.drug_name] = c.roundedDose!;
    }
    lastDoses[key] = prev;
    if (o.reaction) {
      await db.query(
        `INSERT INTO treatment_events (patient_id, treatment_order_id, event_type, severity, description, action_taken, physician_notified, occurred_at, reported_by)
         VALUES ($1,$2,'INFUSION_REACTION','MILD',$3,'Infusion paused 15 min, resumed after physician review (demo)',true,$4,$5)`,
        [patientId, order.id, o.reaction, ts(70), nurse.id],
      );
    }
    const appt = await q1(
      db,
      `INSERT INTO appointments (patient_id, treatment_plan_id, treatment_order_id, protocol_id, cycle_number, day_number, appointment_type,
          appointment_date, start_time, duration_minutes, chair_id, physician_id, status, confirmation_source, confirmed_at, arrived_at,
          checked_in_by, created_by, created_at)
       VALUES ($1,$2,$3,$4,$5,1,$6,$7,$8,$9,$10,$11,'COMPLETED','WHATSAPP',$12,$13,$14,$14,$15) RETURNING id`,
      [patientId, plan.id, order.id, proto.id, cycle, proto.code === 'DEMO-PEMBRO' ? 'IMMUNOTHERAPY' : 'CHEMOTHERAPY', date, slot,
        proto.estimated_duration_min, chairId, plan.physician_id, at(addDays(date, -5), '19:20'), ts(-10), DEMO_USER_IDS.reception,
        at(addDays(date, -7), '10:00')],
    );
    await db.query(
      `INSERT INTO vital_signs (patient_id, treatment_order_id, appointment_id, phase, measured_at, bp_systolic, bp_diastolic, heart_rate,
                                resp_rate, temperature_c, spo2, weight_kg, pain_score, recorded_by)
       VALUES ($1,$2,$3,'PRE',$4,$5,$6,$7,16,$8,$9,$10,0,$11), ($1,$2,$3,'POST',$12,$13,$14,$15,16,$16,$17,NULL,0,$11)`,
      [patientId, order.id, appt.id, ts(10), Math.round(jitter(124, 8)), Math.round(jitter(78, 6)), Math.round(jitter(78, 8)), jitter(36.8, 0.2),
        Math.round(jitter(98, 1)), o.weight, nurse.id, ts(sessionEnd - 5), Math.round(jitter(120, 8)), Math.round(jitter(76, 6)),
        Math.round(jitter(76, 8)), jitter(36.8, 0.2), Math.round(jitter(98, 1))],
    );
    await db.query(
      `INSERT INTO notifications (patient_id, appointment_id, notification_type, recipient, language, message_body, interactive_options, status,
          scheduled_for, sent_at, delivered_at, read_at, provider, provider_message_id, patient_response, responded_at, attempts, created_by, created_at)
       VALUES ($1,$2,'APPOINTMENT_CREATED',$3,$4,$5,$6,'READ',$7,$7,$7,$8,'mock_whatsapp',$9,'CONFIRM',$10,1,$11,$7),
              ($1,$2,'REMINDER_24H',$3,$4,$5,NULL,'READ',$12,$12,$12,$13,'mock_whatsapp',$14,NULL,NULL,1,$11,$12)`,
      [patientId, appt.id, p.phone, p.lang, `[Demo archive] Appointment reminder for ${date} ${slot}`,
        JSON.stringify({ options: [{ id: 'CONFIRM', title: 'Confirm Appointment' }, { id: 'RESCHEDULE', title: 'Request Reschedule' }, { id: 'CANCEL', title: 'Cancel' }] }),
        at(addDays(date, -7), '10:00'), at(addDays(date, -7), '12:00'), `mock.wamid.seed-${order.id}-a`, at(addDays(date, -5), '19:20'),
        DEMO_USER_IDS.reception, new Date(at(date, slot).getTime() - 24 * 3600000), new Date(at(date, slot).getTime() - 23 * 3600000),
        `mock.wamid.seed-${order.id}-b`],
    );
    return order.id;
  }

  async function finishPlan(planId: string, current: number, completed: number, nextCycle: number | null, nextDue: string | null, status = 'ACTIVE') {
    await db.query(
      `UPDATE treatment_plans SET current_cycle=$2, current_day=1, cycles_completed=$3, next_cycle=$4, next_day=CASE WHEN $4::int IS NULL THEN NULL ELSE 1 END,
              next_due_date=$5, status=$6 WHERE id=$1`,
      [planId, current, completed, nextCycle, nextDue, status],
    );
  }

  const gfrFor = (key: string, weight: number, creat: number) =>
    cockcroftGault({ ageYears: ageFrom(pt(key).dob, today), weightKg: weight, sex: pt(key).sex, creatinineMgDl: creat })!;

  // ------------------------------------------------------------------ treatment histories
  // Sara — pembrolizumab-like, C1–C4 done, C5 today (in treatment)
  const saraPlan = await createPlan('sara', PEMBRO, addDays(today, -84), DR);
  for (let c = 1; c <= 4; c++) await historicalCycle('sara', saraPlan, PEMBRO, c, addDays(today, -84 + (c - 1) * 21), { weight: 64 - (c > 2 ? 1 : 0), labs: { TSH: jitter(2.1, 0.5, 2) } });
  await finishPlan(saraPlan.id, 4, 4, 5, today);

  // Omar — carbo/pacli-like, C1 (reaction), C2 today: weight 78 → 71, eGFR low
  const omarPlan = await createPlan('omar', CARBOPACLI, addDays(today, -21), DR);
  await historicalCycle('omar', omarPlan, CARBOPACLI, 1, addDays(today, -21), { weight: 78, gfr: gfrFor('omar', 78, 1.1), reaction: 'Mild flushing and chest tightness at 20 min of paclitaxel infusion (demo)', labs: { CREAT: 1.1, EGFR: 70 } });
  await finishPlan(omarPlan.id, 1, 1, 2, today);

  // Zainab — FOLFOX-like C1–C2, C3 today (completed)
  const zainabPlan = await createPlan('zainab', FOLFOX, addDays(today, -28), DR);
  for (let c = 1; c <= 2; c++) await historicalCycle('zainab', zainabPlan, FOLFOX, c, addDays(today, -28 + (c - 1) * 14), { weight: 60 });
  await finishPlan(zainabPlan.id, 2, 2, 3, today);

  // Mustafa — FOLFOX-like C1–C5 (oxaliplatin 80 % from C4), C6 today (in preparation)
  const mustafaPlan = await createPlan('mustafa', FOLFOX, addDays(today, -70), DR2);
  for (let c = 1; c <= 5; c++) {
    await historicalCycle('mustafa', mustafaPlan, FOLFOX, c, addDays(today, -70 + (c - 1) * 14), {
      weight: 82 - Math.floor(c / 2),
      pct: c >= 4 ? { Oxaliplatin: [80, 'Grade 2 peripheral sensory neuropathy — dose reduced by physician (demo)'] } : undefined,
    });
  }
  await finishPlan(mustafaPlan.id, 5, 5, 6, today);

  // Fatima — carbo/pacli-like C1–C3, C4 today (arrived, labs missing)
  const fatimaPlan = await createPlan('fatima', CARBOPACLI, addDays(today, -63), DR);
  for (let c = 1; c <= 3; c++) await historicalCycle('fatima', fatimaPlan, CARBOPACLI, c, addDays(today, -63 + (c - 1) * 21), { weight: 68, gfr: gfrFor('fatima', 68, 0.8), labs: { CREAT: 0.8 } });
  await finishPlan(fatimaPlan.id, 3, 3, 4, today);

  // Hussein — pembrolizumab-like C1–C2, C3 today (order pending review)
  const husseinPlan = await createPlan('hussein', PEMBRO, addDays(today, -42), DR2);
  for (let c = 1; c <= 2; c++) await historicalCycle('hussein', husseinPlan, PEMBRO, c, addDays(today, -42 + (c - 1) * 21), { weight: 75, labs: { TSH: 1.8 } });
  await finishPlan(husseinPlan.id, 2, 2, 3, today);

  // Ali — FOLFOX-like C1–C7, C8 delayed (cancelled today)
  const aliPlan = await createPlan('ali', FOLFOX, addDays(today, -98), DR);
  for (let c = 1; c <= 7; c++) await historicalCycle('ali', aliPlan, FOLFOX, c, addDays(today, -98 + (c - 1) * 14), { weight: 88 });
  await finishPlan(aliPlan.id, 7, 7, 8, today);

  // Maryam — FOLFOX-like 12 cycles completed (follow-up)
  const maryamPlan = await createPlan('maryam', FOLFOX, addDays(today, -230), DR2);
  for (let c = 1; c <= 12; c++) await historicalCycle('maryam', maryamPlan, FOLFOX, c, addDays(today, -230 + (c - 1) * 14), { weight: 58 });
  await finishPlan(maryamPlan.id, 12, 12, null, null, 'COMPLETED');
  await db.query(`UPDATE patients SET status='TREATMENT_COMPLETED' WHERE id=$1`, [patientIds.maryam]);

  // Karrar — pembrolizumab-like C1–C6, C7 held (LFT elevation)
  const karrarPlan = await createPlan('karrar', PEMBRO, addDays(today, -133), DR);
  for (let c = 1; c <= 6; c++) await historicalCycle('karrar', karrarPlan, PEMBRO, c, addDays(today, -133 + (c - 1) * 21), { weight: 70, labs: { TSH: 2.4 } });
  await finishPlan(karrarPlan.id, 6, 6, 7, addDays(today, -7));

  // Noor — new patient, carbo/pacli-like C1 tomorrow
  const noorPlan = await createPlan('noor', CARBOPACLI, addDays(today, 1), DR);
  await finishPlan(noorPlan.id, 0, 0, 1, addDays(today, 1));

  // Extra historical cancellations / no-show for reports
  for (const [key, plan, proto, daysAgo, status, reason] of [
    ['sara', saraPlan, PEMBRO, 64, 'CANCELLED', 'Patient travelling — rebooked next day (demo)'],
    ['mustafa', mustafaPlan, FOLFOX, 43, 'NO_SHOW', null],
    ['ali', aliPlan, FOLFOX, 57, 'CANCELLED', 'Transport problem — rebooked (demo)'],
  ] as const) {
    await db.query(
      `INSERT INTO appointments (patient_id, treatment_plan_id, protocol_id, appointment_date, start_time, duration_minutes, chair_id, physician_id,
          status, cancel_reason, cancelled_at, cancelled_by, created_by, created_at)
       VALUES ($1,$2,$3,$4,'11:00',$5,$6,$7,$8,$9,$10,$11,$11,$12)`,
      [patientIds[key], (plan as any).id, (proto as any).id, addDays(today, -daysAgo), (proto as any).estimated_duration_min, chair(6),
        (plan as any).physician_id, status, reason, status === 'CANCELLED' ? at(addDays(today, -daysAgo - 1), '15:00') : null,
        DEMO_USER_IDS.reception, at(addDays(today, -daysAgo - 7), '10:00')],
    );
  }

  // ------------------------------------------------------------------ today's schedule (through the real service layer)
  const nowLocal = timeToMinutes(timeInTz(tz));
  const base = Math.min(Math.max(Math.floor(nowLocal / 15) * 15, 10 * 60), 14 * 60);
  const slot = (offset: number) => minutesToTime(base + offset);
  const checklistAll = Object.fromEntries(s.pretreatment_checklist.map((c) => [c.id, true]));

  async function todaysLabs(key: string, overrides: Record<string, number> = {}) {
    const proto = key === 'sara' || key === 'hussein' ? PEMBRO : key === 'omar' || key === 'fatima' || key === 'noor' ? CARBOPACLI : FOLFOX;
    await insertLabs(patientIds[key], addDays(today, -1), overrides, proto.required_labs.concat(['WBC']));
  }

  async function book(key: string, plan: any, cycle: number, date: string, time: string, chairNo: number | null, by: Actor = RC, duration?: number) {
    return appts.createAppointment(
      db,
      { patientId: patientIds[key], treatmentPlanId: plan.id, cycleNumber: cycle, dayNumber: 1, appointmentDate: date, startTime: time, chairId: chairNo ? chair(chairNo) : null, durationMinutes: duration },
      by,
    );
  }

  async function order(key: string, plan: any, cycle: number, date: string, weight: number, prescriber: Actor, extra: Partial<orders.OrderInput> = {}) {
    const o = await orders.createOrder(
      db,
      { treatmentPlanId: plan.id, cycleNumber: cycle, dayNumber: 1, plannedDate: date, heightCm: pt(key).height, weightKg: weight, ...extra },
      prescriber,
      true,
    );
    return o.id as string;
  }

  const markMessagesRead = async (appointmentId: string, response: 'CONFIRM' | null) => {
    await db.query(
      `UPDATE notifications SET status='READ', sent_at=created_at, delivered_at=created_at + interval '1 minute', read_at=created_at + interval '5 minutes',
              provider_message_id='mock.wamid.seed-' || id, attempts=1,
              patient_response=$2, responded_at = CASE WHEN $2::text IS NULL THEN NULL ELSE created_at + interval '6 minutes' END
        WHERE appointment_id=$1 AND notification_type IN ('APPOINTMENT_CREATED','APPOINTMENT_RESCHEDULED')`,
      [appointmentId, response],
    );
    if (response === 'CONFIRM') await db.query(`UPDATE appointments SET status='CONFIRMED', confirmation_source='WHATSAPP', confirmed_at=now() - interval '1 day' WHERE id=$1 AND status='SCHEDULED'`, [appointmentId]);
  };

  // Zainab — C3 completed this morning on Chair 1
  await todaysLabs('zainab');
  const zAppt = await book('zainab', zainabPlan, 3, today, slot(-150), 1, RC, 240);
  await markMessagesRead(zAppt.id, 'CONFIRM');
  const zOrder = await order('zainab', zainabPlan, 3, today, 60, DR);
  await orders.approveOrder(db, zOrder, DR, { acknowledgeWarnings: true, note: 'Labs reviewed (demo).' });
  await appts.checkInAppointment(db, zAppt.id, RC);
  await orders.releaseForPreparation(db, zOrder, RN);
  await orders.markPrepared(db, zOrder, RN2);
  await addVitals(db, patientIds.zainab, { phase: 'PRE', treatmentOrderId: zOrder, bpSystolic: 118, bpDiastolic: 74, heartRate: 76, respRate: 16, temperatureC: 36.7, spo2: 99, weightKg: 60, painScore: 0 }, RN);
  await orders.verifyOrder(db, zOrder, RN, checklistAll);
  await orders.startTreatment(db, zOrder, RN);
  for (const a of await q(db, 'SELECT id, drug_name FROM administrations WHERE treatment_order_id=$1 ORDER BY sequence', [zOrder])) {
    await orders.administrationAction(db, a.id, 'start', RN, {});
    if (!a.drug_name.includes('46-h')) await orders.administrationAction(db, a.id, 'complete', RN, { observations: 'Tolerated well (demo)' });
  }
  await addVitals(db, patientIds.zainab, { phase: 'POST', treatmentOrderId: zOrder, bpSystolic: 116, bpDiastolic: 72, heartRate: 74, temperatureC: 36.8, spo2: 99 }, RN);
  await orders.completeTreatment(db, zOrder, RN, { adverseEvent: false, notes: 'Ambulatory pump connected; patient discharged home (demo).', disposition: 'HOME' });
  // Back-date today's timestamps so the timeline is realistic
  await db.query(
    `UPDATE treatment_orders SET prescribed_at=$2, submitted_at=$2, approved_at=$3, released_at=$4, prepared_at=$5, nurse_verified_at=$6,
            treatment_started_at=$7, completed_at=$8, treatment_duration_min=round(extract(epoch FROM ($8::timestamptz - $7::timestamptz))/60) WHERE id=$1`,
    [zOrder, at(addDays(today, -1), '13:10'), at(addDays(today, -1), '15:40'), minsAgo(235), minsAgo(215), minsAgo(208), minsAgo(200), minsAgo(20)],
  );
  await db.query(`UPDATE administrations SET start_time = $2::timestamptz + (sequence - 1) * interval '60 minutes', end_time = CASE WHEN status='COMPLETED' THEN $2::timestamptz + (sequence - 1) * interval '60 minutes' + interval '55 minutes' END WHERE treatment_order_id=$1`, [zOrder, minsAgo(198)]);
  await db.query(`UPDATE appointments SET arrived_at=$2 WHERE id=$1`, [zAppt.id, minsAgo(245)]);
  await db.query(`UPDATE vital_signs SET measured_at = CASE WHEN phase='PRE' THEN $2::timestamptz ELSE $3::timestamptz END WHERE treatment_order_id=$1`, [zOrder, minsAgo(210), minsAgo(22)]);
  await db.query(`UPDATE chairs SET status='CLEANING', status_note='Post-treatment cleaning', status_changed_by=$2 WHERE id=$1`, [chair(1), RN.id]);
  // Book Zainab's next cycle from the suggestion
  const zNext = await book('zainab', zainabPlan, 4, addDays(today, 14), '08:00', 1, RC, 240);
  await markMessagesRead(zNext.id, null);

  // Sara — C5 pembrolizumab in treatment on Chair 3
  await todaysLabs('sara', { TSH: 2.6 });
  const sAppt = await book('sara', saraPlan, 5, today, slot(-60), 3, RC, 60);
  await markMessagesRead(sAppt.id, 'CONFIRM');
  const sOrder = await order('sara', saraPlan, 5, today, 63, DR);
  await orders.approveOrder(db, sOrder, DR, { acknowledgeWarnings: true });
  await appts.checkInAppointment(db, sAppt.id, RC);
  await orders.releaseForPreparation(db, sOrder, RN);
  await orders.markPrepared(db, sOrder, RN2);
  await addVitals(db, patientIds.sara, { phase: 'PRE', treatmentOrderId: sOrder, bpSystolic: 126, bpDiastolic: 80, heartRate: 82, respRate: 16, temperatureC: 36.9, spo2: 97, weightKg: 63, painScore: 1 }, RN);
  await orders.verifyOrder(db, sOrder, RN, checklistAll);
  await orders.startTreatment(db, sOrder, RN);
  const sAdmin = await q1(db, 'SELECT id FROM administrations WHERE treatment_order_id=$1', [sOrder]);
  await orders.administrationAction(db, sAdmin.id, 'start', RN, {});
  await db.query(`UPDATE treatment_orders SET approved_at=$2, released_at=$3, prepared_at=$4, nurse_verified_at=$5, treatment_started_at=$6 WHERE id=$1`, [sOrder, at(addDays(today, -1), '15:00'), minsAgo(50), minsAgo(35), minsAgo(28), minsAgo(22)]);
  await db.query(`UPDATE administrations SET start_time=$2 WHERE id=$1`, [sAdmin.id, minsAgo(18)]);
  await db.query(`UPDATE appointments SET arrived_at=$2 WHERE id=$1`, [sAppt.id, minsAgo(70)]);
  await db.query(`UPDATE vital_signs SET measured_at=$2 WHERE treatment_order_id=$1`, [sOrder, minsAgo(40)]);

  // Omar — C2 carbo/pacli in treatment on Chair 4 (allergy match, weight/dose change, renal review, late start)
  await todaysLabs('omar', { CREAT: 1.35, EGFR: 55 });
  const oAppt = await book('omar', omarPlan, 2, today, slot(-120), 4, RC, 150);
  await markMessagesRead(oAppt.id, 'CONFIRM');
  const oOrder = await order('omar', omarPlan, 2, today, 71, DR, { gfr: gfrFor('omar', 71, 1.35), gfrSource: 'Cockcroft–Gault estimate from creatinine 1.35 mg/dL (demo)' });
  await orders.approveOrder(db, oOrder, DR, { acknowledgeWarnings: true, note: 'Prior mild paclitaxel reaction reviewed; premedication per policy. Weight loss noted (demo).' });
  await appts.checkInAppointment(db, oAppt.id, RC);
  await orders.releaseForPreparation(db, oOrder, RN2);
  await orders.markPrepared(db, oOrder, RN2);
  await addVitals(db, patientIds.omar, { phase: 'PRE', treatmentOrderId: oOrder, bpSystolic: 134, bpDiastolic: 84, heartRate: 88, respRate: 18, temperatureC: 36.8, spo2: 96, weightKg: 71, painScore: 2 }, RN2);
  await orders.verifyOrder(db, oOrder, RN2, checklistAll);
  await orders.startTreatment(db, oOrder, RN2);
  const oAdmin = await q1(db, `SELECT id FROM administrations WHERE treatment_order_id=$1 AND drug_name='Paclitaxel'`, [oOrder]);
  await orders.administrationAction(db, oAdmin.id, 'start', RN2, {});
  await addVitals(db, patientIds.omar, { phase: 'DURING', treatmentOrderId: oOrder, bpSystolic: 130, bpDiastolic: 82, heartRate: 84, temperatureC: 36.9, spo2: 97, notes: '15-min check — no reaction (demo)' }, RN2);
  await db.query(`UPDATE treatment_orders SET approved_at=$2, released_at=$3, prepared_at=$4, nurse_verified_at=$5, treatment_started_at=$6 WHERE id=$1`, [oOrder, at(addDays(today, -1), '16:00'), minsAgo(110), minsAgo(92), minsAgo(84), minsAgo(80)]);
  await db.query(`UPDATE administrations SET start_time=$2 WHERE id=$1`, [oAdmin.id, minsAgo(75)]);
  await db.query(`UPDATE appointments SET arrived_at=$2 WHERE id=$1`, [oAppt.id, minsAgo(125)]);
  await db.query(`UPDATE vital_signs SET measured_at = CASE WHEN phase='PRE' THEN $2::timestamptz ELSE $3::timestamptz END WHERE treatment_order_id=$1`, [oOrder, minsAgo(90), minsAgo(60)]);

  // Mustafa — C6 FOLFOX in preparation on Chair 5 (dose reduced, low platelets)
  await todaysLabs('mustafa', { PLT: 128 });
  const mAppt = await book('mustafa', mustafaPlan, 6, today, slot(-30), 5, RC, 240);
  await markMessagesRead(mAppt.id, 'CONFIRM');
  const oxali = FOLFOX.drugs.find((d: any) => d.drug_name === 'Oxaliplatin');
  const mOrder = await order('mustafa', mustafaPlan, 6, today, 79, DR2, {
    items: [{ protocolDrugId: oxali.id, dosePercent: 80, modificationReason: 'Grade 2 peripheral sensory neuropathy — continued 80% (demo)' }],
  });
  await orders.approveOrder(db, mOrder, DR2, { acknowledgeWarnings: true, note: 'Platelets 128 reviewed — proceed (demo).' });
  await appts.checkInAppointment(db, mAppt.id, RC);
  await orders.releaseForPreparation(db, mOrder, RN);
  await db.query(`UPDATE treatment_orders SET approved_at=$2, released_at=$3 WHERE id=$1`, [mOrder, at(today, '07:45'), minsAgo(12)]);
  await db.query(`UPDATE appointments SET arrived_at=$2 WHERE id=$1`, [mAppt.id, minsAgo(40)]);

  // Fatima — C4 carbo/pacli, arrived early for Chair 4 (still occupied) — labs missing
  const fAppt = await book('fatima', fatimaPlan, 4, today, slot(30), 4, RC, 300);
  await markMessagesRead(fAppt.id, 'CONFIRM');
  const fOrder = await order('fatima', fatimaPlan, 4, today, 68, DR, { gfr: gfrFor('fatima', 68, 0.8), gfrSource: 'Cockcroft–Gault estimate from previous creatinine 0.8 mg/dL (demo)' });
  await orders.approveOrder(db, fOrder, DR, { acknowledgeWarnings: true, note: 'Approved pending same-day CBC (demo).' });
  await appts.checkInAppointment(db, fAppt.id, RC);
  await db.query(`UPDATE treatment_orders SET approved_at=$2 WHERE id=$1`, [fOrder, at(addDays(today, -1), '17:10')]);
  await db.query(`UPDATE appointments SET arrived_at=$2 WHERE id=$1`, [fAppt.id, minsAgo(15)]);

  // Hussein — C3 pembrolizumab, order awaiting physician approval, appointment not confirmed
  await todaysLabs('hussein', { TSH: 1.9 });
  const hAppt = await book('hussein', husseinPlan, 3, today, slot(90), 3, RC, 60);
  await markMessagesRead(hAppt.id, null);
  await order('hussein', husseinPlan, 3, today, 74, DR2);

  // Ali — C8 appointment cancelled this morning (unwell); order delayed one week; rebooked (invalid phone → message fails)
  await todaysLabs('ali');
  const aAppt = await book('ali', aliPlan, 8, today, slot(0), 6, RC, 240);
  const aOrder = await order('ali', aliPlan, 8, today, 87, DR);
  await orders.approveOrder(db, aOrder, DR, { acknowledgeWarnings: true });
  await appts.cancelAppointment(db, aAppt.id, 'Patient unwell (fever) — requested to postpone (demo)', RC);
  await orders.holdOrder(db, aOrder, DR, 'Patient unwell — delay one week, physician review before treatment (demo)', 'DELAYED', addDays(today, 7));
  await book('ali', aliPlan, 8, addDays(today, 7), '10:00', 6, RC, 240);

  // Karrar — C7 held 7 days ago (liver enzymes)
  await insertLabs(patientIds.karrar, addDays(today, -8), { ALT: 142, AST: 118, TSH: 2.2 }, PEMBRO.required_labs.concat(['WBC']));
  const kOrder = await order('karrar', karrarPlan, 7, addDays(today, -7), 69, DR);
  await orders.approveOrder(db, kOrder, DR, { acknowledgeWarnings: true });
  await orders.holdOrder(db, kOrder, DR, 'ALT/AST elevation — treatment held pending physician review (demo)', 'HELD');
  await db.query(`UPDATE treatment_orders SET prescribed_at=$2, submitted_at=$2, approved_at=$2, held_at=$3 WHERE id=$1`, [kOrder, at(addDays(today, -8), '14:00'), at(addDays(today, -7), '09:00')]);
  await db.query(`UPDATE patients SET status='ON_HOLD' WHERE id=$1`, [patientIds.karrar]);
  await db.query(`UPDATE treatment_plans SET status='ON_HOLD' WHERE id=$1`, [karrarPlan.id]);

  // Noor — new patient, C1 tomorrow on Chair 2 (confirmed via WhatsApp), order pending review
  await insertLabs(patientIds.noor, today, { CREAT: 0.9 }, CARBOPACLI.required_labs.concat(['WBC']));
  const nAppt = await book('noor', noorPlan, 1, addDays(today, 1), '09:00', 2, RC, 300);
  await markMessagesRead(nAppt.id, 'CONFIRM');
  await order('noor', noorPlan, 1, addDays(today, 1), 62, DR, { gfr: gfrFor('noor', 62, 0.9), gfrSource: 'Cockcroft–Gault estimate from creatinine 0.9 mg/dL (demo)' });

  // Future cycles (calendar)
  for (const [key, plan, cycle, days, time, chairNo, dur] of [
    ['sara', saraPlan, 6, 21, '09:00', 3, 60],
    ['omar', omarPlan, 3, 21, '09:00', 4, 300],
    ['fatima', fatimaPlan, 5, 21, '11:30', 1, 300],
    ['hussein', husseinPlan, 4, 21, '12:30', 3, 60],
    ['mustafa', mustafaPlan, 7, 14, '09:30', 5, 240],
  ] as const) {
    const a = await book(key, plan, cycle, addDays(today, days), time, chairNo, RC, dur);
    await markMessagesRead(a.id, rand() > 0.5 ? 'CONFIRM' : null);
  }
  // Follow-up visit without a chair
  await appts.createAppointment(
    db,
    { patientId: patientIds.maryam, appointmentType: 'OTHER', appointmentDate: addDays(today, 3), startTime: '11:00', durationMinutes: 30, physicianId: DR2.id, notes: 'Post-treatment follow-up review (demo)' },
    RC,
  );

  // Clinical notes
  const notes: [string, Actor, string, string][] = [
    ['omar', DR, 'PHYSICIAN', 'C1 mild paclitaxel infusion reaction resolved after pause. Continue with premedication per policy; monitor closely during C2 (demo).'],
    ['omar', RN2, 'NURSING', 'Patient reports reduced appetite; weight 71 kg (was 78 kg at C1). Dietitian referral suggested to physician (demo).'],
    ['mustafa', DR2, 'PHYSICIAN', 'Grade 2 peripheral sensory neuropathy since C3 — oxaliplatin reduced to 80% from C4 (demo).'],
    ['karrar', DR, 'PHYSICIAN', 'ALT 142 / AST 118 — C7 held. Repeat LFTs in 1 week; review before next cycle (demo).'],
    ['sara', RN, 'NURSING', 'Tolerating treatment well. Contrast allergy re-confirmed with patient (demo).'],
    ['fatima', RN, 'NURSING', 'Arrived early today — CBC not yet available; physician informed (demo).'],
  ];
  for (const [key, a, type, content] of notes) {
    await db.query(`INSERT INTO patient_notes (patient_id, author_id, note_type, content, created_at) VALUES ($1,$2,$3,$4, now() - interval '3 hours')`, [patientIds[key], a.id, type, content]);
  }
  await db.query(`INSERT INTO patient_identifiers (patient_id, system, value) SELECT id, 'HOSPITAL_EMR', 'EMR-' || mrn FROM patients`);
  // Keep back-dated workflow timestamps chronological (prescribed → submitted → approved)
  await db.query(
    `UPDATE treatment_orders SET prescribed_at = approved_at - interval '95 minutes', submitted_at = approved_at - interval '90 minutes',
            created_at = approved_at - interval '95 minutes',
            warnings_acknowledged_at = CASE WHEN warnings_acknowledged_at IS NOT NULL THEN approved_at END
      WHERE approved_at IS NOT NULL AND approved_at < prescribed_at`,
  );
  log(`[seed] ${P.length} patients, 6 chairs, 3 demo protocols; today = ${today} (${tz}), base slot ${slot(0)}`);
}
