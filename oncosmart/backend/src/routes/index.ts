import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import * as appts from '../controllers/appointments.controller';
import * as auth from '../controllers/auth.controller';
import * as ops from '../controllers/operations.controller';
import * as orders from '../controllers/orders.controller';
import * as patients from '../controllers/patients.controller';
import { authenticate, requirePermission as need } from '../middleware/auth';

export const api = Router();

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false });

// ---------------------------------------------------------------- public
api.get('/health', (_req, res) => res.json({ ok: true, service: 'oncosmart-api' }));
api.get('/public/config', auth.publicConfig);
api.post('/auth/login', loginLimiter, auth.login);
api.get('/auth/session', auth.session);
api.get('/integrations/whatsapp/webhook', ops.whatsappVerify);
api.post('/integrations/whatsapp/webhook', ops.whatsappWebhook);

// ---------------------------------------------------------------- authenticated
api.use(authenticate);

api.post('/auth/logout', auth.logout);
api.get('/auth/me', auth.me);
api.post('/auth/change-password', auth.changePassword);

api.get('/dashboard', ops.dashboard);
api.post('/search', ops.search);
api.get('/infusion/today', need('infusion.read'), ops.infusion);

// Patients (search terms travel in the request body, never in URLs)
api.post('/patients/query', need('patients.read'), patients.query);
api.post('/patients', need('patients.create'), patients.create);
api.get('/patients/:id', need('patients.read'), patients.get);
api.patch('/patients/:id', need('patients.update'), patients.update);
api.patch('/patients/:id/status', need('patients.status'), patients.setStatus);
api.get('/patients/:id/timeline', need('patients.read'), patients.timeline);
api.get('/patients/:id/appointments', need('appointments.read'), patients.appointments);
api.get('/patients/:id/history', need('clinical.read'), patients.history);
api.get('/patients/:id/orders', need('orders.read'), patients.orders);
api.post('/patients/:id/allergies', need('allergies.create'), patients.addAllergy);
api.post('/allergies/:allergyId/inactivate', need('allergies.inactivate'), patients.inactivateAllergy);
api.get('/patients/:id/diagnoses', need('clinical.read'), patients.diagnoses);
api.post('/patients/:id/diagnoses', need('diagnoses.write'), patients.createDiagnosis);
api.patch('/diagnoses/:diagnosisId', need('diagnoses.write'), patients.updateDiagnosis);
api.get('/patients/:id/plans', need('patients.read'), patients.plans);
api.post('/patients/:id/plans', need('plans.write'), patients.createPlan);
api.patch('/plans/:planId', need('plans.write'), patients.updatePlan);
api.get('/patients/:id/labs', need('clinical.read'), patients.labs);
api.post('/patients/:id/labs', need('labs.write'), patients.addLabs);
api.get('/patients/:id/vitals', need('clinical.read'), patients.vitals);
api.post('/patients/:id/vitals', need('vitals.write'), patients.addVitals);
api.get('/patients/:id/notes', need('clinical.read'), patients.notes);
api.post('/patients/:id/notes', need('notes.write'), patients.addNote);
api.post('/patients/:id/assistant/summary', need('assistant.use'), patients.assistantSummary);
api.get('/integrations/fhir/Patient/:id', need('integrations.fhir'), patients.fhirPatient);

// Treatment orders — prescribing & approval are physician-only
api.post('/orders/preview', need('orders.prescribe'), orders.preview);
api.post('/orders', need('orders.prescribe'), orders.create);
api.get('/orders', need('orders.read'), orders.list);
api.get('/orders/:id', need('orders.read'), orders.get);
api.put('/orders/:id', need('orders.prescribe'), orders.update);
api.post('/orders/:id/submit', need('orders.prescribe'), orders.submit);
api.post('/orders/:id/approve', need('orders.approve'), orders.approve);
api.post('/orders/:id/return', need('orders.approve'), orders.returnToDraft);
api.post('/orders/:id/delay', need('orders.prescribe'), orders.delay);
api.post('/orders/:id/resume', need('orders.approve'), orders.resume);
api.post('/orders/:id/cancel', need('orders.cancel'), orders.cancel);
api.post('/orders/:id/hold', need('orders.hold'), orders.hold);
api.post('/orders/:id/release', need('orders.nursing'), orders.release);
api.post('/orders/:id/prepared', need('orders.nursing'), orders.prepared);
api.post('/orders/:id/verify', need('orders.nursing'), orders.verify);
api.post('/orders/:id/start', need('orders.nursing'), orders.start);
api.post('/orders/:id/complete', need('orders.nursing'), orders.complete);
api.post('/orders/:id/events', need('events.report'), orders.reportEvent);
api.post('/administrations/:adminId/:action', need('orders.nursing'), orders.administration);

// Appointments
api.get('/appointments', need('appointments.read'), appts.list);
api.get('/appointments/suggest-chair', need('appointments.read'), appts.suggestChair);
api.get('/appointments/:id', need('appointments.read'), appts.get);
api.post('/appointments', need('appointments.write'), appts.create);
api.put('/appointments/:id', need('appointments.write'), appts.update);
api.post('/appointments/:id/cancel', need('appointments.write'), appts.cancel);
api.post('/appointments/:id/check-in', need('appointments.checkin'), appts.checkIn);
api.post('/appointments/:id/status', need('appointments.write'), appts.setStatus);
api.post('/appointments/:id/reminder', need('notifications.send'), appts.sendReminder);

// Messaging (WhatsApp mock queue)
api.get('/notifications', need('notifications.read'), ops.listMessages);
api.post('/notifications/process', need('notifications.send'), ops.processMessages);
api.post('/notifications/:id/simulate', need('notifications.send'), ops.simulateMessage);
api.post('/notifications/:id/retry', need('notifications.send'), ops.retryMessage);

// Chairs
api.get('/chairs', need('chairs.read'), ops.listChairs);
api.post('/chairs', need('chairs.manage'), ops.createChair);
api.put('/chairs/:id', need('chairs.manage'), ops.updateChair);
api.post('/chairs/:id/status', need('chairs.status'), ops.setChairStatus);

// Protocol library & drug catalogue
api.get('/protocols', need('protocols.read'), ops.listProtocols);
api.get('/protocols/rounding-rules', need('protocols.read'), ops.roundingRules);
api.get('/protocols/:id', need('protocols.read'), ops.getProtocol);
api.post('/protocols', need('protocols.write'), ops.createProtocol);
api.put('/protocols/:id', need('protocols.write'), ops.updateProtocol);
api.patch('/protocols/:id/active', need('protocols.write'), ops.setProtocolActive);
api.get('/drugs', need('protocols.read'), ops.drugCatalog);

// Reports
api.get('/reports', need('reports.read'), ops.reportTypes);
api.get('/reports/:type', need('reports.read'), ops.report);
api.get('/reports/:type/export', need('reports.read'), ops.exportReport);

// Administration
api.get('/users/physicians', ops.listPhysicians);
api.get('/users', need('users.manage'), ops.listUsers);
api.post('/users', need('users.manage'), ops.createUser);
api.put('/users/:id', need('users.manage'), ops.updateUser);
api.post('/users/:id/reset-password', need('users.manage'), ops.resetUserPassword);
api.get('/settings', ops.getSettingsHandler);
api.put('/settings', need('settings.manage'), ops.updateSettingsHandler);
api.get('/lab-tests', ops.labTests);
api.get('/audit', need('audit.read'), ops.auditLog);
api.post('/admin/reset-demo', need('settings.manage'), ops.resetDemo);
