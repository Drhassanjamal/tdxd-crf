# OncoSmart — Chemotherapy Unit

**Chemotherapy Infusion & Patient Management System — MVP / demonstration prototype**

> ⚠️ **DEMO / TEST DATA ONLY.** Every patient in this system is fictional. The three protocols are
> **DEMO PROTOCOLS — NOT FOR CLINICAL USE**. Calculated doses are decision support only and always
> require physician verification. The system does not replace clinical judgement.

OncoSmart is a focused web application for a hospital chemotherapy infusion unit. It covers the full
day-unit workflow:

```
Registration → electronic chart → diagnosis → treatment plan / protocol → cycle & day → treatment order
→ BSA / dose calculation → physician approval → appointment & chair → WhatsApp reminder (mock)
→ check-in → preparation → nurse verification → administration & infusion timers → vital signs
→ completion → chair release → treatment history → next-cycle suggestion → next appointment
```

It is bilingual (**English / العربية** with full RTL layout), role-based (Admin, Physician, Nurse,
Reception), fully audited, and runs on React + Node.js + PostgreSQL.

---

## Contents

1. [Quick start](#1-quick-start)
2. [Demo accounts](#2-demo-accounts)
3. [Features](#3-features)
4. [Architecture](#4-architecture)
5. [Project structure](#5-project-structure)
6. [Configuration (environment variables)](#6-configuration-environment-variables)
7. [Database, migrations and demo data](#7-database-migrations-and-demo-data)
8. [Guided demo walkthrough](#8-guided-demo-walkthrough)
9. [Clinical safety design](#9-clinical-safety-design)
10. [WhatsApp integration (mock → real)](#10-whatsapp-integration-mock--real)
11. [Security](#11-security)
12. [Testing](#12-testing)
13. [Deployment](#13-deployment)
14. [API overview](#14-api-overview)
15. [Design decisions](#15-design-decisions)
16. [Known limitations](#16-known-limitations)
17. [What to build next](#17-what-to-build-next)

---

## 1. Quick start

**Requirements:** Node.js ≥ 20 (22 recommended) and PostgreSQL ≥ 14 (16 recommended).

```bash
cd oncosmart

# 1. Install dependencies (backend + frontend workspaces)
npm install

# 2. Create a PostgreSQL role and database (example — choose your own password)
psql -U postgres -c "CREATE ROLE oncosmart WITH LOGIN PASSWORD 'change-me' CREATEDB;"
psql -U postgres -c "CREATE DATABASE oncosmart OWNER oncosmart;"
#   The schema uses the btree_gist extension (bundled with PostgreSQL). If your role is not
#   allowed to create it, run once as superuser:  psql -U postgres -d oncosmart -c "CREATE EXTENSION btree_gist;"

# 3. Configure environment
cp .env.example .env
#   edit .env → DATABASE_URL=postgres://oncosmart:change-me@localhost:5432/oncosmart
#               JWT_SECRET=$(openssl rand -hex 48)

# 4. Create the schema and load the synthetic demo dataset
npm run db:seed          # = migrate + (re)load demo data

# 5. Run API (http://localhost:4000) and web app (http://localhost:5173)
npm run dev
```

Open **http://localhost:5173** and click one of the demo accounts on the login screen.

> The demo schedule is generated **relative to today** (unit time zone, default Asia/Baghdad).
> On another day, reload fresh data with `npm run db:seed` or **Settings → Reset demo data** (admin).

Other useful commands:

| Command | What it does |
|---|---|
| `npm run dev` | API (tsx watch) + Vite dev server with `/api` proxy |
| `npm run db:migrate` | Apply pending SQL migrations only |
| `npm run db:seed` | Migrate, then **replace all data** with the demo dataset |
| `npm run db:reset` | **Drop all OncoSmart tables**, migrate, seed |
| `npm test` | Backend unit tests (dose engine, warning engine, next-cycle logic) |
| `npm run test:workflow` | End-to-end workflow verification against a running API |
| `npm run build` / `npm start` | Production build; the API then also serves the built frontend on port 4000 |
| `npm run typecheck` | TypeScript checks for both workspaces |

## 2. Demo accounts

> **Demo credentials — for the prototype only.** All demo accounts use the password **`Demo@2026`**
> (configurable with `SEED_DEMO_PASSWORD` before seeding).

| Role | E-mail | Name |
|---|---|---|
| Administrator | `admin@demo.local` | Demo Administrator |
| Physician | `doctor@demo.local` | Dr. Layla Hameed |
| Nurse | `nurse@demo.local` | Huda Kareem |
| Reception | `reception@demo.local` | Rana Adel |
| (extra) Physician | `doctor2@demo.local` | Dr. Karim Jawad |
| (extra) Nurse | `nurse2@demo.local` | Ali Sabah |

### Role permissions (enforced on the server)

| Capability | Admin | Physician | Nurse | Reception |
|---|:-:|:-:|:-:|:-:|
| Register / edit patient demographics | ✔ | ✔ | – | ✔ |
| View clinical data (labs, orders, history, notes) | ✔ (read) | ✔ | ✔ | – |
| Diagnoses, treatment plans | – | ✔ | – | – |
| **Create / edit / approve treatment orders & doses** | – | **✔ only** | – | – |
| Hold an order for physician review | – | ✔ | ✔ | – |
| Preparation, nurse verification, administration, completion | – | – | ✔ | – |
| Lab results, vital signs, notes | – | ✔ | ✔ | – |
| Book / reschedule / cancel appointments | ✔ | ✔ | ✔ | ✔ |
| Check-in | – | – | ✔ | ✔ |
| Send / simulate WhatsApp reminders | ✔ | – | – | ✔ |
| Protocols, users, settings, audit log | ✔ | – | – | – |
| Chairs: configure / set status | ✔ / ✔ | – | – / ✔ | – |
| Reports | ✔ | ✔ | – | – |

Nurses can never prescribe or modify doses; reception never sees laboratory results, orders or notes.

## 3. Features

**Dashboard** — today's statistics (total, confirmed, waiting, in preparation, in treatment, completed,
cancelled), live chair status tiles, today's timeline, prioritised alerts (order awaiting approval,
patient arrived but labs missing, appointment not confirmed, chair conflict, treatment delayed, dose
differs from previous cycle, documented allergy matches a drug, failed WhatsApp message) and KPIs
(today's patients, receiving treatment, available chairs, completed, average treatment duration,
chair utilisation, cancellation rate, delays).

**Patients** — registry with search (name, MRN, patient ID, phone — sent in the request body, never
in URLs) and filters (cancer type, oncologist, status, protocol, appointment date). Electronic chart
with tabs: Overview, Diagnosis, Treatment plan, Orders, Treatment history, Laboratory (CBC, renal,
liver, other — flagged against configurable reference ranges), Vital signs, Notes, Appointments,
visual Timeline (clickable events) and the Clinical Assistant placeholder. Allergy banner on every
clinical screen; statuses: Active treatment, Treatment completed, On hold, Discontinued, Follow-up,
Palliative care, Deceased.

**Protocol library** — protocols with cancer type, intent, cycle length, planned cycles, treatment
days, premedication, hydration, supportive medication, special instructions, required labs, default
and per-drug rounding rules. Drugs: dose value + unit (mg, mg/m², mg/kg, AUC), route (IV/PO/SC/IM),
method, diluent, final volume, infusion duration, sequence, premedication flag, instructions.
Editing creates a new version; existing orders keep their snapshot. Drug catalogue & inventory
tables (strength, vial size, stock, expiry, batch, manufacturer) are in place for future pharmacy
integration and already drive an approximate vial estimate on each order.

**Treatment orders** — order editor with live, server-side calculation: Mosteller BSA, mg/m², mg/kg,
flat mg and Calvert AUC (`Dose = AUC × (GFR + 25)`, GFR must be entered by the clinician; Cockcroft–Gault
and latest eGFR are shown as *reference values only*). Dose %, protocol/drug rounding rule and manual
final-dose adjustments (reason mandatory) — the exact calculated dose, rounded dose and rounding rule
are all stored. Status workflow: Draft → Pending review → Physician approved → Ready for preparation →
Prepared → Ready for administration → In progress → Completed, or Held / Delayed (re-approval
required) / Cancelled. Full printable order.

**Warning engine** — allergy documented / allergy-drug match / allergy status not documented, missing
or stale required labs, out-of-range labs, renal function review, Calvert verification & GFR review
threshold, weight change, dose difference vs previous cycle, dose modification / manual adjustment,
unconfigured pharmacy fields, premedication not configured, cycle beyond plan, interval shorter than
cycle length, chair conflict, not approved, demo protocol. Warnings **never** cancel treatment; they
require acknowledgement at approval.

**Appointments** — Day (chair × time grid), Week, Month and List views; booking with a chair
occupancy strip and "suggest chair"; reschedule, cancel, no-show, manual confirm, send reminder,
printable appointment slip. Chair double-booking is blocked by the application **and** by a
PostgreSQL exclusion constraint.

**Today's Infusion (nurse screen)** — one card per patient (name, MRN, protocol, cycle/day, chair,
time, status, warnings, per-drug progress with live infusion timer) with Open order / Check in /
Start treatment / Pause / Complete / Report event. Auto-refreshes every 20 s; works on tablets.

**Nursing administration** — pre-treatment checklist (configurable, bilingual) + mandatory
pre-treatment vitals before nurse verification; per-drug start / pause / resume / end / stop /
not-given with elapsed, remaining and expected-end timers (paused time excluded); dose administered
cannot exceed the approved dose; reactions and treatment events (type, severity, action, physician
notified); vitals (BP, HR, RR, temperature, SpO₂, weight, pain) pre/during/post. Continuous infusions
(e.g. 46-h ambulatory pump) may continue after the chair session and are closed later.

**Completion** — completed by / time / duration / adverse event / notes / disposition, then
automatically: appointment completed, chair released (Available or Cleaning, configurable), plan
progress and treatment history updated, next-cycle suggestion (date, time, free chair) with one-click
booking.

**WhatsApp (mock)** — appointment message in the patient's language (Arabic / English templates),
Confirm / Request reschedule / Cancel buttons, statuses Pending → Sent → Delivered → Read / Failed,
24-h, 2-h and optional same-day reminders in a notification queue processed by a background worker.
Patient replies are simulated from the UI and update the appointment (Confirmed / Needs rescheduling
/ Cancelled).

**Reports** — daily activity, monthly activity, patients treated, treatment cycles, drug usage,
chair utilisation, cancelled appointments, delayed treatments, treatment completion, cancer type
distribution, protocol distribution, physician workload. Export **CSV** (UTF-8 BOM, opens correctly in
Excel with Arabic), **Excel .xlsx** (dependency-free writer) and **print/PDF** layout.

**Documents (printable, A4)** — chemotherapy treatment order, chemotherapy administration record,
appointment slip, patient treatment summary — each with hospital header, DEMO banner, warnings and
signature fields (prescriber, physician approval, nurse verification, independent double check).

**Administration** — users (create, role, deactivate, reset password), settings (hospital/unit
name, time zone, languages, units, opening hours, default duration, arrival time, delay threshold,
chair cleaning, reminder timing & templates, rounding rule, alert thresholds, checklist), chairs
(add, rename, deactivate, status), append-only audit log with previous/new values.

## 4. Architecture

```
┌─────────────────────────────┐      /api (JSON, httpOnly session cookie)     ┌──────────────────────────────┐
│  React 18 + TypeScript SPA  │ ───────────────────────────────────────────▶ │  Node.js 22 + Express 5 (TS) │
│  Vite · Tailwind · TanStack │                                              │  routes → controllers →      │
│  Query · EN/AR (RTL)        │ ◀─────────────────────────────────────────── │  services → SQL (pg)         │
└─────────────────────────────┘                                              │  zod validation · RBAC       │
                                                                             │  audit · notification worker │
                                                                             └──────────────┬───────────────┘
                                                                                            │
                                   ┌──────────────────────────┐                              ▼
                                   │ Integration adapters     │               ┌──────────────────────────────┐
                                   │ messaging (mock/WhatsApp │               │ PostgreSQL 16                │
                                   │ Cloud), FHIR mapper, EMR,│               │ normalized schema, UUID PKs, │
                                   │ LIS, pharmacy, AI (stub) │               │ exclusion constraint, audit  │
                                   └──────────────────────────┘               └──────────────────────────────┘
```

* **Pure clinical engines** (`doseCalculator.ts`, `warningEngine.ts`, `nextCycle.ts`) have no I/O
  and are unit-tested. The server is the single source of truth for doses: the order editor calls
  `POST /api/orders/preview` for every change.
* **Transactions**: every state change runs in one DB transaction together with its audit record.
* **Order snapshots**: order items copy drug, dose, diluent, volume and duration from the protocol, so
  protocol edits never alter existing orders.
* **Time**: appointment dates/times are unit-local wall-clock values; timestamps are `timestamptz`;
  "today" is computed in the configured unit time zone.
* **Database portability**: plain SQL migrations and a thin query layer — no ORM lock-in; the schema
  is ready to be pointed at a hospital-managed PostgreSQL.

## 5. Project structure

```
oncosmart/
├── package.json                 npm workspaces (backend, frontend) + root scripts
├── .env.example                 all configuration keys (no secrets)
├── Dockerfile, docker-compose.yml
├── scripts/e2e-workflow.mjs     end-to-end workflow verification (spec §50)
├── backend/
│   ├── database/
│   │   ├── migrations/          001_initial_schema.sql, 002_reference_data.sql
│   │   ├── seed/                demoSeed.ts (synthetic data), index.ts
│   │   ├── migrate.ts           minimal migration runner
│   │   └── reset.ts             drop + migrate + seed (dev only)
│   ├── src/
│   │   ├── config/env.ts        environment loading, secrets validation
│   │   ├── db/pool.ts           pg pool, query helpers, transactions
│   │   ├── middleware/          auth (JWT cookie), RBAC, error handler
│   │   ├── routes/index.ts      all endpoints + permission guards
│   │   ├── controllers/         request parsing (zod schemas) → services
│   │   ├── services/            patients, orders (workflow), appointments, chairs, notifications,
│   │   │                        dashboard, infusion, reports, protocols, users, settings, audit, search,
│   │   │                        doseCalculator, warningEngine, nextCycle, clinicalAssistant/
│   │   ├── integrations/        messaging/ (mock + WhatsApp Cloud), fhir/, emr/, lis/, pharmacy/
│   │   ├── jobs/                notification queue worker
│   │   └── utils/               permissions matrix, dates, errors, xlsx/csv writers
│   └── tests/                   vitest unit tests
└── frontend/
    └── src/
        ├── components/          UI kit, layout (collapsible sidebar, search, language switch), badges, warnings
        ├── pages/               Dashboard, Patients, PatientChart, Appointments, Infusion, Orders,
        │                        OrderEditor, OrderDetail, Protocols, Chairs, Reports, Users, Settings,
        │                        Audit, Print, Login
        ├── features/            patients/, appointments/, orders/, common/ (forms, modals, tabs)
        ├── services/api.ts      fetch wrapper (cookie session)
        ├── hooks/               auth, settings/reference data, ticking clock
        ├── i18n/                en.ts, ar.ts, provider (RTL)
        ├── types/, utils/
```

## 6. Configuration (environment variables)

All secrets come from the environment (or a git-ignored `.env`). Nothing is hardcoded.

| Variable | Default | Notes |
|---|---|---|
| `DATABASE_URL` | – | `postgres://user:pass@host:5432/oncosmart` (required in production) |
| `JWT_SECRET` | ephemeral (dev only) | **Required in production.** `openssl rand -hex 48` |
| `JWT_EXPIRES_IN` | `8h` | Session length (one shift) |
| `COOKIE_SECURE` | `false` (dev) | Set `true` behind HTTPS (secure cookie, HSTS, upgrade-insecure-requests) |
| `PORT` | `4000` | API / production server port |
| `DEMO_MODE` | `true` | Demo banner, demo-login shortcuts, admin "reset demo data" |
| `SEED_DEMO_PASSWORD` | `Demo@2026` | Password given to seeded demo accounts |
| `MESSAGING_PROVIDER` | `mock` | `mock` or `whatsapp_cloud` |
| `MOCK_WHATSAPP_AUTO_PROGRESS` | `true` | Mock advances Sent → Delivered → Read automatically |
| `NOTIFICATION_WORKER_INTERVAL_MS` | `10000` | Queue polling interval |
| `DISABLE_WORKER` | `false` | Run the API without the queue worker |
| `WHATSAPP_API_BASE_URL`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_TEMPLATE_NAME` | – | Only for the real WhatsApp Cloud provider |

Unit behaviour (hospital name, time zone, reminder timing, thresholds, checklist…) is configured in
the app under **Settings** and stored in the `settings` table.

## 7. Database, migrations and demo data

* Migrations are plain SQL in `backend/database/migrations`, applied in order and recorded in
  `schema_migrations` (`npm run db:migrate`).
* Tables: `roles, users, patients, patient_identifiers, allergies, diagnoses, drugs, drug_products,
  inventory_batches, protocols, protocol_drugs, treatment_plans, chairs, treatment_orders,
  treatment_order_items, appointments, administrations, vital_signs, treatment_events,
  lab_test_definitions, laboratory_results, patient_notes, notifications, audit_logs, settings`.
* Integrity: UUID keys, foreign keys, CHECK constraints on every status/unit/range, a partial unique
  index (one active order per plan/cycle/day), a **GiST exclusion constraint preventing overlapping
  chair bookings**, and an **append-only trigger on `audit_logs`**.
* `npm run db:seed` loads the synthetic dataset (it replaces all data but keeps settings):
  * 6 users, 6 chairs, 3 DEMO protocols (FOLFOX-like, Carboplatin/Paclitaxel-like,
    Pembrolizumab-like), a demo drug catalogue with vial sizes and batches;
  * 10 fictional patients (lung, colorectal, ovarian) with diagnoses, plans and **42 completed
    historical cycles** (orders, doses, administrations, vitals, labs, messages);
  * **today's live schedule**: one completed, two in treatment (running infusion timers), one in
    preparation, one waiting, one not yet confirmed, one cancelled — and Chair 2 left free for the
    walkthrough;
  * warning scenarios: allergy-drug match (Omar Kareem / paclitaxel), weight loss and dose change,
    renal review, arrived-with-missing-labs and chair conflict (Fatima Mahdi), order awaiting
    approval (Hussein Kadhim, Noor Salman), delayed and held orders (Ali Rahim, Karrar Abdulameer),
    dose reduction (Mustafa Jaber), failed WhatsApp message (invalid phone), completed plan (Maryam Yousif).
* Today's scenarios are created **through the real service layer**, so the seed itself exercises the
  workflow rules and writes genuine audit records.

## 8. Guided demo walkthrough

This mirrors the specification's test workflow (§50). `npm run test:workflow` runs the same steps
automatically through the API; every step was also exercised in a browser.

> Reception registers patients but, by design, cannot enter diagnoses or chemotherapy orders
> (safety principle §3/§6). Steps 3–13 are therefore performed by the physician.

1. **Reception** (`reception@demo.local`) → *Patients → Register patient*: Ahmed Ali, MRN `DEMO-001`,
   tick *No known allergies*.
2. **Physician** (`doctor@demo.local`) → open Ahmed → *Diagnosis → Add diagnosis*.
3. *Treatment plan → Create treatment plan* → select *FOLFOX-like demonstration protocol* (marked DEMO).
4. Enter labs (*Laboratory → Enter results*) — otherwise a "labs missing" warning appears (by design).
5. *New treatment order* → Cycle 1 Day 1, height 170, weight 70 → **BSA 1.82 m²** and calculated doses
   (e.g. oxaliplatin 85 mg/m² × 1.82 = 154.70 → 155 mg) → *Submit for review*.
6. On the order page: review warnings → *Approve order* (acknowledge warnings if requested).
7. **Reception** → *Book appointment* for today, **Chair 2** → a WhatsApp message is queued
   (Arabic for this patient). *Appointments → open the appointment →* simulate **Patient confirms**
   → status becomes *Confirmed*.
8. **Nurse** (`nurse@demo.local`) → *Today's Infusion* → Ahmed's card → *Check in* → *Open order* →
   *Send to preparation* → *Mark prepared* → *Nurse verification* (record pre-treatment vitals,
   complete the checklist) → *Start treatment*.
9. In *Administration*: *Start* oxaliplatin (timer shows elapsed / remaining / expected end), *Pause /
   Resume*, *End* each drug (the 46-h pump keeps running), record *vital signs* during treatment.
10. *Complete treatment* → Chair 2 is released, history and plan progress update, the **next-cycle
    suggestion** (C2D1, +14 days, free chair) appears → *Book next appointment*.
11. **Admin** → *Audit Log* shows every step with user, time, previous and new values.

Try Arabic with the **EN | العربية** switch (top bar) — the whole layout flips to RTL; drug names stay
in English.

## 9. Clinical safety design

* The system **never prescribes autonomously**. Doses are arithmetic on physician-configured protocol
  values; every calculated dose is labelled *"Calculated dose — requires physician verification."*
* Only physicians create, modify and approve orders; approval is refused for incomplete orders
  (missing BSA/weight/GFR, missing infusion duration, no drugs) and requires explicit acknowledgement
  of warnings.
* Treatment cannot start without physician approval, preparation and nurse verification (checklist +
  pre-treatment vitals); it cannot be completed while administrations are undocumented; administered
  dose cannot exceed the approved dose.
* Holding/delaying an order and resuming it requires **re-approval**.
* No clinical content is invented: missing diluent, volume, infusion time, hydration or
  premedication is displayed as **"Not configured — clinician/pharmacy input required."** Reference
  ranges and alert thresholds are configurable placeholders; no dose-modification rules exist.
* Calvert (AUC) dosing requires clinician-entered GFR; Cockcroft–Gault is shown as a reference only.
* Warnings never cancel treatment automatically.
* Clinical Assistant: architecture placeholder only (deterministic summary of recorded data, no AI
  model); all output is labelled *"AI-generated clinical support — physician verification required."*

## 10. WhatsApp integration (mock → real)

**How the mock works** (`backend/src/integrations/messaging/mockWhatsApp.provider.ts`):

1. Creating/rescheduling an appointment queues an immediate message plus 24-h, 2-h and optional
   same-day reminders in `notifications` (reminders already in the past are skipped; pending
   reminders are cancelled on reschedule, cancellation, check-in).
2. The worker (`jobs/notificationWorker.ts`) sends due messages through the configured provider. The
   mock **sends nothing**: it validates the phone number (invalid → `FAILED`) and returns a fake id.
3. With `MOCK_WHATSAPP_AUTO_PROGRESS=true` the mock advances `SENT → DELIVERED → READ`.
4. Patient replies (*Confirm / Request reschedule / Cancel*) are simulated from the appointment
   dialog or *Appointments → Messages*; they go through the same `applyPatientResponse` code path a
   real webhook uses and update the appointment.

**Replacing it with the real WhatsApp Business (Cloud) API:**

1. In Meta Business Manager create a WhatsApp Business account, register the unit's phone number and
   get a permanent access token and phone-number id.
2. Create and get approval for a **message template** (e.g. `chemo_appointment_reminder`) in Arabic
   and English with 5 body variables (patient name, date, time, arrival minutes, hospital) and three
   **quick-reply buttons** whose payloads are `CONFIRM`, `RESCHEDULE`, `CANCEL`.
3. Set `MESSAGING_PROVIDER=whatsapp_cloud` and the `WHATSAPP_*` variables.
4. Configure the webhook URL `https://<your-host>/api/integrations/whatsapp/webhook` with
   `WHATSAPP_VERIFY_TOKEN`; incoming requests are verified with `X-Hub-Signature-256`
   (`WHATSAPP_APP_SECRET`) and translated to status / reply events
   (`whatsappCloud.provider.ts → parseWhatsAppWebhook`).
5. Verify payload formats against Meta's current documentation before go-live (the skeleton was not
   run against Meta's servers in this prototype).

Any other channel (SMS gateway, e-mail) = implement the `MessagingProvider` interface in
`integrations/messaging/` and register it in `integrations/messaging/index.ts`. Other integration
points are listed in `backend/src/integrations/README.md` (EMR, LIS, pharmacy, HL7-FHIR — a read-only
`GET /api/integrations/fhir/Patient/:id` bundle is included).

## 11. Security

* Passwords hashed with **bcrypt** (cost 11); password policy ≥ 8 chars with letters and digits.
* Session = signed JWT in an **httpOnly, SameSite=Strict** cookie (secure when `COOKIE_SECURE=true`);
  users are re-loaded on each request so deactivation is immediate; 8-hour expiry.
* Server-side RBAC on every endpoint (`utils/permissions.ts`); the UI only hides what the server
  already forbids.
* Login rate limiting, helmet security headers and CSP, `Cache-Control: no-store` on the API,
  input validation with zod, parameterised SQL everywhere.
* **No patient data in URLs**: routes use opaque UUIDs; search terms travel in POST bodies; request
  logs contain method/path/status only (no bodies).
* Reception cannot read clinical data; audit log is append-only (DB trigger) and records logins,
  failed logins, every clinical/scheduling change with previous/new values, IP and user agent.
* No secrets in the repository (`.env` is git-ignored; `.env.example` contains placeholders).

## 12. Testing

* `npm test` — 34 unit tests: Mosteller BSA, mg/m² / mg/kg / flat / Calvert, dose %, rounding rules
  (incl. 163.2 → 163), Cockcroft–Gault, vial estimation, every warning type, next-cycle logic.
* `npm run test:workflow` — 28-step end-to-end verification of the specification workflow including
  safety checks (reception cannot prescribe, nurse cannot start before approval or edit orders, chair
  double booking rejected, completion refused with undocumented administrations, audit trail present).
  Run it right after `npm run db:seed` while `npm run dev` is running.
* The complete workflow was additionally driven through the browser UI (Playwright) for all four
  roles, and all pages were checked in English, Arabic (RTL), tablet (1024 px) and mobile (390 px)
  viewports without console errors.

## 13. Deployment

**Single server (recommended for a pilot):**

```bash
npm ci && npm run build
NODE_ENV=production DATABASE_URL=... JWT_SECRET=... COOKIE_SECURE=true npm run db:migrate
NODE_ENV=production DATABASE_URL=... JWT_SECRET=... COOKIE_SECURE=true npm start   # serves API + frontend on :4000
```

Put it behind a reverse proxy (nginx / Caddy) that terminates **HTTPS**, and run it with a process
manager (systemd / pm2). Back up PostgreSQL daily (`pg_dump`). For real use set `DEMO_MODE=false`,
create real users, change every default, and do **not** load the demo seed.

**Docker Compose (demo):** `POSTGRES_PASSWORD=... JWT_SECRET=... docker compose up --build`, then load
demo data once with `docker compose exec app node backend/dist/database/seed/index.js`.
(The Dockerfile and compose file are provided but were not built inside this development environment.)

## 14. API overview

All endpoints are under `/api` and return JSON; errors have the shape
`{ "error": { "code", "message", "details" } }` with user-friendly messages.

| Area | Endpoints |
|---|---|
| Auth | `POST /auth/login`, `POST /auth/logout`, `GET /auth/session`, `GET /auth/me`, `POST /auth/change-password`, `GET /public/config` |
| Dashboard / search | `GET /dashboard`, `POST /search`, `GET /infusion/today` |
| Patients | `POST /patients/query`, `POST /patients`, `GET/PATCH /patients/:id`, `PATCH /patients/:id/status`, `GET /patients/:id/{timeline,history,appointments,orders,diagnoses,plans,labs,vitals,notes}`, `POST /patients/:id/{allergies,diagnoses,plans,labs,vitals,notes,assistant/summary}`, `POST /allergies/:id/inactivate`, `PATCH /diagnoses/:id`, `PATCH /plans/:id` |
| Orders | `POST /orders/preview`, `POST /orders`, `GET /orders`, `GET/PUT /orders/:id`, `POST /orders/:id/{submit,approve,return,release,prepared,verify,start,complete,hold,delay,resume,cancel,events}`, `POST /administrations/:id/{start,pause,resume,complete,stop,not_given}` |
| Appointments | `GET /appointments?from&to`, `GET /appointments/suggest-chair`, `GET/PUT /appointments/:id`, `POST /appointments`, `POST /appointments/:id/{cancel,check-in,status,reminder}` |
| Messaging | `GET /notifications`, `POST /notifications/process`, `POST /notifications/:id/{simulate,retry}`, `GET/POST /integrations/whatsapp/webhook` |
| Configuration | `GET/POST /chairs`, `PUT /chairs/:id`, `POST /chairs/:id/status`, `GET/POST /protocols`, `GET/PUT /protocols/:id`, `PATCH /protocols/:id/active`, `GET /protocols/rounding-rules`, `GET /drugs`, `GET/POST /users`, `PUT /users/:id`, `POST /users/:id/reset-password`, `GET/PUT /settings`, `GET /lab-tests`, `GET /audit`, `POST /admin/reset-demo` |
| Reports | `GET /reports`, `GET /reports/:type?from&to`, `GET /reports/:type/export?format=csv|xlsx` |
| Interop | `GET /integrations/fhir/Patient/:id` |

## 15. Design decisions

* **Stack**: React + TypeScript + Tailwind, Node.js + Express 5 + TypeScript, PostgreSQL with plain
  SQL (no ORM) — simple for a solo developer and easy to point at a hospital database later.
* **Location in the repository**: the app lives in `oncosmart/` so the existing T-DXd CRF files at
  the repository root are untouched.
* **Doses are computed only on the server**; the UI previews by calling the same code.
* BSA is rounded to 2 decimals and that value is used for calculation (as displayed on the order).
* Dose % is applied before rounding; the unmodified calculated dose is always stored.
* Appointment "working week" in the calendar starts on Saturday (Iraq).
* Nurses may book the next appointment at discharge (scheduling only; never doses).
* Continuous infusions (ambulatory pumps) are allowed to remain "infusing" after the chair session
  and are documented later.
* Chair status is driven by the workflow (reserved → preparing → infusing → available/cleaning);
  staff set Cleaning / Out of service / Available manually.
* Demo protocol values are illustrative placeholders; some pharmacy fields are intentionally left
  unconfigured to demonstrate the "Not configured" safety display.

## 16. Known limitations

* Prototype for demonstration with synthetic data — **not validated for clinical use**, no
  regulatory assessment, no formal clinical safety case.
* WhatsApp Cloud provider, EMR, LIS, pharmacy and FHIR are integration skeletons/placeholders; only
  the mock messaging provider is exercised.
* No pharmacist role / pharmacy verification step, no stock decrement, no barcode (patient
  wristband / drug bag) scanning.
* Single active treatment plan per patient; no multi-day inpatient regimens, no oral chemotherapy
  dispensing workflow, no dose-banding tables.
* Laboratory reference ranges are generic defaults (not sex/age specific).
* Protocol versions are stored as increments; full historical protocol versions are not browsable.
* Reports are computed on demand (fine for one unit; would need materialised views at scale).
* No offline mode; browser print is used for PDFs (no server-side PDF generation).
* Authentication is local accounts only (no SSO/LDAP, no 2FA yet).

## 17. What to build next

1. **Pharmacy module**: pharmacist verification step, compounding worksheet, stock deduction by batch,
   vial-sharing, expiry alerts, barcode verification of patient and drug bag.
2. **Real integrations**: WhatsApp Business template approval + webhook, LIS import (HL7 v2 ORU / FHIR
   Observation), EMR patient lookup (ADT), SMS fallback.
3. **Clinical content governance**: protocol authoring with dual sign-off, version history and
   references; institution-approved dose-modification tables (entered by the oncology team).
4. **Toxicity documentation** (CTCAE grading), patient-reported outcomes, consent capture.
5. **Security hardening**: SSO/2FA, session management UI, field-level encryption for identifiers,
   penetration test, backup/restore runbook.
6. **Scale-out modules** on the same schema: outpatient clinic, inpatient oncology, tumour board/MDT,
   radiotherapy, palliative care, registry statistics, and a governed AI Clinical Assistant behind the
   existing `ClinicalAssistantProvider` interface.
