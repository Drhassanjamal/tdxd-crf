import clsx from 'clsx';
import { Bot, CalendarPlus, ClipboardPlus, FlaskConical, HeartPulse, Pencil, Plus, Printer, Sparkles, Stethoscope } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { StatusBadge } from '../../components/StatusBadge';
import { Badge, Button, Card, CardHeader, EmptyState, ErrorBox, InfoRow, Spinner, Table, td, Textarea, th } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { useAuth } from '../../hooks/useAuth';
import { useI18n } from '../../i18n/I18nProvider';
import { api } from '../../services/api';
import { fmtDate, fmtDateTime, fmtDuration, fmtNum, fmtTime, hhmm, todayLocal, fmtBsa } from '../../utils/format';
import { VitalsModal } from '../common/VitalsModal';
import { DiagnosisModal, LabEntryModal, PlanEditModal, PlanModal } from './ChartModals';

function useTab<T = any>(patientId: string, tab: string, url: string, enabled = true) {
  return useQuery<T>({ queryKey: ['patient-tab', patientId, tab], queryFn: () => api.get(url), enabled });
}

function Loading({ q }: { q: { isLoading: boolean; error: unknown } }) {
  if (q.isLoading)
    return (
      <div className="flex justify-center p-8">
        <Spinner />
      </div>
    );
  if (q.error) return <div className="p-3"><ErrorBox error={q.error} /></div>;
  return null;
}

// ---------------------------------------------------------------- Diagnosis
export function DiagnosisTab({ patient }: { patient: any }) {
  const { t, lang } = useI18n();
  const { can } = useAuth();
  const [edit, setEdit] = useState<any>(null);
  const [adding, setAdding] = useState(false);
  return (
    <div className="space-y-3">
      {can('diagnoses.write') && (
        <div className="flex justify-end">
          <Button icon={<Plus className="h-4 w-4" />} onClick={() => setAdding(true)}>
            {t('chart.addDiagnosis')}
          </Button>
        </div>
      )}
      {patient.diagnoses.length === 0 && (
        <Card>
          <EmptyState icon={<Stethoscope className="h-9 w-9" />} title={t('chart.noDiagnosis')} />
        </Card>
      )}
      {patient.diagnoses.map((d: any) => (
        <Card key={d.id}>
          <CardHeader
            title={d.primary_cancer}
            subtitle={d.is_primary ? 'Primary' : undefined}
            actions={can('diagnoses.write') && <Button size="sm" variant="ghost" icon={<Pencil className="h-4 w-4" />} onClick={() => setEdit(d)}>{t('common.edit')}</Button>}
          />
          <dl className="grid gap-4 p-4 sm:grid-cols-3 lg:grid-cols-4">
            <InfoRow label={t('patients.cancerType')} value={d.cancer_type} />
            <InfoRow label={t('chart.icd10')} value={<span className="ltr-nums">{d.icd10_code}</span>} />
            <InfoRow label={t('chart.histology')} value={d.histology} />
            <InfoRow label={t('chart.stage')} value={d.stage} />
            <InfoRow label={t('chart.biomarkers')} value={d.biomarkers} className="sm:col-span-2" />
            <InfoRow label={t('chart.diagnosisDate')} value={fmtDate(d.diagnosis_date, lang)} />
            <InfoRow label={t('patients.oncologist')} value={d.oncologist_name} />
            {d.notes && <InfoRow label={t('common.notes')} value={d.notes} className="sm:col-span-4" />}
          </dl>
        </Card>
      ))}
      <DiagnosisModal open={adding || !!edit} onClose={() => { setAdding(false); setEdit(null); }} patientId={patient.id} diagnosis={edit} />
    </div>
  );
}

