import type { Request, Response } from 'express';
import { z } from 'zod';
import { env } from '../config/env';
import { pool, q1, tx } from '../db/pool';
import { parseWhatsAppWebhook, verifyWebhookSignature } from '../integrations/messaging/whatsappCloud.provider';
import { applyPatientResponse } from '../services/appointment.service';
import { actorFrom, audit, listAudit, SYSTEM_ACTOR } from '../services/audit.service';
import * as chairs from '../services/chair.service';
import { getDashboard } from '../services/dashboard.service';
import { infusionBoard } from '../services/infusion.service';
import { applyStatusEvent, listNotifications, processQueue, retryNotification } from '../services/notification.service';
import * as protocols from '../services/protocols.service';
import { ROUNDING_RULES } from '../services/doseCalculator';
import { REPORT_TYPES, runReport } from '../services/reports.service';
import { globalSearch } from '../services/search.service';
import { getSettings, listSettingsRows, updateSettings } from '../services/settings.service';
import * as users from '../services/users.service';
import { buildCsv, buildXlsx } from '../utils/xlsx';
import { seedDemoData } from '../../database/seed/demoSeed';
import { badRequest, conflict, forbidden, notFound } from '../utils/errors';
import {
  chairSchema,
  chairStatusSchema,
  chairUpdateSchema,
  isoDate,
  passwordSchema,
  protocolSchema,
  rangeSchema,
  searchSchema,
  simulateSchema,
  userSchema,
  userUpdateSchema,
  uuid,
} from './schemas';

// ---------------------------------------------------------------- dashboard / infusion / search
export const dashboard = async (req: Request, res: Response) => res.json(await getDashboard(req.user!));
export const infusion = async (req: Request, res: Response) =>
  res.json(await infusionBoard(typeof req.query.date === 'string' ? isoDate.parse(req.query.date) : undefined));
export async function search(req: Request, res: Response) {
  const { q } = searchSchema.parse(req.body);
  res.json(await globalSearch(q, req.user!));
}

// ---------------------------------------------------------------- chairs
export const listChairs = async (req: Request, res: Response) =>
  res.json(await chairs.listChairs(typeof req.query.date === 'string' ? isoDate.parse(req.query.date) : undefined));
export async function createChair(req: Request, res: Response) {
  const body = chairSchema.parse(req.body);
  res.status(201).json(await tx((db) => chairs.createChair(db, body, actorFrom(req))));
}
export async function updateChair(req: Request, res: Response) {
  const body = chairUpdateSchema.parse(req.body);
  res.json(await tx((db) => chairs.updateChair(db, uuid.parse(req.params.id), body, actorFrom(req))));
}
export async function setChairStatus(req: Request, res: Response) {
  const body = chairStatusSchema.parse(req.body);
  res.json(await tx((db) => chairs.setChairStatus(db, uuid.parse(req.params.id), body.status, body.note ?? null, actorFrom(req))));
}

// ---------------------------------------------------------------- protocols
export const listProtocols = async (req: Request, res: Response) => res.json(await protocols.listProtocols(req.query.all === 'true'));
export const getProtocol = async (req: Request, res: Response) => res.json(await protocols.getProtocol(pool, uuid.parse(req.params.id)));
export async function createProtocol(req: Request, res: Response) {
  const body = protocolSchema.parse(req.body);
  res.status(201).json(await tx((db) => protocols.createProtocol(db, body, actorFrom(req))));
}
export async function updateProtocol(req: Request, res: Response) {
  const body = protocolSchema.parse(req.body);
  res.json(await tx((db) => protocols.updateProtocol(db, uuid.parse(req.params.id), body, actorFrom(req))));
}
export async function setProtocolActive(req: Request, res: Response) {
  const { isActive } = z.object({ isActive: z.boolean() }).parse(req.body);
  res.json(await tx((db) => protocols.setProtocolActive(db, uuid.parse(req.params.id), isActive, actorFrom(req))));
}
export const drugCatalog = async (_req: Request, res: Response) => res.json(await protocols.listDrugCatalog());
export const roundingRules = async (_req: Request, res: Response) => res.json(ROUNDING_RULES);

// ---------------------------------------------------------------- notifications & WhatsApp
export async function listMessages(req: Request, res: Response) {
  res.json(
    await listNotifications({
      status: typeof req.query.status === 'string' ? req.query.status : undefined,
      type: typeof req.query.type === 'string' ? req.query.type : undefined,
      from: typeof req.query.from === 'string' ? isoDate.parse(req.query.from) : undefined,
      to: typeof req.query.to === 'string' ? isoDate.parse(req.query.to) : undefined,
    }),
  );
}

