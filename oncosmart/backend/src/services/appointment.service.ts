import { Db, pool, q, q1 } from '../db/pool';
import { badRequest, conflict, notFound, validationError } from '../utils/errors';
import { minutesToTime, timeToMinutes, todayInTz } from '../utils/dates';
import { Actor, audit, diff } from './audit.service';
import { occupyChair, releaseChair } from './chair.service';
import {
  cancelPendingForAppointment,
  queueAppointmentMessages,
  queueCancellationMessage,
  queueManualReminder,
  recordResponse,
} from './notification.service';
import { getSettings } from './settings.service';

const ACTIVE_STATUSES = ['SCHEDULED', 'CONFIRMED', 'ARRIVED', 'IN_PREPARATION', 'IN_TREATMENT'];

export interface AppointmentInput {
  patientId: string;
  treatmentPlanId?: string | null;
  protocolId?: string | null;
  cycleNumber?: number | null;
  dayNumber?: number | null;
  appointmentType?: string;
  appointmentDate: string;
  startTime: string;
  durationMinutes?: number;
  chairId?: string | null;
  physicianId?: string | null;
  notes?: string | null;
}

export const APPOINTMENT_SELECT = `
  SELECT a.id, a.appointment_number, a.patient_id, a.treatment_plan_id, a.treatment_order_id, a.protocol_id,
         a.cycle_number, a.day_number, a.appointment_type, a.appointment_date, a.start_time::text AS start_time,
         a.duration_minutes, a.chair_id, a.physician_id, a.status, a.confirmation_source, a.confirmed_at, a.arrived_at,
         a.cancelled_at, a.cancel_reason, a.notes, a.created_at, a.updated_at,
         p.patient_code, p.mrn, p.first_name, p.last_name, p.full_name_ar, p.phone, p.sex, p.date_of_birth,
         pr.name AS protocol_name, pr.code AS protocol_code, pr.is_demo AS protocol_is_demo,
         c.name AS chair_name, c.code AS chair_code, c.status AS chair_status, c.current_appointment_id AS chair_current_appointment_id,
         u.full_name AS physician_name,
         o.status AS order_status, o.order_number,
         (SELECT n.status FROM notifications n WHERE n.appointment_id = a.id AND n.status <> 'CANCELLED' AND n.status <> 'PENDING'
           ORDER BY n.scheduled_for DESC LIMIT 1) AS whatsapp_status,
         (SELECT n.patient_response FROM notifications n WHERE n.appointment_id = a.id AND n.patient_response IS NOT NULL
           ORDER BY n.responded_at DESC LIMIT 1) AS patient_response
    FROM appointments a
    JOIN patients p ON p.id = a.patient_id
    LEFT JOIN protocols pr ON pr.id = a.protocol_id
    LEFT JOIN chairs c ON c.id = a.chair_id
    LEFT JOIN users u ON u.id = a.physician_id
    LEFT JOIN treatment_orders o ON o.id = a.treatment_order_id`;

export async function getAppointment(db: Db, id: string) {
  const a = await q1(db, `${APPOINTMENT_SELECT} WHERE a.id = $1`, [id]);
  if (!a) throw notFound('Appointment');
  return a;
}

export async function listAppointments(f: { from: string; to: string; chairId?: string; status?: string; patientId?: string }) {
  const params: unknown[] = [f.from, f.to];
  let where = 'a.appointment_date BETWEEN $1 AND $2';
  if (f.chairId) {
    params.push(f.chairId);
    where += ` AND a.chair_id = $${params.length}`;
  }
  if (f.status) {
    params.push(f.status);
    where += ` AND a.status = $${params.length}`;
  }
  if (f.patientId) {
    params.push(f.patientId);
    where += ` AND a.patient_id = $${params.length}`;
  }
  return q(pool, `${APPOINTMENT_SELECT} WHERE ${where} ORDER BY a.appointment_date, a.start_time`, params);
}