// ---------------------------------------------------------------- Plan
export function PlanTab({ patient, onBook }: { patient: any; onBook: (prefill: any) => void }) {
  const { t, lang } = useI18n();
  const { can } = useAuth();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const [editPlan, setEditPlan] = useState<any>(null);
  return (
    <div className="space-y-3">
      {can('plans.write') && !patient.activePlan && (
        <div className="flex justify-end">
          <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>
            {t('chart.createPlan')}
          </Button>
        </div>
      )}
      {patient.plans.length === 0 && (
        <Card>
          <EmptyState title={t('chart.noPlan')} />
        </Card>
      )}
      {patient.plans.map((p: any) => {
        const pct = Math.round((p.cycles_completed / p.planned_cycles) * 100);
        return (
          <Card key={p.id}>
            <CardHeader
              title={
                <span className="flex flex-wrap items-center gap-2">
                  {p.protocol_name} {p.protocol_is_demo && <Badge tone="amber">{t('app.demoProtocol')}</Badge>}
                </span>
              }
              subtitle={p.primary_cancer}
              actions={
                <>
                  <StatusBadge kind="plan" status={p.status} />
                  {can('plans.write') && <Button size="sm" variant="ghost" icon={<Pencil className="h-4 w-4" />} onClick={() => setEditPlan(p)}>{t('chart.modifyPlan')}</Button>}
                  {p.status === 'ACTIVE' && can('orders.prescribe') && p.next_cycle && (
                    <Button size="sm" variant="primary" icon={<ClipboardPlus className="h-4 w-4" />} onClick={() => navigate(`/orders/new?patient=${patient.id}`)}>
                      {t('chart.newOrder')}
                    </Button>
                  )}
                  {p.status === 'ACTIVE' && can('appointments.write') && p.next_cycle && (
                    <Button size="sm" icon={<CalendarPlus className="h-4 w-4" />} onClick={() => onBook({ patientId: patient.id, treatmentPlanId: p.id, cycleNumber: p.next_cycle, dayNumber: p.next_day, appointmentDate: p.next_due_date ?? todayLocal(), durationMinutes: p.estimated_duration_min, physicianId: p.physician_id })}>
                      {t('chart.bookAppointment')}
                    </Button>
                  )}
                </>
              }
            />
            <dl className="grid gap-4 p-4 sm:grid-cols-3 lg:grid-cols-6">
              <InfoRow label={t('chart.intent')} value={t(`intent.${p.intent}`)} />
              <InfoRow label={t('chart.cycleLength')} value={`${p.cycle_length_days} ${t('chart.days')}`} />
              <InfoRow label={t('chart.plannedCycles')} value={p.planned_cycles} />
              <InfoRow label={t('chart.currentCycle')} value={p.current_cycle ? <span className="ltr-nums">C{p.current_cycle}D{p.current_day}</span> : t('patients.notStarted')} />
              <InfoRow label={t('chart.startDate')} value={fmtDate(p.start_date, lang)} />
              <InfoRow label={t('chart.plannedEnd')} value={fmtDate(p.planned_end_date, lang)} />
              <InfoRow label={t('chart.nextSuggested')} value={p.next_cycle ? <span className="ltr-nums">C{p.next_cycle}D{p.next_day} · {fmtDate(p.next_due_date, lang)}</span> : t('orders.allCyclesDone')} className="sm:col-span-2" />
              <InfoRow label={t('common.physician')} value={p.physician_name} />
              <div className="sm:col-span-3">
                <dt className="text-2xs font-medium uppercase tracking-wide text-slate-500">{t('chart.cyclesCompleted')}</dt>
                <dd className="mt-1 flex items-center gap-2">
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-blue-100">
                    <div className="h-full rounded-full bg-blue-600" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-sm font-medium text-slate-700 ltr-nums">
                    {p.cycles_completed}/{p.planned_cycles}
                  </span>
                </dd>
              </div>
              {p.notes && <InfoRow label={t('common.notes')} value={p.notes} className="sm:col-span-6" />}
            </dl>
          </Card>
        );
      })}
      <PlanModal open={creating} onClose={() => setCreating(false)} patientId={patient.id} diagnoses={patient.diagnoses} />
      <PlanEditModal open={!!editPlan} onClose={() => setEditPlan(null)} patientId={patient.id} plan={editPlan} />
    </div>
  );
}

