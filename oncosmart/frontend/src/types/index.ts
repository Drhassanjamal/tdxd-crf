export type Role = 'ADMIN' | 'PHYSICIAN' | 'NURSE' | 'RECEPTION';

export interface User {
  id: string;
  email: string;
  fullName: string;
  fullNameAr: string | null;
  role: Role;
  title: string | null;
  permissions: string[];
}

export interface Settings {
  hospital_name: string;
  unit_name: string;
  unit_phone: string;
  timezone: string;
  default_language: 'en' | 'ar';
  languages_enabled: string[];
  units: { height: string; weight: string; creatinine: string; temperature: string };
  unit_open_time: string;
  unit_close_time: string;
  default_appointment_duration_min: number;
  arrival_minutes_before: number;
  delay_grace_minutes: number;
  chair_cleaning_after_treatment: boolean;
  reminder_24h_enabled: boolean;
  reminder_2h_enabled: boolean;
  reminder_same_day_enabled: boolean;
  reminder_same_day_time: string;
  whatsapp_template_en: string;
  whatsapp_template_ar: string;
  default_rounding_rule: string;
  dose_difference_threshold_pct: number;
  weight_change_threshold_pct: number;
  lab_validity_days: number;
  calvert_gfr_review_threshold: number;
  pretreatment_checklist: { id: string; en: string; ar: string }[];
}

export interface ClinicalWarning {
  code: string;
  severity: 'CRITICAL' | 'WARNING' | 'INFO';
  message: string;
  params?: Record<string, string | number>;
  drug?: string;
}

export interface Appointment {
  id: string;
  appointment_number: string;
  patient_id: string;
  treatment_plan_id: string | null;
  treatment_order_id: string | null;
  protocol_id: string | null;
  cycle_number: number | null;
  day_number: number | null;
  appointment_type: string;
  appointment_date: string;
  start_time: string;
  duration_minutes: number;
  chair_id: string | null;
  physician_id: string | null;
  status: string;
  notes: string | null;
  patient_code: string;
  mrn: string;
  first_name: string;
  last_name: string;
  full_name_ar: string | null;
  phone: string | null;
  protocol_name: string | null;
  protocol_is_demo: boolean | null;
  chair_name: string | null;
  physician_name: string | null;
  order_status: string | null;
  order_number: string | null;
  whatsapp_status: string | null;
  patient_response: string | null;
  cancel_reason: string | null;
  arrived_at: string | null;
}
