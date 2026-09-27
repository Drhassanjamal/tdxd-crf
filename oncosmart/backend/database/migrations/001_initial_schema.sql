-- =============================================================================
-- OncoSmart — Chemotherapy Unit
-- Migration 001: initial normalized schema
--
-- Design notes
--  * UUID primary keys everywhere (safe to expose in URLs, merge-friendly for
--    future multi-site / EMR integration). Human-readable codes (patient_code,
--    order_number, appointment_number) are separate columns.
--  * Clinical order items SNAPSHOT protocol drug data at order time so later
--    protocol edits never silently change an existing order.
--  * Chair double-booking is prevented at the database level with an
--    exclusion constraint (btree_gist) in addition to application checks.
--  * audit_logs is append-only (UPDATE/DELETE blocked by trigger).
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- -----------------------------------------------------------------------------
-- Users & roles
-- -----------------------------------------------------------------------------
CREATE TABLE roles (
  code        TEXT PRIMARY KEY CHECK (code IN ('ADMIN','PHYSICIAN','NURSE','RECEPTION')),
  name        TEXT NOT NULL,
  description TEXT
);

CREATE TABLE users (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email               TEXT NOT NULL,
  password_hash       TEXT NOT NULL,
  full_name           TEXT NOT NULL,
  full_name_ar        TEXT,
  role_code           TEXT NOT NULL REFERENCES roles(code),
  title               TEXT,
  phone               TEXT,
  is_active           BOOLEAN NOT NULL DEFAULT TRUE,
  last_login_at       TIMESTAMPTZ,
  password_changed_at TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_uq ON users (lower(email));
CREATE TRIGGER users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- -----------------------------------------------------------------------------
-- Patients
-- -----------------------------------------------------------------------------
CREATE SEQUENCE patient_code_seq START 1001;

CREATE TABLE patients (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_code                TEXT NOT NULL UNIQUE DEFAULT ('P-' || lpad(nextval('patient_code_seq')::text, 6, '0')),
  mrn                         TEXT NOT NULL,
  first_name                  TEXT NOT NULL,
  last_name                   TEXT NOT NULL,
  full_name_ar                TEXT,
  date_of_birth               DATE NOT NULL,
  sex                         TEXT NOT NULL CHECK (sex IN ('MALE','FEMALE')),
  phone                       TEXT,
  governorate                 TEXT,
  address                     TEXT,
  preferred_language          TEXT NOT NULL DEFAULT 'ar' CHECK (preferred_language IN ('en','ar')),
  emergency_contact_name      TEXT,
  emergency_contact_phone     TEXT,
  emergency_contact_relation  TEXT,
  no_known_allergies          BOOLEAN NOT NULL DEFAULT FALSE,
  status                      TEXT NOT NULL DEFAULT 'ACTIVE_TREATMENT' CHECK (status IN (
                                'ACTIVE_TREATMENT','TREATMENT_COMPLETED','ON_HOLD','DISCONTINUED',
                                'FOLLOW_UP','PALLIATIVE_CARE','DECEASED')),
  primary_oncologist_id       UUID REFERENCES users(id),
  height_cm                   NUMERIC(5,1) CHECK (height_cm IS NULL OR (height_cm > 30 AND height_cm < 260)),
  weight_kg                   NUMERIC(5,1) CHECK (weight_kg IS NULL OR (weight_kg > 1 AND weight_kg < 400)),
  is_demo                     BOOLEAN NOT NULL DEFAULT TRUE,
  created_by                  UUID REFERENCES users(id),
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX patients_mrn_uq ON patients (upper(mrn));
CREATE INDEX patients_name_idx ON patients (lower(last_name), lower(first_name));
CREATE INDEX patients_phone_idx ON patients (phone);
CREATE TRIGGER patients_updated_at BEFORE UPDATE ON patients FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- External identifiers (future EMR / LIS / HL7-FHIR linkage)
CREATE TABLE patient_identifiers (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id  UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  system      TEXT NOT NULL,          -- e.g. 'HOSPITAL_EMR', 'LIS', 'FHIR'
  value       TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (system, value)
);

CREATE TABLE allergies (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id      UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  allergen        TEXT NOT NULL,
  allergen_type   TEXT NOT NULL DEFAULT 'DRUG' CHECK (allergen_type IN ('DRUG','FOOD','ENVIRONMENTAL','OTHER')),
  reaction        TEXT,
  severity        TEXT NOT NULL DEFAULT 'UNKNOWN' CHECK (severity IN ('MILD','MODERATE','SEVERE','UNKNOWN')),
  notes           TEXT,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  recorded_by     UUID REFERENCES users(id),
  inactivated_by  UUID REFERENCES users(id),
  inactivated_at  TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX allergies_patient_idx ON allergies (patient_id);

CREATE TABLE diagnoses (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id      UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  primary_cancer  TEXT NOT NULL,
  cancer_type     TEXT NOT NULL,
  icd10_code      TEXT,
  histology       TEXT,
  stage           TEXT,
  biomarkers      TEXT,
  diagnosis_date  DATE,
  oncologist_id   UUID REFERENCES users(id),
  is_primary      BOOLEAN NOT NULL DEFAULT TRUE,
  notes           TEXT,
  created_by      UUID REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX diagnoses_patient_idx ON diagnoses (patient_id);
CREATE TRIGGER diagnoses_updated_at BEFORE UPDATE ON diagnoses FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- -----------------------------------------------------------------------------
-- Drug catalog & inventory (architecture only — not a full pharmacy system)
-- -----------------------------------------------------------------------------
CREATE TABLE drugs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  generic_name  TEXT NOT NULL,
  drug_class    TEXT,
  notes         TEXT,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX drugs_generic_name_uq ON drugs (lower(generic_name));

CREATE TABLE drug_products (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  drug_id       UUID NOT NULL REFERENCES drugs(id) ON DELETE CASCADE,
  brand_name    TEXT,
  manufacturer  TEXT,
  strength      NUMERIC(10,2) NOT NULL,          -- amount of drug per vial/unit
  strength_unit TEXT NOT NULL DEFAULT 'mg',
  vial_size_ml  NUMERIC(8,2),
  form          TEXT NOT NULL DEFAULT 'VIAL' CHECK (form IN ('VIAL','AMPOULE','TABLET','CAPSULE','PREFILLED_SYRINGE','OTHER')),
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE inventory_batches (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  drug_product_id   UUID NOT NULL REFERENCES drug_products(id) ON DELETE CASCADE,
  batch_number      TEXT NOT NULL,
  expiry_date       DATE NOT NULL,
  quantity_on_hand  INT NOT NULL DEFAULT 0 CHECK (quantity_on_hand >= 0),
  location          TEXT,
  received_at       DATE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (drug_product_id, batch_number)
);

-- -----------------------------------------------------------------------------
-- Protocol library
-- -----------------------------------------------------------------------------
CREATE TABLE protocols (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code                    TEXT NOT NULL UNIQUE,
  name                    TEXT NOT NULL,
  cancer_type             TEXT NOT NULL,
  intent                  TEXT NOT NULL CHECK (intent IN ('CURATIVE','ADJUVANT','NEOADJUVANT','PALLIATIVE','MAINTENANCE')),
  cycle_length_days       INT NOT NULL CHECK (cycle_length_days > 0),
  planned_cycles          INT NOT NULL CHECK (planned_cycles > 0),
  treatment_days          INT[] NOT NULL DEFAULT '{1}',
  estimated_duration_min  INT CHECK (estimated_duration_min IS NULL OR estimated_duration_min > 0),
  premedications          TEXT,
  hydration               TEXT,
  supportive_medications  TEXT,
  special_instructions    TEXT,
  required_labs           TEXT[] NOT NULL DEFAULT '{}',
  default_rounding_rule   TEXT NOT NULL DEFAULT 'NEAREST_1',
  is_demo                 BOOLEAN NOT NULL DEFAULT TRUE,
  is_active               BOOLEAN NOT NULL DEFAULT TRUE,
  version                 INT NOT NULL DEFAULT 1,
  created_by              UUID REFERENCES users(id),
  updated_by              UUID REFERENCES users(id),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER protocols_updated_at BEFORE UPDATE ON protocols FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE protocol_drugs (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  protocol_id             UUID NOT NULL REFERENCES protocols(id) ON DELETE CASCADE,
  drug_id                 UUID REFERENCES drugs(id),
  sequence                INT NOT NULL CHECK (sequence > 0),
  drug_name               TEXT NOT NULL,
  dose_value              NUMERIC(10,3) NOT NULL CHECK (dose_value > 0),
  dose_unit               TEXT NOT NULL CHECK (dose_unit IN ('MG','MG_M2','MG_KG','AUC')),
  route                   TEXT NOT NULL CHECK (route IN ('IV','PO','SC','IM')),
  administration_method   TEXT CHECK (administration_method IN ('INFUSION','BOLUS','CONTINUOUS_INFUSION','ORAL','INJECTION')),
  diluent                 TEXT,
  final_volume_ml         NUMERIC(8,1) CHECK (final_volume_ml IS NULL OR final_volume_ml > 0),
  infusion_duration_min   INT CHECK (infusion_duration_min IS NULL OR infusion_duration_min > 0),
  treatment_days          INT[] NOT NULL DEFAULT '{1}',
  premedication_required  BOOLEAN NOT NULL DEFAULT FALSE,
  rounding_rule           TEXT,              -- NULL = use protocol default
  special_instructions    TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX protocol_drugs_protocol_idx ON protocol_drugs (protocol_id, sequence);
CREATE TRIGGER protocol_drugs_updated_at BEFORE UPDATE ON protocol_drugs FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- -----------------------------------------------------------------------------
-- Treatment plans
-- -----------------------------------------------------------------------------
CREATE TABLE treatment_plans (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id          UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  diagnosis_id        UUID REFERENCES diagnoses(id),
  protocol_id         UUID NOT NULL REFERENCES protocols(id),
  intent              TEXT NOT NULL CHECK (intent IN ('CURATIVE','ADJUVANT','NEOADJUVANT','PALLIATIVE','MAINTENANCE')),
  cycle_length_days   INT NOT NULL CHECK (cycle_length_days > 0),
  planned_cycles      INT NOT NULL CHECK (planned_cycles > 0),
  current_cycle       INT NOT NULL DEFAULT 0,     -- last cycle administered / in progress (0 = not started)
  current_day         INT NOT NULL DEFAULT 0,
  cycles_completed    INT NOT NULL DEFAULT 0,
  next_cycle          INT DEFAULT 1,              -- next-cycle suggestion (NULL = plan complete)
  next_day            INT DEFAULT 1,
  next_due_date       DATE,
  start_date          DATE NOT NULL,
  planned_end_date    DATE,
  status              TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','COMPLETED','ON_HOLD','DISCONTINUED')),
  physician_id        UUID NOT NULL REFERENCES users(id),
  notes               TEXT,
  created_by          UUID REFERENCES users(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX treatment_plans_patient_idx ON treatment_plans (patient_id);
CREATE TRIGGER treatment_plans_updated_at BEFORE UPDATE ON treatment_plans FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- -----------------------------------------------------------------------------
-- Chairs
-- -----------------------------------------------------------------------------
CREATE TABLE chairs (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code                    TEXT NOT NULL UNIQUE,
  name                    TEXT NOT NULL,
  zone                    TEXT,
  chair_type              TEXT NOT NULL DEFAULT 'RECLINER' CHECK (chair_type IN ('RECLINER','BED','ISOLATION')),
  status                  TEXT NOT NULL DEFAULT 'AVAILABLE' CHECK (status IN (
                            'AVAILABLE','RESERVED','PREPARING','INFUSING','CLEANING','OUT_OF_SERVICE')),
  current_appointment_id  UUID,
  status_note             TEXT,
  status_changed_at       TIMESTAMPTZ,
  status_changed_by       UUID REFERENCES users(id),
  sort_order              INT NOT NULL DEFAULT 0,
  is_active               BOOLEAN NOT NULL DEFAULT TRUE,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER chairs_updated_at BEFORE UPDATE ON chairs FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- -----------------------------------------------------------------------------
-- Treatment orders
-- -----------------------------------------------------------------------------
CREATE SEQUENCE treatment_order_seq START 1;

CREATE TABLE treatment_orders (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number              TEXT NOT NULL UNIQUE DEFAULT ('CO-' || lpad(nextval('treatment_order_seq')::text, 6, '0')),
  patient_id                UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  treatment_plan_id         UUID NOT NULL REFERENCES treatment_plans(id),
  protocol_id               UUID NOT NULL REFERENCES protocols(id),
  diagnosis_id              UUID REFERENCES diagnoses(id),
  protocol_name             TEXT NOT NULL,        -- snapshot
  protocol_version          INT,
  intent                    TEXT,
  cycle_number              INT NOT NULL CHECK (cycle_number >= 1),
  day_number                INT NOT NULL CHECK (day_number >= 1),
  planned_date              DATE NOT NULL,
  height_cm                 NUMERIC(5,1),
  weight_kg                 NUMERIC(5,1),
  bsa_m2                    NUMERIC(4,2),
  bsa_formula               TEXT NOT NULL DEFAULT 'MOSTELLER',
  gfr_ml_min                NUMERIC(6,1),
  gfr_source                TEXT,
  status                    TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN (
                              'DRAFT','PENDING_REVIEW','APPROVED','READY_FOR_PREPARATION','PREPARED',
                              'READY_FOR_ADMINISTRATION','IN_PROGRESS','COMPLETED','CANCELLED','HELD','DELAYED')),
  premedications            TEXT,
  hydration                 TEXT,
  supportive_medications    TEXT,
  special_instructions      TEXT,
  clinical_notes            TEXT,
  warnings                  JSONB NOT NULL DEFAULT '[]'::jsonb,   -- snapshot reviewed at approval
  warnings_acknowledged_by  UUID REFERENCES users(id),
  warnings_acknowledged_at  TIMESTAMPTZ,
  prescribed_by             UUID NOT NULL REFERENCES users(id),
  prescribed_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  submitted_by              UUID REFERENCES users(id),
  submitted_at              TIMESTAMPTZ,
  approved_by               UUID REFERENCES users(id),
  approved_at               TIMESTAMPTZ,
  approval_note             TEXT,
  released_by               UUID REFERENCES users(id),
  released_at               TIMESTAMPTZ,
  prepared_by               UUID REFERENCES users(id),
  prepared_at               TIMESTAMPTZ,
  nurse_verified_by         UUID REFERENCES users(id),
  nurse_verified_at         TIMESTAMPTZ,
  pretreatment_checklist    JSONB,
  treatment_started_by      UUID REFERENCES users(id),
  treatment_started_at      TIMESTAMPTZ,
  completed_by              UUID REFERENCES users(id),
  completed_at              TIMESTAMPTZ,
  treatment_duration_min    INT,
  adverse_event             BOOLEAN,
  adverse_event_details     TEXT,
  completion_notes          TEXT,
  disposition               TEXT CHECK (disposition IS NULL OR disposition IN ('HOME','ADMITTED','TRANSFERRED_ER','OBSERVATION','OTHER')),
  status_before_hold        TEXT,
  hold_reason               TEXT,
  held_by                   UUID REFERENCES users(id),
  held_at                   TIMESTAMPTZ,
  delay_reason              TEXT,
  delayed_until             DATE,
  cancelled_reason          TEXT,
  cancelled_by              UUID REFERENCES users(id),
  cancelled_at              TIMESTAMPTZ,
  created_by                UUID REFERENCES users(id),
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX treatment_orders_plan_cycle_day_uq
  ON treatment_orders (treatment_plan_id, cycle_number, day_number) WHERE status <> 'CANCELLED';
CREATE INDEX treatment_orders_patient_idx ON treatment_orders (patient_id, planned_date DESC);
CREATE INDEX treatment_orders_status_idx ON treatment_orders (status);
CREATE TRIGGER treatment_orders_updated_at BEFORE UPDATE ON treatment_orders FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE treatment_order_items (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  treatment_order_id        UUID NOT NULL REFERENCES treatment_orders(id) ON DELETE CASCADE,
  protocol_drug_id          UUID REFERENCES protocol_drugs(id) ON DELETE SET NULL,
  drug_id                   UUID REFERENCES drugs(id),
  sequence                  INT NOT NULL,
  drug_name                 TEXT NOT NULL,
  dose_value                NUMERIC(10,3) NOT NULL,     -- prescribed per-unit dose (e.g. 85 mg/m², AUC 5)
  dose_unit                 TEXT NOT NULL CHECK (dose_unit IN ('MG','MG_M2','MG_KG','AUC')),
  dose_basis_value          NUMERIC(10,3),              -- BSA / weight / GFR used in the calculation
  calculated_dose           NUMERIC(12,4),              -- exact calculated dose at 100 % (mg) — preserved
  dose_percent              NUMERIC(5,1) NOT NULL DEFAULT 100 CHECK (dose_percent > 0 AND dose_percent <= 150),
  rounding_rule             TEXT NOT NULL,
  rounded_dose              NUMERIC(12,2),              -- after dose % and rounding rule
  final_dose                NUMERIC(12,2) NOT NULL CHECK (final_dose > 0),
  final_dose_unit           TEXT NOT NULL DEFAULT 'mg',
  is_manually_adjusted      BOOLEAN NOT NULL DEFAULT FALSE,
  dose_modification_reason  TEXT,
  calculation_formula       TEXT,
  previous_final_dose       NUMERIC(12,2),
  route                     TEXT NOT NULL CHECK (route IN ('IV','PO','SC','IM')),
  administration_method     TEXT,
  diluent                   TEXT,
  final_volume_ml           NUMERIC(8,1),
  infusion_duration_min     INT,
  premedication_required    BOOLEAN NOT NULL DEFAULT FALSE,
  special_instructions      TEXT,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX treatment_order_items_order_idx ON treatment_order_items (treatment_order_id, sequence);
CREATE TRIGGER treatment_order_items_updated_at BEFORE UPDATE ON treatment_order_items FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- -----------------------------------------------------------------------------
-- Appointments
-- -----------------------------------------------------------------------------
CREATE SEQUENCE appointment_seq START 1;

CREATE TABLE appointments (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_number    TEXT NOT NULL UNIQUE DEFAULT ('AP-' || lpad(nextval('appointment_seq')::text, 6, '0')),
  patient_id            UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  treatment_plan_id     UUID REFERENCES treatment_plans(id),
  treatment_order_id    UUID REFERENCES treatment_orders(id) ON DELETE SET NULL,
  protocol_id           UUID REFERENCES protocols(id),
  cycle_number          INT,
  day_number            INT,
  appointment_type      TEXT NOT NULL DEFAULT 'CHEMOTHERAPY' CHECK (appointment_type IN (
                          'CHEMOTHERAPY','IMMUNOTHERAPY','SUPPORTIVE_CARE','HYDRATION','PROCEDURE','OTHER')),
  appointment_date      DATE NOT NULL,
  start_time            TIME NOT NULL,
  duration_minutes      INT NOT NULL CHECK (duration_minutes > 0 AND duration_minutes <= 720),
  slot                  TSRANGE GENERATED ALWAYS AS (
                          tsrange(appointment_date + start_time,
                                  appointment_date + start_time + (duration_minutes * interval '1 minute'), '[)')
                        ) STORED,
  chair_id              UUID REFERENCES chairs(id),
  physician_id          UUID REFERENCES users(id),
  status                TEXT NOT NULL DEFAULT 'SCHEDULED' CHECK (status IN (
                          'SCHEDULED','CONFIRMED','NEEDS_RESCHEDULING','ARRIVED','IN_PREPARATION',
                          'IN_TREATMENT','COMPLETED','CANCELLED','NO_SHOW')),
  confirmation_source   TEXT,
  confirmed_at          TIMESTAMPTZ,
  arrived_at            TIMESTAMPTZ,
  checked_in_by         UUID REFERENCES users(id),
  cancelled_at          TIMESTAMPTZ,
  cancelled_by          UUID REFERENCES users(id),
  cancel_reason         TEXT,
  rescheduled_from_id   UUID REFERENCES appointments(id),
  notes                 TEXT,
  created_by            UUID REFERENCES users(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- A chair can never hold two active bookings for overlapping times.
  CONSTRAINT appointments_no_chair_overlap EXCLUDE USING gist (chair_id WITH =, slot WITH &&)
    WHERE (chair_id IS NOT NULL AND status NOT IN ('CANCELLED','NO_SHOW','NEEDS_RESCHEDULING','COMPLETED'))
);
CREATE INDEX appointments_date_idx ON appointments (appointment_date, start_time);
CREATE INDEX appointments_patient_idx ON appointments (patient_id, appointment_date DESC);
CREATE TRIGGER appointments_updated_at BEFORE UPDATE ON appointments FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE chairs
  ADD CONSTRAINT chairs_current_appointment_fk
  FOREIGN KEY (current_appointment_id) REFERENCES appointments(id) ON DELETE SET NULL;

-- -----------------------------------------------------------------------------
-- Administration & nursing documentation
-- -----------------------------------------------------------------------------
CREATE TABLE administrations (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  treatment_order_id        UUID NOT NULL REFERENCES treatment_orders(id) ON DELETE CASCADE,
  treatment_order_item_id   UUID NOT NULL UNIQUE REFERENCES treatment_order_items(id) ON DELETE CASCADE,
  patient_id                UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  appointment_id            UUID REFERENCES appointments(id) ON DELETE SET NULL,
  sequence                  INT NOT NULL,
  drug_name                 TEXT NOT NULL,
  planned_dose              NUMERIC(12,2) NOT NULL,
  dose_administered         NUMERIC(12,2),
  dose_unit                 TEXT NOT NULL DEFAULT 'mg',
  route                     TEXT NOT NULL,
  diluent                   TEXT,
  volume_ml                 NUMERIC(8,1),
  planned_duration_min      INT,
  status                    TEXT NOT NULL DEFAULT 'NOT_STARTED' CHECK (status IN (
                              'NOT_STARTED','IN_PROGRESS','PAUSED','COMPLETED','STOPPED','NOT_GIVEN')),
  start_time                TIMESTAMPTZ,
  end_time                  TIMESTAMPTZ,
  paused_at                 TIMESTAMPTZ,
  total_paused_seconds      INT NOT NULL DEFAULT 0,
  started_by                UUID REFERENCES users(id),
  completed_by              UUID REFERENCES users(id),
  reaction                  BOOLEAN NOT NULL DEFAULT FALSE,
  reaction_details          TEXT,
  observations              TEXT,
  notes                     TEXT,
  not_given_reason          TEXT,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX administrations_order_idx ON administrations (treatment_order_id, sequence);
CREATE INDEX administrations_patient_idx ON administrations (patient_id);
CREATE TRIGGER administrations_updated_at BEFORE UPDATE ON administrations FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE vital_signs (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id          UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  treatment_order_id  UUID REFERENCES treatment_orders(id) ON DELETE SET NULL,
  administration_id   UUID REFERENCES administrations(id) ON DELETE SET NULL,
  appointment_id      UUID REFERENCES appointments(id) ON DELETE SET NULL,
  phase               TEXT NOT NULL CHECK (phase IN ('PRE','DURING','POST','OTHER')),
  measured_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  bp_systolic         INT CHECK (bp_systolic IS NULL OR bp_systolic BETWEEN 40 AND 300),
  bp_diastolic        INT CHECK (bp_diastolic IS NULL OR bp_diastolic BETWEEN 20 AND 200),
  heart_rate          INT CHECK (heart_rate IS NULL OR heart_rate BETWEEN 20 AND 250),
  resp_rate           INT CHECK (resp_rate IS NULL OR resp_rate BETWEEN 4 AND 80),
  temperature_c       NUMERIC(4,1) CHECK (temperature_c IS NULL OR temperature_c BETWEEN 30 AND 45),
  spo2                INT CHECK (spo2 IS NULL OR spo2 BETWEEN 40 AND 100),
  weight_kg           NUMERIC(5,1) CHECK (weight_kg IS NULL OR weight_kg BETWEEN 1 AND 400),
  pain_score          INT CHECK (pain_score IS NULL OR pain_score BETWEEN 0 AND 10),
  notes               TEXT,
  recorded_by         UUID REFERENCES users(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX vital_signs_patient_idx ON vital_signs (patient_id, measured_at DESC);
CREATE INDEX vital_signs_order_idx ON vital_signs (treatment_order_id);

CREATE TABLE treatment_events (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id          UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  treatment_order_id  UUID REFERENCES treatment_orders(id) ON DELETE SET NULL,
  administration_id   UUID REFERENCES administrations(id) ON DELETE SET NULL,
  event_type          TEXT NOT NULL CHECK (event_type IN (
                        'INFUSION_REACTION','HYPERSENSITIVITY','EXTRAVASATION','NAUSEA_VOMITING',
                        'VASOVAGAL','DEVICE_ISSUE','OTHER')),
  severity            TEXT NOT NULL CHECK (severity IN ('MILD','MODERATE','SEVERE','LIFE_THREATENING')),
  description         TEXT NOT NULL,
  action_taken        TEXT,
  physician_notified  BOOLEAN NOT NULL DEFAULT FALSE,
  occurred_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  reported_by         UUID REFERENCES users(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX treatment_events_patient_idx ON treatment_events (patient_id, occurred_at DESC);

-- -----------------------------------------------------------------------------
-- Laboratory
-- -----------------------------------------------------------------------------
CREATE TABLE lab_test_definitions (
  code        TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  panel       TEXT NOT NULL CHECK (panel IN ('CBC','RENAL','LIVER','OTHER')),
  unit        TEXT NOT NULL,
  ref_low     NUMERIC(12,3),
  ref_high    NUMERIC(12,3),
  sort_order  INT NOT NULL DEFAULT 0,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE laboratory_results (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id    UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  test_code     TEXT NOT NULL REFERENCES lab_test_definitions(code),
  value         NUMERIC(12,3) NOT NULL,
  unit          TEXT NOT NULL,
  ref_low       NUMERIC(12,3),
  ref_high      NUMERIC(12,3),
  collected_at  TIMESTAMPTZ NOT NULL,
  source        TEXT NOT NULL DEFAULT 'MANUAL' CHECK (source IN ('MANUAL','LIS_IMPORT','DEMO')),
  notes         TEXT,
  entered_by    UUID REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX laboratory_results_patient_idx ON laboratory_results (patient_id, test_code, collected_at DESC);

-- -----------------------------------------------------------------------------
-- Notes
-- -----------------------------------------------------------------------------
CREATE TABLE patient_notes (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id          UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  author_id           UUID NOT NULL REFERENCES users(id),
  note_type           TEXT NOT NULL DEFAULT 'GENERAL' CHECK (note_type IN ('PHYSICIAN','NURSING','GENERAL')),
  content             TEXT NOT NULL,
  treatment_order_id  UUID REFERENCES treatment_orders(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX patient_notes_patient_idx ON patient_notes (patient_id, created_at DESC);

-- -----------------------------------------------------------------------------
-- Notifications (WhatsApp / SMS / e-mail queue — provider-agnostic)
-- -----------------------------------------------------------------------------
CREATE TABLE notifications (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id            UUID REFERENCES patients(id) ON DELETE CASCADE,
  appointment_id        UUID REFERENCES appointments(id) ON DELETE SET NULL,
  channel               TEXT NOT NULL DEFAULT 'WHATSAPP' CHECK (channel IN ('WHATSAPP','SMS','EMAIL','IN_APP')),
  notification_type     TEXT NOT NULL CHECK (notification_type IN (
                          'APPOINTMENT_CREATED','APPOINTMENT_RESCHEDULED','APPOINTMENT_CANCELLED',
                          'REMINDER_24H','REMINDER_2H','REMINDER_SAME_DAY','MANUAL_REMINDER')),
  recipient             TEXT,
  language              TEXT NOT NULL DEFAULT 'en',
  message_body          TEXT NOT NULL,
  interactive_options   JSONB,
  status                TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN (
                          'PENDING','SENT','DELIVERED','READ','FAILED','CANCELLED')),
  scheduled_for         TIMESTAMPTZ NOT NULL DEFAULT now(),
  attempts              INT NOT NULL DEFAULT 0,
  last_attempt_at       TIMESTAMPTZ,
  sent_at               TIMESTAMPTZ,
  delivered_at          TIMESTAMPTZ,
  read_at               TIMESTAMPTZ,
  failed_at             TIMESTAMPTZ,
  failure_reason        TEXT,
  provider              TEXT,
  provider_message_id   TEXT,
  patient_response      TEXT CHECK (patient_response IS NULL OR patient_response IN ('CONFIRM','RESCHEDULE','CANCEL')),
  responded_at          TIMESTAMPTZ,
  created_by            UUID REFERENCES users(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX notifications_queue_idx ON notifications (status, scheduled_for);
CREATE INDEX notifications_appointment_idx ON notifications (appointment_id);
CREATE UNIQUE INDEX notifications_provider_msg_uq ON notifications (provider, provider_message_id) WHERE provider_message_id IS NOT NULL;
CREATE TRIGGER notifications_updated_at BEFORE UPDATE ON notifications FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- -----------------------------------------------------------------------------
-- Audit log (append-only)
-- -----------------------------------------------------------------------------
CREATE TABLE audit_logs (
  id              BIGSERIAL PRIMARY KEY,
  occurred_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id         UUID REFERENCES users(id) ON DELETE SET NULL,
  user_email      TEXT,
  user_role       TEXT,
  action          TEXT NOT NULL,
  entity_type     TEXT,
  entity_id       TEXT,
  patient_id      UUID REFERENCES patients(id) ON DELETE SET NULL,
  description     TEXT,
  previous_value  JSONB,
  new_value       JSONB,
  ip_address      TEXT,
  user_agent      TEXT
);
CREATE INDEX audit_logs_occurred_idx ON audit_logs (occurred_at DESC);
CREATE INDEX audit_logs_patient_idx ON audit_logs (patient_id);
CREATE INDEX audit_logs_action_idx ON audit_logs (action);

CREATE OR REPLACE FUNCTION audit_logs_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER audit_logs_no_update BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_immutable();

-- -----------------------------------------------------------------------------
-- Settings (key/value, JSON typed)
-- -----------------------------------------------------------------------------
CREATE TABLE settings (
  key          TEXT PRIMARY KEY,
  value        JSONB NOT NULL,
  category     TEXT NOT NULL DEFAULT 'general',
  description  TEXT,
  updated_by   UUID,                       -- no FK: settings must survive user data resets
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
