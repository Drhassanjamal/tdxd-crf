#!/usr/bin/env node
/**
 * OncoSmart — end-to-end workflow verification (API level, synthetic data only).
 *
 * Runs the complete chemotherapy-unit workflow from the MVP specification (§50)
 * against a running API using the four demo accounts:
 *
 *   reception → register Ahmed Ali (DEMO-001)
 *   physician → diagnosis, treatment plan, demo protocol, C1D1 order, BSA & doses, submit, review, approve
 *   reception → appointment on Chair 2, WhatsApp (mock) reminder, simulated patient confirmation
 *   nurse     → today's infusion list, check-in, preparation, vitals, verification, start,
 *               infusion timer, end times, completion, chair release, history, next-cycle suggestion
 *
 * It also checks key safety rules (RBAC, no start without approval, no double booking).
 *
 * Usage:  npm run db:seed && npm run dev   (in another terminal)
 *         node scripts/e2e-workflow.mjs [--base http://localhost:4000/api]
 */

const BASE = process.argv.includes('--base') ? process.argv[process.argv.indexOf('--base') + 1] : process.env.API_BASE ?? 'http://localhost:4000/api';
const PASSWORD = process.env.DEMO_PASSWORD ?? 'Demo@2026';
let step = 0;
let failures = 0;

const c = { green: (s) => `\x1b[32m${s}\x1b[0m`, red: (s) => `\x1b[31m${s}\x1b[0m`, dim: (s) => `\x1b[2m${s}\x1b[0m`, bold: (s) => `\x1b[1m${s}\x1b[0m` };

function session(label) {
  let cookie = '';
  const call = async (method, path, body) => {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    return { status: res.status, data };
  };
  return {
    label,
    get: (p) => call('GET', p),
    post: (p, b = {}) => call('POST', p, b),
    put: (p, b = {}) => call('PUT', p, b),
  };
}

async function check(title, fn) {
  step++;
  try {
    const detail = await fn();
    console.log(`${c.green('✔')} ${String(step).padStart(2)}. ${title}${detail ? c.dim(` — ${detail}`) : ''}`);
  } catch (err) {
    failures++;
    console.log(`${c.red('✘')} ${String(step).padStart(2)}. ${title} — ${c.red(err.message)}`);
    throw err;
  }
}

const expect = (cond, msg) => {
  if (!cond) throw new Error(msg);
};
const ok = (r, msg) => {
  if (r.status >= 400) throw new Error(`${msg}: HTTP ${r.status} ${r.data?.error?.message ?? ''}`);
  return r.data;
};

function localNow(tz) {
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const time = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
  return { date, time: time === '24:00' ? '00:00' : time };
}

