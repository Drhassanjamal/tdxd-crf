import type { Request, Response } from 'express';
import { pool, tx } from '../db/pool';
import * as svc from '../services/appointment.service';
import { actorFrom } from '../services/audit.service';
import { listNotifications } from '../services/notification.service';
import { getSettings } from '../services/settings.service';
import { addDays, todayInTz } from '../utils/dates';
import {
  appointmentSchema,
  appointmentStatusSchema,
  appointmentUpdateSchema,
  hhmm,
  isoDate,
  reasonSchema,
  uuid,
} from './schemas';
import { z } from 'zod';

const aid = (req: Request) => uuid.parse(req.params.id);

export async function list(req: Request, res: Response) {
  const s = await getSettings();
  const today = todayInTz(s.timezone);
  const from = typeof req.query.from === 'string' ? isoDate.parse(req.query.from) : today;
  const to = typeof req.query.to === 'string' ? isoDate.parse(req.query.to) : addDays(from, 0);
  res.json(
    await svc.listAppointments({
      from,
      to,
      chairId: typeof req.query.chairId === 'string' ? uuid.parse(req.query.chairId) : undefined,
      status: typeof req.query.status === 'string' ? req.query.status : undefined,
    }),
  );
}

export const get = async (req: Request, res: Response) => {
  const appt = await svc.getAppointment(pool, aid(req));
  const notifications = await listNotifications({ appointmentId: appt.id });
  res.json({ ...appt, notifications });
};

export async function create(req: Request, res: Response) {
  const body = appointmentSchema.parse(req.body);
  res.status(201).json(await tx((db) => svc.createAppointment(db, body, actorFrom(req))));
}

export async function update(req: Request, res: Response) {
  const body = appointmentUpdateSchema.parse(req.body);
  res.json(await tx((db) => svc.updateAppointment(db, aid(req), body, actorFrom(req))));
}

export async function cancel(req: Request, res: Response) {
  const { reason } = reasonSchema.parse(req.body);
  res.json(await tx((db) => svc.cancelAppointment(db, aid(req), reason, actorFrom(req))));
}

export const checkIn = async (req: Request, res: Response) => res.json(await tx((db) => svc.checkInAppointment(db, aid(req), actorFrom(req))));

export async function setStatus(req: Request, res: Response) {
  const { status } = appointmentStatusSchema.parse(req.body);
  res.json(await tx((db) => svc.setAppointmentStatus(db, aid(req), status, actorFrom(req))));
}

export async function sendReminder(req: Request, res: Response) {
  const n = await tx((db) => svc.sendManualReminder(db, aid(req), actorFrom(req)));
  res.status(201).json(n);
}

export async function suggestChair(req: Request, res: Response) {
  const p = z.object({ date: isoDate, time: hhmm, duration: z.coerce.number().int().min(10).max(720) }).parse(req.query);
  res.json(await svc.suggestChair(pool, p.date, p.time, p.duration));
}
