import { Db, pool, q, q1 } from '../db/pool';
import { getMessagingProvider, InboundEvent, InteractiveOption, normalizePhone } from '../integrations/messaging';
import { formatDateForMessage, localToUtc } from '../utils/dates';
import { Actor, audit, SYSTEM_ACTOR } from './audit.service';
import { getSettings, UnitSettings } from './settings.service';

export type NotificationType =
  | 'APPOINTMENT_CREATED'
  | 'APPOINTMENT_RESCHEDULED'
  | 'APPOINTMENT_CANCELLED'
  | 'REMINDER_24H'
  | 'REMINDER_2H'
  | 'REMINDER_SAME_DAY'
  | 'MANUAL_REMINDER';

const OPTIONS: Record<'en' | 'ar', InteractiveOption[]> = {
  en: [
    { id: 'CONFIRM', title: 'Confirm Appointment' },
    { id: 'RESCHEDULE', title: 'Request Reschedule' },
    { id: 'CANCEL', title: 'Cancel' },
  ],
  ar: [
    { id: 'CONFIRM', title: 'تأكيد الموعد' },
    { id: 'RESCHEDULE', title: 'طلب تغيير الموعد' },
    { id: 'CANCEL', title: 'إلغاء' },
  ],
};

interface ApptForMessage {
  id: string;
  patient_id: string;
  appointment_date: string;
  start_time: string;
  first_name: string;
  last_name: string;
  full_name_ar: string | null;
  phone: string | null;
  preferred_language: 'en' | 'ar';
}

export function renderTemplate(template: string, vars: Record<string, string | number>) {
  return template.replace(/\{(\w+)\}/g, (_, k) => (vars[k] !== undefined ? String(vars[k]) : `{${k}}`));
}

function buildMessage(appt: ApptForMessage, type: NotificationType, s: UnitSettings) {
  const lang = appt.preferred_language === 'en' ? 'en' : 'ar';
  const patientName = lang === 'ar' && appt.full_name_ar ? appt.full_name_ar : `${appt.first_name} ${appt.last_name}`;
  const vars = {
    patientName,
    date: formatDateForMessage(appt.appointment_date, lang),
    time: appt.start_time.slice(0, 5),
    arrivalMinutes: s.arrival_minutes_before,
    hospitalName: s.hospital_name,
    unitName: s.unit_name,
    unitPhone: s.unit_phone,
  };
  const template = lang === 'ar' ? s.whatsapp_template_ar : s.whatsapp_template_en;
  let body: string;
  if (type === 'APPOINTMENT_CANCELLED') {
    body =
      lang === 'ar'
        ? `عزيزي/عزيزتي ${patientName}،\n\nتم إلغاء موعد العلاج الكيميائي بتاريخ ${vars.date} الساعة ${vars.time}.\n\nالمستشفى: ${vars.hospitalName}\n\nيرجى التواصل مع وحدة العلاج الكيميائي لتحديد موعد جديد.`
        : `Dear ${patientName},\n\nYour chemotherapy appointment on ${vars.date} at ${vars.time} has been cancelled.\n\nHospital: ${vars.hospitalName}\n\nPlease contact the chemotherapy unit to arrange a new appointment.`;
  } else {
    body = renderTemplate(template, vars);
    if (type === 'APPOINTMENT_RESCHEDULED') {
      body = (lang === 'ar' ? 'تم تغيير موعدكم.\n\n' : 'Your appointment has been changed.\n\n') + body;
    }
  }
  const interactive = type === 'APPOINTMENT_CANCELLED' ? null : OPTIONS[lang];
  const templateParams = [vars.patientName, vars.date, vars.time, String(vars.arrivalMinutes), vars.hospitalName];
  return { body, lang, interactive, templateParams };
}

async function loadAppt(db: Db, appointmentId: string) {
  return q1<ApptForMessage>(
    db,
    `SELECT a.id, a.patient_id, a.appointment_date, a.start_time::text AS start_time,
            p.first_name, p.last_name, p.full_name_ar, p.phone, p.preferred_language
       FROM appointments a JOIN patients p ON p.id = a.patient_id WHERE a.id = $1`,
    [appointmentId],
  );
}

