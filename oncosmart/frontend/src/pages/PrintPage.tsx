import clsx from 'clsx';
import { Printer } from 'lucide-react';
import { ReactNode, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { LanguageSwitcher } from '../components/Layout';
import { Button, ErrorBox, PageLoader } from '../components/ui';
import { warningText } from '../components/WarningList';
import { useSettings } from '../hooks/useSettings';
import { useI18n } from '../i18n/I18nProvider';
import { api } from '../services/api';
import { doseLabel, fmtDate, fmtDateTime, fmtDuration, fmtNum, fmtTime, hhmm, patientName, setUnitTimezone, fmtBsa } from '../utils/format';

const cell = 'border border-slate-400 px-1.5 py-1 text-start align-top';
const head = 'border border-slate-400 bg-slate-100 px-1.5 py-1 text-start text-[10px] font-semibold uppercase';

function Sheet({ title, children, subtitle }: { title: string; subtitle?: ReactNode; children: ReactNode }) {
  const { t } = useI18n();
  const settings = useSettings();
  const s = settings.data?.settings;
  useEffect(() => {
    if (s?.timezone) setUnitTimezone(s.timezone);
  }, [s?.timezone]);
  return (
    <div className="min-h-screen bg-slate-200 py-6 print:bg-white print:py-0">
      <div className="no-print mx-auto mb-3 flex max-w-[210mm] items-center justify-between px-2">
        <LanguageSwitcher />
        <Button variant="primary" icon={<Printer className="h-4 w-4" />} onClick={() => window.print()}>
          {t('common.print')}
        </Button>
      </div>
      <div className="print-sheet mx-auto max-w-[210mm] bg-white p-[12mm] text-[12px] leading-snug text-slate-900 shadow-lg">
        <header className="flex items-start justify-between gap-4 border-b-2 border-slate-800 pb-2">
          <div>
            <div className="text-base font-bold">{s?.hospital_name}</div>
            <div className="text-sm font-semibold text-brand-800">{s?.unit_name}</div>
            <div className="text-[10px] text-slate-500">{s?.unit_phone}</div>
          </div>
          <div className="text-end">
            <div className="text-base font-bold uppercase">{title}</div>
            {subtitle && <div className="text-[11px] text-slate-600">{subtitle}</div>}
            <div className="text-[10px] text-slate-500">OncoSmart · {t('print.generated')} {new Date().toLocaleString('en-GB')}</div>
          </div>
        </header>
        <div className="my-2 rounded border-2 border-amber-500 bg-amber-50 px-2 py-1 text-center text-[11px] font-bold text-amber-900">{t('app.demoBanner')}</div>
        {children}
      </div>
    </div>
  );
}

function PatientBlock({ p, extra }: { p: any; extra?: ReactNode }) {
  const { t, lang } = useI18n();
  return (
    <table className="my-2 w-full border-collapse">
      <tbody>
        <tr>
          <th className={head}>{t('patients.name')}</th>
          <td className={cell} colSpan={3}>
            <b>{patientName(p, 'en')}</b> {p.full_name_ar && <span dir="rtl"> — {p.full_name_ar}</span>}
          </td>
          <th className={head}>{t('patients.mrn')}</th>
          <td className={clsx(cell, 'font-bold ltr-nums')}>{p.mrn}</td>
        </tr>
        <tr>
          <th className={head}>{t('patients.dob')}</th>
          <td className={cell}>{fmtDate(p.date_of_birth, lang)} ({p.age})</td>
          <th className={head}>{t('patients.sex')}</th>
          <td className={cell}>{t(`patients.${p.sex}`)}</td>
          <th className={head}>{t('patients.patientId')}</th>
          <td className={clsx(cell, 'ltr-nums')}>{p.patient_code}</td>
        </tr>
        <tr>
          <th className={head}>{t('patients.allergies')}</th>
          <td className={clsx(cell, 'font-semibold', p.allergies?.length && 'text-rose-700')} colSpan={5}>
            {p.allergies?.length ? p.allergies.map((a: any) => `${a.allergen}${a.reaction ? ` (${a.reaction})` : ''}`).join('; ') : p.no_known_allergies ? t('patients.noKnownAllergies') : t('patients.allergyNotDocumented')}
          </td>
        </tr>
        {extra}
      </tbody>
    </table>
  );
}

function Signatures({ rows }: { rows: { label: string; name?: string | null; at?: string | null }[] }) {
  const { t, lang } = useI18n();
  return (
    <table className="mt-3 w-full border-collapse print-avoid-break">
      <thead>
        <tr>
          <th className={head} />
          <th className={head}>{t('print.name')}</th>
          <th className={head}>{t('print.dateTime')}</th>
          <th className={clsx(head, 'w-1/3')}>{t('print.signature')}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.label}>
            <th className={clsx(head, 'normal-case')}>{r.label}</th>
            <td className={clsx(cell, 'h-9')}>{r.name ?? ''}</td>
            <td className={clsx(cell, 'ltr-nums')}>{r.at ? fmtDateTime(r.at, lang) : ''}</td>
            <td className={cell} />
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function OrderPrint({ id, administration }: { id: string; administration?: boolean }) {
  const { t, lang } = useI18n();
  const q = useQuery({ queryKey: ['order', id], queryFn: () => api.get(`/orders/${id}`) });
  if (q.isLoading) return <PageLoader />;
  if (q.error) return <ErrorBox error={q.error} />;
  const d = q.data;
  const o = d.order;
  const adminById = Object.fromEntries(d.administrations.map((a: any) => [a.treatment_order_item_id, a]));
  return (
    <Sheet title={administration ? t('print.administrationRecord') : t('print.treatmentOrder')} subtitle={<span className="ltr-nums">{o.order_number} · {t(`status.order.${o.status}`)}</span>}>
      <PatientBlock
        p={d.patient}
        extra={
          <>
            <tr>
              <th className={head}>{t('patients.diagnosis')}</th>
              <td className={cell} colSpan={5}>{d.diagnosis ? `${d.diagnosis.primary_cancer}${d.diagnosis.icd10_code ? ` (${d.diagnosis.icd10_code})` : ''}${d.diagnosis.stage ? ` — ${d.diagnosis.stage}` : ''}` : '—'}</td>
            </tr>
            <tr>
              <th className={head}>{t('common.protocol')}</th>
              <td className={cell} colSpan={3}>
                <b>{o.protocol_name}</b> {d.protocol?.is_demo && <b className="text-amber-700">[{t('app.demoProtocol')}]</b>}
              </td>
              <th className={head}>{t('chart.intent')}</th>
              <td className={cell}>{o.intent ? t(`intent.${o.intent}`) : '—'}</td>
            </tr>
            <tr>
              <th className={head}>{t('common.cycle')} / {t('common.day')}</th>
              <td className={clsx(cell, 'font-bold ltr-nums')}>C{o.cycle_number} / D{o.day_number}</td>
              <th className={head}>{t('orders.plannedDate')}</th>
              <td className={cell}>{fmtDate(o.planned_date, lang)}</td>
              <th className={head}>{t('common.chair')}</th>
              <td className={cell}>{d.appointment?.chair_name ?? '—'}</td>
            </tr>
            <tr>
              <th className={head}>{t('orders.height')}</th>
              <td className={clsx(cell, 'ltr-nums')}>{fmtNum(o.height_cm)}</td>
              <th className={head}>{t('orders.weight')}</th>
              <td className={clsx(cell, 'ltr-nums')}>{fmtNum(o.weight_kg)}</td>
              <th className={head}>{t('orders.bsa')} (Mosteller)</th>
              <td className={clsx(cell, 'font-bold ltr-nums')}>{fmtBsa(o.bsa_m2)} m²</td>
            </tr>
            {o.gfr_ml_min && (
              <tr>
                <th className={head}>GFR</th>
                <td className={clsx(cell, 'ltr-nums')}>{fmtNum(o.gfr_ml_min)} mL/min</td>
                <th className={head}>{t('orders.gfrSource')}</th>
                <td className={cell} colSpan={3}>{o.gfr_source}</td>
              </tr>
            )}
          </>
        }
      />
      <div className="mt-2 text-[11px] font-bold text-amber-800">{t('app.calcDisclaimer')}</div>
      <table className="mt-1 w-full border-collapse">
        <thead>
          <tr>
            <th className={head}>#</th>
            <th className={head}>{t('chart.drug')}</th>
            <th className={head}>{t('orders.perUnit')}</th>
            <th className={head}>{t('chart.dose')}</th>
            <th className={head}>{t('chart.route')}</th>
            <th className={head}>{t('chart.diluent')}</th>
            <th className={head}>{t('orders.volume')}</th>
            <th className={head}>{t('chart.infusionTime')}</th>
            {administration && (
              <>
                <th className={head}>{t('common.start')}</th>
                <th className={head}>{t('common.end')}</th>
                <th className={head}>{t('orders.doseAdministered')}</th>
                <th className={head}>{t('common.nurse')}</th>
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {d.items.map((i: any) => {
            const a = adminById[i.id];
            return (
              <tr key={i.id}>
                <td className={clsx(cell, 'ltr-nums')}>{i.sequence}</td>
                <td className={cell}>
                  <b>{i.drug_name}</b>
                  <div className="text-[10px] text-slate-600">{i.calculation_formula}</div>
                  {i.dose_modification_reason && <div className="text-[10px] text-amber-800">{i.dose_modification_reason}</div>}
                </td>
                <td className={clsx(cell, 'ltr-nums whitespace-nowrap')}>
                  {doseLabel(Number(i.dose_value), i.dose_unit)}
                  {Number(i.dose_percent) !== 100 && ` × ${fmtNum(i.dose_percent)}%`}
                </td>
                <td className={clsx(cell, 'text-[13px] font-bold ltr-nums whitespace-nowrap')}>{fmtNum(i.final_dose)} mg</td>
                <td className={cell}>{i.route}</td>
                <td className={cell}>{i.diluent ?? <i className="text-[10px]">{t('app.notConfigured')}</i>}</td>
                <td className={clsx(cell, 'ltr-nums')}>{i.final_volume_ml ? `${fmtNum(i.final_volume_ml)} mL` : i.administration_method === 'BOLUS' ? '—' : <i className="text-[10px]">{t('app.notConfigured')}</i>}</td>
                <td className={cell}>{i.infusion_duration_min ? fmtDuration(i.infusion_duration_min, lang) : i.administration_method === 'BOLUS' ? 'Bolus' : <i className="text-[10px]">{t('app.notConfigured')}</i>}</td>
                {administration && (
                  <>
                    <td className={clsx(cell, 'ltr-nums')}>{a?.start_time ? fmtTime(a.start_time) : ''}</td>
                    <td className={clsx(cell, 'ltr-nums')}>{a?.end_time ? fmtTime(a.end_time) : ''}</td>
                    <td className={clsx(cell, 'ltr-nums')}>{a?.dose_administered ? `${fmtNum(a.dose_administered)} mg` : a?.status === 'NOT_GIVEN' ? t('status.admin.NOT_GIVEN') : ''}</td>
                    <td className={cell}>{a?.completed_by_name ?? a?.started_by_name ?? ''}</td>
                  </>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="mt-2 grid grid-cols-2 gap-2">
        {(
          [
            ['orders.premedications', o.premedications],
            ['orders.hydration', o.hydration],
            ['orders.supportive', o.supportive_medications],
            ['orders.specialInstructions', o.special_instructions],
          ] as const
        ).map(([k, v]) => (
          <div key={k} className="rounded border border-slate-400 p-1.5 print-avoid-break">
            <div className="text-[10px] font-semibold uppercase text-slate-600">{t(k)}</div>
            <div className="whitespace-pre-wrap">{v || <i className="text-[10px]">{t('app.notConfigured')}</i>}</div>
          </div>
        ))}
      </div>
      <div className="mt-2 rounded border border-slate-400 p-1.5 print-avoid-break">
        <div className="text-[10px] font-semibold uppercase text-slate-600">{t('orders.warnings')}</div>
        <ul className="list-disc ps-4">
          {(o.warnings?.length ? o.warnings : d.warnings).filter((w: any) => w.severity !== 'INFO' || w.code === 'CALVERT_VERIFY').map((w: any, i: number) => (
            <li key={i}>
              <b>[{t(`warnings.severity.${w.severity}`)}]</b> {warningText(w, t, lang)}
            </li>
          ))}
        </ul>
        {o.warnings_acknowledged_by_name && (
          <div className="mt-1 text-[10px]">
            {t('orders.warningsAcknowledged')}: {o.warnings_acknowledged_by_name} · {fmtDateTime(o.warnings_acknowledged_at, lang)}
          </div>
        )}
      </div>
      {administration && d.vitals.length > 0 && (
        <table className="mt-2 w-full border-collapse print-avoid-break">
          <thead>
            <tr>
              {['vitals.measuredAt', 'vitals.phase', 'vitals.bp', 'vitals.hr', 'vitals.rr', 'vitals.temp', 'vitals.spo2', 'vitals.weight', 'vitals.pain'].map((k) => <th key={k} className={head}>{t(k)}</th>)}
            </tr>
          </thead>
          <tbody>
            {d.vitals.map((v: any) => (
              <tr key={v.id}>
                <td className={clsx(cell, 'ltr-nums')}>{fmtDateTime(v.measured_at, lang)}</td>
                <td className={cell}>{t(`vitals.${v.phase}`)}</td>
                <td className={clsx(cell, 'ltr-nums')}>{v.bp_systolic ? `${v.bp_systolic}/${v.bp_diastolic}` : ''}</td>
                <td className={clsx(cell, 'ltr-nums')}>{v.heart_rate ?? ''}</td>
                <td className={clsx(cell, 'ltr-nums')}>{v.resp_rate ?? ''}</td>
                <td className={clsx(cell, 'ltr-nums')}>{v.temperature_c ?? ''}</td>
                <td className={clsx(cell, 'ltr-nums')}>{v.spo2 ?? ''}</td>
                <td className={clsx(cell, 'ltr-nums')}>{v.weight_kg ?? ''}</td>
                <td className={clsx(cell, 'ltr-nums')}>{v.pain_score ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {administration && (d.events.length > 0 || o.completed_at) && (
        <div className="mt-2 rounded border border-slate-400 p-1.5 text-[11px] print-avoid-break">
          {d.events.map((e: any) => (
            <div key={e.id}>
              <b>{t(`events.${e.event_type}`)} ({t(`events.${e.severity}`)})</b> {fmtDateTime(e.occurred_at, lang)} — {e.description} {e.action_taken && `→ ${e.action_taken}`}
            </div>
          ))}
          {o.completed_at && (
            <div>
              {t('orders.completionTime')}: <b className="ltr-nums">{fmtDateTime(o.completed_at, lang)}</b> · {t('orders.treatmentDuration')}: {fmtDuration(o.treatment_duration_min, lang)} · {t('orders.disposition')}: {o.disposition && t(`disposition.${o.disposition}`)} · {t('orders.adverseEvent')}: {o.adverse_event ? o.adverse_event_details : t('common.no')}
            </div>
          )}
        </div>
      )}
      {!administration && (
        <table className="mt-2 w-full border-collapse print-avoid-break">
          <thead>
            <tr>
              <th className={head}>{t('print.administrationTimes')}</th>
              <th className={head}>{t('common.start')}</th>
              <th className={head}>{t('common.end')}</th>
              <th className={head}>{t('common.nurse')}</th>
            </tr>
          </thead>
          <tbody>
            {d.items.map((i: any) => {
              const a = adminById[i.id];
              return (
                <tr key={i.id}>
                  <td className={cell}>{i.drug_name}</td>
                  <td className={clsx(cell, 'h-7 ltr-nums')}>{a?.start_time ? fmtTime(a.start_time) : ''}</td>
                  <td className={clsx(cell, 'ltr-nums')}>{a?.end_time ? fmtTime(a.end_time) : ''}</td>
                  <td className={cell}>{a?.completed_by_name ?? ''}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <Signatures
        rows={[
          { label: t('orders.prescriber'), name: o.prescribed_by_name, at: o.prescribed_at },
          { label: t('orders.physicianApproval'), name: o.approved_by_name, at: o.approved_at },
          { label: t('orders.nurseVerification'), name: o.nurse_verified_by_name, at: o.nurse_verified_at },
          { label: t('print.doubleCheck'), name: o.prepared_by_name, at: o.prepared_at },
          ...(administration ? [{ label: t('orders.completedBy'), name: o.completed_by_name, at: o.completed_at }] : []),
        ]}
      />
      <p className="mt-2 text-[10px] text-slate-500">{t('app.clinicalJudgement')}</p>
    </Sheet>
  );
}

function AppointmentPrint({ id }: { id: string }) {
  const { t, lang } = useI18n();
  const settings = useSettings();
  const q = useQuery({ queryKey: ['appointment', id], queryFn: () => api.get(`/appointments/${id}`) });
  if (q.isLoading) return <PageLoader />;
  if (q.error) return <ErrorBox error={q.error} />;
  const a = q.data;
  return (
    <Sheet title={t('print.appointmentSlip')} subtitle={<span className="ltr-nums">{a.appointment_number}</span>}>
      <div className="mx-auto mt-4 max-w-[140mm] rounded-lg border-2 border-slate-700 p-4 text-sm">
        <div className="text-lg font-bold">{patientName(a, lang)}</div>
        <div className="ltr-nums text-slate-600">{t('patients.mrn')}: {a.mrn}</div>
        <div className="my-3 grid grid-cols-2 gap-3">
          <div>
            <div className="text-[10px] font-semibold uppercase text-slate-500">{t('common.date')}</div>
            <div className="text-base font-bold">{fmtDate(a.appointment_date, lang, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</div>
          </div>
          <div>
            <div className="text-[10px] font-semibold uppercase text-slate-500">{t('common.time')}</div>
            <div className="ltr-nums text-base font-bold">{hhmm(a.start_time)}</div>
          </div>
          <div>
            <div className="text-[10px] font-semibold uppercase text-slate-500">{t('appointments.type')}</div>
            <div>{t(`appointments.types.${a.appointment_type}`)} {a.cycle_number && <span className="ltr-nums">· C{a.cycle_number}D{a.day_number}</span>}</div>
          </div>
          <div>
            <div className="text-[10px] font-semibold uppercase text-slate-500">{t('common.chair')}</div>
            <div>{a.chair_name ?? '—'}</div>
          </div>
        </div>
        <p className="font-medium">{t('print.arrive', { minutes: settings.data?.settings.arrival_minutes_before })}</p>
        <p className="text-slate-600">{t('print.contact')} {settings.data?.settings.unit_phone}</p>
      </div>
    </Sheet>
  );
}

function SummaryPrint({ id }: { id: string }) {
  const { t, lang } = useI18n();
  const p = useQuery({ queryKey: ['patient', id], queryFn: () => api.get(`/patients/${id}`) });
  const history = useQuery({ queryKey: ['patient-tab', id, 'history'], queryFn: () => api.get<any[]>(`/patients/${id}/history`) });
  const labs = useQuery({ queryKey: ['patient-tab', id, 'labs'], queryFn: () => api.get(`/patients/${id}/labs`) });
  if (p.isLoading || history.isLoading || labs.isLoading) return <PageLoader />;
  if (p.error) return <ErrorBox error={p.error} />;
  const pt = p.data;
  const latest: Record<string, any> = {};
  for (const r of labs.data?.results ?? []) if (!latest[r.test_code]) latest[r.test_code] = r;
  const byCycle = new Map<string, any[]>();
  for (const h of history.data ?? []) {
    const k = `${h.protocol_name}|${h.cycle_number}|${h.day_number}`;
    byCycle.set(k, [...(byCycle.get(k) ?? []), h]);
  }
  return (
    <Sheet title={t('print.summary')}>
      <PatientBlock p={pt} />
      {pt.diagnoses.map((d: any) => (
        <div key={d.id} className="mb-1">
          <b>{t('chart.diagnosis')}:</b> {d.primary_cancer} {d.icd10_code && `(${d.icd10_code})`} · {d.stage} · {d.histology} · {d.biomarkers} · {fmtDate(d.diagnosis_date, lang)}
        </div>
      ))}
      {pt.plans.map((pl: any) => (
        <div key={pl.id} className="mb-1">
          <b>{t('chart.plan')}:</b> {pl.protocol_name} {pl.protocol_is_demo && `[${t('app.demoProtocol')}]`} · {t(`intent.${pl.intent}`)} · q{pl.cycle_length_days}d · {pl.cycles_completed}/{pl.planned_cycles} {t('chart.cycles')} · {t(`status.plan.${pl.status}`)} · {fmtDate(pl.start_date, lang)} → {fmtDate(pl.planned_end_date, lang)}
        </div>
      ))}
      <table className="mt-2 w-full border-collapse">
        <thead>
          <tr>
            {['common.date', 'common.protocol', 'common.cycle', 'chart.drug', 'chart.dose', 'common.status'].map((k) => <th key={k} className={head}>{t(k)}</th>)}
          </tr>
        </thead>
        <tbody>
          {[...byCycle.values()].map((rows) =>
            rows.map((h, i) => (
              <tr key={h.id}>
                {i === 0 && <td className={cell} rowSpan={rows.length}>{fmtDate(h.date ?? h.planned_date, lang)}</td>}
                {i === 0 && <td className={cell} rowSpan={rows.length}>{h.protocol_name}</td>}
                {i === 0 && <td className={clsx(cell, 'ltr-nums')} rowSpan={rows.length}>C{h.cycle_number}D{h.day_number}</td>}
                <td className={cell}>{h.drug_name}{h.reaction && ' ⚠'}</td>
                <td className={clsx(cell, 'ltr-nums')}>{fmtNum(h.dose_administered ?? h.planned_dose)} mg{Number(h.dose_percent) !== 100 ? ` (${fmtNum(h.dose_percent)}%)` : ''}</td>
                <td className={cell}>{t(`status.admin.${h.status}`)}</td>
              </tr>
            )),
          )}
        </tbody>
      </table>
      <div className="mt-2">
        <b>{t('chart.labs')} ({t('common.date')}):</b>{' '}
        {Object.values(latest).map((r: any) => (
          <span key={r.test_code} className="me-2 inline-block ltr-nums">
            {r.test_code} {fmtNum(r.value)} {r.unit}
          </span>
        ))}
      </div>
      <Signatures rows={[{ label: t('common.physician'), name: pt.oncologist_name }]} />
    </Sheet>
  );
}

export function PrintPage() {
  const { kind, id } = useParams();
  if (!id) return null;
  if (kind === 'order') return <OrderPrint id={id} />;
  if (kind === 'administration') return <OrderPrint id={id} administration />;
  if (kind === 'appointment') return <AppointmentPrint id={id} />;
  if (kind === 'summary') return <SummaryPrint id={id} />;
  return <ErrorBox error="Unknown document" />;
}
