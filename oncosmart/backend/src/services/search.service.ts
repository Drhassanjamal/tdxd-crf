import { pool, q } from '../db/pool';
import { AuthUser } from '../middleware/auth';
import { can } from '../utils/permissions';

/** Global search across patients (name, MRN, patient ID, phone), protocols and appointments. */
export async function globalSearch(term: string, user: AuthUser) {
  const t = term.trim();
  if (t.length < 2) return { patients: [], protocols: [], appointments: [] };
  const like = `%${t.toLowerCase()}%`;
  const digits = t.replace(/\D/g, '');
  const patients = await q(
    pool,
    `SELECT id, patient_code, mrn, first_name, last_name, full_name_ar, date_of_birth, sex, status
       FROM patients
      WHERE lower(first_name || ' ' || last_name) LIKE $1 OR lower(mrn) LIKE $1 OR lower(patient_code) LIKE $1
         OR coalesce(full_name_ar, '') LIKE $1
         OR ($2 <> '' AND length($2) >= 4 AND regexp_replace(coalesce(phone,''), '\\D', '', 'g') LIKE '%' || $2 || '%')
      ORDER BY last_name, first_name LIMIT 8`,
    [like, digits.slice(-9)],
  );
  const protocols = can(user.role, 'protocols.read')
    ? await q(pool, `SELECT id, code, name, cancer_type, is_demo FROM protocols WHERE lower(name) LIKE $1 OR lower(code) LIKE $1 ORDER BY name LIMIT 5`, [like])
    : [];
  const appointments = await q(
    pool,
    `SELECT a.id, a.appointment_number, a.appointment_date, a.start_time::text AS start_time, a.status, a.patient_id,
            p.first_name || ' ' || p.last_name AS patient_name, p.mrn
       FROM appointments a JOIN patients p ON p.id = a.patient_id
      WHERE lower(a.appointment_number) LIKE $1
         OR ((lower(p.first_name || ' ' || p.last_name) LIKE $1 OR lower(p.mrn) LIKE $1) AND a.appointment_date >= CURRENT_DATE - 1
             AND a.status NOT IN ('CANCELLED','COMPLETED'))
      ORDER BY a.appointment_date, a.start_time LIMIT 6`,
    [like],
  );
  return { patients, protocols, appointments };
}