/** Demo simulator: drives the SAME inbound-event code path a real WhatsApp webhook would. */
export async function simulateMessage(req: Request, res: Response) {
  if (env.MESSAGING_PROVIDER !== 'mock') throw forbidden('Simulation is only available with the mock messaging provider.');
  const { event } = simulateSchema.parse(req.body);
  const id = uuid.parse(req.params.id);
  const n = await q1(pool, 'SELECT * FROM notifications WHERE id=$1', [id]);
  if (!n) throw notFound('Notification');
  const actor = { ...SYSTEM_ACTOR, email: `whatsapp-simulator (${req.user!.email})` };
  const result = await tx(async (db) => {
    if (['DELIVERED', 'READ', 'FAILED'].includes(event)) {
      if (n.status === 'PENDING') throw conflict('Message has not been sent yet.');
      if (!n.provider_message_id) throw conflict('Message has no provider id (it may have failed to send).');
      await applyStatusEvent(db, { kind: 'STATUS', providerMessageId: n.provider_message_id, status: event as any, reason: event === 'FAILED' ? 'Simulated delivery failure' : undefined });
      await audit(db, actor, { action: 'WHATSAPP_STATUS_SIMULATED', entityType: 'notification', entityId: id, patientId: n.patient_id, next: { status: event } });
      return null;
    }
    if (!['SENT', 'DELIVERED', 'READ'].includes(n.status)) throw conflict('The patient can only reply to a delivered message.');
    if (!n.interactive_options?.options) throw conflict('This message has no reply buttons.');
    return applyPatientResponse(db, id, event as 'CONFIRM' | 'RESCHEDULE' | 'CANCEL', actor);
  });
  res.json({ ok: true, appointment: result });
}

export async function retryMessage(req: Request, res: Response) {
  const n = await tx((db) => retryNotification(db, uuid.parse(req.params.id), actorFrom(req)));
  if (!n) throw conflict('Only failed messages can be retried.');
  res.json({ ok: true });
}

export async function processMessages(_req: Request, res: Response) {
  res.json({ processed: await processQueue() });
}

/** Meta webhook verification handshake (GET). */
export function whatsappVerify(req: Request, res: Response) {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  if (mode === 'subscribe' && env.WHATSAPP_VERIFY_TOKEN && token === env.WHATSAPP_VERIFY_TOKEN) {
    return res.status(200).send(String(req.query['hub.challenge'] ?? ''));
  }
  res.sendStatus(403);
}

/** Meta webhook receiver (POST) — only active with MESSAGING_PROVIDER=whatsapp_cloud. */
export async function whatsappWebhook(req: Request, res: Response) {
  if (env.MESSAGING_PROVIDER !== 'whatsapp_cloud') return res.sendStatus(404);
  const raw: Buffer | undefined = (req as any).rawBody;
  if (!raw || !verifyWebhookSignature(raw, req.headers['x-hub-signature-256'] as string | undefined)) return res.sendStatus(401);
  const events = parseWhatsAppWebhook(req.body);
  await tx(async (db) => {
    for (const ev of events) {
      if (ev.kind === 'STATUS') await applyStatusEvent(db, ev);
      else if (ev.providerMessageId) {
        const n = await q1(db, 'SELECT id FROM notifications WHERE provider_message_id=$1', [ev.providerMessageId]);
        if (n) await applyPatientResponse(db, n.id, ev.response, { ...SYSTEM_ACTOR, email: 'whatsapp-webhook' });
      }
    }
  });
  res.sendStatus(200);
}

// ---------------------------------------------------------------- reports
export const reportTypes = (_req: Request, res: Response) => res.json(REPORT_TYPES);

export async function report(req: Request, res: Response) {
  const { from, to } = rangeSchema.parse(req.query);
  if (from > to) throw badRequest('“From” date must be before “to” date.');
  res.json(await runReport(String(req.params.type), from, to));
}

export async function exportReport(req: Request, res: Response) {
  const { from, to } = rangeSchema.parse(req.query);
  const format = req.query.format === 'xlsx' ? 'xlsx' : 'csv';
  const r = await runReport(String(req.params.type), from, to);
  const header = r.columns.map((c) => c.label);
  const rows = r.rows.map((row) => r.columns.map((c) => row[c.key] ?? ''));
  const s = await getSettings();
  const meta = [`${s.hospital_name} — ${s.unit_name}`, `${r.title}`, `Period: ${from} to ${to}`, 'DEMO / TEST DATA'];
  await audit(pool, actorFrom(req), { action: 'REPORT_EXPORTED', entityType: 'report', entityId: r.type, description: `${format} ${from}..${to}` });
  const filename = `oncosmart-${r.type}-${from}_${to}.${format}`;
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  if (format === 'xlsx') {
    res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    return res.send(buildXlsx(r.type, header, [...rows, [], ...meta.map((m) => [m])]));
  }
  res.type('text/csv; charset=utf-8').send(buildCsv(header, [...rows, [], ...meta.map((m) => [m])]));
}

