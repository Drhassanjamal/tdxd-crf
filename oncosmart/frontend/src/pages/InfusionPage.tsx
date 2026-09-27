import clsx from 'clsx';
import { Activity, AlertOctagon, AlertTriangle, CheckCircle2, ClipboardList, LogIn, Pause, PlayCircle, RefreshCw, Siren } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { StatusBadge } from '../components/StatusBadge';
import { Badge, Button, Card, EmptyState, ErrorBox, PageHeader, PageLoader, Segmented } from '../components/ui';
import { useToast } from '../components/Toast';
import { InfusionTimer } from '../features/orders/AdministrationPanel';
import { useAuth } from '../hooks/useAuth';
import { useI18n } from '../i18n/I18nProvider';
import { api } from '../services/api';
import { fmtDate, hhmm, patientName } from '../utils/format';
import { warningText } from '../components/WarningList';

type Filter = 'all' | 'waiting' | 'prep' | 'treatment' | 'done';
const GROUP: Record<string, Filter> = {
  SCHEDULED: 'waiting', CONFIRMED: 'waiting', ARRIVED: 'waiting', NEEDS_RESCHEDULING: 'waiting',
  IN_PREPARATION: 'prep', IN_TREATMENT: 'treatment', COMPLETED: 'done', CANCELLED: 'done', NO_SHOW: 'done',
};
const ACCENT: Record<string, string> = {
  waiting: 'border-t-amber-400', prep: 'border-t-violet-500', treatment: 'border-t-blue-600', done: 'border-t-emerald-500',
};

