import clsx from 'clsx';
import { Activity, AlertOctagon, AlertTriangle, Armchair, CalendarClock, ChevronRight, Info, LayoutDashboard } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { StatusBadge } from '../components/StatusBadge';
import { Badge, Button, Card, CardHeader, EmptyState, ErrorBox, PageHeader, PageLoader, td, th, Table } from '../components/ui';
import { useAuth } from '../hooks/useAuth';
import { useSettings } from '../hooks/useSettings';
import { useI18n } from '../i18n/I18nProvider';
import { api } from '../services/api';
import { fmtDate, fmtDuration, hhmm, patientName } from '../utils/format';

const CHAIR_STYLE: Record<string, string> = {
  AVAILABLE: 'border-emerald-200 bg-emerald-50/60',
  RESERVED: 'border-violet-200 bg-violet-50/60',
  PREPARING: 'border-amber-200 bg-amber-50/60',
  INFUSING: 'border-blue-200 bg-blue-50/60',
  CLEANING: 'border-sky-200 bg-sky-50/60',
  OUT_OF_SERVICE: 'border-rose-200 bg-rose-50/60',
};
const CHAIR_BAR: Record<string, string> = {
  AVAILABLE: 'bg-emerald-500',
  RESERVED: 'bg-violet-500',
  PREPARING: 'bg-amber-500',
  INFUSING: 'bg-blue-600',
  CLEANING: 'bg-sky-400',
  OUT_OF_SERVICE: 'bg-rose-500',
};

export function ChairTile({ chair, onClick }: { chair: any; onClick?: () => void }) {
  const { t, lang } = useI18n();
  const next = (chair.bookings ?? []).find((b: any) => ['SCHEDULED', 'CONFIRMED', 'ARRIVED'].includes(b.status) && b.id !== chair.current_appointment_id);
  return (
    <button onClick={onClick} className={clsx('relative flex min-h-[104px] flex-col overflow-hidden rounded-lg border p-3 text-start transition hover:shadow-md', CHAIR_STYLE[chair.status] ?? 'border-slate-200 bg-white')}>
      <span className={clsx('absolute inset-y-0 start-0 w-1', CHAIR_BAR[chair.status])} />
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-sm font-semibold text-slate-800">
          <Armchair className="h-4 w-4 text-slate-400" />
          {chair.name}
        </span>
        <StatusBadge kind="chair" status={chair.status} />
      </div>
      {chair.occupant_name ? (
        <div className="mt-2 min-w-0">
          <div className="truncate text-sm font-medium text-slate-900">{lang === 'ar' && chair.occupant_name_ar ? chair.occupant_name_ar : chair.occupant_name}</div>
          <div className="truncate text-xs text-slate-500">
            {chair.occupant_protocol ?? '—'} {chair.occupant_cycle ? `· C${chair.occupant_cycle}D${chair.occupant_day}` : ''}
          </div>
        </div>
      ) : chair.status_note ? (
        <div className="mt-2 text-xs text-slate-500">{chair.status_note}</div>
      ) : (
        <div className="mt-2 text-xs text-slate-400">{t('chairs.free')}</div>
      )}
      {next && (
        <div className="mt-auto pt-1.5 text-2xs text-slate-500">
          {t('common.next')}: <span className="ltr-nums font-medium">{hhmm(next.start_time)}</span> · {lang === 'ar' && next.patient_name_ar ? next.patient_name_ar : next.patient_name}
        </div>
      )}
    </button>
  );
}

function StatTile({ label, value, tone, sub }: { label: string; value: ReactNode; tone?: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2.5 shadow-sm">
      <div className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
        {tone && <span className={clsx('h-2 w-2 rounded-full', tone)} />}
        <span className="truncate">{label}</span>
      </div>
      <div className="mt-1 text-2xl font-semibold text-slate-900">{value}</div>
      {sub && <div className="text-2xs text-slate-500">{sub}</div>}
    </div>
  );
}

