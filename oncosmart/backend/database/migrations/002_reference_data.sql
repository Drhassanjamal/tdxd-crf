-- =============================================================================
-- Migration 002: reference data required by every installation
-- (roles, laboratory test catalogue, default settings). Idempotent.
-- =============================================================================

INSERT INTO roles (code, name, description) VALUES
  ('ADMIN',     'Administrator', 'Manages users, protocols, chairs, settings; views reports and audit logs'),
  ('PHYSICIAN', 'Physician',     'Creates treatment plans and orders; approves treatment orders'),
  ('NURSE',     'Nurse',         'Pre-treatment verification, administration, nursing documentation'),
  ('RECEPTION', 'Reception',     'Registers patients, books/reschedules/cancels appointments, sends reminders')
ON CONFLICT (code) DO NOTHING;

-- Default reference ranges are GENERIC PLACEHOLDERS. Each laboratory must
-- configure its own reference ranges and units before clinical use.
INSERT INTO lab_test_definitions (code, name, panel, unit, ref_low, ref_high, sort_order) VALUES
  ('HB',    'Hemoglobin',               'CBC',   'g/dL',             12.0,  16.0, 10),
  ('WBC',   'White blood cells',        'CBC',   '×10⁹/L',            4.0,  11.0, 20),
  ('ANC',   'Absolute neutrophil count','CBC',   '×10⁹/L',            2.0,   7.5, 30),
  ('PLT',   'Platelets',                'CBC',   '×10⁹/L',          150.0, 400.0, 40),
  ('CREAT', 'Creatinine',               'RENAL', 'mg/dL',             0.6,   1.2, 50),
  ('EGFR',  'eGFR',                     'RENAL', 'mL/min/1.73m²',    60.0,  NULL, 60),
  ('AST',   'AST',                      'LIVER', 'U/L',               NULL,  40.0, 70),
  ('ALT',   'ALT',                      'LIVER', 'U/L',               NULL,  41.0, 80),
  ('ALP',   'Alkaline phosphatase',     'LIVER', 'U/L',              40.0, 129.0, 90),
  ('BILI',  'Total bilirubin',          'LIVER', 'mg/dL',             0.1,   1.2, 100),
  ('ALB',   'Albumin',                  'OTHER', 'g/dL',              3.5,   5.2, 110),
  ('NA',    'Sodium',                   'OTHER', 'mmol/L',          135.0, 145.0, 120),
  ('K',     'Potassium',                'OTHER', 'mmol/L',            3.5,   5.1, 130),
  ('MG',    'Magnesium',                'OTHER', 'mg/dL',             1.7,   2.4, 140),
  ('TSH',   'TSH',                      'OTHER', 'mIU/L',             0.4,   4.0, 150)
ON CONFLICT (code) DO NOTHING;