// ---------------------------------------------------------------- Orders
export function OrdersTab({ patientId }: { patientId: string }) {
  const { t, lang } = useI18n();
  const navigate = useNavigate();
  const q = useTab<any[]>(patientId, 'orders', `/patients/${patientId}/orders`);
  return (
    <Card>
      <Loading q={q} />
      {q.data && q.data.length === 0 && <EmptyState title={t('common.noResults')} />}
      {!!q.data?.length && (
        <Table>
          <thead className="bg-slate-50">
            <tr>
              <th className={th}>{t('orders.orderNumber')}</th>
              <th className={th}>{t('orders.plannedDate')}</th>
              <th className={th}>{t('common.protocol')}</th>
              <th className={th}>{t('common.cycle')}</th>
              <th className={th}>{t('orders.bsa')}</th>
              <th className={th}>{t('orders.prescriber')}</th>
              <th className={th}>{t('common.status')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {q.data.map((o) => (
              <tr key={o.id} className="cursor-pointer hover:bg-slate-50" onClick={() => navigate(`/orders/${o.id}`)}>
                <td className={clsx(td, 'ltr-nums font-medium')}>{o.order_number}</td>
                <td className={td}>{fmtDate(o.planned_date, lang)}</td>
                <td className={td}>{o.protocol_name}</td>
                <td className={clsx(td, 'ltr-nums')}>C{o.cycle_number}D{o.day_number}</td>
                <td className={clsx(td, 'ltr-nums')}>{fmtBsa(o.bsa_m2)} m²</td>
                <td className={td}>{o.prescribed_by_name}</td>
                <td className={td}>
                  <StatusBadge kind="order" status={o.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------- History
export function HistoryTab({ patientId }: { patientId: string }) {
  const { t, lang } = useI18n();
  const navigate = useNavigate();
  const q = useTab<any[]>(patientId, 'history', `/patients/${patientId}/history`);
  return (
    <Card>
      <Loading q={q} />
      {q.data && q.data.length === 0 && <EmptyState title={t('chart.noHistory')} />}
      {!!q.data?.length && (
        <Table>
          <thead className="bg-slate-50">
            <tr>
              <th className={th}>{t('common.date')}</th>
              <th className={th}>{t('common.protocol')}</th>
              <th className={th}>{t('common.cycle')}</th>
              <th className={th}>{t('common.day')}</th>
              <th className={th}>{t('chart.drug')}</th>
              <th className={th}>{t('chart.dose')}</th>
              <th className={th}>{t('chart.route')}</th>
              <th className={th}>{t('chart.diluent')}</th>
              <th className={th}>{t('chart.infusionTime')}</th>
              <th className={th}>{t('common.status')}</th>
              <th className={th}>{t('common.physician')}</th>
              <th className={th}>{t('common.nurse')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {q.data.map((h) => (
              <tr key={h.id} className="cursor-pointer hover:bg-slate-50" onClick={() => navigate(`/orders/${h.treatment_order_id}`)}>
                <td className={clsx(td, 'whitespace-nowrap')}>{fmtDate(h.date ?? h.planned_date, lang)}</td>
                <td className={td}>{h.protocol_name}</td>
                <td className={clsx(td, 'ltr-nums')}>{h.cycle_number}</td>
                <td className={clsx(td, 'ltr-nums')}>{h.day_number}</td>
                <td className={clsx(td, 'font-medium text-slate-900')}>
                  {h.drug_name}
                  {h.reaction && <Badge tone="red" className="ms-1">!</Badge>}
                </td>
                <td className={clsx(td, 'ltr-nums whitespace-nowrap')}>
                  {fmtNum(h.dose_administered ?? h.planned_dose)} {h.dose_unit}
                  {Number(h.dose_percent) !== 100 && <span className="ms-1 text-xs text-amber-700">({fmtNum(h.dose_percent)}%)</span>}
                </td>
                <td className={td}>{h.route}</td>
                <td className={td}>{h.diluent ?? '—'}</td>
                <td className={clsx(td, 'whitespace-nowrap')}>
                  {h.start_time ? (
                    <span className="ltr-nums">
                      {fmtTime(h.start_time)}–{h.end_time ? fmtTime(h.end_time) : '…'}
                    </span>
                  ) : (
                    fmtDuration(h.planned_duration_min, lang)
                  )}
                </td>
                <td className={td}>
                  <StatusBadge kind="admin" status={h.status} />
                </td>
                <td className={clsx(td, 'whitespace-nowrap')}>{h.approved_by_name ?? h.physician_name}</td>
                <td className={clsx(td, 'whitespace-nowrap')}>{h.nurse_name ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------- Labs
export function LabsTab({ patientId }: { patientId: string }) {
  const { t, lang } = useI18n();
  const { can } = useAuth();
  const [adding, setAdding] = useState(false);
  const q = useTab<{ definitions: any[]; results: any[] }>(patientId, 'labs', `/patients/${patientId}/labs`);
  const dates = q.data ? [...new Set(q.data.results.map((r) => new Date(r.collected_at).toISOString()))].slice(0, 8) : [];
  const panels: [string, string][] = [
    ['CBC', 'CBC'],
    ['RENAL', lang === 'ar' ? 'وظائف الكلى' : 'Renal'],
    ['LIVER', lang === 'ar' ? 'وظائف الكبد' : 'Liver'],
    ['OTHER', lang === 'ar' ? 'أخرى' : 'Other'],
  ];
  return (
    <Card>
      <CardHeader
        title={t('chart.labs')}
        subtitle={t('chart.labsDemoNote')}
        icon={<FlaskConical className="h-4 w-4" />}
        actions={can('labs.write') && <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setAdding(true)}>{t('chart.addLabs')}</Button>}
      />
      <Loading q={q} />
      {q.data && q.data.results.length === 0 && <EmptyState title={t('chart.noLabs')} />}
      {q.data && q.data.results.length > 0 && (
        <Table>
          <thead className="bg-slate-50">
            <tr>
              <th className={th}>Test</th>
              <th className={th}>{t('chart.refRange')}</th>
              {dates.map((d) => (
                <th key={d} className={clsx(th, 'ltr-nums')}>
                  {fmtDateTime(d, lang)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {panels.map(([panel, label]) => {
              const defs = q.data!.definitions.filter((d) => d.panel === panel && q.data!.results.some((r) => r.test_code === d.code));
              if (!defs.length) return null;
              return [
                <tr key={panel} className="bg-slate-50/60">
                  <td colSpan={2 + dates.length} className="px-3 py-1 text-2xs font-bold uppercase tracking-wide text-slate-500">
                    {label}
                  </td>
                </tr>,
                ...defs.map((d) => (
                  <tr key={d.code}>
                    <td className={clsx(td, 'whitespace-nowrap font-medium')}>
                      {d.name} <span className="text-xs text-slate-400">{d.unit}</span>
                    </td>
                    <td className={clsx(td, 'ltr-nums whitespace-nowrap text-xs text-slate-500')}>
                      {d.ref_low ?? '—'}–{d.ref_high ?? '—'}
                    </td>
                    {dates.map((dt) => {
                      const r = q.data!.results.find((x) => x.test_code === d.code && new Date(x.collected_at).toISOString() === dt);
                      if (!r) return <td key={dt} className={clsx(td, 'text-slate-300')}>·</td>;
                      const low = r.ref_low !== null && r.value < r.ref_low;
                      const high = r.ref_high !== null && r.value > r.ref_high;
                      return (
                        <td key={dt} className={clsx(td, 'ltr-nums tabular whitespace-nowrap', (low || high) && 'font-semibold text-rose-700')}>
                          {fmtNum(r.value)}
                          {low && ' L'}
                          {high && ' H'}
                        </td>
                      );
                    })}
                  </tr>
                )),
              ];
            })}
          </tbody>
        </Table>
      )}
      <LabEntryModal open={adding} onClose={() => setAdding(false)} patientId={patientId} />
    </Card>
  );
}

// ---------------------------------------------------------------- Vitals
export function VitalsTab({ patientId }: { patientId: string }) {
  const { t, lang } = useI18n();
  const { can } = useAuth();
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const q = useTab<any[]>(patientId, 'vitals', `/patients/${patientId}/vitals`);
  return (
    <Card>
      <CardHeader
        title={t('chart.vitals')}
        icon={<HeartPulse className="h-4 w-4" />}
        actions={can('vitals.write') && <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setAdding(true)}>{t('chart.addVitals')}</Button>}
      />
      <Loading q={q} />
      {q.data && q.data.length === 0 && <EmptyState title={t('common.noResults')} />}
      {!!q.data?.length && (
        <Table>
          <thead className="bg-slate-50">
            <tr>
              {['vitals.measuredAt', 'vitals.phase', 'vitals.bp', 'vitals.hr', 'vitals.rr', 'vitals.temp', 'vitals.spo2', 'vitals.weight', 'vitals.pain', 'common.cycle', 'common.by'].map((k) => (
                <th key={k} className={th}>
                  {t(k)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {q.data.map((v) => (
              <tr key={v.id}>
                <td className={clsx(td, 'ltr-nums whitespace-nowrap')}>{fmtDateTime(v.measured_at, lang)}</td>
                <td className={td}>{t(`vitals.${v.phase}`)}</td>
                <td className={clsx(td, 'ltr-nums')}>{v.bp_systolic ? `${v.bp_systolic}/${v.bp_diastolic}` : '—'}</td>
                <td className={clsx(td, 'ltr-nums')}>{v.heart_rate ?? '—'}</td>
                <td className={clsx(td, 'ltr-nums')}>{v.resp_rate ?? '—'}</td>
                <td className={clsx(td, 'ltr-nums')}>{v.temperature_c ?? '—'}</td>
                <td className={clsx(td, 'ltr-nums')}>{v.spo2 ?? '—'}</td>
                <td className={clsx(td, 'ltr-nums')}>{v.weight_kg ?? '—'}</td>
                <td className={clsx(td, 'ltr-nums')}>{v.pain_score ?? '—'}</td>
                <td className={clsx(td, 'ltr-nums')}>{v.cycle_number ? `C${v.cycle_number}D${v.day_number}` : '—'}</td>
                <td className={clsx(td, 'whitespace-nowrap')}>{v.recorded_by_name}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <VitalsModal open={adding} onClose={() => setAdding(false)} patientId={patientId} defaultPhase="OTHER" onSaved={() => qc.invalidateQueries({ queryKey: ['patient-tab', patientId, 'vitals'] })} />
    </Card>
  );
}

// ---------------------------------------------------------------- Notes
export function NotesTab({ patientId }: { patientId: string }) {
  const { t, lang } = useI18n();
  const { can } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [content, setContent] = useState('');
  const q = useTab<any[]>(patientId, 'notes', `/patients/${patientId}/notes`);
  const m = useMutation({
    mutationFn: () => api.post(`/patients/${patientId}/notes`, { content }),
    onSuccess: () => {
      setContent('');
      toast.success(t('common.success'));
      qc.invalidateQueries({ queryKey: ['patient-tab', patientId, 'notes'] });
    },
  });
  return (
    <div className="space-y-3">
      {can('notes.write') && (
        <Card className="p-3">
          <Textarea value={content} onChange={(e) => setContent(e.target.value)} placeholder={t('chart.noteContent')} />
          <div className="mt-2 flex items-center justify-between gap-2">
            <ErrorBox error={m.error} />
            <Button variant="primary" size="sm" className="ms-auto" loading={m.isPending} disabled={content.trim().length < 2} onClick={() => m.mutate()}>
              {t('chart.addNote')}
            </Button>
          </div>
        </Card>
      )}
      <Loading q={q} />
      {q.data && q.data.length === 0 && (
        <Card>
          <EmptyState title={t('chart.noNotes')} />
        </Card>
      )}
      {q.data?.map((n) => (
        <Card key={n.id} className="p-3">
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <Badge tone={n.note_type === 'PHYSICIAN' ? 'blue' : n.note_type === 'NURSING' ? 'teal' : 'slate'}>{n.note_type}</Badge>
            <span className="font-medium text-slate-700">{n.author_name}</span>
            <span className="ltr-nums">{fmtDateTime(n.created_at, lang)}</span>
            {n.order_number && <span className="ltr-nums">· {n.order_number}</span>}
          </div>
          <p className="mt-1.5 whitespace-pre-wrap text-sm text-slate-800">{n.content}</p>
        </Card>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- Appointments
export function AppointmentsTab({ patientId, onBook }: { patientId: string; onBook?: () => void }) {
  const { t, lang } = useI18n();
  const { can } = useAuth();
  const navigate = useNavigate();
  const q = useTab<any[]>(patientId, 'appointments', `/patients/${patientId}/appointments`);
  const today = todayLocal();
  const upcoming = (q.data ?? []).filter((a) => a.appointment_date >= today && !['COMPLETED', 'CANCELLED', 'NO_SHOW'].includes(a.status)).reverse();
  const past = (q.data ?? []).filter((a) => !upcoming.includes(a));
  const table = (rows: any[]) => (
    <Table>
      <thead className="bg-slate-50">
        <tr>
          {['common.date', 'common.time', 'appointments.type', 'common.protocol', 'common.cycle', 'common.chair', 'common.physician', 'appointments.whatsapp', 'common.status', ''].map((k) => (
            <th key={k} className={th}>
              {k ? t(k) : ''}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100">
        {rows.map((a) => (
          <tr key={a.id} className="hover:bg-slate-50">
            <td className={clsx(td, 'whitespace-nowrap')}>{fmtDate(a.appointment_date, lang)}</td>
            <td className={clsx(td, 'ltr-nums')}>{hhmm(a.start_time)}</td>
            <td className={td}>{t(`appointments.types.${a.appointment_type}`)}</td>
            <td className={td}>{a.protocol_name ?? '—'}</td>
            <td className={clsx(td, 'ltr-nums')}>{a.cycle_number ? `C${a.cycle_number}D${a.day_number}` : '—'}</td>
            <td className={td}>{a.chair_name ?? '—'}</td>
            <td className={clsx(td, 'whitespace-nowrap')}>{a.physician_name ?? '—'}</td>
            <td className={td}>{a.whatsapp_status ? <StatusBadge kind="message" status={a.whatsapp_status} /> : '—'}</td>
            <td className={td}>
              <StatusBadge kind="appointment" status={a.status} />
              {a.cancel_reason && <div className="mt-0.5 text-xs text-slate-500">{a.cancel_reason}</div>}
            </td>
            <td className={td}>
              <div className="flex gap-1">
                <Button size="xs" variant="ghost" onClick={() => navigate(`/appointments?date=${a.appointment_date}&open=${a.id}`)}>
                  {t('common.open')}
                </Button>
                <Button size="xs" variant="ghost" icon={<Printer className="h-3.5 w-3.5" />} onClick={() => window.open(`/print/appointment/${a.id}`, '_blank')} aria-label={t('appointments.printSlip')} />
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
  return (
    <div className="space-y-3">
      <Loading q={q} />
      <Card>
        <CardHeader title={t('chart.upcoming')} actions={can('appointments.write') && onBook && <Button size="sm" icon={<CalendarPlus className="h-4 w-4" />} onClick={onBook}>{t('chart.bookAppointment')}</Button>} />
        {upcoming.length ? table(upcoming) : <EmptyState title={t('common.noResults')} />}
      </Card>
      <Card>
        <CardHeader title={t('chart.past')} />
        {past.length ? table(past) : <EmptyState title={t('common.noResults')} />}
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------- Timeline
const TIMELINE_DOT: Record<string, string> = {
  REGISTERED: 'bg-slate-400',
  DIAGNOSIS: 'bg-violet-500',
  PLAN: 'bg-teal-500',
  CYCLE: 'bg-blue-600',
  ORDER: 'bg-amber-500',
  EVENT: 'bg-rose-500',
  APPOINTMENT: 'bg-sky-400',
};

export function TimelineTab({ patientId, onOpen }: { patientId: string; onOpen: (e: any) => void }) {
  const { t, lang } = useI18n();
  const q = useTab<any[]>(patientId, 'timeline', `/patients/${patientId}/timeline`);
  return (
    <Card className="p-4">
      <p className="mb-3 text-xs text-slate-500">{t('chart.timelineHint')}</p>
      <Loading q={q} />
      <ol className="relative ms-3 border-s-2 border-slate-200">
        {q.data?.map((e, i) => (
          <li key={i} className="mb-3 ms-5">
            <span className={clsx('absolute -start-[7px] mt-1.5 h-3 w-3 rounded-full ring-4 ring-white', TIMELINE_DOT[e.type])} />
            <button onClick={() => onOpen(e)} disabled={!e.refType} className={clsx('w-full rounded-md px-2 py-1 text-start', e.refType && 'hover:bg-slate-50')}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="ltr-nums w-24 shrink-0 text-xs font-semibold text-slate-500">{fmtDate(e.date, lang)}</span>
                <span className="text-sm font-medium text-slate-900">{e.type === 'CYCLE' || e.type === 'ORDER' ? e.title.replace('Cycle', t('common.cycle')).replace('Day', t('common.day')) : t(`timeline.${e.type}`, undefined, e.title)}</span>
                {e.status && e.type === 'ORDER' && <StatusBadge kind="order" status={e.status} />}
              </div>
              {e.detail && <div className="ms-0 mt-0.5 text-xs text-slate-500 sm:ms-[104px]">{e.detail}</div>}
            </button>
          </li>
        ))}
      </ol>
    </Card>
  );
}

// ---------------------------------------------------------------- Clinical assistant (placeholder)
export function AssistantTab({ patientId }: { patientId: string }) {
  const { t, lang } = useI18n();
  const m = useMutation({ mutationFn: () => api.post(`/patients/${patientId}/assistant/summary`) });
  return (
    <Card>
      <CardHeader
        title={t('assistant.title')}
        subtitle={t('assistant.subtitle')}
        icon={<Bot className="h-4 w-4" />}
        actions={
          <Button variant="primary" size="sm" icon={<Sparkles className="h-4 w-4" />} loading={m.isPending} onClick={() => m.mutate()}>
            {t('assistant.generate')}
          </Button>
        }
      />
      <div className="space-y-3 p-4">
        <div className="rounded-md border border-violet-200 bg-violet-50 px-3 py-2 text-sm font-semibold text-violet-900">{t('assistant.label')}</div>
        <ErrorBox error={m.error} />
        {m.data && (
          <>
            <p className="text-xs text-slate-500">
              {t('assistant.engine')}: {m.data.engine} · {fmtDateTime(m.data.generatedAt, lang)} — {m.data.disclaimer}
            </p>
            <div className="grid gap-3 md:grid-cols-2">
              {m.data.sections.map((s: any) => (
                <div key={s.id} className="rounded-lg border border-slate-200 p-3">
                  <h4 className="text-sm font-semibold text-slate-800">{s.title}</h4>
                  <ul className="mt-1.5 list-disc space-y-1 ps-5 text-sm text-slate-700">
                    {s.items.map((it: string, i: number) => (
                      <li key={i}>{it}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </Card>
  );
}