export function DashboardPage() {
  const { t, lang } = useI18n();
  const { can } = useAuth();
  const navigate = useNavigate();
  const settings = useSettings();
  const q = useQuery({ queryKey: ['dashboard'], queryFn: () => api.get('/dashboard'), refetchInterval: 30_000 });
  if (q.isLoading) return <PageLoader />;
  if (q.error) return <ErrorBox error={q.error} />;
  const d = q.data;
  const s = d.stats;
  const k = d.kpis;

  const alertText = (a: any) => {
    const key = `alerts.${a.type}`;
    const tr = t(key, a.params, '');
    return tr && !/\{\w+\}/.test(tr) ? tr : a.message;
  };

  return (
    <div className="space-y-4">
      <PageHeader
        icon={<LayoutDashboard className="h-5 w-5" />}
        title={t('dashboard.title')}
        subtitle={`${settings.data?.settings.hospital_name ?? ''} · ${settings.data?.settings.unit_name ?? ''} · ${fmtDate(d.date, lang, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}`}
        actions={
          can('infusion.read') && (
            <Button variant="primary" icon={<Activity className="h-4 w-4" />} onClick={() => navigate('/infusion')}>
              {t('dashboard.openInfusion')}
            </Button>
          )
        }
      />

      {/* Today's statistics */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7">
        <StatTile label={t('dashboard.totalAppointments')} value={s.total} />
        <StatTile label={t('dashboard.confirmed')} value={s.confirmed} tone="bg-teal-500" sub={s.scheduled ? `${s.scheduled} ${t('dashboard.scheduled').toLowerCase()}` : undefined} />
        <StatTile label={t('dashboard.waiting')} value={s.waiting} tone="bg-amber-500" />
        <StatTile label={t('dashboard.inPreparation')} value={s.inPreparation} tone="bg-violet-500" />
        <StatTile label={t('dashboard.inTreatment')} value={s.inTreatment} tone="bg-blue-600" />
        <StatTile label={t('dashboard.completed')} value={s.completed} tone="bg-emerald-500" />
        <StatTile label={t('dashboard.cancelled')} value={s.cancelled} tone="bg-rose-500" />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <Card>
            <CardHeader title={t('dashboard.chairStatus')} icon={<Armchair className="h-4 w-4" />} actions={<Link to="/chairs" className="text-xs font-medium text-brand-700 hover:underline">{t('nav.chairs')}</Link>} />
            <div className="grid grid-cols-2 gap-2 p-3 sm:grid-cols-3">
              {d.chairs.filter((c: any) => c.is_active).map((c: any) => (
                <ChairTile key={c.id} chair={c} onClick={() => c.occupant_patient_id && navigate(`/patients/${c.occupant_patient_id}`)} />
              ))}
            </div>
          </Card>

          <Card>
            <CardHeader title={t('dashboard.timeline')} icon={<CalendarClock className="h-4 w-4" />} actions={<Link to="/appointments" className="text-xs font-medium text-brand-700 hover:underline">{t('nav.appointments')}</Link>} />
            {d.timeline.length === 0 ? (
              <EmptyState title={t('dashboard.noAppointments')} />
            ) : (
              <Table>
                <thead className="bg-slate-50">
                  <tr>
                    <th className={th}>{t('common.time')}</th>
                    <th className={th}>{t('common.patient')}</th>
                    <th className={th}>{t('common.protocol')}</th>
                    <th className={th}>{t('common.cycle')}</th>
                    <th className={th}>{t('common.chair')}</th>
                    <th className={th}>{t('common.status')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {d.timeline.map((a: any) => (
                    <tr key={a.id} className={clsx('cursor-pointer hover:bg-slate-50', a.status === 'CANCELLED' && 'opacity-60')} onClick={() => navigate(`/patients/${a.patient_id}`)}>
                      <td className={clsx(td, 'ltr-nums font-semibold tabular')}>{hhmm(a.start_time)}</td>
                      <td className={td}>
                        <div className="font-medium text-slate-900">{patientName(a, lang)}</div>
                        <div className="text-xs text-slate-500">{a.mrn}</div>
                      </td>
                      <td className={td}>{a.protocol_name ?? '—'}</td>
                      <td className={clsx(td, 'ltr-nums')}>{a.cycle_number ? `C${a.cycle_number}D${a.day_number}` : '—'}</td>
                      <td className={clsx(td, 'whitespace-nowrap')}>{a.chair_name ?? '—'}</td>
                      <td className={td}>
                        <StatusBadge kind="appointment" status={a.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader title={t('dashboard.alerts')} icon={<AlertTriangle className="h-4 w-4" />} actions={<Badge tone={d.alerts.some((a: any) => a.severity === 'CRITICAL') ? 'red' : 'slate'}>{d.alerts.length}</Badge>} />
            <div className="max-h-[520px] space-y-1.5 overflow-y-auto p-3">
              {d.alerts.length === 0 && <p className="text-sm text-slate-500">{t('dashboard.noAlerts')}</p>}
              {d.alerts.map((a: any, i: number) => {
                const Icon = a.severity === 'CRITICAL' ? AlertOctagon : a.severity === 'WARNING' ? AlertTriangle : Info;
                const target = a.orderId && can('orders.read') ? `/orders/${a.orderId}` : a.patientId ? `/patients/${a.patientId}` : null;
                return (
                  <button
                    key={i}
                    disabled={!target}
                    onClick={() => target && navigate(target)}
                    className={clsx(
                      'flex w-full items-start gap-2 rounded-md border px-2.5 py-2 text-start text-sm transition hover:shadow-sm',
                      a.severity === 'CRITICAL' && 'border-rose-200 bg-rose-50 text-rose-900',
                      a.severity === 'WARNING' && 'border-amber-200 bg-amber-50 text-amber-900',
                      a.severity === 'INFO' && 'border-slate-200 bg-slate-50 text-slate-700',
                    )}
                  >
                    <Icon className="mt-0.5 h-4 w-4 shrink-0" />
                    <span className="min-w-0 flex-1">
                      {a.patientName && <span className="block text-xs font-semibold">{a.patientName}</span>}
                      <span className="block">{alertText(a)}</span>
                    </span>
                    {target && <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 opacity-50 rtl:rotate-180" />}
                  </button>
                );
              })}
            </div>
          </Card>

          <Card>
            <CardHeader title={t('dashboard.kpis')} />
            <div className="grid grid-cols-2 gap-2 p-3">
              <StatTile label={t('dashboard.kpiTodaysPatients')} value={k.todaysPatients} />
              <StatTile label={t('dashboard.kpiInTreatment')} value={k.inTreatment} />
              <StatTile label={t('dashboard.kpiAvailableChairs')} value={<span className="ltr-nums">{k.availableChairs} / {k.totalChairs}</span>} />
              <StatTile label={t('dashboard.kpiCompleted')} value={k.completedToday} />
              <StatTile label={t('dashboard.kpiAvgDuration')} value={fmtDuration(k.avgInfusionDurationMin, lang)} />
              <StatTile label={t('dashboard.kpiUtilization')} value={`${k.chairUtilizationPct}%`} />
              <StatTile label={t('dashboard.kpiCancellation')} value={`${k.cancellationRatePct}%`} />
              <StatTile label={t('dashboard.kpiDelays')} value={k.treatmentDelays} />
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
