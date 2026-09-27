import type { Request, Response } from 'express';
import { pool, q1, tx } from '../db/pool';
import { toFhirAllergy, toFhirPatient } from '../integrations/fhir/patient.mapper';
import { actorFrom, audit } from '../services/audit.service';
import { getClinicalAssistant } from '../services/clinicalAssistant';
import { listOrders } from '../services/orders.service';
import * as svc from '../services/patients.service';
import { notFound } from '../utils/errors';
import {
  allergySchema,
  createPatientSchema,
  diagnosisSchema,
  labsSchema,
  noteSchema,
  patientQuerySchema,
  patientSchema,
  patientStatusSchema,
  planSchema,
  planUpdateSchema,
  reasonSchema,
  uuid,
  vitalsSchema,
} from './schemas';

const pid = (req: Request) => uuid.parse(req.params.id);

async function ensurePatient(id: string) {
  const p = await q1(pool, 'SELECT id FROM patients WHERE id=$1', [id]);
  if (!p) throw notFound('Patient');
}

export const query = async (req: Request, res: Response) => res.json(await svc.queryPatients(patientQuerySchema.parse(req.body ?? {}), req.user!));

export async function create(req: Request, res: Response) {
  const body = createPatientSchema.parse(req.body);
  const p = await tx((db) => svc.createPatient(db, body, actorFrom(req)));
  res.status(201).json(p);
}

export const get = async (req: Request, res: Response) => res.json(await svc.getPatient(pool, pid(req), req.user!));

export async function update(req: Request, res: Response) {
  const body = patientSchema.partial().parse(req.body);
  res.json(await tx((db) => svc.updatePatient(db, pid(req), body, actorFrom(req))));
}

export async function setStatus(req: Request, res: Response) {
  const body = patientStatusSchema.parse(req.body);
  await tx((db) => svc.setPatientStatus(db, pid(req), body.status, body.reason ?? null, actorFrom(req)));
  res.json({ ok: true });
}

export const timeline = async (req: Request, res: Response) => res.json(await svc.patientTimeline(pool, pid(req), req.user!));
export const history = async (req: Request, res: Response) => res.json(await svc.treatmentHistory(pool, pid(req)));
export const appointments = async (req: Request, res: Response) => res.json(await svc.patientAppointments(pool, pid(req)));
export const orders = async (req: Request, res: Response) => res.json(await listOrders({ patientId: pid(req) }));

export async function addAllergy(req: Request, res: Response) {
  const body = allergySchema.parse(req.body);
  await ensurePatient(pid(req));
  res.status(201).json(await tx((db) => svc.addAllergy(db, pid(req), body, actorFrom(req))));
}

export async function inactivateAllergy(req: Request, res: Response) {
  const { reason } = reasonSchema.parse(req.body);
  res.json(await tx((db) => svc.inactivateAllergy(db, uuid.parse(req.params.allergyId), reason, actorFrom(req))));
}

export const diagnoses = async (req: Request, res: Response) => res.json(await svc.listDiagnoses(pool, pid(req)));
export async function createDiagnosis(req: Request, res: Response) {
  const body = diagnosisSchema.parse(req.body);
  res.status(201).json(await tx((db) => svc.createDiagnosis(db, pid(req), body, actorFrom(req))));
}
export async function updateDiagnosis(req: Request, res: Response) {
  const body = diagnosisSchema.partial().parse(req.body);
  res.json(await tx((db) => svc.updateDiagnosis(db, uuid.parse(req.params.diagnosisId), body, actorFrom(req))));
}

export const plans = async (req: Request, res: Response) => res.json(await svc.listPlans(pool, pid(req)));
export async function createPlan(req: Request, res: Response) {
  const body = planSchema.parse(req.body);
  await ensurePatient(pid(req));
  res.status(201).json(await tx((db) => svc.createPlan(db, pid(req), body, actorFrom(req))));
}
export async function updatePlan(req: Request, res: Response) {
  const body = planUpdateSchema.parse(req.body);
  res.json(await tx((db) => svc.updatePlan(db, uuid.parse(req.params.planId), body, actorFrom(req))));
}

export const labs = async (req: Request, res: Response) => res.json(await svc.listLabs(pool, pid(req)));
export async function addLabs(req: Request, res: Response) {
  const body = labsSchema.parse(req.body);
  await ensurePatient(pid(req));
  res.status(201).json(await tx((db) => svc.addLabResults(db, pid(req), body, actorFrom(req))));
}

export const vitals = async (req: Request, res: Response) => res.json(await svc.listVitals(pool, pid(req)));
export async function addVitals(req: Request, res: Response) {
  const body = vitalsSchema.parse(req.body);
  await ensurePatient(pid(req));
  res.status(201).json(await tx((db) => svc.addVitals(db, pid(req), body, actorFrom(req))));
}

export const notes = async (req: Request, res: Response) => res.json(await svc.listNotes(pool, pid(req)));
export async function addNote(req: Request, res: Response) {
  const body = noteSchema.parse(req.body);
  await ensurePatient(pid(req));
  res.status(201).json(await tx((db) => svc.addNote(db, pid(req), body, actorFrom(req))));
}

export async function assistantSummary(req: Request, res: Response) {
  const id = pid(req);
  await ensurePatient(id);
  const out = await getClinicalAssistant().summarizePatient(id);
  await audit(pool, actorFrom(req), { action: 'CLINICAL_ASSISTANT_SUMMARY', entityType: 'patient', entityId: id, patientId: id, description: out.engine });
  res.json(out);
}

export async function fhirPatient(req: Request, res: Response) {
  const id = pid(req);
  const p = await q1(pool, 'SELECT * FROM patients WHERE id=$1', [id]);
  if (!p) throw notFound('Patient');
  const allergies = (await pool.query('SELECT * FROM allergies WHERE patient_id=$1 AND is_active', [id])).rows;
  await audit(pool, actorFrom(req), { action: 'FHIR_EXPORT', entityType: 'patient', entityId: id, patientId: id });
  res.type('application/fhir+json').json({
    resourceType: 'Bundle',
    type: 'collection',
    entry: [{ resource: toFhirPatient(p) }, ...allergies.map((a) => ({ resource: toFhirAllergy(a, id) }))],
  });
}
