import { pool, q } from '../db/pool';
import { daysBetween, timeToMinutes } from '../utils/dates';
import { notFound } from '../utils/errors';
import { getSettings } from './settings.service';

export interface ReportColumn {
  key: string;
  label: string;
  type?: 'text' | 'number' | 'date' | 'percent';
}

export interface ReportResult {
  type: string;
  title: string;
  from: string;
  to: string;
  columns: ReportColumn[];
  rows: Record<string, any>[];
  summary?: { label: string; value: string | number }[];
  chart?: { labelKey: string; valueKey: string; title: string };
}

type Builder = (from: string, to: string) => Promise<Omit<ReportResult, 'type' | 'from' | 'to'>>;

const PATIENT_NAME = `(p.first_name || ' ' || p.last_name)`;

const builders: Record<string, Builder> = {
  'daily-activity': async (from) => {
    const rows = await q(
      pool,
      `SELECT a.start_time::text AS time, ${PATIENT_NAME} AS patient, p.mrn, pr.name AS protocol,
              CASE WHEN a.cycle_number IS NOT NULL THEN 'C' || a.cycle_number || 'D' || a.day_number END AS cycle_day,
              c.name AS chair, a.status, to_char(o.treatment_started_at AT TIME ZONE $2, 'HH24:MI') AS started,
              to_char(o.completed_at AT TIME ZONE $2, 'HH24:MI') AS completed, o.treatment_duration_min AS duration_min
         FROM appointments a JOIN patients p ON p.id = a.patient_id
         LEFT JOIN protocols pr ON pr.id = a.protocol_id LEFT JOIN chairs c ON c.id = a.chair_id
         LEFT JOIN treatment_orders o ON o.id = a.treatment_order_id
        WHERE a.appointment_date = $1 ORDER BY a.start_time`,
      [from, (await getSettings()).timezone],
    );
    const by = (st: string) => rows.filter((r) => r.status === st).length;
    return {
      title: `Daily chemotherapy activity — ${from}`,
      columns: [
        { key: 'time', label: 'Time' },
        { key: 'patient', label: 'Patient' },
        { key: 'mrn', label: 'MRN' },
        { key: 'protocol', label: 'Protocol' },
        { key: 'cycle_day', label: 'Cycle/Day' },
        { key: 'chair', label: 'Chair' },
        { key: 'status', label: 'Status' },
        { key: 'started', label: 'Started' },
        { key: 'completed', label: 'Completed' },
        { key: 'duration_min', label: 'Duration (min)', type: 'number' },
      ],
      rows: rows.map((r) => ({ ...r, time: r.time.slice(0, 5) })),
      summary: [
        { label: 'Appointments', value: rows.length },
        { label: 'Completed', value: by('COMPLETED') },
        { label: 'In treatment', value: by('IN_TREATMENT') },
        { label: 'Cancelled', value: by('CANCELLED') },
        { label: 'No-show', value: by('NO_SHOW') },
      ],
    };
  },
  'monthly-activity': async (from, to) => {
    const rows = await q(
      pool,
      `SELECT d::date::text AS date,
              count(a.id) FILTER (WHERE a.id IS NOT NULL)::int AS appointments,
              count(a.id) FILTER (WHERE a.status='COMPLETED')::int AS completed,
              count(a.id) FILTER (WHERE a.status='CANCELLED')::int AS cancelled,
              count(a.id) FILTER (WHERE a.status='NO_SHOW')::int AS no_show,
              count(DISTINCT a.patient_id) FILTER (WHERE a.status='COMPLETED')::int AS patients_treated
         FROM generate_series($1::date, $2::date, interval '1 day') d
         LEFT JOIN appointments a ON a.appointment_date = d::date
        GROUP BY d ORDER BY d`,
      [from, to],
    );
    const sum = (k: string) => rows.reduce((s, r) => s + r[k], 0);
    return {
      title: `Activity ${from} → ${to}`,
      columns: [
        { key: 'date', label: 'Date', type: 'date' },
        { key: 'appointments', label: 'Appointments', type: 'number' },
        { key: 'completed', label: 'Completed', type: 'number' },
        { key: 'cancelled', label: 'Cancelled', type: 'number' },
        { key: 'no_show', label: 'No-show', type: 'number' },
        { key: 'patients_treated', label: 'Patients treated', type: 'number' },
      ],
      rows,
      summary: [
        { label: 'Appointments', value: sum('appointments') },
        { label: 'Completed treatments', value: sum('completed') },
        { label: 'Cancelled', value: sum('cancelled') },
      ],
      chart: { labelKey: 'date', valueKey: 'completed', title: 'Completed treatments per day' },
    };
  },
  'patients-treated': async (from, to) => {
    const rows = await q(
      pool,
      `SELECT p.mrn, ${PATIENT_NAME} AS patient, string_agg(DISTINCT o.protocol_name, ', ') AS protocols,
              count(*)::int AS treatments, max(o.completed_at)::date::text AS last_treatment
         FROM treatment_orders o JOIN patients p ON p.id = o.patient_id
        WHERE o.status='COMPLETED' AND o.completed_at::date BETWEEN $1 AND $2
        GROUP BY p.id ORDER BY patient`,
      [from, to],
    );
    return {
      title: 'Patients treated',
      columns: [
        { key: 'mrn', label: 'MRN' },
        { key: 'patient', label: 'Patient' },
        { key: 'protocols', label: 'Protocol(s)' },
        { key: 'treatments', label: 'Treatments', type: 'number' },
        { key: 'last_treatment', label: 'Last treatment', type: 'date' },
      ],
      rows,
      summary: [
        { label: 'Unique patients', value: rows.length },
        { label: 'Treatments', value: rows.reduce((s, r) => s + r.treatments, 0) },
      ],
    };
  },
  'treatment-cycles': async (from, to) => {
    const rows = await q(
      pool,
      `SELECT o.completed_at::date::text AS date, o.order_number, p.mrn, ${PATIENT_NAME} AS patient, o.protocol_name AS protocol,
              o.cycle_number AS cycle, o.day_number AS day, o.treatment_duration_min AS duration_min,
              pb.full_name AS physician, cb.full_name AS nurse, CASE WHEN o.adverse_event THEN 'Yes' ELSE 'No' END AS adverse_event
         FROM treatment_orders o JOIN patients p ON p.id = o.patient_id
         LEFT JOIN users pb ON pb.id = o.prescribed_by LEFT JOIN users cb ON cb.id = o.completed_by
        WHERE o.status='COMPLETED' AND o.completed_at::date BETWEEN $1 AND $2
        ORDER BY o.completed_at`,
      [from, to],
    );
    return {
      title: 'Treatment cycles administered',
      columns: [
        { key: 'date', label: 'Date', type: 'date' },
        { key: 'order_number', label: 'Order' },
        { key: 'mrn', label: 'MRN' },
        { key: 'patient', label: 'Patient' },
        { key: 'protocol', label: 'Protocol' },
        { key: 'cycle', label: 'Cycle', type: 'number' },
        { key: 'day', label: 'Day', type: 'number' },
        { key: 'duration_min', label: 'Duration (min)', type: 'number' },
        { key: 'physician', label: 'Physician' },
        { key: 'nurse', label: 'Nurse' },
        { key: 'adverse_event', label: 'Adverse event' },
      ],
      rows,
      summary: [{ label: 'Cycles administered', value: rows.length }],
    };
  },
  'drug-usage': async (from, to) => {
    const rows = await q(
      pool,
      `SELECT ad.drug_name AS drug, ad.route, count(*)::int AS administrations, count(DISTINCT ad.patient_id)::int AS patients,
              round(sum(ad.dose_administered)::numeric, 1)::float AS total_mg, round(avg(ad.dose_administered)::numeric, 1)::float AS avg_mg
         FROM administrations ad
        WHERE ad.status IN ('COMPLETED','STOPPED') AND ad.dose_administered IS NOT NULL AND ad.start_time::date BETWEEN $1 AND $2
        GROUP BY ad.drug_name, ad.route ORDER BY total_mg DESC`,
      [from, to],
    );
    return {
      title: 'Drug usage (administered)',
      columns: [
        { key: 'drug', label: 'Drug' },
        { key: 'route', label: 'Route' },
        { key: 'administrations', label: 'Administrations', type: 'number' },
        { key: 'patients', label: 'Patients', type: 'number' },
        { key: 'total_mg', label: 'Total (mg)', type: 'number' },
        { key: 'avg_mg', label: 'Average (mg)', type: 'number' },
      ],
      rows,
      chart: { labelKey: 'drug', valueKey: 'total_mg', title: 'Total administered (mg)' },
    };
  },
  'chair-utilization': async (from, to) => {
    const s = await getSettings();
    const openMin = Math.max(60, timeToMinutes(s.unit_close_time) - timeToMinutes(s.unit_open_time));
    const days = daysBetween(from, to) + 1;
    const rows = await q(
      pool,
      `SELECT c.name AS chair, count(a.id)::int AS bookings, coalesce(sum(a.duration_minutes), 0)::int AS booked_min,
              coalesce(sum(o.treatment_duration_min), 0)::int AS treatment_min
         FROM chairs c
         LEFT JOIN appointments a ON a.chair_id = c.id AND a.appointment_date BETWEEN $1 AND $2
              AND a.status NOT IN ('CANCELLED','NO_SHOW','NEEDS_RESCHEDULING')
         LEFT JOIN treatment_orders o ON o.id = a.treatment_order_id AND o.status='COMPLETED'
        WHERE c.is_active GROUP BY c.id ORDER BY c.sort_order, c.code`,
      [from, to],
    );
    const withPct = rows.map((r) => ({ ...r, utilization_pct: Math.round((r.booked_min / (openMin * days)) * 1000) / 10 }));
    const avg = withPct.length ? Math.round((withPct.reduce((s2, r) => s2 + r.utilization_pct, 0) / withPct.length) * 10) / 10 : 0;
    return {
      title: `Chair utilization (${days} day(s), ${s.unit_open_time}–${s.unit_close_time})`,
      columns: [
        { key: 'chair', label: 'Chair' },
        { key: 'bookings', label: 'Bookings', type: 'number' },
        { key: 'booked_min', label: 'Booked (min)', type: 'number' },
        { key: 'treatment_min', label: 'Actual treatment (min)', type: 'number' },
        { key: 'utilization_pct', label: 'Utilization %', type: 'percent' },
      ],
      rows: withPct,
      summary: [{ label: 'Average utilization', value: `${avg}%` }],
      chart: { labelKey: 'chair', valueKey: 'utilization_pct', title: 'Utilization %' },
    };
  },
  'cancelled-appointments': async (from, to) => {
    const rows = await q(
      pool,
      `SELECT a.appointment_date::text AS date, a.start_time::text AS time, a.appointment_number, p.mrn, ${PATIENT_NAME} AS patient,
              pr.name AS protocol, a.cancel_reason AS reason, to_char(a.cancelled_at, 'YYYY-MM-DD HH24:MI') AS cancelled_at,
              coalesce(u.full_name, 'Patient (WhatsApp)') AS cancelled_by
         FROM appointments a JOIN patients p ON p.id = a.patient_id LEFT JOIN protocols pr ON pr.id = a.protocol_id
         LEFT JOIN users u ON u.id = a.cancelled_by
        WHERE a.status='CANCELLED' AND a.appointment_date BETWEEN $1 AND $2 ORDER BY a.appointment_date, a.start_time`,
      [from, to],
    );
    const total = await q(pool, 'SELECT count(*)::int AS n FROM appointments WHERE appointment_date BETWEEN $1 AND $2', [from, to]);
    return {
      title: 'Cancelled appointments',
      columns: [
        { key: 'date', label: 'Date', type: 'date' },
        { key: 'time', label: 'Time' },
        { key: 'appointment_number', label: 'Appointment' },
        { key: 'mrn', label: 'MRN' },
        { key: 'patient', label: 'Patient' },
        { key: 'protocol', label: 'Protocol' },
        { key: 'reason', label: 'Reason' },
        { key: 'cancelled_at', label: 'Cancelled at' },
        { key: 'cancelled_by', label: 'Cancelled by' },
      ],
      rows: rows.map((r) => ({ ...r, time: r.time.slice(0, 5) })),
      summary: [
        { label: 'Cancelled', value: rows.length },
        { label: 'Cancellation rate', value: total[0].n ? `${Math.round((rows.length / total[0].n) * 1000) / 10}%` : '0%' },
      ],
    };
  },
  'delayed-treatments': async (from, to) => {
    const s = await getSettings();
    const rows = await q(
      pool,
      `SELECT a.appointment_date::text AS date, ${PATIENT_NAME} AS patient, p.mrn, o.protocol_name AS protocol,
              a.start_time::text AS scheduled, to_char(o.treatment_started_at AT TIME ZONE $3, 'HH24:MI') AS actual_start,
              GREATEST(0, round(extract(epoch FROM (o.treatment_started_at - ((a.appointment_date + a.start_time) AT TIME ZONE $3))) / 60))::int AS delay_min,
              o.status, coalesce(o.delay_reason, o.hold_reason) AS reason
         FROM treatment_orders o JOIN appointments a ON a.treatment_order_id = o.id JOIN patients p ON p.id = o.patient_id
        WHERE a.appointment_date BETWEEN $1 AND $2
          AND (o.status IN ('DELAYED','HELD')
               OR o.treatment_started_at > ((a.appointment_date + a.start_time) AT TIME ZONE $3) + ($4 * interval '1 minute'))
        ORDER BY a.appointment_date, a.start_time`,
      [from, to, s.timezone, Number(s.delay_grace_minutes)],
    );
    return {
      title: `Delayed treatments (> ${s.delay_grace_minutes} min, or held/delayed orders)`,
      columns: [
        { key: 'date', label: 'Date', type: 'date' },
        { key: 'patient', label: 'Patient' },
        { key: 'mrn', label: 'MRN' },
        { key: 'protocol', label: 'Protocol' },
        { key: 'scheduled', label: 'Scheduled' },
        { key: 'actual_start', label: 'Actual start' },
        { key: 'delay_min', label: 'Delay (min)', type: 'number' },
        { key: 'status', label: 'Order status' },
        { key: 'reason', label: 'Reason' },
      ],
      rows: rows.map((r) => ({ ...r, scheduled: r.scheduled.slice(0, 5), delay_min: r.actual_start ? r.delay_min : null })),
      summary: [{ label: 'Delayed treatments', value: rows.length }],
    };
  },
  'treatment-completion': async () => {
    const rows = await q(
      pool,
      `SELECT p.mrn, ${PATIENT_NAME} AS patient, pr.name AS protocol, tp.planned_cycles, tp.cycles_completed,
              round(100.0 * tp.cycles_completed / tp.planned_cycles, 1)::float AS completion_pct, tp.status, tp.start_date::text AS start_date
         FROM treatment_plans tp JOIN patients p ON p.id = tp.patient_id JOIN protocols pr ON pr.id = tp.protocol_id
        ORDER BY completion_pct DESC, patient`,
    );
    const done = rows.filter((r) => r.cycles_completed >= r.planned_cycles).length;
    return {
      title: 'Treatment completion (all treatment plans)',
      columns: [
        { key: 'mrn', label: 'MRN' },
        { key: 'patient', label: 'Patient' },
        { key: 'protocol', label: 'Protocol' },
        { key: 'planned_cycles', label: 'Planned', type: 'number' },
        { key: 'cycles_completed', label: 'Completed', type: 'number' },
        { key: 'completion_pct', label: 'Completion %', type: 'percent' },
        { key: 'status', label: 'Plan status' },
        { key: 'start_date', label: 'Start', type: 'date' },
      ],
      rows,
      summary: [
        { label: 'Plans', value: rows.length },
        { label: 'All planned cycles completed', value: done },
      ],
    };
  },
  'cancer-type-distribution': async () => {
    const rows = await q(
      pool,
      `SELECT d.cancer_type, count(DISTINCT d.patient_id)::int AS patients
         FROM diagnoses d WHERE d.is_primary GROUP BY d.cancer_type ORDER BY patients DESC`,
    );
    const total = rows.reduce((s, r) => s + r.patients, 0);
    return {
      title: 'Cancer type distribution (primary diagnosis)',
      columns: [
        { key: 'cancer_type', label: 'Cancer type' },
        { key: 'patients', label: 'Patients', type: 'number' },
        { key: 'pct', label: '%', type: 'percent' },
      ],
      rows: rows.map((r) => ({ ...r, pct: total ? Math.round((r.patients / total) * 1000) / 10 : 0 })),
      chart: { labelKey: 'cancer_type', valueKey: 'patients', title: 'Patients' },
    };
  },
  'protocol-distribution': async (from, to) => {
    const rows = await q(
      pool,
      `SELECT pr.name AS protocol, pr.cancer_type,
              count(DISTINCT tp.id) FILTER (WHERE tp.status='ACTIVE')::int AS active_plans,
              count(DISTINCT tp.id)::int AS total_plans,
              count(DISTINCT o.id) FILTER (WHERE o.status='COMPLETED' AND o.completed_at::date BETWEEN $1 AND $2)::int AS treatments_in_period
         FROM protocols pr LEFT JOIN treatment_plans tp ON tp.protocol_id = pr.id LEFT JOIN treatment_orders o ON o.protocol_id = pr.id
        GROUP BY pr.id ORDER BY total_plans DESC`,
      [from, to],
    );
    return {
      title: 'Protocol distribution',
      columns: [
        { key: 'protocol', label: 'Protocol' },
        { key: 'cancer_type', label: 'Cancer type' },
        { key: 'active_plans', label: 'Active plans', type: 'number' },
        { key: 'total_plans', label: 'Total plans', type: 'number' },
        { key: 'treatments_in_period', label: 'Treatments in period', type: 'number' },
      ],
      rows,
      chart: { labelKey: 'protocol', valueKey: 'total_plans', title: 'Treatment plans' },
    };
  },
  'physician-workload': async (from, to) => {
    const rows = await q(
      pool,
      `SELECT u.full_name AS physician,
              (SELECT count(*)::int FROM treatment_orders o WHERE o.prescribed_by = u.id AND o.prescribed_at::date BETWEEN $1 AND $2) AS orders_prescribed,
              (SELECT count(*)::int FROM treatment_orders o WHERE o.approved_by = u.id AND o.approved_at::date BETWEEN $1 AND $2) AS orders_approved,
              (SELECT count(*)::int FROM appointments a WHERE a.physician_id = u.id AND a.appointment_date BETWEEN $1 AND $2 AND a.status <> 'CANCELLED') AS appointments,
              (SELECT count(*)::int FROM patients p WHERE p.primary_oncologist_id = u.id) AS patients
         FROM users u WHERE u.role_code='PHYSICIAN' ORDER BY u.full_name`,
      [from, to],
    );
    return {
      title: 'Physician workload',
      columns: [
        { key: 'physician', label: 'Physician' },
        { key: 'orders_prescribed', label: 'Orders prescribed', type: 'number' },
        { key: 'orders_approved', label: 'Orders approved', type: 'number' },
        { key: 'appointments', label: 'Appointments', type: 'number' },
        { key: 'patients', label: 'Primary patients', type: 'number' },
      ],
      rows,
      chart: { labelKey: 'physician', valueKey: 'orders_approved', title: 'Orders approved' },
    };
  },
};

export const REPORT_TYPES = Object.keys(builders);

export async function runReport(type: string, from: string, to: string): Promise<ReportResult> {
  const b = builders[type];
  if (!b) throw notFound('Report');
  const r = await b(from, to);
  return { type, from, to, ...r };
}