export function InfusionPage() {
  const { t, lang } = useI18n();
  const { can } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const [filter, setFilter] = useState<Filter>('all');
  const q = useQuery({ queryKey: ['infusion'], queryFn: () => api.get('/infusion/today'), refetchInterval: 20_000 });
  const act = useMutation({
    mutationFn: ({ url }: { url: string }) => api.post(url),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['infusion'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      toast.success(t('common.success'));
    },
    onError: (e) => toast.error(e),
  });
  if (q.isLoading) return <PageLoader />;
  if (q.error) return <ErrorBox error={q.error} />;
  const d = q.data;
  const cards = d.cards.filter((c: any) => filter === 'all' || GROUP[c.appointment.status] === filter);

  return (
    <div>
      <PageHeader
        icon={<Activity className="h-5 w-5" />}
        title={t('infusion.title')}
        subtitle={`${fmtDate(d.date, lang, { weekday: 'long', day: 'numeric', month: 'long' })} · ${t('infusion.autoRefresh')}`}
        actions={
          <Button size="sm" variant="ghost" icon={<RefreshCw className={clsx('h-4 w-4', q.isFetching && 'animate-spin')} />} onClick={() => q.refetch()}>
            {t('common.refresh')}
          </Button>
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
        {(
          [
            ['all', t('infusion.patients'), d.summary.total, 'bg-slate-500'],
            ['waiting', t('infusion.waiting'), d.summary.waiting, 'bg-amber-400'],
            ['prep', t('infusion.inPreparation'), d.summary.inPreparation, 'bg-violet-500'],
            ['treatment', t('infusion.inTreatment'), d.summary.inTreatment, 'bg-blue-600'],
            ['done', t('infusion.completed'), d.summary.completed, 'bg-emerald-500'],
          ] as const
        ).map(([id, label, value, dot]) => (
          <button key={id} onClick={() => setFilter(id)} className={clsx('rounded-lg border bg-white px-3 py-2.5 text-start shadow-sm transition', filter === id ? 'border-brand-600 ring-1 ring-brand-600' : 'border-slate-200 hover:border-slate-300')}>
            <div className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
              <span className={clsx('h-2 w-2 rounded-full', dot)} />
              {label}
            </div>
            <div className="mt-0.5 text-2xl font-semibold text-slate-900">{value}</div>
          </button>
        ))}
      </div>
      <div className="mb-3 sm:hidden">
        <Segmented value={filter} onChange={setFilter} options={[{ id: 'all', label: t('common.all') }, { id: 'waiting', label: t('infusion.waiting') }, { id: 'treatment', label: t('infusion.inTreatment') }]} />
      </div>
      {cards.length === 0 ? (
        <Card>
          <EmptyState icon={<Activity className="h-10 w-10" />} title={t('dashboard.noAppointments')} />
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
          {cards.map((c: any) => {
            const a = c.appointment;
            const o = c.order;
            const running = c.administrations.find((x: any) => x.status === 'IN_PROGRESS' || x.status === 'PAUSED');
            const crit = c.warnings.filter((w: any) => w.severity === 'CRITICAL');
            const warn = c.warnings.filter((w: any) => w.severity === 'WARNING');
            const group = GROUP[a.status];
            const inactive = ['CANCELLED', 'NO_SHOW'].includes(a.status);
            return (
              <Card key={a.id} className={clsx('flex flex-col border-t-4', ACCENT[group], inactive && 'opacity-60')}>
                <div className="flex items-start justify-between gap-3 p-4 pb-2">
                  <div className="min-w-0">
                    <button onClick={() => navigate(`/patients/${a.patient_id}`)} className="block truncate text-start text-base font-bold uppercase tracking-wide text-slate-900 hover:text-brand-800">
                      {patientName(a, lang)}
                    </button>
                    <div className="ltr-nums text-xs text-slate-500">{a.mrn}</div>
                  </div>
                  <div className="text-end">
                    <div className="ltr-nums text-lg font-semibold text-slate-900">{hhmm(a.start_time)}</div>
                    <div className="text-xs font-medium text-slate-600">{a.chair_name ?? t('appointments.noChair')}</div>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 px-4">
                  <span className="text-sm font-semibold text-slate-800">{o?.protocol_name ?? a.protocol_name ?? '—'}</span>
                  {(o || a.cycle_number) && (
                    <Badge tone="slate" className="ltr-nums">
                      C{o?.cycle_number ?? a.cycle_number}D{o?.day_number ?? a.day_number}
                    </Badge>
                  )}
                  {a.protocol_is_demo && <Badge tone="amber">DEMO</Badge>}
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2 px-4">
                  <StatusBadge kind="appointment" status={a.status} />
                  {o ? <StatusBadge kind="order" status={o.status} /> : <Badge tone="red">{t('infusion.noOrder')}</Badge>}
                  {o && ['DRAFT', 'PENDING_REVIEW'].includes(o.status) && <Badge tone="red">{t('infusion.notApproved')}</Badge>}
                </div>
                {(crit.length > 0 || warn.length > 0) && (
                  <div className="mt-2 space-y-1 px-4">
                    {crit.slice(0, 2).map((w: any, i: number) => (
                      <div key={i} className="flex items-start gap-1.5 text-xs font-medium text-rose-700">
                        <AlertOctagon className="mt-0.5 h-3.5 w-3.5 shrink-0" /> <span className="line-clamp-2">{warningText(w, t, lang)}</span>
                      </div>
                    ))}
                    {warn.length > 0 && (
                      <div className="flex items-center gap-1.5 text-xs text-amber-800">
                        <AlertTriangle className="h-3.5 w-3.5" /> {warn.length} {t('warnings.severity.WARNING').toLowerCase()}
                      </div>
                    )}
                  </div>
                )}
                {c.administrations.length > 0 && (
                  <div className="mt-3 space-y-1.5 border-t border-slate-100 px-4 pt-2">
                    {c.administrations.map((x: any) => (
                      <div key={x.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 text-xs">
                        <span className={clsx('truncate', x.status === 'COMPLETED' ? 'text-slate-400 line-through' : 'text-slate-700')}>{x.drug_name}</span>
                        <StatusBadge kind="admin" status={x.status} />
                        {x === running && (
                          <div className="col-span-2">
                            <InfusionTimer a={x} compact />
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                <div className="mt-auto flex flex-wrap gap-1.5 p-4 pt-3">
                  {o && (
                    <Button size="sm" icon={<ClipboardList className="h-4 w-4" />} onClick={() => navigate(`/orders/${o.id}`)}>
                      {t('infusion.openOrder')}
                    </Button>
                  )}
                  {can('appointments.checkin') && ['SCHEDULED', 'CONFIRMED', 'NEEDS_RESCHEDULING'].includes(a.status) && (
                    <Button size="sm" icon={<LogIn className="h-4 w-4 rtl:rotate-180" />} loading={act.isPending} onClick={() => act.mutate({ url: `/appointments/${a.id}/check-in` })}>
                      {t('infusion.checkIn')}
                    </Button>
                  )}
                  {can('orders.nursing') && o && ['APPROVED', 'READY_FOR_PREPARATION', 'PREPARED', 'READY_FOR_ADMINISTRATION'].includes(o.status) && (
                    <Button
                      size="sm"
                      variant="primary"
                      icon={<PlayCircle className="h-4 w-4" />}
                      loading={act.isPending}
                      onClick={() => (o.status === 'READY_FOR_ADMINISTRATION' ? act.mutate({ url: `/orders/${o.id}/start` }) : navigate(`/orders/${o.id}`))}
                    >
                      {t('infusion.startTreatment')}
                    </Button>
                  )}
                  {can('orders.nursing') && o?.status === 'IN_PROGRESS' && running?.status === 'IN_PROGRESS' && (
                    <Button size="sm" variant="warning" icon={<Pause className="h-4 w-4" />} loading={act.isPending} onClick={() => act.mutate({ url: `/administrations/${running.id}/pause` })}>
                      {t('infusion.pause')}
                    </Button>
                  )}
                  {can('orders.nursing') && o?.status === 'IN_PROGRESS' && (
                    <Button size="sm" variant="success" icon={<CheckCircle2 className="h-4 w-4" />} onClick={() => navigate(`/orders/${o.id}?action=complete`)}>
                      {t('infusion.complete')}
                    </Button>
                  )}
                  {can('events.report') && o && ['READY_FOR_ADMINISTRATION', 'IN_PROGRESS'].includes(o.status) && (
                    <Button size="sm" variant="ghost" icon={<Siren className="h-4 w-4" />} onClick={() => navigate(`/orders/${o.id}?action=event`)}>
                      {t('infusion.reportEvent')}
                    </Button>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
