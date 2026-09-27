import { Db, pool, q } from '../db/pool';

export interface ChecklistItem {
  id: string;
  en: string;
  ar: string;
}

export interface UnitSettings {
  hospital_name: string;
  unit_name: string;
  unit_phone: string;
  timezone: string;
  default_language: 'en' | 'ar';
  languages_enabled: string[];
  units: { height: string; weight: string; creatinine: string; temperature: string };
  unit_open_time: string;
  unit_close_time: string;
  default_appointment_duration_min: number;
  arrival_minutes_before: number;
  delay_grace_minutes: number;
  chair_cleaning_after_treatment: boolean;
  reminder_24h_enabled: boolean;
  reminder_2h_enabled: boolean;
  reminder_same_day_enabled: boolean;
  reminder_same_day_time: string;
  whatsapp_template_en: string;
  whatsapp_template_ar: string;
  default_rounding_rule: string;
  dose_difference_threshold_pct: number;
  weight_change_threshold_pct: number;
  lab_validity_days: number;
  calvert_gfr_review_threshold: number;
  pretreatment_checklist: ChecklistItem[];
}

const DEFAULTS: UnitSettings = {
  hospital_name: 'Demo Private Hospital',
  unit_name: 'Chemotherapy Unit',
  unit_phone: '',
  timezone: 'Asia/Baghdad',
  default_language: 'en',
  languages_enabled: ['en', 'ar'],
  units: { height: 'cm', weight: 'kg', creatinine: 'mg/dL', temperature: '°C' },
  unit_open_time: '08:00',
  unit_close_time: '16:00',
  default_appointment_duration_min: 120,
  arrival_minutes_before: 30,
  delay_grace_minutes: 30,
  chair_cleaning_after_treatment: false,
  reminder_24h_enabled: true,
  reminder_2h_enabled: true,
  reminder_same_day_enabled: false,
  reminder_same_day_time: '07:00',
  whatsapp_template_en: '',
  whatsapp_template_ar: '',
  default_rounding_rule: 'NEAREST_1',
  dose_difference_threshold_pct: 10,
  weight_change_threshold_pct: 5,
  lab_validity_days: 7,
  calvert_gfr_review_threshold: 125,
  pretreatment_checklist: [],
};

let cache: { value: UnitSettings; at: number } | null = null;
const TTL_MS = 30_000;

export async function getSettings(db: Db = pool): Promise<UnitSettings> {
  if (cache && Date.now() - cache.at < TTL_MS && db === pool) return cache.value;
  const rows = await q<{ key: string; value: unknown }>(db, 'SELECT key, value FROM settings');
  const merged: any = { ...DEFAULTS };
  for (const r of rows) merged[r.key] = r.value;
  if (db === pool) cache = { value: merged, at: Date.now() };
  return merged;
}

export function invalidateSettingsCache() {
  cache = null;
}

export async function listSettingsRows(db: Db = pool) {
  return q(db, 'SELECT key, value, category, description, updated_at FROM settings ORDER BY category, key');
}

export async function updateSettings(db: Db, values: Record<string, unknown>, userId: string) {
  const previous: Record<string, unknown> = {};
  const current = await q<{ key: string; value: unknown }>(db, 'SELECT key, value FROM settings WHERE key = ANY($1)', [
    Object.keys(values),
  ]);
  for (const r of current) previous[r.key] = r.value;
  for (const [key, value] of Object.entries(values)) {
    await db.query(
      `INSERT INTO settings (key, value, updated_by, updated_at) VALUES ($1, $2::jsonb, $3, now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [key, JSON.stringify(value), userId],
    );
  }
  invalidateSettingsCache();
  return previous;
}
