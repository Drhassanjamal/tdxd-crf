import type { Request, Response } from 'express';
import { pool, tx } from '../db/pool';
import { actorFrom } from '../services/audit.service';
import * as svc from '../services/orders.service';
import { getOrderDetail } from '../services/orders.service';
import {
  administrationSchema,
  approveSchema,
  completeSchema,
  delaySchema,
  eventSchema,
  isoDate,
  orderSchema,
  reasonSchema,
  uuid,
  verifySchema,
} from './schemas';

const oid = (req: Request) => uuid.parse(req.params.id);
const detail = (req: Request) => getOrderDetail(pool, oid(req), req.user!);

export async function preview(req: Request, res: Response) {
  const body = orderSchema.parse(req.body);
  res.json(await svc.previewOrder(pool, body));
}

export async function create(req: Request, res: Response) {
  const { submit, ...body } = orderSchema.parse(req.body);
  const order = await tx((db) => svc.createOrder(db, body, actorFrom(req), !!submit));
  res.status(201).json(await getOrderDetail(pool, order.id, req.user!));
}

export async function list(req: Request, res: Response) {
  res.json(
    await svc.listOrders({
      status: typeof req.query.status === 'string' ? req.query.status : undefined,
      from: typeof req.query.from === 'string' ? isoDate.parse(req.query.from) : undefined,
      to: typeof req.query.to === 'string' ? isoDate.parse(req.query.to) : undefined,
    }),
  );
}

export const get = async (req: Request, res: Response) => res.json(await detail(req));

export async function update(req: Request, res: Response) {
  const { submit, treatmentPlanId: _ignored, ...body } = orderSchema.parse(req.body);
  await tx(async (db) => {
    await svc.updateOrder(db, oid(req), body, actorFrom(req));
    if (submit) await svc.submitOrder(db, oid(req), actorFrom(req));
  });
  res.json(await detail(req));
}

const simple = (fn: (db: any, id: string, actor: any) => Promise<unknown>) => async (req: Request, res: Response) => {
  await tx((db) => fn(db, oid(req), actorFrom(req)));
  res.json(await detail(req));
};

export const submit = simple(svc.submitOrder);
export const release = simple(svc.releaseForPreparation);
export const prepared = simple(svc.markPrepared);
export const start = simple(svc.startTreatment);
export const resume = simple(svc.resumeOrder);

export async function approve(req: Request, res: Response) {
  const body = approveSchema.parse(req.body ?? {});
  await tx((db) => svc.approveOrder(db, oid(req), actorFrom(req), body));
  res.json(await detail(req));
}

export async function returnToDraft(req: Request, res: Response) {
  const { reason } = reasonSchema.parse(req.body);
  await tx((db) => svc.returnOrder(db, oid(req), actorFrom(req), reason));
  res.json(await detail(req));
}

export async function verify(req: Request, res: Response) {
  const { checklist } = verifySchema.parse(req.body);
  await tx((db) => svc.verifyOrder(db, oid(req), actorFrom(req), checklist));
  res.json(await detail(req));
}

export async function complete(req: Request, res: Response) {
  const body = completeSchema.parse(req.body);
  const result = await tx((db) => svc.completeTreatment(db, oid(req), actorFrom(req), body));
  res.json({ ...(await detail(req)), completion: result });
}

export async function hold(req: Request, res: Response) {
  const { reason } = reasonSchema.parse(req.body);
  await tx((db) => svc.holdOrder(db, oid(req), actorFrom(req), reason, 'HELD'));
  res.json(await detail(req));
}

export async function delay(req: Request, res: Response) {
  const { reason, delayedUntil } = delaySchema.parse(req.body);
  await tx((db) => svc.holdOrder(db, oid(req), actorFrom(req), reason, 'DELAYED', delayedUntil));
  res.json(await detail(req));
}

export async function cancel(req: Request, res: Response) {
  const { reason } = reasonSchema.parse(req.body);
  await tx((db) => svc.cancelOrder(db, oid(req), actorFrom(req), reason));
  res.json(await detail(req));
}

export async function reportEvent(req: Request, res: Response) {
  const body = eventSchema.parse(req.body);
  res.status(201).json(await tx((db) => svc.reportEvent(db, oid(req), actorFrom(req), body)));
}

const ADMIN_ACTIONS = ['start', 'pause', 'resume', 'complete', 'stop', 'not_given'] as const;

export async function administration(req: Request, res: Response) {
  const action = String(req.params.action) as (typeof ADMIN_ACTIONS)[number];
  if (!ADMIN_ACTIONS.includes(action)) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Unknown action' } });
  const body = administrationSchema.parse(req.body ?? {});
  const row = await tx((db) => svc.administrationAction(db, uuid.parse(req.params.adminId), action, actorFrom(req), body));
  res.json(row);
}