async function main() {
  console.log(c.bold(`\nOncoSmart workflow verification against ${BASE}\n`));
  const reception = session('reception');
  const doctor = session('doctor');
  const nurse = session('nurse');
  const admin = session('admin');
  const ctx = {};

  await check('Login as receptionist', async () => {
    const r = ok(await reception.post('/auth/login', { email: 'reception@demo.local', password: PASSWORD }), 'login');
    expect(r.user.role === 'RECEPTION', 'wrong role');
    const s = ok(await reception.get('/settings'), 'settings');
    ctx.tz = s.settings.timezone;
    return `${r.user.fullName} · unit TZ ${ctx.tz}`;
  });

  await check('Create patient Ahmed Ali (MRN DEMO-001)', async () => {
    let mrn = 'DEMO-001';
    let r = await reception.post('/patients', {
      mrn, firstName: 'Ahmed', lastName: 'Ali', fullNameAr: 'أحمد علي', dateOfBirth: '1968-04-10', sex: 'MALE',
      phone: '+964 770 000 0001', governorate: 'Baghdad', preferredLanguage: 'ar', noKnownAllergies: true,
      emergencyContactName: 'Ali Hassan', emergencyContactPhone: '+964 770 000 1001', emergencyContactRelation: 'Brother',
      heightCm: 170, weightKg: 70,
    });
    if (r.status === 409) {
      mrn = `DEMO-001-${Date.now().toString().slice(-5)}`;
      r = await reception.post('/patients', { mrn, firstName: 'Ahmed', lastName: 'Ali', dateOfBirth: '1968-04-10', sex: 'MALE', phone: '+964 770 000 0001', noKnownAllergies: true });
    }
    const p = ok(r, 'create patient');
    ctx.patientId = p.id;
    return `${p.patient_code} / ${p.mrn}${mrn !== 'DEMO-001' ? ' (DEMO-001 existed — run `npm run db:seed` for a clean run)' : ''}`;
  });

  await check('Safety: reception cannot create treatment orders (RBAC)', async () => {
    const r = await reception.post('/orders/preview', { treatmentPlanId: '00000000-0000-4000-8000-000000000000', cycleNumber: 1, dayNumber: 1, plannedDate: '2026-01-01' });
    expect(r.status === 403, `expected 403, got ${r.status}`);
    return '403 Forbidden';
  });

  await check('Login as physician; assign diagnosis', async () => {
    ok(await doctor.post('/auth/login', { email: 'doctor@demo.local', password: PASSWORD }), 'login');
    const d = ok(
      await doctor.post(`/patients/${ctx.patientId}/diagnoses`, {
        primaryCancer: 'Adenocarcinoma of sigmoid colon', cancerType: 'Colorectal', icd10Code: 'C18.7', histology: 'Adenocarcinoma',
        stage: 'Stage III (pT3N1M0)', biomarkers: 'MSS; RAS wild-type (demo)', diagnosisDate: localNow(ctx.tz).date,
      }),
      'diagnosis',
    );
    ctx.diagnosisId = d.id;
    return d.primary_cancer;
  });

  await check('Create treatment plan with demo protocol (FOLFOX-like)', async () => {
    const protocols = ok(await doctor.get('/protocols'), 'protocols');
    const folfox = protocols.find((p) => p.code === 'DEMO-FOLFOX');
    expect(folfox?.is_demo, 'demo protocol missing');
    ctx.protocol = folfox;
    const plan = ok(await doctor.post(`/patients/${ctx.patientId}/plans`, { protocolId: folfox.id, diagnosisId: ctx.diagnosisId, startDate: localNow(ctx.tz).date }), 'plan');
    ctx.planId = plan.id;
    return `${folfox.name} · ${plan.planned_cycles} cycles × ${plan.cycle_length_days} d`;
  });

  await check('Enter baseline laboratory results', async () => {
    const r = ok(
      await doctor.post(`/patients/${ctx.patientId}/labs`, {
        collectedAt: new Date(Date.now() - 3600_000).toISOString(),
        results: [
          { code: 'HB', value: 13.1 }, { code: 'WBC', value: 6.4 }, { code: 'ANC', value: 3.9 }, { code: 'PLT', value: 245 },
          { code: 'CREAT', value: 0.9 }, { code: 'EGFR', value: 91 }, { code: 'ALT', value: 22 }, { code: 'AST', value: 25 }, { code: 'BILI', value: 0.6 },
        ],
      }),
      'labs',
    );
    return `${r.length} results`;
  });

  await check('Create Cycle 1 Day 1 order — calculate BSA and display doses', async () => {
    const pv = ok(
      await doctor.post('/orders/preview', { treatmentPlanId: ctx.planId, cycleNumber: 1, dayNumber: 1, plannedDate: localNow(ctx.tz).date, heightCm: 170, weightKg: 70 }),
      'preview',
    );
    expect(pv.bsa === 1.82, `BSA expected 1.82, got ${pv.bsa}`);
    const oxa = pv.items.find((i) => i.drugName === 'Oxaliplatin');
    expect(Math.abs(oxa.calculatedDose - 154.7) < 0.001, `oxaliplatin calc ${oxa.calculatedDose}`);
    expect(oxa.roundedDose === 155, `oxaliplatin rounded ${oxa.roundedDose}`);
    ctx.preview = pv;
    return `BSA ${pv.bsa} m² · ${pv.items.map((i) => `${i.drugName} ${i.finalDose} mg`).join(', ')}`;
  });

  await check('Submit order for physician review', async () => {
    const d = ok(await doctor.post('/orders', { treatmentPlanId: ctx.planId, cycleNumber: 1, dayNumber: 1, plannedDate: localNow(ctx.tz).date, heightCm: 170, weightKg: 70, submit: true }), 'create order');
    expect(d.order.status === 'PENDING_REVIEW', `status ${d.order.status}`);
    ctx.orderId = d.order.id;
    return `${d.order.order_number} → PENDING_REVIEW`;
  });

  await check('Safety: nurse cannot start treatment before physician approval', async () => {
    ok(await nurse.post('/auth/login', { email: 'nurse@demo.local', password: PASSWORD }), 'nurse login');
    const r = await nurse.post(`/orders/${ctx.orderId}/start`);
    expect(r.status === 409, `expected 409, got ${r.status}`);
    const m = await nurse.put(`/orders/${ctx.orderId}`, {});
    expect(m.status === 403, `nurse edit expected 403, got ${m.status}`);
    return r.data.error.message;
  });

  await check('Physician reviews and approves order', async () => {
    const d = ok(await doctor.get(`/orders/${ctx.orderId}`), 'review');
    expect(d.items.length === 4, 'expected 4 drugs');
    const a = ok(await doctor.post(`/orders/${ctx.orderId}/approve`, { acknowledgeWarnings: true, note: 'E2E approval (demo)' }), 'approve');
    expect(a.order.status === 'APPROVED', `status ${a.order.status}`);
    return `approved by ${a.order.approved_by_name} · warnings: ${a.warnings.map((w) => w.code).join(', ') || 'none'}`;
  });

  await check('Create appointment today and assign Chair 2', async () => {
    const chairs = ok(await reception.get('/chairs'), 'chairs');
    ctx.chair2 = chairs.find((x) => x.name === 'Chair 2');
    const now = localNow(ctx.tz);
    let [h, m] = now.time.split(':').map(Number);
    let mins = Math.min(h * 60 + m - ((h * 60 + m) % 5), 19 * 60 + 30);
    const start = `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
    const a = ok(
      await reception.post('/appointments', { patientId: ctx.patientId, treatmentPlanId: ctx.planId, cycleNumber: 1, dayNumber: 1, appointmentDate: now.date, startTime: start, durationMinutes: 240, chairId: ctx.chair2.id }),
      'appointment',
    );
    expect(a.treatment_order_id === ctx.orderId, 'appointment not linked to order');
    ctx.appointment = a;
    ctx.startTime = start;
    return `${a.appointment_number} · ${now.date} ${start} · ${a.chair_name}`;
  });

  await check('Safety: double booking of Chair 2 is prevented', async () => {
    const other = ok(await reception.post('/patients/query', { search: 'DEMO-109' }), 'find patient').rows[0];
    const r = await reception.post('/appointments', { patientId: other.id, appointmentDate: ctx.appointment.appointment_date, startTime: ctx.startTime, durationMinutes: 60, chairId: ctx.chair2.id });
    expect(r.status === 409, `expected 409, got ${r.status}`);
    return r.data.error.message;
  });

  await check('Generate WhatsApp reminder (mock provider)', async () => {
    ok(await reception.post('/notifications/process'), 'process queue');
    const a = ok(await reception.get(`/appointments/${ctx.appointment.id}`), 'appointment');
    const msg = a.notifications.find((n) => n.notification_type === 'APPOINTMENT_CREATED');
    expect(msg && ['SENT', 'DELIVERED', 'READ'].includes(msg.status), `message status ${msg?.status}`);
    ctx.messageId = msg.id;
    return `${msg.status} · ${msg.language} · "${msg.message_body.split('\n')[0]}"`;
  });

  await check('Simulate patient confirmation (WhatsApp reply)', async () => {
    const r = ok(await reception.post(`/notifications/${ctx.messageId}/simulate`, { event: 'CONFIRM' }), 'simulate');
    expect(r.appointment.status === 'CONFIRMED', `appointment ${r.appointment.status}`);
    return 'appointment → CONFIRMED';
  });

  await check("Login as nurse; open today's infusion list", async () => {
    const board = ok(await nurse.get('/infusion/today'), 'board');
    const card = board.cards.find((x) => x.appointment.id === ctx.appointment.id);
    expect(card, 'Ahmed not on board');
    return `${board.summary.total} patients · ${board.summary.waiting} waiting · ${board.summary.inTreatment} in treatment · ${board.summary.completed} completed`;
  });

  await check('Check in, send to preparation, mark prepared', async () => {
    ok(await nurse.post(`/appointments/${ctx.appointment.id}/check-in`), 'check-in');
    ok(await nurse.post(`/orders/${ctx.orderId}/release`), 'release');
    const d = ok(await nurse.post(`/orders/${ctx.orderId}/prepared`), 'prepared');
    return d.order.status;
  });

  await check('Record pre-treatment vital signs and nurse verification checklist', async () => {
    ok(await nurse.post(`/patients/${ctx.patientId}/vitals`, { phase: 'PRE', treatmentOrderId: ctx.orderId, bpSystolic: 128, bpDiastolic: 80, heartRate: 78, respRate: 16, temperatureC: 36.8, spo2: 98, weightKg: 70, painScore: 0 }), 'vitals');
    const s = ok(await nurse.get('/settings'), 'settings');
    const checklist = Object.fromEntries(s.settings.pretreatment_checklist.map((x) => [x.id, true]));
    const d = ok(await nurse.post(`/orders/${ctx.orderId}/verify`, { checklist }), 'verify');
    expect(d.order.status === 'READY_FOR_ADMINISTRATION', d.order.status);
    return `verified by ${d.order.nurse_verified_by_name}`;
  });

  await check('Start treatment (chair becomes INFUSING)', async () => {
    const d = ok(await nurse.post(`/orders/${ctx.orderId}/start`), 'start');
    expect(d.order.status === 'IN_PROGRESS', d.order.status);
    const chairs = ok(await nurse.get('/chairs'), 'chairs');
    const ch = chairs.find((x) => x.id === ctx.chair2.id);
    expect(ch.status === 'INFUSING', `chair ${ch.status}`);
    ctx.admins = d.administrations;
    return `${d.administrations.length} administration records · Chair 2 ${ch.status}`;
  });

  await check('Record vital signs during treatment', async () => {
    const v = ok(await nurse.post(`/patients/${ctx.patientId}/vitals`, { phase: 'DURING', treatmentOrderId: ctx.orderId, bpSystolic: 124, bpDiastolic: 78, heartRate: 80, temperatureC: 36.9, spo2: 98 }), 'vitals');
    return `BP ${v.bp_systolic}/${v.bp_diastolic}`;
  });

  await check('Start infusion timer (oxaliplatin 120 min), pause and resume', async () => {
    const oxa = ctx.admins.find((a) => a.drug_name === 'Oxaliplatin');
    const s1 = ok(await nurse.post(`/administrations/${oxa.id}/start`), 'start infusion');
    expect(s1.status === 'IN_PROGRESS' && s1.start_time, 'timer not started');
    ok(await nurse.post(`/administrations/${oxa.id}/pause`), 'pause');
    const s3 = ok(await nurse.post(`/administrations/${oxa.id}/resume`), 'resume');
    const end = new Date(new Date(s1.start_time).getTime() + (s3.planned_duration_min * 60 + s3.total_paused_seconds) * 1000);
    return `start ${new Date(s1.start_time).toISOString().slice(11, 16)}Z · duration ${s3.planned_duration_min} min · expected end ${end.toISOString().slice(11, 16)}Z`;
  });

  await check('Safety: cannot complete treatment with undocumented administrations', async () => {
    const r = await nurse.post(`/orders/${ctx.orderId}/complete`, { adverseEvent: false, disposition: 'HOME' });
    expect(r.status === 422, `expected 422, got ${r.status}`);
    return r.data.error.message.slice(0, 90);
  });

  await check('Record end times for each drug (continuous infusion continues via pump)', async () => {
    for (const a of ctx.admins) {
      if (a.status === 'NOT_STARTED' && a.drug_name !== 'Oxaliplatin') ok(await nurse.post(`/administrations/${a.id}/start`), `start ${a.drug_name}`);
      if (!a.drug_name.includes('46-h')) ok(await nurse.post(`/administrations/${a.id}/complete`, { observations: 'Tolerated well (E2E)' }), `end ${a.drug_name}`);
    }
    const d = ok(await nurse.get(`/orders/${ctx.orderId}`), 'order');
    const done = d.administrations.filter((a) => a.status === 'COMPLETED' && a.end_time).length;
    return `${done} completed with end time, ${d.administrations.length - done} running (ambulatory pump)`;
  });

  await check('Complete treatment', async () => {
    const r = ok(await nurse.post(`/orders/${ctx.orderId}/complete`, { adverseEvent: false, notes: 'E2E completion — discharged home with pump (demo)', disposition: 'HOME' }), 'complete');
    expect(r.order.status === 'COMPLETED', r.order.status);
    expect(r.appointment.status === 'COMPLETED', `appointment ${r.appointment.status}`);
    ctx.completion = r.completion;
    return `completed by ${r.order.completed_by_name} · duration ${r.order.treatment_duration_min} min`;
  });

  await check('Chair released', async () => {
    const chairs = ok(await nurse.get('/chairs'), 'chairs');
    const ch = chairs.find((x) => x.id === ctx.chair2.id);
    expect(['AVAILABLE', 'CLEANING'].includes(ch.status) && !ch.current_appointment_id, `chair ${ch.status}`);
    return `Chair 2 → ${ch.status}`;
  });

  await check('Treatment history updated', async () => {
    const h = ok(await nurse.get(`/patients/${ctx.patientId}/history`), 'history');
    const c1 = h.filter((x) => x.cycle_number === 1);
    expect(c1.length === 4, `history rows ${c1.length}`);
    const p = ok(await nurse.get(`/patients/${ctx.patientId}`), 'patient');
    expect(p.activePlan.current_cycle === 1 && p.activePlan.cycles_completed === 1, 'plan not updated');
    return `${c1.length} administrations for C1 · plan C${p.activePlan.current_cycle}/${p.activePlan.planned_cycles}`;
  });

  await check('Next-cycle appointment suggestion generated', async () => {
    const s = ctx.completion.nextSuggestion;
    expect(s && s.cycle === 2 && s.day === 1, 'no suggestion');
    return `C${s.cycle}D${s.day} due ${s.dueDate} · ${s.startTime} · suggested ${s.suggestedChairName ?? 'no chair'}`;
  });

  await check('Book next appointment from suggestion', async () => {
    const s = ctx.completion.nextSuggestion;
    const a = ok(
      await reception.post('/appointments', { patientId: ctx.patientId, treatmentPlanId: s.treatmentPlanId, cycleNumber: s.cycle, dayNumber: s.day, appointmentDate: s.dueDate, startTime: s.startTime, durationMinutes: s.durationMinutes, chairId: s.suggestedChairId }),
      'book next',
    );
    return `${a.appointment_number} · ${a.appointment_date} ${a.start_time.slice(0, 5)}`;
  });

  await check('Audit trail recorded for the workflow', async () => {
    ok(await admin.post('/auth/login', { email: 'admin@demo.local', password: PASSWORD }), 'admin login');
    const a = ok(await admin.get(`/audit?patientId=${ctx.patientId}&pageSize=200`), 'audit');
    const actions = new Set(a.rows.map((r) => r.action));
    for (const x of ['PATIENT_CREATED', 'TREATMENT_ORDER_CREATED', 'TREATMENT_ORDER_APPROVED', 'APPOINTMENT_CREATED', 'TREATMENT_STARTED', 'TREATMENT_COMPLETED']) {
      expect(actions.has(x), `missing audit action ${x}`);
    }
    return `${a.total} audit records for this patient`;
  });

  console.log(c.bold(c.green(`\nAll ${step} workflow steps passed.\n`)));
}

main().catch(() => {
  console.log(c.red(`\nWorkflow verification failed (${failures} failure).\n`));
  process.exit(1);
});