/** Validates chair and patient availability. Throws a user-friendly error on conflict. */
async function validateSlot(
  db: Db,
  p: { patientId: string; date: string; startTime: string; duration: number; chairId?: string | null; excludeId?: string },
) {
  const patient = await q1(db, 'SELECT id, status FROM patients WHERE id=$1', [p.patientId]);
  if (!patient) throw validationError('Cannot create an appointment without a valid patient.');
  if (patient.status === 'DECEASED') throw conflict('Cannot book an appointment for a patient recorded as deceased.');
  const start = timeToMinutes(p.startTime);
  if (start + p.duration > 24 * 60) throw validationError('Appointment must end on the same day.');
  if (p.chairId) {
    const chair = await q1(db, 'SELECT id, name, status, is_active FROM chairs WHERE id=$1', [p.chairId]);
    if (!chair || !chair.is_active) throw validationError('Selected chair does not exist or is inactive.');
    if (chair.status === 'OUT_OF_SERVICE') throw conflict(`${chair.name} is out of service and cannot be booked.`);
    const clash = await q1(
      db,
      `SELECT a.appointment_number, a.start_time::text AS start_time, a.duration_minutes
         FROM appointments a
        WHERE a.chair_id = $1 AND a.status = ANY($2) AND ($3::uuid IS NULL OR a.id <> $3)
          AND a.slot && tsrange($4::date + $5::time, $4::date + $5::time + ($6 * interval '1 minute'), '[)')
        LIMIT 1`,
      [p.chairId, ACTIVE_STATUSES, p.excludeId ?? null, p.date, p.startTime, p.duration],
    );
    if (clash) {
      const end = minutesToTime(timeToMinutes(clash.start_time) + clash.duration_minutes);
      throw conflict(
        `Cannot book: ${chair.name} is already assigned to another patient from ${clash.start_time.slice(0, 5)} to ${end} (${clash.appointment_number}).`,
      );
    }
  }
  const patientClash = await q1(
    db,
    `SELECT a.appointment_number, a.start_time::text AS start_time FROM appointments a
      WHERE a.patient_id = $1 AND a.status = ANY($2) AND ($3::uuid IS NULL OR a.id <> $3)
        AND a.slot && tsrange($4::date + $5::time, $4::date + $5::time + ($6 * interval '1 minute'), '[)')
      LIMIT 1`,
    [p.patientId, ACTIVE_STATUSES, p.excludeId ?? null, p.date, p.startTime, p.duration],
  );
  if (patientClash) {
    throw conflict(`This patient already has an overlapping appointment at ${patientClash.start_time.slice(0, 5)} (${patientClash.appointment_number}).`);
  }
}

