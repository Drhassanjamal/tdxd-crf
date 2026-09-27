import { Db, pool, q, q1 } from '../db/pool';
import { badRequest, conflict, notFound } from '../utils/errors';
import { todayInTz } from '../utils/dates';
import { Actor, audit } from './audit.service';
import { getSettings } from './settings.service';

export type ChairStatus = 'AVAILABLE' | 'RESERVED' | 'PREPARING' | 'INFUSING' | 'CLEANING' | 'OUT_OF_SERVICE';

/** Chairs with live occupant and the given day's bookings (for the occupancy view). */
export async function listChairs(date?: string) {
  const s = await getSettings();
  const day = date ?? todayInTz(s.timezone);
  const chairs = await q(
    pool,
    `SELECT c.*, a.id AS occupant_appointment_id, a.status AS occupant_appointment_status,
            p.id AS occupant_patient_id, p.first_name || ' ' || p.last_name AS occupant_name, p.full_name_ar AS occupant_name_ar,
            p.mrn AS occupant_mrn, o.protocol_name AS occupant_protocol, o.cycle_number AS occupant_cycle,
            o.day_number AS occupant_day, o.status AS occupant_order_status, o.treatment_started_at AS occupant_started_at
       FROM chairs c
       LEFT JOIN appointments a ON a.id = c.current_appointment_id
       LEFT JOIN patients p ON p.id = a.patient_id
       LEFT JOIN treatment_orders o ON o.id = a.treatment_order_id
      WHERE c.is_active OR $1::boolean
      ORDER BY c.sort_order, c.code`,
    [true],
  );
  const bookings = await q(
    pool,
    `SELECT a.id, a.chair_id, a.start_time::text AS start_time, a.duration_minutes, a.status, a.appointment_number,
            p.first_name || ' ' || p.last_name AS patient_name, p.full_name_ar AS patient_name_ar, pr.name AS protocol_name,
            a.cycle_number, a.day_number, a.patient_id
       FROM appointments a
       JOIN patients p ON p.id = a.patient_id
       LEFT JOIN protocols pr ON pr.id = a.protocol_id
      WHERE a.appointment_date = $1 AND a.chair_id IS NOT NULL AND a.status NOT IN ('CANCELLED','NO_SHOW','NEEDS_RESCHEDULING')
      ORDER BY a.start_time`,
    [day],
  );
  return chairs.map((c) => ({ ...c, bookings: bookings.filter((b) => b.chair_id === c.id) }));
}