async function insertNotification(
  db: Db,
  appt: ApptForMessage,
  type: NotificationType,
  scheduledFor: Date,
  s: UnitSettings,
  actorId: string | null,
) {
  const msg = buildMessage(appt, type, s);
  return q1(
    db,
    `INSERT INTO notifications (patient_id, appointment_id, channel, notification_type, recipient, language,
                                message_body, interactive_options, status, scheduled_for, provider, created_by)
     VALUES ($1,$2,'WHATSAPP',$3,$4,$5,$6,$7,'PENDING',$8,$9,$10) RETURNING id`,
    [
      appt.patient_id,
      appt.id,
      type,
      normalizePhone(appt.phone) ?? appt.phone,
      msg.lang,
      msg.body,
      msg.interactive ? JSON.stringify({ options: msg.interactive, templateParams: msg.templateParams }) : JSON.stringify({ templateParams: msg.templateParams }),
      scheduledFor,
      getMessagingProvider().name,
      actorId,
    ],
  );
}

/**
 * Queues the immediate appointment message plus the configured reminders
 * (24 h, 2 h, optional same-day). Reminders whose time has already passed are skipped.
 */
export async function queueAppointmentMessages(
  db: Db,
  appointmentId: string,
  kind: 'APPOINTMENT_CREATED' | 'APPOINTMENT_RESCHEDULED',
  actor: Actor,
) {
  const s = await getSettings();
  const appt = await loadAppt(db, appointmentId);
  if (!appt) return;
  const now = new Date();
  await insertNotification(db, appt, kind, now, s, actor.id);
  const start = localToUtc(appt.appointment_date, appt.start_time, s.timezone);
  const reminders: [NotificationType, Date, boolean][] = [
    ['REMINDER_24H', new Date(start.getTime() - 24 * 3600 * 1000), s.reminder_24h_enabled],
    ['REMINDER_2H', new Date(start.getTime() - 2 * 3600 * 1000), s.reminder_2h_enabled],
    ['REMINDER_SAME_DAY', localToUtc(appt.appointment_date, s.reminder_same_day_time, s.timezone), s.reminder_same_day_enabled],
  ];
  for (const [type, when, enabled] of reminders) {
    if (enabled && when > now && when < start) await insertNotification(db, appt, type, when, s, actor.id);
  }
}

export async function queueCancellationMessage(db: Db, appointmentId: string, actor: Actor) {
  const s = await getSettings();
  const appt = await loadAppt(db, appointmentId);
  if (appt) await insertNotification(db, appt, 'APPOINTMENT_CANCELLED', new Date(), s, actor.id);
}

export async function queueManualReminder(db: Db, appointmentId: string, actor: Actor) {
  const s = await getSettings();
  const appt = await loadAppt(db, appointmentId);
  if (!appt) return null;
  return insertNotification(db, appt, 'MANUAL_REMINDER', new Date(), s, actor.id);
}

export async function cancelPendingForAppointment(db: Db, appointmentId: string) {
  await db.query(
    `UPDATE notifications SET status = 'CANCELLED' WHERE appointment_id = $1 AND status = 'PENDING'`,
    [appointmentId],
  );
}