// ---------------------------------------------------------------- users
export const listUsers = async (_req: Request, res: Response) => res.json(await users.listUsers());
export const listPhysicians = async (_req: Request, res: Response) => res.json(await users.listPhysicians());
export async function createUser(req: Request, res: Response) {
  const body = userSchema.parse(req.body);
  res.status(201).json(await tx((db) => users.createUser(db, body, actorFrom(req))));
}
export async function updateUser(req: Request, res: Response) {
  const body = userUpdateSchema.parse(req.body);
  res.json(await tx((db) => users.updateUser(db, uuid.parse(req.params.id), body, actorFrom(req))));
}
export async function resetUserPassword(req: Request, res: Response) {
  const { password } = passwordSchema.parse(req.body);
  await tx((db) => users.resetPassword(db, uuid.parse(req.params.id), password, actorFrom(req)));
  res.json({ ok: true });
}

// ---------------------------------------------------------------- settings & audit
export async function getSettingsHandler(req: Request, res: Response) {
  const s = await getSettings();
  const admin = req.user!.role === 'ADMIN';
  res.json({ settings: s, rows: admin ? await listSettingsRows() : undefined, demoMode: env.DEMO_MODE, messagingProvider: env.MESSAGING_PROVIDER });
}

const EDITABLE_SETTINGS = [
  'hospital_name', 'unit_name', 'unit_phone', 'timezone', 'default_language', 'languages_enabled', 'units', 'unit_open_time',
  'unit_close_time', 'default_appointment_duration_min', 'arrival_minutes_before', 'delay_grace_minutes',
  'chair_cleaning_after_treatment', 'reminder_24h_enabled', 'reminder_2h_enabled', 'reminder_same_day_enabled',
  'reminder_same_day_time', 'whatsapp_template_en', 'whatsapp_template_ar', 'default_rounding_rule',
  'dose_difference_threshold_pct', 'weight_change_threshold_pct', 'lab_validity_days', 'calvert_gfr_review_threshold',
  'pretreatment_checklist',
];

export async function updateSettingsHandler(req: Request, res: Response) {
  const body = z.record(z.string(), z.unknown()).parse(req.body);
  const unknownKeys = Object.keys(body).filter((k) => !EDITABLE_SETTINGS.includes(k));
  if (unknownKeys.length) throw badRequest(`Unknown setting(s): ${unknownKeys.join(', ')}`);
  if (body.timezone !== undefined) {
    try {
      new Intl.DateTimeFormat('en', { timeZone: String(body.timezone) });
    } catch {
      throw badRequest('Invalid time zone.');
    }
  }
  if (body.default_rounding_rule !== undefined && !ROUNDING_RULES.some((r) => r.code === body.default_rounding_rule)) {
    throw badRequest('Invalid rounding rule.');
  }
  const previous = await tx((db) => updateSettings(db, body, req.user!.id));
  await audit(pool, actorFrom(req), { action: 'SETTINGS_UPDATED', entityType: 'settings', previous, next: body });
  res.json({ settings: await getSettings() });
}

export async function labTests(_req: Request, res: Response) {
  res.json((await pool.query('SELECT * FROM lab_test_definitions WHERE is_active ORDER BY sort_order')).rows);
}

export async function auditLog(req: Request, res: Response) {
  const f = z
    .object({
      from: isoDate.optional(),
      to: isoDate.optional(),
      action: z.string().max(60).optional(),
      userId: uuid.optional(),
      patientId: uuid.optional(),
      entityType: z.string().max(40).optional(),
      page: z.coerce.number().int().min(1).optional(),
      pageSize: z.coerce.number().int().min(1).max(200).optional(),
    })
    .parse(req.query);
  res.json(await listAudit(f));
}

// ---------------------------------------------------------------- demo reset
export async function resetDemo(req: Request, res: Response) {
  if (!env.DEMO_MODE) throw forbidden('Demo reset is disabled (DEMO_MODE=false).');
  await seedDemoData();
  await audit(pool, actorFrom(req), { action: 'DEMO_DATA_RESET', entityType: 'system' });
  res.json({ ok: true });
}