INSERT INTO settings (key, value, category, description) VALUES
  ('hospital_name',                   '"Demo Private Hospital"', 'general', 'Hospital name shown on documents and messages'),
  ('unit_name',                       '"Chemotherapy Unit"', 'general', 'Unit name'),
  ('unit_phone',                      '"+964 770 000 0000"', 'general', 'Unit contact phone (used in patient messages)'),
  ('timezone',                        '"Asia/Baghdad"', 'general', 'IANA time zone of the unit'),
  ('default_language',                '"en"', 'general', 'Default UI language'),
  ('languages_enabled',               '["en","ar"]', 'general', 'Enabled UI languages'),
  ('units',                           '{"height":"cm","weight":"kg","creatinine":"mg/dL","temperature":"°C"}', 'general', 'Measurement units'),
  ('unit_open_time',                  '"08:00"', 'scheduling', 'Unit opening time (chair utilization)'),
  ('unit_close_time',                 '"16:00"', 'scheduling', 'Unit closing time (chair utilization)'),
  ('default_appointment_duration_min','120', 'scheduling', 'Default appointment duration (minutes)'),
  ('arrival_minutes_before',          '30', 'scheduling', 'Minutes before appointment the patient should arrive'),
  ('delay_grace_minutes',             '30', 'scheduling', 'Minutes after scheduled start before a treatment is flagged as delayed'),
  ('chair_cleaning_after_treatment',  'false', 'scheduling', 'If true, chair goes to CLEANING (not AVAILABLE) after completion'),
  ('reminder_24h_enabled',            'true', 'reminders', '24-hour reminder'),
  ('reminder_2h_enabled',             'true', 'reminders', '2-hour reminder'),
  ('reminder_same_day_enabled',       'false', 'reminders', 'Optional same-day morning reminder'),
  ('reminder_same_day_time',          '"07:00"', 'reminders', 'Time of the same-day reminder'),
  ('whatsapp_template_en',            to_jsonb('Dear {patientName},' || chr(10) || chr(10) ||
                                        'This is a reminder that your chemotherapy appointment is scheduled for {date} at {time}.' || chr(10) || chr(10) ||
                                        'Please arrive {arrivalMinutes} minutes before your appointment.' || chr(10) || chr(10) ||
                                        'Hospital: {hospitalName}' || chr(10) || chr(10) ||
                                        'Please contact the chemotherapy unit if you need to reschedule.'::text), 'reminders', 'WhatsApp message template (English)'),
  ('whatsapp_template_ar',            to_jsonb('عزيزي/عزيزتي {patientName}،' || chr(10) || chr(10) ||
                                        'نود تذكيركم بأن موعد العلاج الكيميائي الخاص بكم محدد بتاريخ {date} الساعة {time}.' || chr(10) || chr(10) ||
                                        'يرجى الحضور قبل الموعد بـ {arrivalMinutes} دقيقة.' || chr(10) || chr(10) ||
                                        'المستشفى: {hospitalName}' || chr(10) || chr(10) ||
                                        'يرجى التواصل مع وحدة العلاج الكيميائي إذا كنتم بحاجة إلى تغيير الموعد.'::text), 'reminders', 'WhatsApp message template (Arabic)'),
  ('default_rounding_rule',           '"NEAREST_1"', 'dosing', 'Default dose rounding rule for new protocols'),
  ('dose_difference_threshold_pct',   '10', 'dosing', 'Warn when a dose differs from the previous cycle by more than this % (alert threshold only)'),
  ('weight_change_threshold_pct',     '5', 'dosing', 'Warn when weight changes by more than this % since previous treatment (alert threshold only)'),
  ('lab_validity_days',               '7', 'dosing', 'Laboratory results older than this many days are treated as missing for the order'),
  ('calvert_gfr_review_threshold',    '125', 'dosing', 'Flag Calvert (AUC) calculations when GFR input exceeds this value (mL/min) for physician review'),
  ('pretreatment_checklist',          '[
      {"id":"identity","en":"Patient identity confirmed with two identifiers (name + MRN / date of birth)","ar":"تم التحقق من هوية المريض بمعرّفين (الاسم + رقم السجل / تاريخ الميلاد)"},
      {"id":"order","en":"Physician-approved order matches protocol, cycle and day","ar":"أمر العلاج المعتمد من الطبيب مطابق للبروتوكول والدورة واليوم"},
      {"id":"allergies","en":"Allergies reviewed with the patient","ar":"تمت مراجعة الحساسية مع المريض"},
      {"id":"labs","en":"Laboratory results available and reviewed per order","ar":"نتائج المختبر متوفرة وتمت مراجعتها حسب الأمر"},
      {"id":"vitals","en":"Pre-treatment vital signs recorded","ar":"تم تسجيل العلامات الحيوية قبل العلاج"},
      {"id":"weight","en":"Height and weight confirmed for dose calculation","ar":"تم تأكيد الطول والوزن لحساب الجرعة"},
      {"id":"consent","en":"Informed consent on file","ar":"الموافقة المستنيرة موجودة في الملف"},
      {"id":"access","en":"Venous access assessed","ar":"تم تقييم الوصول الوريدي"},
      {"id":"double_check","en":"Drugs checked against order by two staff (drug, dose, route, volume, expiry)","ar":"تم التحقق من الأدوية مقابل الأمر من قبل شخصين (الدواء، الجرعة، الطريق، الحجم، الصلاحية)"}
   ]', 'nursing', 'Pre-treatment verification checklist (configurable)')
ON CONFLICT (key) DO NOTHING;
