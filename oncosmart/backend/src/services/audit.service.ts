import type { Request } from 'express';
import { Db, pool, q } from '../db/pool';

export interface Actor {
  id: string | null;
  email: string | null;
  role: string | null;
  ip?: string | null;
  userAgent?: string | null;
}

export function actorFrom(req: Request): Actor {
  return {
    id: req.user?.id ?? null,
    email: req.user?.email ?? null,
    role: req.user?.role ?? null,
    ip: req.ip ?? null,
    userAgent: (req.headers['user-agent'] as string | undefined)?.slice(0, 250) ?? null,
  };
}

export const SYSTEM_ACTOR: Actor = { id: null, email: 'system', role: 'SYSTEM' };

export interface AuditEntry {
  action: string;
  entityType?: string;
  entityId?: string | null;
  patientId?: string | null;
  description?: string;
  previous?: unknown;
  next?: unknown;
}

/** Appends an audit record. Must be called inside the same transaction as the change when one is used. */
export async function audit(db: Db, actor: Actor, entry: AuditEntry) {
  await db.query(
    `INSERT INTO audit_logs (user_id, user_email, user_role, action, entity_type, entity_id, patient_id,
                             description, previous_value, new_value, ip_address, user_agent)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [
      actor.id,
      actor.email,
      actor.role,
      entry.action,
      entry.entityType ?? null,
      entry.entityId ?? null,
      entry.patientId ?? null,
      entry.description ?? null,
      entry.previous === undefined ? null : JSON.stringify(entry.previous),
      entry.next === undefined ? null : JSON.stringify(entry.next),
      actor.ip ?? null,
      actor.userAgent ?? null,
    ],
  );
}

/** Returns only the fields that changed between two objects (for concise previous/new audit values). */
export function diff(before: Record<string, any>, after: Record<string, any>) {
  const prev: Record<string, any> = {};
  const next: Record<string, any> = {};
  for (const key of Object.keys(after)) {
    const a = before[key] ?? null;
    const b = after[key] ?? null;
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      prev[key] = a;
      next[key] = b;
    }
  }
  return { prev, next, changed: Object.keys(next).length > 0 };
}

export interface AuditQuery {
  from?: string;
  to?: string;
  action?: string;
  userId?: string;
  patientId?: string;
  entityType?: string;
  page?: number;
  pageSize?: number;
}

export async function listAudit(filters: AuditQuery) {
  const where: string[] = [];
  const params: unknown[] = [];
  const add = (sql: string, v: unknown) => {
    params.push(v);
    where.push(sql.replace('?', `$${params.length}`));
  };
  if (filters.from) add('a.occurred_at >= ?::date', filters.from);
  if (filters.to) add("a.occurred_at < (?::date + interval '1 day')", filters.to);
  if (filters.action) add('a.action = ?', filters.action);
  if (filters.userId) add('a.user_id = ?', filters.userId);
  if (filters.patientId) add('a.patient_id = ?', filters.patientId);
  if (filters.entityType) add('a.entity_type = ?', filters.entityType);
  const pageSize = Math.min(filters.pageSize ?? 50, 200);
  const page = Math.max(filters.page ?? 1, 1);
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [{ total }] = await q<{ total: number }>(pool, `SELECT count(*)::int AS total FROM audit_logs a ${whereSql}`, params);
  const rows = await q(
    pool,
    `SELECT a.id, a.occurred_at, a.user_id, a.user_email, a.user_role, u.full_name AS user_name, a.action,
            a.entity_type, a.entity_id, a.patient_id, p.mrn AS patient_mrn,
            (p.first_name || ' ' || p.last_name) AS patient_name, a.description, a.previous_value, a.new_value, a.ip_address
       FROM audit_logs a
       LEFT JOIN users u ON u.id = a.user_id
       LEFT JOIN patients p ON p.id = a.patient_id
       ${whereSql}
      ORDER BY a.occurred_at DESC, a.id DESC
      LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
    params,
  );
  const actions = await q<{ action: string }>(pool, 'SELECT DISTINCT action FROM audit_logs ORDER BY action');
  return { rows, total, page, pageSize, actions: actions.map((a) => a.action) };
}