export async function createChair(db: Db, input: { code: string; name: string; zone?: string | null; chairType?: string; sortOrder?: number }, actor: Actor) {
  const chair = await q1(
    db,
    `INSERT INTO chairs (code, name, zone, chair_type, sort_order) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [input.code, input.name, input.zone ?? null, input.chairType ?? 'RECLINER', input.sortOrder ?? 0],
  );
  await audit(db, actor, { action: 'CHAIR_CREATED', entityType: 'chair', entityId: chair.id, next: chair });
  return chair;
}

export async function updateChair(
  db: Db,
  id: string,
  input: { name?: string; zone?: string | null; chairType?: string; sortOrder?: number; isActive?: boolean },
  actor: Actor,
) {
  const before = await q1(db, 'SELECT * FROM chairs WHERE id=$1', [id]);
  if (!before) throw notFound('Chair');
  if (input.isActive === false) {
    const future = await q1(
      db,
      `SELECT count(*)::int AS n FROM appointments WHERE chair_id=$1 AND appointment_date >= CURRENT_DATE
         AND status NOT IN ('CANCELLED','NO_SHOW','COMPLETED','NEEDS_RESCHEDULING')`,
      [id],
    );
    if (future.n > 0) throw conflict(`Cannot deactivate: chair has ${future.n} upcoming appointment(s). Reassign them first.`);
  }
  const chair = await q1(
    db,
    `UPDATE chairs SET name=COALESCE($2,name), zone=COALESCE($3,zone), chair_type=COALESCE($4,chair_type),
            sort_order=COALESCE($5,sort_order), is_active=COALESCE($6,is_active) WHERE id=$1 RETURNING *`,
    [id, input.name ?? null, input.zone ?? null, input.chairType ?? null, input.sortOrder ?? null, input.isActive ?? null],
  );
  await audit(db, actor, { action: 'CHAIR_UPDATED', entityType: 'chair', entityId: id, previous: before, next: chair });
  return chair;
}

/** Manual status change by nurse/admin (cleaning, out of service, available). */
export async function setChairStatus(db: Db, id: string, status: ChairStatus, note: string | null, actor: Actor) {
  const chair = await q1(db, 'SELECT * FROM chairs WHERE id=$1 FOR UPDATE', [id]);
  if (!chair) throw notFound('Chair');
  if (['PREPARING', 'INFUSING'].includes(chair.status) && chair.current_appointment_id && ['AVAILABLE', 'CLEANING', 'OUT_OF_SERVICE'].includes(status)) {
    const appt = await q1(db, 'SELECT status FROM appointments WHERE id=$1', [chair.current_appointment_id]);
    if (appt && ['IN_PREPARATION', 'IN_TREATMENT'].includes(appt.status)) {
      throw conflict('This chair has a patient in preparation/treatment. Complete or move the treatment before changing the chair status.');
    }
  }
  if (['PREPARING', 'INFUSING'].includes(status)) {
    throw badRequest('Preparing/Infusing statuses are set automatically by the treatment workflow.');
  }
  const clearOccupant = ['AVAILABLE', 'CLEANING', 'OUT_OF_SERVICE'].includes(status);
  const updated = await q1(
    db,
    `UPDATE chairs SET status=$2, status_note=$3, status_changed_at=now(), status_changed_by=$4,
            current_appointment_id = CASE WHEN $5 THEN NULL ELSE current_appointment_id END
      WHERE id=$1 RETURNING *`,
    [id, status, note, actor.id, clearOccupant],
  );
  await audit(db, actor, {
    action: 'CHAIR_STATUS_CHANGED',
    entityType: 'chair',
    entityId: id,
    previous: { status: chair.status },
    next: { status, note },
  });
  return updated;
}

/** Workflow-driven chair occupancy update. */
export async function occupyChair(db: Db, chairId: string, appointmentId: string, status: 'RESERVED' | 'PREPARING' | 'INFUSING', actor: Actor) {
  const chair = await q1(db, 'SELECT * FROM chairs WHERE id=$1 FOR UPDATE', [chairId]);
  if (!chair) throw notFound('Chair');
  if (chair.status === 'OUT_OF_SERVICE') throw conflict(`${chair.name} is out of service. Assign another chair.`);
  if (chair.current_appointment_id && chair.current_appointment_id !== appointmentId && ['PREPARING', 'INFUSING', 'RESERVED'].includes(chair.status)) {
    const other = await q1(db, 'SELECT status FROM appointments WHERE id=$1', [chair.current_appointment_id]);
    if (other && ['ARRIVED', 'IN_PREPARATION', 'IN_TREATMENT'].includes(other.status)) {
      throw conflict(`${chair.name} is currently occupied by another patient. Assign another chair or wait until it is released.`);
    }
  }
  await db.query(
    `UPDATE chairs SET status=$2, current_appointment_id=$3, status_changed_at=now(), status_changed_by=$4 WHERE id=$1`,
    [chairId, status, appointmentId, actor.id],
  );
  if (chair.status !== status) {
    await audit(db, actor, {
      action: 'CHAIR_STATUS_CHANGED',
      entityType: 'chair',
      entityId: chairId,
      previous: { status: chair.status },
      next: { status, appointmentId },
    });
  }
}

/** Releases a chair after completion / cancellation (AVAILABLE, or CLEANING if configured). */
export async function releaseChair(db: Db, chairId: string, appointmentId: string, actor: Actor, reason: string) {
  const chair = await q1(db, 'SELECT * FROM chairs WHERE id=$1 FOR UPDATE', [chairId]);
  if (!chair || chair.current_appointment_id !== appointmentId) return null;
  const s = await getSettings();
  const next = s.chair_cleaning_after_treatment && reason === 'TREATMENT_COMPLETED' ? 'CLEANING' : 'AVAILABLE';
  await db.query(
    `UPDATE chairs SET status=$2, current_appointment_id=NULL, status_changed_at=now(), status_changed_by=$3 WHERE id=$1`,
    [chairId, next, actor.id],
  );
  await audit(db, actor, {
    action: 'CHAIR_RELEASED',
    entityType: 'chair',
    entityId: chairId,
    description: `${chair.name} released (${reason})`,
    previous: { status: chair.status },
    next: { status: next },
  });
  return next;
}
