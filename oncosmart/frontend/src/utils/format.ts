import type { Lang } from '../i18n/I18nProvider';

let unitTz = 'Asia/Baghdad';
export const setUnitTimezone = (tz: string) => {
  unitTz = tz || unitTz;
};
export const getUnitTimezone = () => unitTz;

const locale = (lang: Lang) => (lang === 'ar' ? 'ar-IQ-u-nu-latn' : 'en-GB');

export function patientName(p: { first_name?: string; last_name?: string; full_name_ar?: string | null } | null | undefined, lang: Lang) {
  if (!p) return '';
  if (lang === 'ar' && p.full_name_ar) return p.full_name_ar;
  return `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim();
}

/** Formats 'YYYY-MM-DD' (calendar date) without time-zone shifting. */
export function fmtDate(d: string | null | undefined, lang: Lang, opts: Intl.DateTimeFormatOptions = { day: '2-digit', month: 'short', year: 'numeric' }) {
  if (!d) return '—';
  const s = d.length === 10 ? `${d}T12:00:00Z` : d;
  const dt = new Date(s);
  if (Number.isNaN(dt.getTime())) return d;
  return new Intl.DateTimeFormat(locale(lang), { ...opts, timeZone: d.length === 10 ? 'UTC' : unitTz }).format(dt);
}

export function fmtDateTime(iso: string | null | undefined, lang: Lang) {
  if (!iso) return '—';
  return new Intl.DateTimeFormat(locale(lang), { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: unitTz }).format(new Date(iso));
}

export function fmtTime(iso: string | null | undefined) {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: unitTz }).format(new Date(iso));
}

export const hhmm = (t: string | null | undefined) => (t ? t.slice(0, 5) : '—');

export function fmtDuration(mins: number | null | undefined, lang: Lang) {
  if (mins === null || mins === undefined || Number.isNaN(mins)) return '—';
  const m = Math.max(0, Math.round(mins));
  const h = Math.floor(m / 60);
  const r = m % 60;
  const hu = lang === 'ar' ? 'س' : 'h';
  const mu = lang === 'ar' ? 'د' : 'min';
  if (!h) return `${r} ${mu}`;
  return r ? `${h} ${hu} ${String(r).padStart(2, '0')} ${mu}` : `${h} ${hu}`;
}

export function fmtClock(totalSeconds: number) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h ? `${h}:` : ''}${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

export const fmtNum = (n: number | string | null | undefined, dp = 2) => {
  if (n === null || n === undefined || n === '') return '—';
  const v = Number(n);
  return Number.isInteger(v) ? String(v) : String(Number(v.toFixed(dp)));
};

/** BSA always shown with 2 decimals (e.g. 1.70 m²), the precision used in calculations. */
export const fmtBsa = (n: number | string | null | undefined) => (n === null || n === undefined || n === '' ? '—' : Number(n).toFixed(2));

export const DOSE_UNIT: Record<string, string> = { MG: 'mg', MG_M2: 'mg/m²', MG_KG: 'mg/kg', AUC: 'AUC' };
export const doseLabel = (value: number, unit: string) => (unit === 'AUC' ? `AUC ${fmtNum(value)}` : `${fmtNum(value)} ${DOSE_UNIT[unit] ?? unit}`);

export function todayLocal() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: unitTz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

export function addDays(date: string, days: number) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export function ageFrom(dob: string) {
  const [y, m, d] = dob.split('-').map(Number);
  const [ty, tm, td] = todayLocal().split('-').map(Number);
  let a = ty - y;
  if (tm < m || (tm === m && td < d)) a--;
  return a;
}

export const timeToMinutes = (t: string) => {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
};
export const minutesToTime = (mins: number) => `${String(Math.floor(mins / 60) % 24).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;

export function downloadUrl(url: string) {
  const a = document.createElement('a');
  a.href = url;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}
