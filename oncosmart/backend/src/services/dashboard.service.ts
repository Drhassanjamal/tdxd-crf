import { pool, q, q1 } from '../db/pool';
import { AuthUser } from '../middleware/auth';
import { addDays, timeToMinutes, timeInTz, todayInTz } from '../utils/dates';
import { can } from '../utils/permissions';
import { APPOINTMENT_SELECT } from './appointment.service';
import { listChairs } from './chair.service';
import { liveWarnings } from './orders.service';
import { getSettings } from './settings.service';

export interface DashboardAlert {
  type: string;
  severity: 'CRITICAL' | 'WARNING' | 'INFO';
  message: string;
  params?: Record<string, string | number>;
  patientId?: string;
  patientName?: string;
  orderId?: string;
  appointmentId?: string;
}

export async function todaysAppointments(date: string) {
  return q(pool, `${APPOINTMENT_SELECT} WHERE a.appointment_date = $1 ORDER BY a.start_time`, [date]);
}

export async function getDashboard(user: AuthUser) {
  const s = await getSettings();
  const today = todayInTz(s.timezone);
  const nowMin = timeToMinutes(timeInTz(s.timezone));
  const appts = await todaysAppointments(today);
  const count = (...st: string[]) => appts.filter((a) => st.includes(a.status)).length;
  const stats = {
    total: appts.length,
    scheduled: count('SCHEDULED'),
    confirmed: count('CONFIRMED'),
    waiting: count('ARRIVED'),
    inPreparation: count('IN_PREPARATION'),
    inTreatment: count('IN_TREATMENT'),
    completed: count('COMPLETED'),
    cancelled: count('CANCELLED'),
    needsRescheduling: count('NEEDS_RESCHEDULING'),
    noShow: count('NO_SHOW'),
  };
  const chairs = await listChairs(today);
  const alerts: DashboardAlert[] = [];
  const name = (a: any) => `${a.first_name} ${a.last_name}`;
  const clinical = can(user.role, 'clinical.read');

  // Orders awaiting physician approval (today and next 7 days)
  const pending = await q(
    pool,
    `SELECT o.id, o.patient_id, o.cycle_number, o.day_number, o.planned_date, p.first_name, p.last_name
       FROM treatment_orders o JOIN patients p ON p.id = o.patient_id
      WHERE o.status = 'PENDING_REVIEW' AND o.planned_date <= $1 ORDER BY o.planned_date`,
    [addDays(today, 7)],
  );
  for (const o of pending) {
    alerts.push({
      type: 'ORDER_AWAITING_APPROVAL',
      severity: o.planned_date <= today ? 'CRITICAL' : 'WARNING',
      message: `Treatment order awaiting physician approval — C${o.cycle_number}D${o.day_number} (${o.planned_date})`,
      params: { cycle: o.cycle_number, day: o.day_number, date: o.planned_date },
      patientId: o.patient_id,
      patientName: name(o),
      orderId: o.id,
    });
  }

  for (const a of appts) {
    const start = timeToMinutes(a.start_time);
    // Not confirmed
    if (a.status === 'SCHEDULED') {
      alerts.push({
        type: 'APPOINTMENT_NOT_CONFIRMED',
        severity: 'WARNING',
        message: `Appointment not confirmed (${a.start_time.slice(0, 5)})`,
        params: { time: a.start_time.slice(0, 5) },
        patientId: a.patient_id,
        patientName: name(a),
        appointmentId: a.id,
      });
    }
    if (a.status === 'NEEDS_RESCHEDULING') {
      alerts.push({
        type: 'NEEDS_RESCHEDULING',
        severity: 'WARNING',
        message: 'Patient requested rescheduling',
        patientId: a.patient_id,
        patientName: name(a),
        appointmentId: a.id,
      });
    }
    // Delayed start
    if (['SCHEDULED', 'CONFIRMED', 'ARRIVED', 'IN_PREPARATION'].includes(a.status) && nowMin > start + Number(s.delay_grace_minutes)) {
      alerts.push({
        type: 'TREATMENT_DELAYED',
        severity: 'WARNING',
        message: `Treatment delayed — scheduled ${a.start_time.slice(0, 5)}, not started`,
        params: { time: a.start_time.slice(0, 5) },
        patientId: a.patient_id,
        patientName: name(a),
        appointmentId: a.id,
      });
    }
    // Chair conflict
    if (a.chair_id && ['ARRIVED', 'IN_PREPARATION'].includes(a.status)) {
      if (a.chair_status === 'OUT_OF_SERVICE' || (a.chair_current_appointment_id && a.chair_current_appointment_id !== a.id && ['RESERVED', 'PREPARING', 'INFUSING'].includes(a.chair_status))) {
        alerts.push({
          type: 'CHAIR_CONFLICT',
          severity: 'CRITICAL',
          message: `Chair conflict — ${a.chair_name} is occupied by another patient`,
          params: { chair: a.chair_name },
          patientId: a.patient_id,
          patientName: name(a),
          appointmentId: a.id,
        });
      }
    }
    if (a.chair_status === 'OUT_OF_SERVICE' && ['SCHEDULED', 'CONFIRMED'].includes(a.status)) {
      alerts.push({
        type: 'CHAIR_CONFLICT',
        severity: 'WARNING',
        message: `Booked chair ${a.chair_name} is out of service`,
        params: { chair: a.chair_name },
        patientId: a.patient_id,
        patientName: name(a),
        appointmentId: a.id,
      });
    }
    // Order-level safety alerts (clinical roles)
    if (clinical && a.treatment_order_id && !['COMPLETED', 'CANCELLED', 'NO_SHOW'].includes(a.status)) {
      const order = await q1(pool, 'SELECT * FROM treatment_orders WHERE id=$1', [a.treatment_order_id]);
      if (order && !['COMPLETED', 'CANCELLED'].includes(order.status)) {
        const items = await q(pool, 'SELECT * FROM treatment_order_items WHERE treatment_order_id=$1', [order.id]);
        const warnings = await liveWarnings(pool, order, items, a);
        if (['ARRIVED', 'IN_PREPARATION'].includes(a.status) && warnings.some((w) => w.code === 'LABS_MISSING')) {
          alerts.push({
            type: 'ARRIVED_LABS_MISSING',
            severity: 'CRITICAL',
            message: 'Patient arrived but laboratory results missing',
            patientId: a.patient_id,
            patientName: name(a),
            orderId: order.id,
            appointmentId: a.id,
          });
        }
        for (const w of warnings.filter((x) => x.code === 'DOSE_DIFFERENCE')) {
          alerts.push({
            type: 'DOSE_DIFFERENCE',
            severity: 'WARNING',
            message: w.message,
            params: w.params,
            patientId: a.patient_id,
            patientName: name(a),
            orderId: order.id,
          });
        }
        if (warnings.some((x) => x.code === 'ALLERGY_DRUG_MATCH')) {
          alerts.push({
            type: 'ALLERGY_DRUG_MATCH',
            severity: 'CRITICAL',
            message: 'Documented allergy matches an ordered drug',
            patientId: a.patient_id,
            patientName: name(a),
            orderId: order.id,
          });
        }
      }
    }
    if (!a.treatment_order_id && ['CHEMOTHERAPY', 'IMMUNOTHERAPY'].includes(a.appointment_type) && !['CANCELLED', 'COMPLETED', 'NO_SHOW'].includes(a.status)) {
      alerts.push({
        type: 'NO_ORDER',
        severity: 'WARNING',
        message: 'No treatment order linked to today’s appointment',
        patientId: a.patient_id,
        patientName: name(a),
        appointmentId: a.id,
      });
    }
  }
  const failed = await q(
    pool,
    `SELECT n.id, n.patient_id, p.first_name, p.last_name, n.failure_reason FROM notifications n JOIN patients p ON p.id = n.patient_id
      WHERE n.status='FAILED' AND n.created_at > now() - interval '3 days' ORDER BY n.created_at DESC LIMIT 10`,
  );
  for (const n of failed) {
    alerts.push({
      type: 'MESSAGE_FAILED',
      severity: 'INFO',
      message: `WhatsApp reminder failed: ${n.failure_reason ?? 'unknown error'}`,
      params: { reason: n.failure_reason ?? '' },
      patientId: n.patient_id,
      patientName: name(n),
    });
  }
  const sevOrder = { CRITICAL: 0, WARNING: 1, INFO: 2 };
  alerts.sort((x, y) => sevOrder[x.severity] - sevOrder[y.severity]);

  // KPIs
  const activeChairs = chairs.filter((c: any) => c.is_active);
  const openMinutes = Math.max(60, timeToMinutes(s.unit_close_time) - timeToMinutes(s.unit_open_time));
  const bookedMinutes = appts
    .filter((a) => a.chair_id && !['CANCELLED', 'NO_SHOW', 'NEEDS_RESCHEDULING'].includes(a.status))
    .reduce((sum, a) => sum + a.duration_minutes, 0);
  const avg = await q1(
    pool,
    `SELECT round(avg(treatment_duration_min))::int AS avg FROM treatment_orders
      WHERE status='COMPLETED' AND completed_at > now() - interval '30 days' AND treatment_duration_min > 0`,
  );
  const cancel = await q1(
    pool,
    `SELECT count(*) FILTER (WHERE status='CANCELLED')::int AS cancelled, count(*)::int AS total
       FROM appointments WHERE appointment_date BETWEEN $1 AND $2`,
    [addDays(today, -30), today],
  );
  const delaysToday = alerts.filter((x) => x.type === 'TREATMENT_DELAYED').length;
  const delayedStarts = await q1(
    pool,
    `SELECT count(*)::int AS n FROM treatment_orders o JOIN appointments a ON a.treatment_order_id = o.id
      WHERE a.appointment_date = $1 AND o.treatment_started_at IS NOT NULL
        AND o.treatment_started_at > ((a.appointment_date + a.start_time) AT TIME ZONE $2) + ($3 * interval '1 minute')`,
    [today, s.timezone, Number(s.delay_grace_minutes)],
  );
  const kpis = {
    todaysPatients: new Set(appts.filter((a) => !['CANCELLED'].includes(a.status)).map((a) => a.patient_id)).size,
    inTreatment: stats.inTreatment,
    availableChairs: activeChairs.filter((c: any) => c.status === 'AVAILABLE').length,
    totalChairs: activeChairs.length,
    completedToday: stats.completed,
    avgInfusionDurationMin: avg?.avg ?? null,
    chairUtilizationPct: activeChairs.length ? Math.round((bookedMinutes / (activeChairs.length * openMinutes)) * 100) : 0,
    cancellationRatePct: cancel.total ? Math.round((cancel.cancelled / cancel.total) * 1000) / 10 : 0,
    treatmentDelays: delaysToday + (delayedStarts?.n ?? 0),
  };
  return { date: today, now: new Date().toISOString(), stats, kpis, chairs, timeline: appts, alerts };
}