export async function createAppointment(db: Db, input: AppointmentInput, actor: Actor) {
  const s = await getSettings();
  let protocolId = input.protocolId ?? null;
  let physicianId = input.physicianId ?? null;
  let duration = input.durationMinutes;
  if (input.treatmentPlanId) {
    const plan = await q1(
      db,
      `SELECT tp.*, pr.estimated_duration_min FROM treatment_plans tp JOIN protocols pr ON pr.id = tp.protocol_id WHERE tp.id=$1`,
      [input.treatmentPlanId],
    );
    if (!plan || plan.patient_id !== input.patientId) throw validationError('Treatment plan does not belong to this patient.');
    protocolId = protocolId ?? plan.protocol_id;
    physicianId = physicianId ?? plan.physician_id;
    duration = duration ?? plan.estimated_duration_min ?? undefined;
  }
  duration = duration ?? s.default_appointment_duration_min;
  await validateSlot(db, {
    patientId: input.patientId,
    date: input.appointmentDate,
    startTime: input.startTime,
    duration,
    chairId: input.chairId,
  });
  // Link an existing active order for the same plan/cycle/day, if any.
  let orderId: string | null = null;
  if (input.treatmentPlanId && input.cycleNumber && input.dayNumber) {
    const order = await q1(
      db,
      `SELECT o.id FROM treatment_orders o
        WHERE o.treatment_plan_id=$1 AND o.cycle_number=$2 AND o.day_number=$3 AND o.status NOT IN ('CANCELLED','COMPLETED')
          AND NOT EXISTS (SELECT 1 FROM appointments a WHERE a.treatment_order_id = o.id AND a.status NOT IN ('CANCELLED','NO_SHOW','NEEDS_RESCHEDULING'))`,
      [input.treatmentPlanId, input.cycleNumber, input.dayNumber],
    );
    orderId = order?.id ?? null;
  }
  const appt = await q1(
    db,
    `INSERT INTO appointments (patient_id, treatment_plan_id, treatment_order_id, protocol_id, cycle_number, day_number,
                               appointment_type, appointment_date, start_time, duration_minutes, chair_id, physician_id,
                               notes, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
    [
      input.patientId,
      input.treatmentPlanId ?? null,
      orderId,
      protocolId,
      input.cycleNumber ?? null,
      input.dayNumber ?? null,
      input.appointmentType ?? 'CHEMOTHERAPY',
      input.appointmentDate,
      input.startTime,
      duration,
      input.chairId ?? null,
      physicianId,
      input.notes ?? null,
      actor.id,
    ],
  );
  const full = await getAppointment(db, appt.id);
  await audit(db, actor, {
    action: 'APPOINTMENT_CREATED',
    entityType: 'appointment',
    entityId: appt.id,
    patientId: input.patientId,
    description: `${full.appointment_number} on ${input.appointmentDate} ${input.startTime}${full.chair_name ? ` — ${full.chair_name}` : ''}`,
    next: { date: input.appointmentDate, time: input.startTime, duration, chair: full.chair_name, cycle: input.cycleNumber, day: input.dayNumber },
  });
  await queueAppointmentMessages(db, appt.id, 'APPOINTMENT_CREATED', actor);
  return getAppointment(db, appt.id);
}

export async function updateAppointment(
  db: Db,
  id: string,
  input: Partial<Pick<AppointmentInput, 'appointmentDate' | 'startTime' | 'durationMinutes' | 'chairId' | 'physicianId' | 'notes' | 'appointmentType'>>,
  actor: Actor,
) {
  const before = await getAppointment(db, id);
  if (['COMPLETED', 'CANCELLED', 'IN_TREATMENT', 'NO_SHOW'].includes(before.status)) {
    throw conflict(`Cannot change an appointment with status ${before.status.replace('_', ' ').toLowerCase()}.`);
  }
  const next = {
    appointment_date: input.appointmentDate ?? before.appointment_date,
    start_time: (input.startTime ?? before.start_time).slice(0, 5),
    duration_minutes: input.durationMinutes ?? before.duration_minutes,
    chair_id: input.chairId === undefined ? before.chair_id : input.chairId,
    physician_id: input.physicianId === undefined ? before.physician_id : input.physicianId,
    notes: input.notes === undefined ? before.notes : input.notes,
    appointment_type: input.appointmentType ?? before.appointment_type,
  };
  await validateSlot(db, {
    patientId: before.patient_id,
    date: next.appointment_date,
    startTime: next.start_time,
    duration: next.duration_minutes,
    chairId: next.chair_id,
    excludeId: id,
  });
  const rescheduled =
    next.appointment_date !== before.appointment_date || next.start_time !== before.start_time.slice(0, 5);
  const newStatus = rescheduled && ['CONFIRMED', 'NEEDS_RESCHEDULING'].includes(before.status) ? 'SCHEDULED' : before.status;
  if (before.chair_id && next.chair_id !== before.chair_id && before.chair_current_appointment_id === id) {
    await releaseChair(db, before.chair_id, id, actor, 'CHAIR_REASSIGNED');
  }
  await db.query(
    `UPDATE appointments SET appointment_date=$2, start_time=$3, duration_minutes=$4, chair_id=$5, physician_id=$6,
            notes=$7, appointment_type=$8, status=$9 WHERE id=$1`,
    [id, next.appointment_date, next.start_time, next.duration_minutes, next.chair_id, next.physician_id, next.notes, next.appointment_type, newStatus],
  );
  if (next.chair_id && next.chair_id !== before.chair_id && ['ARRIVED', 'IN_PREPARATION'].includes(before.status)) {
    await occupyChair(db, next.chair_id, id, before.status === 'ARRIVED' ? 'RESERVED' : 'PREPARING', actor);
  }
  const d = diff(
    { date: before.appointment_date, time: before.start_time.slice(0, 5), duration: before.duration_minutes, chairId: before.chair_id, physicianId: before.physician_id, notes: before.notes },
    { date: next.appointment_date, time: next.start_time, duration: next.duration_minutes, chairId: next.chair_id, physicianId: next.physician_id, notes: next.notes },
  );
  if (d.changed) {
    await audit(db, actor, {
      action: rescheduled ? 'APPOINTMENT_RESCHEDULED' : 'APPOINTMENT_CHANGED',
      entityType: 'appointment',
      entityId: id,
      patientId: before.patient_id,
      previous: d.prev,
      next: d.next,
    });
  }
  if (rescheduled) {
    await cancelPendingForAppointment(db, id);
    await queueAppointmentMessages(db, id, 'APPOINTMENT_RESCHEDULED', actor);
  }
  return getAppointment(db, id);
}

export async function cancelAppointment(db: Db, id: string, reason: string, actor: Actor, source = 'STAFF') {
  const appt = await getAppointment(db, id);
  if (['COMPLETED', 'CANCELLED'].includes(appt.status)) throw conflict('Appointment is already completed or cancelled.');
  if (appt.status === 'IN_TREATMENT') throw conflict('Cannot cancel an appointment while the patient is in treatment.');
  await db.query(
    `UPDATE appointments SET status='CANCELLED', cancelled_at=now(), cancelled_by=$2, cancel_reason=$3 WHERE id=$1`,
    [id, actor.id, reason],
  );
  if (appt.chair_id) await releaseChair(db, appt.chair_id, id, actor, 'APPOINTMENT_CANCELLED');
  await cancelPendingForAppointment(db, id);
  if (source === 'STAFF') await queueCancellationMessage(db, id, actor);
  await audit(db, actor, {
    action: 'APPOINTMENT_CANCELLED',
    entityType: 'appointment',
    entityId: id,
    patientId: appt.patient_id,
    description: `${appt.appointment_number} cancelled (${source.toLowerCase()}): ${reason}`,
    previous: { status: appt.status },
    next: { status: 'CANCELLED', reason },
  });
  return getAppointment(db, id);
}

export async function checkInAppointment(db: Db, id: string, actor: Actor) {
  const appt = await getAppointment(db, id);
  if (!['SCHEDULED', 'CONFIRMED', 'NEEDS_RESCHEDULING'].includes(appt.status)) {
    throw conflict('Patient is already checked in or the appointment is closed.');
  }
  const s = await getSettings();
  if (appt.appointment_date !== todayInTz(s.timezone)) throw badRequest('Only today’s appointments can be checked in.');
  await db.query(`UPDATE appointments SET status='ARRIVED', arrived_at=now(), checked_in_by=$2 WHERE id=$1`, [id, actor.id]);
  // Patient is here — pending reminders are no longer relevant
  await cancelPendingForAppointment(db, id);
  if (appt.chair_id) {
    const chair = await q1(db, 'SELECT status, current_appointment_id FROM chairs WHERE id=$1', [appt.chair_id]);
    if (chair && (chair.status === 'AVAILABLE' || chair.current_appointment_id === id)) {
      await occupyChair(db, appt.chair_id, id, 'RESERVED', actor);
    }
  }
  await audit(db, actor, {
    action: 'PATIENT_CHECKED_IN',
    entityType: 'appointment',
    entityId: id,
    patientId: appt.patient_id,
    previous: { status: appt.status },
    next: { status: 'ARRIVED' },
  });
  return getAppointment(db, id);
}

export async function setAppointmentStatus(db: Db, id: string, status: 'CONFIRMED' | 'NO_SHOW' | 'NEEDS_RESCHEDULING' | 'SCHEDULED', actor: Actor, source = 'STAFF') {
  const appt = await getAppointment(db, id);
  const allowedFrom: Record<string, string[]> = {
    CONFIRMED: ['SCHEDULED', 'NEEDS_RESCHEDULING'],
    SCHEDULED: ['CONFIRMED', 'NEEDS_RESCHEDULING'],
    NEEDS_RESCHEDULING: ['SCHEDULED', 'CONFIRMED'],
    NO_SHOW: ['SCHEDULED', 'CONFIRMED', 'NEEDS_RESCHEDULING'],
  };
  if (!allowedFrom[status]?.includes(appt.status)) {
    throw conflict(`Cannot change appointment from ${appt.status} to ${status}.`);
  }
  await db.query(
    `UPDATE appointments SET status=$2,
            confirmed_at = CASE WHEN $2='CONFIRMED' THEN now() ELSE confirmed_at END,
            confirmation_source = CASE WHEN $2='CONFIRMED' THEN $3 ELSE confirmation_source END
      WHERE id=$1`,
    [id, status, source],
  );
  if (status === 'NO_SHOW' && appt.chair_id) await releaseChair(db, appt.chair_id, id, actor, 'NO_SHOW');
  if (status === 'NO_SHOW' || status === 'NEEDS_RESCHEDULING') await cancelPendingForAppointment(db, id);
  await audit(db, actor, {
    action: status === 'CONFIRMED' ? 'APPOINTMENT_CONFIRMED' : 'APPOINTMENT_STATUS_CHANGED',
    entityType: 'appointment',
    entityId: id,
    patientId: appt.patient_id,
    description: `Source: ${source}`,
    previous: { status: appt.status },
    next: { status },
  });
  return getAppointment(db, id);
}

/** Applies a patient reply (from WhatsApp webhook or the simulator) to the appointment. */
export async function applyPatientResponse(db: Db, notificationId: string, response: 'CONFIRM' | 'RESCHEDULE' | 'CANCEL', actor: Actor) {
  const n = await q1(db, 'SELECT id, appointment_id, patient_id FROM notifications WHERE id=$1', [notificationId]);
  if (!n) throw notFound('Notification');
  await recordResponse(db, notificationId, response);
  await audit(db, actor, {
    action: 'PATIENT_RESPONSE_RECEIVED',
    entityType: 'notification',
    entityId: notificationId,
    patientId: n.patient_id,
    next: { response },
  });
  if (!n.appointment_id) return null;
  const appt = await getAppointment(db, n.appointment_id);
  if (['COMPLETED', 'CANCELLED', 'IN_TREATMENT', 'IN_PREPARATION', 'ARRIVED'].includes(appt.status)) return appt;
  if (response === 'CONFIRM') return setAppointmentStatus(db, appt.id, 'CONFIRMED', actor, 'WHATSAPP');
  if (response === 'RESCHEDULE') return setAppointmentStatus(db, appt.id, 'NEEDS_RESCHEDULING', actor, 'WHATSAPP');
  return cancelAppointment(db, appt.id, 'Cancelled by patient via WhatsApp', actor, 'WHATSAPP');
}

export async function sendManualReminder(db: Db, id: string, actor: Actor) {
  const appt = await getAppointment(db, id);
  if (!['SCHEDULED', 'CONFIRMED', 'NEEDS_RESCHEDULING'].includes(appt.status)) {
    throw conflict('Reminders can only be sent for upcoming appointments.');
  }
  const n = await queueManualReminder(db, id, actor);
  await audit(db, actor, { action: 'REMINDER_QUEUED', entityType: 'appointment', entityId: id, patientId: appt.patient_id });
  return n;
}

/** Finds the first chair free at the requested time (used by the next-cycle suggestion). */
export async function suggestChair(db: Db, date: string, startTime: string, duration: number) {
  const chairs = await q(db, `SELECT id, name FROM chairs WHERE is_active AND status <> 'OUT_OF_SERVICE' ORDER BY sort_order, code`);
  for (const c of chairs) {
    const clash = await q1(
      db,
      `SELECT 1 FROM appointments WHERE chair_id=$1 AND status = ANY($2)
         AND slot && tsrange($3::date + $4::time, $3::date + $4::time + ($5 * interval '1 minute'), '[)') LIMIT 1`,
      [c.id, ACTIVE_STATUSES, date, startTime, duration],
    );
    if (!clash) return c;
  }
  return null;
}