/** Sends due notifications through the configured provider. Safe to run concurrently (SKIP LOCKED). */
export async function processQueue(limit = 25) {
  const provider = getMessagingProvider();
  const client = await pool.connect();
  let processed = 0;
  try {
    await client.query('BEGIN');
    const due = await q(
      client,
      `SELECT * FROM notifications WHERE status = 'PENDING' AND scheduled_for <= now()
        ORDER BY scheduled_for LIMIT $1 FOR UPDATE SKIP LOCKED`,
      [limit],
    );
    for (const n of due) {
      const opts = n.interactive_options ?? {};
      let result;
      try {
        result = await provider.send({
          notificationId: n.id,
          to: n.recipient,
          language: n.language,
          body: n.message_body,
          notificationType: n.notification_type,
          interactiveOptions: opts.options,
          templateParams: opts.templateParams,
        });
      } catch (err) {
        result = { status: 'FAILED' as const, failureReason: (err as Error).message };
      }
      if (result.status === 'SENT') {
        await client.query(
          `UPDATE notifications SET status='SENT', sent_at=now(), attempts=attempts+1, last_attempt_at=now(),
                  provider=$2, provider_message_id=$3 WHERE id=$1`,
          [n.id, provider.name, result.providerMessageId ?? null],
        );
      } else {
        await client.query(
          `UPDATE notifications SET status='FAILED', failed_at=now(), attempts=attempts+1, last_attempt_at=now(),
                  failure_reason=$2, provider=$3 WHERE id=$1`,
          [n.id, result.failureReason ?? 'Unknown error', provider.name],
        );
      }
      processed++;
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
  return processed;
}

/** Mock only: advances SENT → DELIVERED (after ~5 s) → READ (after ~20 s) to simulate receipts. */
export async function autoProgressMockReceipts() {
  if (!getMessagingProvider().simulatesReceipts) return;
  await pool.query(
    `UPDATE notifications SET status='DELIVERED', delivered_at=now()
      WHERE status='SENT' AND provider='mock_whatsapp' AND sent_at < now() - interval '5 seconds'`,
  );
  await pool.query(
    `UPDATE notifications SET status='READ', read_at=now()
      WHERE status='DELIVERED' AND provider='mock_whatsapp' AND delivered_at < now() - interval '15 seconds'`,
  );
}

/** Applies a delivery-status event (from a real webhook or the simulator). */
export async function applyStatusEvent(db: Db, event: Extract<InboundEvent, { kind: 'STATUS' }>) {
  const col = { SENT: 'sent_at', DELIVERED: 'delivered_at', READ: 'read_at', FAILED: 'failed_at' }[event.status];
  const n = await q1(
    db,
    `UPDATE notifications SET status=$2, ${col}=now(), failure_reason = COALESCE($3, failure_reason)
      WHERE provider_message_id=$1 RETURNING id, appointment_id, patient_id`,
    [event.providerMessageId, event.status, event.reason ?? null],
  );
  return n;
}

export async function recordResponse(db: Db, notificationId: string, response: 'CONFIRM' | 'RESCHEDULE' | 'CANCEL') {
  await db.query(
    `UPDATE notifications SET patient_response=$2, responded_at=now(),
            status = CASE WHEN status IN ('SENT','DELIVERED') THEN 'READ' ELSE status END,
            read_at = COALESCE(read_at, now())
      WHERE id=$1`,
    [notificationId, response],
  );
}

export interface NotificationFilters {
  status?: string;
  type?: string;
  appointmentId?: string;
  from?: string;
  to?: string;
  limit?: number;
}

export async function listNotifications(f: NotificationFilters) {
  const where: string[] = [];
  const params: unknown[] = [];
  const add = (sql: string, v: unknown) => {
    params.push(v);
    where.push(sql.replace('?', `$${params.length}`));
  };
  if (f.status) add('n.status = ?', f.status);
  if (f.type) add('n.notification_type = ?', f.type);
  if (f.appointmentId) add('n.appointment_id = ?', f.appointmentId);
  if (f.from) add('n.scheduled_for >= ?::date', f.from);
  if (f.to) add("n.scheduled_for < (?::date + interval '1 day')", f.to);
  const limit = Math.min(f.limit ?? 200, 500);
  return q(
    pool,
    `SELECT n.id, n.appointment_id, n.patient_id, n.channel, n.notification_type, n.recipient, n.language,
            n.message_body, n.interactive_options, n.status, n.scheduled_for, n.sent_at, n.delivered_at, n.read_at,
            n.failed_at, n.failure_reason, n.provider, n.provider_message_id, n.patient_response, n.responded_at,
            n.created_at, p.first_name || ' ' || p.last_name AS patient_name, p.mrn,
            a.appointment_date, a.start_time::text AS start_time, a.status AS appointment_status, a.appointment_number
       FROM notifications n
       LEFT JOIN patients p ON p.id = n.patient_id
       LEFT JOIN appointments a ON a.id = n.appointment_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY n.scheduled_for DESC
      LIMIT ${limit}`,
    params,
  );
}

export async function retryNotification(db: Db, id: string, actor: Actor) {
  const n = await q1(db, `UPDATE notifications SET status='PENDING', scheduled_for=now(), failure_reason=NULL
                            WHERE id=$1 AND status='FAILED' RETURNING id, patient_id, recipient`, [id]);
  if (n) await audit(db, actor, { action: 'NOTIFICATION_RETRIED', entityType: 'notification', entityId: id, patientId: n.patient_id });
  return n;
}

export { SYSTEM_ACTOR };
