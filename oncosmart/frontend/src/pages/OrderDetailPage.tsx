import clsx from 'clsx';
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  CheckCircle2,
  ClipboardCheck,
  FlaskConical,
  HeartPulse,
  Pencil,
  PlayCircle,
  Printer,
  RotateCcw,
  Send,
  ShieldAlert,
  Siren,
  XCircle,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { StatusBadge } from '../components/StatusBadge';
import { WarningList } from '../components/WarningList';
import { Badge, Button, Card, CardHeader, ErrorBox, InfoRow, PageLoader, Table, td, th } from '../components/ui';
import { useToast } from '../components/Toast';
import { AppointmentFormModal, AppointmentPrefill } from '../features/appointments/AppointmentFormModal';
import { VitalsModal } from '../features/common/VitalsModal';
import { AdministrationPanel } from '../features/orders/AdministrationPanel';
import { ApproveModal, CompleteModal, CompletionResultModal, EventModal, ReasonModal, VerifyModal } from '../features/orders/OrderModals';
import { useI18n } from '../i18n/I18nProvider';
import { api } from '../services/api';
import { doseLabel, fmtDate, fmtDateTime, fmtDuration, fmtNum, hhmm, patientName, fmtBsa } from '../utils/format';

export function NotConfigured() {
  const { t } = useI18n();
  return <span className="text-xs italic text-amber-700">{t('app.notConfigured')}</span>;
}

export function TreatmentTable({ detail, showVials = true }: { detail: any; showVials?: boolean }) {
  const { t, lang } = useI18n();
  const prev = detail.previous?.items ?? [];
  return (
    <Table>
      <thead className="bg-slate-50">
        <tr>
          <th className={th}>{t('orders.sequence')}</th>
          <th className={th}>{t('chart.drug')}</th>
          <th className={th}>{t('orders.perUnit')}</th>
          <th className={th}>{t('orders.calculated')}</th>
          <th className={th}>{t('orders.final')}</th>
          <th className={th}>{t('chart.route')}</th>
          <th className={th}>{t('chart.diluent')}</th>
          <th className={th}>{t('orders.volume')}</th>
          <th className={th}>{t('chart.infusionTime')}</th>
          <th className={th}>{t('orders.previousDose')}</th>
          {showVials && <th className={th}>{t('orders.vialEstimate')}</th>}
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100">
        {detail.items.map((i: any) => {
          const p = prev.find((x: any) => x.drug_name === i.drug_name);
          const vial = detail.vialEstimates?.[i.id];
          const changed = p && Number(p.final_dose) !== Number(i.final_dose);
          return (
            <tr key={i.id} className="align-top">
              <td className={clsx(td, 'ltr-nums font-semibold text-slate-500')}>{i.sequence}</td>
              <td className={td}>
                <div className="font-semibold text-slate-900">{i.drug_name}</div>
                <div className="text-xs text-slate-500">{t(`protocols.methods.${i.administration_method}`, undefined, i.administration_method ?? '')}</div>
                {i.special_instructions && <div className="mt-0.5 text-2xs text-slate-500">{i.special_instructions}</div>}
              </td>
              <td className={clsx(td, 'ltr-nums whitespace-nowrap')}>
                {doseLabel(Number(i.dose_value), i.dose_unit)}
                {Number(i.dose_percent) !== 100 && <div className="text-xs font-semibold text-amber-700">× {fmtNum(i.dose_percent)}%</div>}
              </td>
              <td className={clsx(td, 'min-w-[150px]')}>
                <div className="ltr-nums">{fmtNum(i.calculated_dose, 2)} mg</div>
                <div className="ltr-nums text-2xs text-slate-500">{i.calculation_formula}</div>
              </td>
              <td className={clsx(td, 'whitespace-nowrap')}>
                <div className="ltr-nums text-base font-bold text-slate-900">{fmtNum(i.final_dose)} mg</div>
                {i.is_manually_adjusted && <Badge tone="amber">{t('orders.manualAdjusted')}</Badge>}
                {i.dose_modification_reason && <div className="max-w-[180px] whitespace-normal text-2xs text-amber-800">{i.dose_modification_reason}</div>}
              </td>
              <td className={td}>{i.route}</td>
              <td className={td}>{i.diluent ?? <NotConfigured />}</td>
              <td className={clsx(td, 'ltr-nums whitespace-nowrap')}>{i.final_volume_ml ? `${fmtNum(i.final_volume_ml)} mL` : i.route === 'IV' && i.administration_method !== 'BOLUS' ? <NotConfigured /> : '—'}</td>
              <td className={clsx(td, 'whitespace-nowrap')}>{i.infusion_duration_min ? fmtDuration(i.infusion_duration_min, lang) : i.administration_method === 'BOLUS' ? 'Bolus' : <NotConfigured />}</td>
              <td className={clsx(td, 'ltr-nums whitespace-nowrap', changed ? 'font-semibold text-amber-700' : 'text-slate-500')}>{p ? `${fmtNum(p.final_dose)} mg` : '—'}</td>
              {showVials && (
                <td className={clsx(td, 'ltr-nums whitespace-nowrap text-xs text-slate-600')}>
                  {vial ? vial.combination.map((c: any) => `${c.count}×${c.strength} mg`).join(' + ') : '—'}
                </td>
              )}
            </tr>
          );
        })}
      </tbody>
    </Table>
  );
}

const STEPS = [
  ['prescribed', 'orders.prescriber', 'prescribed_at', 'prescribed_by_name'],
  ['submitted', 'orders.submitReview', 'submitted_at', null],
  ['approved', 'orders.physicianApproval', 'approved_at', 'approved_by_name'],
  ['released', 'orders.release', 'released_at', 'released_by_name'],
  ['prepared', 'orders.prepared', 'prepared_at', 'prepared_by_name'],
  ['verified', 'orders.nurseVerification', 'nurse_verified_at', 'nurse_verified_by_name'],
  ['started', 'orders.start', 'treatment_started_at', 'treatment_started_by_name'],
  ['completed', 'orders.complete', 'completed_at', 'completed_by_name'],
] as const;

export function OrderDetailPage() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const { t, lang } = useI18n();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const [modal, setModal] = useState<string | null>(null);
  const [completion, setCompletion] = useState<any>(null);
  const [booking, setBooking] = useState<AppointmentPrefill | null>(null);
  const q = useQuery({ queryKey: ['order', id], queryFn: () => api.get(`/orders/${id}`), refetchInterval: 30_000 });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['order', id] });
    qc.invalidateQueries({ queryKey: ['infusion'] });
    qc.invalidateQueries({ queryKey: ['dashboard'] });
    qc.invalidateQueries({ queryKey: ['orders'] });
    qc.invalidateQueries({ queryKey: ['chairs'] });
  };
  const simple = useMutation({
    mutationFn: (action: string) => api.post(`/orders/${id}/${action}`),
    onSuccess: () => {
      toast.success(t('common.success'));
      refresh();
    },
    onError: (e) => toast.error(e),
  });
  useEffect(() => {
    const action = params.get('action');
    if (action && q.data) {
      setModal(action);
      params.delete('action');
      setParams(params, { replace: true });
    }
  }, [params, q.data, setParams]);

  if (q.isLoading) return <PageLoader />;
  if (q.error) return <ErrorBox error={q.error} />;
  const d = q.data;
  const o = d.order;
  const p = d.patient;
  const can = (a: string) => d.allowedActions.includes(a);

  // Next nursing step, highlighted for a busy infusion room
  const next = can('release') ? 'release' : can('prepared') ? 'prepared' : can('verify') ? 'verify' : can('start') ? 'start' : can('complete') ? 'complete' : can('approve') ? 'approve' : can('submit') ? 'submit' : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link to={`/patients/${p.id}`} className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
          <ArrowLeft className="h-4 w-4 rtl:rotate-180" /> {patientName(p, lang)}
        </Link>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="ghost" icon={<Printer className="h-4 w-4" />} onClick={() => window.open(`/print/order/${o.id}`, '_blank')}>
            {t('orders.printOrder')}
          </Button>
          {d.administrations.length > 0 && (
            <Button size="sm" variant="ghost" icon={<Printer className="h-4 w-4" />} onClick={() => window.open(`/print/administration/${o.id}`, '_blank')}>
              {t('orders.printAdmin')}
            </Button>
          )}
        </div>
      </div>

      {/* Header */}
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-start justify-between gap-4 p-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold text-slate-900">{patientName(p, lang)}</h1>
              <span className="ltr-nums text-sm text-slate-500">
                {p.mrn} · {p.age} · {t(`patients.${p.sex}`)}
              </span>
              <StatusBadge kind="order" status={o.status} className="text-sm" />
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-700">
              <b className="ltr-nums">{o.order_number}</b>
              <span>·</span>
              <span>{o.protocol_name}</span>
              {d.protocol?.is_demo && <Badge tone="amber">{t('app.demoProtocol')}</Badge>}
              <span>·</span>
              <b className="ltr-nums">
                C{o.cycle_number}D{o.day_number}
              </b>
              <span>·</span>
              <span>{fmtDate(o.planned_date, lang)}</span>
              {o.intent && <Badge>{t(`intent.${o.intent}`)}</Badge>}
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {p.allergies.length ? (
                p.allergies.map((a: any) => (
                  <Badge key={a.id} tone="red">
                    <AlertTriangle className="h-3 w-3" /> {a.allergen}
                  </Badge>
                ))
              ) : p.no_known_allergies ? (
                <Badge tone="green">{t('patients.noKnownAllergies')}</Badge>
              ) : (
                <Badge tone="amber">{t('patients.allergyNotDocumented')}</Badge>
              )}
            </div>
          </div>
          {/* Actions */}
          <div className="flex flex-wrap items-center gap-2">
            {can('edit') && (
              <Button icon={<Pencil className="h-4 w-4" />} onClick={() => navigate(`/orders/${o.id}/edit`)}>
                {t('common.edit')}
              </Button>
            )}
            {can('submit') && (
              <Button variant={next === 'submit' ? 'primary' : 'secondary'} icon={<Send className="h-4 w-4" />} loading={simple.isPending} onClick={() => simple.mutate('submit')}>
                {t('orders.submitReview')}
              </Button>
            )}
            {can('return') && (
              <Button icon={<RotateCcw className="h-4 w-4" />} onClick={() => setModal('return')}>
                {t('orders.returnDraft')}
              </Button>
            )}
            {can('approve') && (
              <Button variant="success" icon={<CheckCircle2 className="h-4 w-4" />} onClick={() => setModal('approve')}>
                {t('orders.approve')}
              </Button>
            )}
            {can('release') && (
              <Button variant="primary" icon={<FlaskConical className="h-4 w-4" />} loading={simple.isPending} onClick={() => simple.mutate('release')}>
                {t('orders.release')}
              </Button>
            )}
            {can('prepared') && (
              <Button variant="primary" icon={<Check className="h-4 w-4" />} loading={simple.isPending} onClick={() => simple.mutate('prepared')}>
                {t('orders.prepared')}
              </Button>
            )}
            {can('verify') && (
              <Button variant="primary" icon={<ClipboardCheck className="h-4 w-4" />} onClick={() => setModal('verify')}>
                {t('orders.verify')}
              </Button>
            )}
            {can('start') && (
              <Button variant="primary" icon={<PlayCircle className="h-4 w-4" />} loading={simple.isPending} onClick={() => simple.mutate('start')}>
                {t('orders.start')}
              </Button>
            )}
            {can('complete') && (
              <Button variant="success" icon={<CheckCircle2 className="h-4 w-4" />} onClick={() => setModal('complete')}>
                {t('orders.complete')}
              </Button>
            )}
            {can('vitals') && (
              <Button icon={<HeartPulse className="h-4 w-4" />} onClick={() => setModal('vitals')}>
                {t('chart.addVitals')}
              </Button>
            )}
            {can('report_event') && (
              <Button variant="ghost" icon={<Siren className="h-4 w-4" />} onClick={() => setModal('event')}>
                {t('orders.reportEvent')}
              </Button>
            )}
            {can('hold') && (
              <Button variant="ghost" onClick={() => setModal('hold')}>
                {t('orders.hold')}
              </Button>
            )}
            {can('delay') && (
              <Button variant="ghost" onClick={() => setModal('delay')}>
                {t('orders.delay')}
              </Button>
            )}
            {can('resume') && (
              <Button variant="primary" icon={<RotateCcw className="h-4 w-4" />} loading={simple.isPending} onClick={() => simple.mutate('resume')}>
                {t('orders.resume')}
              </Button>
            )}
            {can('cancel') && (
              <Button variant="ghost" className="text-rose-700" icon={<XCircle className="h-4 w-4" />} onClick={() => setModal('cancel')}>
                {t('orders.cancelOrder')}
              </Button>
            )}
          </div>
        </div>
        {(o.hold_reason || o.cancelled_reason) && ['HELD', 'DELAYED', 'CANCELLED'].includes(o.status) && (
          <div className="border-t border-orange-200 bg-orange-50 px-4 py-2 text-sm text-orange-900">
            <b>{t('orders.heldReason')}:</b> {o.cancelled_reason ?? o.hold_reason} {o.delayed_until && `→ ${fmtDate(o.delayed_until, lang)}`}
          </div>
        )}
      </Card>

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          {/* Measurements + diagnosis */}
          <Card>
            <dl className="grid gap-4 p-4 sm:grid-cols-3 lg:grid-cols-6">
              <InfoRow label={t('patients.diagnosis')} value={d.diagnosis ? `${d.diagnosis.primary_cancer}${d.diagnosis.stage ? ` · ${d.diagnosis.stage}` : ''}` : null} className="sm:col-span-3 lg:col-span-2" />
              <InfoRow label={t('orders.height')} value={<span className="ltr-nums">{fmtNum(o.height_cm)}</span>} />
              <InfoRow label={t('orders.weight')} value={<span className="ltr-nums">{fmtNum(o.weight_kg)}</span>} />
              <InfoRow label={t('orders.bsa')} value={<span className="ltr-nums text-base font-semibold text-brand-800">{fmtBsa(o.bsa_m2)} m²</span>} />
              <InfoRow label="GFR" value={o.gfr_ml_min ? <span className="ltr-nums">{fmtNum(o.gfr_ml_min)} mL/min</span> : null} />
              {o.gfr_source && <InfoRow label={t('orders.gfrSource')} value={o.gfr_source} className="sm:col-span-3 lg:col-span-6" />}
            </dl>
          </Card>

          <Card>
            <CardHeader title={t('orders.doseTable')} subtitle={<span className="font-semibold text-amber-700">{t('app.calcDisclaimer')}</span>} />
            <TreatmentTable detail={d} />
            <p className="border-t border-slate-100 px-4 py-2 text-2xs text-slate-500">{t('orders.vialNote')}</p>
          </Card>

          {d.administrations.length > 0 && <AdministrationPanel detail={d} onChanged={refresh} canAct={d.allowedActions.includes('administer') || d.order.status === 'COMPLETED'} />}

          <div className="grid gap-4 md:grid-cols-2">
            {(
              [
                ['orders.premedications', o.premedications],
                ['orders.hydration', o.hydration],
                ['orders.supportive', o.supportive_medications],
                ['orders.specialInstructions', o.special_instructions],
              ] as const
            ).map(([k, v]) => (
              <Card key={k} className="p-3">
                <div className="text-2xs font-semibold uppercase tracking-wide text-slate-500">{t(k)}</div>
                <div className="mt-1 whitespace-pre-wrap text-sm text-slate-800">{v || <NotConfigured />}</div>
              </Card>
            ))}
          </div>

          <Card>
            <CardHeader title={t('chart.vitals')} icon={<HeartPulse className="h-4 w-4" />} actions={can('vitals') && <Button size="sm" onClick={() => setModal('vitals')}>{t('chart.addVitals')}</Button>} />
            {d.vitals.length === 0 ? (
              <p className="p-4 text-sm text-slate-500">{t('common.noResults')}</p>
            ) : (
              <Table>
                <thead className="bg-slate-50">
                  <tr>
                    {['vitals.measuredAt', 'vitals.phase', 'vitals.bp', 'vitals.hr', 'vitals.rr', 'vitals.temp', 'vitals.spo2', 'vitals.weight', 'vitals.pain', 'common.by'].map((k) => (
                      <th key={k} className={th}>
                        {t(k)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {d.vitals.map((v: any) => (
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
                      <td className={clsx(td, 'whitespace-nowrap')}>{v.recorded_by_name}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>

          {d.events.length > 0 && (
            <Card>
              <CardHeader title={t('orders.events')} icon={<Siren className="h-4 w-4" />} />
              <ul className="divide-y divide-slate-100">
                {d.events.map((e: any) => (
                  <li key={e.id} className="px-4 py-2.5 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone="red">{t(`events.${e.event_type}`)}</Badge>
                      <Badge tone="amber">{t(`events.${e.severity}`)}</Badge>
                      <span className="ltr-nums text-xs text-slate-500">{fmtDateTime(e.occurred_at, lang)} · {e.reported_by_name}</span>
                    </div>
                    <p className="mt-1 text-slate-800">{e.description}</p>
                    {e.action_taken && <p className="text-xs text-slate-600">{t('orders.actionTaken')}: {e.action_taken}</p>}
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>

        {/* Side column */}
        <div className="space-y-4">
          <Card>
            <CardHeader title={t('orders.warnings')} icon={<ShieldAlert className="h-4 w-4" />} />
            <div className="space-y-2 p-3">
              <WarningList warnings={d.warnings} />
              <p className="text-2xs text-slate-500">{t('warnings.neverCancels')}</p>
              {o.warnings_acknowledged_by_name && (
                <p className="text-xs text-emerald-700">
                  ✓ {t('orders.warningsAcknowledged')}: {o.warnings_acknowledged_by_name} · <span className="ltr-nums">{fmtDateTime(o.warnings_acknowledged_at, lang)}</span>
                </p>
              )}
            </div>
          </Card>

          <Card>
            <CardHeader title={t('orders.workflow')} />
            <ol className="space-y-0 p-3">
              {STEPS.map(([key, label, at, by]) => {
                const done = !!o[at];
                return (
                  <li key={key} className="flex gap-2.5 py-1.5">
                    <span className={clsx('mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-white', done ? 'bg-emerald-500' : 'bg-slate-200')}>{done && <Check className="h-3.5 w-3.5" />}</span>
                    <div className="min-w-0 text-sm">
                      <div className={clsx('font-medium', done ? 'text-slate-900' : 'text-slate-400')}>{t(label)}</div>
                      {done && (
                        <div className="text-xs text-slate-500">
                          {by && o[by] ? `${o[by]} · ` : ''}
                          <span className="ltr-nums">{fmtDateTime(o[at], lang)}</span>
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
            {o.approval_note && <p className="border-t border-slate-100 px-4 py-2 text-xs text-slate-600">{t('orders.approvalNote')}: {o.approval_note}</p>}
            {o.status === 'COMPLETED' && (
              <div className="border-t border-slate-100 px-4 py-2 text-xs text-slate-600">
                {t('orders.treatmentDuration')}: <b>{fmtDuration(o.treatment_duration_min, lang)}</b> · {t('orders.disposition')}: <b>{o.disposition && t(`disposition.${o.disposition}`)}</b>
                {o.adverse_event && <div className="text-rose-700">{t('orders.adverseEvent')}: {o.adverse_event_details}</div>}
              </div>
            )}
          </Card>

          {d.appointment && (
            <Card className="p-3 text-sm">
              <div className="text-2xs font-semibold uppercase tracking-wide text-slate-500">{t('nav.appointments')}</div>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <span className="ltr-nums font-medium">
                  {fmtDate(d.appointment.appointment_date, lang)} {hhmm(d.appointment.start_time)}
                </span>
                <span>· {d.appointment.chair_name ?? t('appointments.noChair')}</span>
                <StatusBadge kind="appointment" status={d.appointment.status} />
              </div>
            </Card>
          )}

          <Card>
            <CardHeader title={t('orders.previousCycle')} />
            {d.previous ? (
              <div className="p-3 text-sm">
                <button className="ltr-nums font-medium text-brand-700 hover:underline" onClick={() => navigate(`/orders/${d.previous.id}`)}>
                  {d.previous.orderNumber} · C{d.previous.cycleNumber}D{d.previous.dayNumber} · {fmtDate(d.previous.plannedDate, lang)}
                </button>
                <div className="ltr-nums mt-0.5 text-xs text-slate-500">
                  {fmtNum(d.previous.weightKg)} kg · BSA {fmtBsa(d.previous.bsa)} m²
                </div>
                <ul className="mt-2 space-y-1">
                  {d.previous.items.map((i: any) => {
                    const cur = d.items.find((x: any) => x.drug_name === i.drug_name);
                    const diff = cur ? ((Number(cur.final_dose) - Number(i.final_dose)) / Number(i.final_dose)) * 100 : 0;
                    return (
                      <li key={i.drug_name} className="flex justify-between gap-2 text-xs">
                        <span>{i.drug_name}</span>
                        <span className="ltr-nums">
                          {fmtNum(i.final_dose)} → {cur ? fmtNum(cur.final_dose) : '—'} mg{' '}
                          {cur && Math.abs(diff) >= 0.5 && <span className={clsx(Math.abs(diff) > 10 ? 'font-semibold text-amber-700' : 'text-slate-500')}>({diff > 0 ? '+' : ''}{diff.toFixed(1)}%)</span>}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : (
              <p className="p-3 text-sm text-slate-500">{t('orders.noPrevious')}</p>
            )}
          </Card>
          {next && (
            <p className="text-center text-xs text-slate-500">
              {t('infusion.nextStep')}: <b>{t(`orders.${next === 'submit' ? 'submitReview' : next}`)}</b>
            </p>
          )}
        </div>
      </div>

      <ApproveModal open={modal === 'approve'} onClose={() => setModal(null)} detail={d} onDone={() => { toast.success(t('common.success')); refresh(); }} />
      <ReasonModal open={modal === 'return'} onClose={() => setModal(null)} title={t('orders.returnDraft')} action="return" orderId={o.id} onDone={refresh} variant="warning" />
      <ReasonModal open={modal === 'hold'} onClose={() => setModal(null)} title={t('orders.hold')} action="hold" orderId={o.id} onDone={refresh} variant="warning" />
      <ReasonModal open={modal === 'delay'} onClose={() => setModal(null)} title={t('orders.delay')} action="delay" orderId={o.id} withDate onDone={refresh} variant="warning" />
      <ReasonModal open={modal === 'cancel'} onClose={() => setModal(null)} title={t('orders.cancelOrder')} action="cancel" orderId={o.id} onDone={refresh} />
      <VerifyModal open={modal === 'verify'} onClose={() => setModal(null)} detail={d} onDone={() => { toast.success(t('common.success')); refresh(); }} onRecordVitals={() => setModal('vitals-pre')} />
      <VitalsModal open={modal === 'vitals' || modal === 'vitals-pre'} onClose={() => setModal(modal === 'vitals-pre' ? 'verify' : null)} patientId={p.id} orderId={o.id} defaultPhase={o.status === 'IN_PROGRESS' ? 'DURING' : ['COMPLETED'].includes(o.status) ? 'POST' : 'PRE'} onSaved={refresh} />
      <EventModal open={modal === 'event'} onClose={() => setModal(null)} orderId={o.id} onDone={() => { toast.success(t('common.success')); refresh(); }} />
      <CompleteModal open={modal === 'complete'} onClose={() => setModal(null)} detail={d} onDone={(r) => { refresh(); qc.invalidateQueries({ queryKey: ['patient'] }); setCompletion(r.completion); }} />
      <CompletionResultModal
        result={completion}
        onClose={() => setCompletion(null)}
        onBook={(s) => {
          setCompletion(null);
          setBooking({ patientId: p.id, treatmentPlanId: s.treatmentPlanId, cycleNumber: s.cycle, dayNumber: s.day, appointmentDate: s.dueDate, startTime: s.startTime, durationMinutes: s.durationMinutes, chairId: s.suggestedChairId, physicianId: s.physicianId });
        }}
      />
      <AppointmentFormModal open={!!booking} onClose={() => setBooking(null)} prefill={booking ?? undefined} />
    </div>
  );
}
