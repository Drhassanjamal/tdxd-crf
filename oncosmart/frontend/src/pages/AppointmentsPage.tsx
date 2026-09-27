import clsx from 'clsx';
import { CalendarDays, ChevronLeft, ChevronRight, MessageCircle, Plus, RefreshCw } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { StatusBadge, statusTone } from '../components/StatusBadge';
import { Badge, Button, Card, EmptyState, Input, PageHeader, Segmented, Select, Spinner, Table, td, th } from '../components/ui';
import { useToast } from '../components/Toast';
import { AppointmentDetailModal, MessageCard } from '../features/appointments/AppointmentDetailModal';
import { AppointmentFormModal } from '../features/appointments/AppointmentFormModal';
import { useAuth } from '../hooks/useAuth';
import { useChairs, useSettings } from '../hooks/useSettings';
import { useI18n } from '../i18n/I18nProvider';
import { api, qs } from '../services/api';
import { addDays, fmtDate, fmtDateTime, hhmm, minutesToTime, patientName, timeToMinutes, todayLocal } from '../utils/format';
import type { Appointment } from '../types';

type View = 'day' | 'week' | 'month' | 'list' | 'messages';

const BLOCK: Record<string, string> = {
  slate: 'border-slate-300 bg-slate-50 text-slate-800',
  teal: 'border-teal-300 bg-teal-50 text-teal-900',
  orange: 'border-orange-300 bg-orange-50 text-orange-900',
  amber: 'border-amber-300 bg-amber-50 text-amber-900',
  violet: 'border-violet-300 bg-violet-50 text-violet-900',
  blue: 'border-blue-300 bg-blue-50 text-blue-900',
  green: 'border-emerald-300 bg-emerald-50 text-emerald-900',
  red: 'border-rose-200 bg-rose-50/60 text-rose-800 line-through',
  sky: 'border-sky-300 bg-sky-50 text-sky-900',
};

function weekStart(date: string) {
  // Week starts on Saturday (Iraqi working week Sat–Thu)
  const [y, m, d] = date.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=Sun … 6=Sat
  return addDays(date, -((dow + 1) % 7));
}

function monthGrid(date: string) {
  const first = `${date.slice(0, 8)}01`;
  const start = weekStart(first);
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

export function AppointmentsPage() {
  const { t, lang } = useI18n();
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const settings = useSettings();
  const [view, setView] = useState<View>((params.get('view') as View) || 'day');
  const [date, setDate] = useState(params.get('date') || todayLocal());
  const [openId, setOpenId] = useState<string | null>(params.get('open'));
  const [creating, setCreating] = useState<any>(null);

  const range = useMemo(() => {
    if (view === 'week') return { from: weekStart(date), to: addDays(weekStart(date), 6) };
    if (view === 'month') {
      const g = monthGrid(date);
      return { from: g[0], to: g[41] };
    }
    if (view === 'list') return { from: date, to: addDays(date, 13) };
    return { from: date, to: date };
  }, [view, date]);
  const q = useQuery({
    queryKey: ['appointments', range.from, range.to],
    queryFn: () => api.get<Appointment[]>(`/appointments${qs(range)}`),
    enabled: view !== 'messages',
    refetchInterval: 30_000,
  });
  const chairs = useChairs(date);

  const shift = (dir: number) => {
    const step = view === 'week' ? 7 : view === 'month' ? 0 : view === 'list' ? 14 : 1;
    if (view === 'month') {
      const [y, m] = date.split('-').map(Number);
      const nd = new Date(Date.UTC(y, m - 1 + dir, 1)).toISOString().slice(0, 10);
      setDate(nd);
    } else setDate(addDays(date, dir * step));
  };
  const closeDetail = () => {
    setOpenId(null);
    if (params.get('open')) {
      params.delete('open');
      setParams(params, { replace: true });
    }
  };

  const s = settings.data?.settings;
  const dayAppts = (q.data ?? []).filter((a) => a.appointment_date === date);
  const earliest = Math.min(...dayAppts.map((a) => timeToMinutes(a.start_time)), 24 * 60);
  const latest = Math.max(...dayAppts.map((a) => timeToMinutes(a.start_time) + a.duration_minutes), 0);
  const dayStart = Math.floor(Math.min(timeToMinutes(s?.unit_open_time ?? '08:00') - 60, earliest) / 60) * 60;
  const dayEnd = Math.min(24 * 60, Math.ceil(Math.max(timeToMinutes(s?.unit_close_time ?? '16:00') + 180, latest) / 60) * 60);
  const PX = 1.15;
  const byDate = (d: string) => (q.data ?? []).filter((a) => a.appointment_date === d);

  return (
    <div>
      <PageHeader
        icon={<CalendarDays className="h-5 w-5" />}
        title={t('appointments.title')}
        actions={
          can('appointments.write') && (
            <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setCreating({ appointmentDate: date })}>
              {t('appointments.new')}
            </Button>
          )
        }
      />
      <Card className="mb-3 flex flex-wrap items-center gap-2 p-2.5">
        <Segmented
          value={view}
          onChange={setView}
          options={[
            { id: 'day', label: t('appointments.dayView') },
            { id: 'week', label: t('appointments.weekView') },
            { id: 'month', label: t('appointments.monthView') },
            { id: 'list', label: t('appointments.listView') },
            { id: 'messages', label: t('appointments.messages') },
          ]}
        />
        {view !== 'messages' && (
          <div className="flex items-center gap-1">
            <Button size="sm" variant="ghost" onClick={() => shift(-1)} aria-label={t('common.previous')}>
              <ChevronLeft className="h-4 w-4 rtl:rotate-180" />
            </Button>
            <Button size="sm" onClick={() => setDate(todayLocal())}>
              {t('common.today')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => shift(1)} aria-label={t('common.next')}>
              <ChevronRight className="h-4 w-4 rtl:rotate-180" />
            </Button>
            <Input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} className="w-40" />
            <span className="ms-2 whitespace-nowrap text-sm font-semibold text-slate-700">
              {view === 'month'
                ? fmtDate(date, lang, { month: 'long', year: 'numeric' })
                : view === 'week'
                  ? `${fmtDate(range.from, lang, { day: 'numeric', month: 'short' })} – ${fmtDate(range.to, lang)}`
                  : fmtDate(date, lang, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
            </span>
          </div>
        )}
        {q.isFetching && <Spinner className="ms-auto h-4 w-4" />}
      </Card>

      {view === 'day' && (
        <Card className="overflow-x-auto">
          <div className="min-w-[860px]">
            <div className="grid border-b border-slate-200 bg-slate-50" style={{ gridTemplateColumns: `64px repeat(${(chairs.data?.filter((c) => c.is_active).length ?? 6) + 1}, minmax(0,1fr))` }}>
              <div />
              {chairs.data?.filter((c) => c.is_active).map((c) => (
                <div key={c.id} className="border-s border-slate-200 px-2 py-2 text-center">
                  <div className="text-sm font-semibold text-slate-800">{c.name}</div>
                  {date === todayLocal() && <StatusBadge kind="chair" status={c.status} />}
                </div>
              ))}
              <div className="border-s border-slate-200 px-2 py-2 text-center text-sm font-semibold text-slate-500">{t('appointments.noChair')}</div>
            </div>
            <div className="relative grid" style={{ gridTemplateColumns: `64px repeat(${(chairs.data?.filter((c) => c.is_active).length ?? 6) + 1}, minmax(0,1fr))`, height: (dayEnd - dayStart) * PX }}>
              <div className="relative">
                {Array.from({ length: Math.ceil((dayEnd - dayStart) / 60) }, (_, i) => (
                  <div key={i} className="absolute end-2 text-2xs text-slate-400 ltr-nums" style={{ top: i * 60 * PX - 6 }}>
                    {minutesToTime(dayStart + i * 60)}
                  </div>
                ))}
              </div>
              {[...(chairs.data?.filter((c) => c.is_active) ?? []), { id: null }].map((c: any) => (
                <div key={c.id ?? 'none'} className="relative border-s border-slate-200">
                  {Array.from({ length: Math.ceil((dayEnd - dayStart) / 60) }, (_, i) => (
                    <div key={i} className="absolute inset-x-0 border-t border-slate-100" style={{ top: i * 60 * PX }} />
                  ))}
                  {byDate(date)
                    .filter((a) => (a.chair_id ?? null) === c.id)
                    .map((a) => {
                      const top = (timeToMinutes(a.start_time) - dayStart) * PX;
                      const h = Math.max(28, a.duration_minutes * PX - 2);
                      return (
                        <button
                          key={a.id}
                          onClick={() => setOpenId(a.id)}
                          className={clsx('absolute inset-x-1 flex flex-col justify-start overflow-hidden rounded-md border px-1.5 py-1 text-start text-xs shadow-sm hover:z-10 hover:shadow-md', BLOCK[statusTone('appointment', a.status)], a.status === 'CANCELLED' && 'opacity-70')}
                          style={{ top, height: h }}
                          title={`${hhmm(a.start_time)} ${patientName(a, lang)}`}
                        >
                          <div className="flex items-center justify-between gap-1">
                            <span className="ltr-nums font-semibold">{hhmm(a.start_time)}</span>
                            {a.whatsapp_status && <MessageCircle className={clsx('h-3 w-3', a.patient_response === 'CONFIRM' ? 'text-emerald-600' : a.whatsapp_status === 'FAILED' ? 'text-rose-600' : 'text-slate-400')} />}
                          </div>
                          <div className="truncate font-medium">{patientName(a, lang)}</div>
                          {h > 44 && (
                            <div className="truncate opacity-80">
                              {a.protocol_name ?? t(`appointments.types.${a.appointment_type}`)} {a.cycle_number ? `· C${a.cycle_number}D${a.day_number}` : ''}
                            </div>
                          )}
                          {h > 62 && <div className="mt-0.5 truncate text-2xs">{t(`status.appointment.${a.status}`)}</div>}
                        </button>
                      );
                    })}
                </div>
              ))}
            </div>
          </div>
        </Card>
      )}

      {view === 'week' && (
        <div className="grid gap-2 md:grid-cols-7">
          {Array.from({ length: 7 }, (_, i) => addDays(range.from, i)).map((d) => (
            <Card key={d} className={clsx('min-h-[160px]', d === todayLocal() && 'ring-2 ring-brand-500')}>
              <button onClick={() => { setDate(d); setView('day'); }} className="flex w-full items-center justify-between border-b border-slate-100 px-2.5 py-1.5 text-start hover:bg-slate-50">
                <span className="text-xs font-semibold text-slate-700">{fmtDate(d, lang, { weekday: 'short', day: 'numeric', month: 'short' })}</span>
                <Badge>{byDate(d).filter((a) => a.status !== 'CANCELLED').length}</Badge>
              </button>
              <div className="space-y-1 p-1.5">
                {byDate(d).map((a) => (
                  <button key={a.id} onClick={() => setOpenId(a.id)} className={clsx('w-full rounded border px-1.5 py-1 text-start text-xs', BLOCK[statusTone('appointment', a.status)])}>
                    <div className="flex justify-between gap-1">
                      <span className="ltr-nums font-semibold">{hhmm(a.start_time)}</span>
                      <span className="truncate opacity-75">{a.chair_name ?? ''}</span>
                    </div>
                    <div className="truncate">{patientName(a, lang)}</div>
                  </button>
                ))}
              </div>
            </Card>
          ))}
        </div>
      )}

      {view === 'month' && (
        <Card className="overflow-hidden">
          <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50">
            {monthGrid(date).slice(0, 7).map((d) => (
              <div key={d} className="px-2 py-1.5 text-center text-2xs font-semibold uppercase text-slate-500">
                {fmtDate(d, lang, { weekday: 'short' })}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {monthGrid(date).map((d) => {
              const list = byDate(d).filter((a) => a.status !== 'CANCELLED');
              const inMonth = d.slice(0, 7) === date.slice(0, 7);
              return (
                <button key={d} onClick={() => { setDate(d); setView('day'); }} className={clsx('min-h-[92px] border-b border-e border-slate-100 p-1.5 text-start align-top hover:bg-slate-50', !inMonth && 'bg-slate-50/60 text-slate-400', d === todayLocal() && 'bg-brand-50/60')}>
                  <div className="flex items-center justify-between">
                    <span className="ltr-nums text-xs font-semibold">{Number(d.slice(8))}</span>
                    {list.length > 0 && <Badge tone="blue">{list.length}</Badge>}
                  </div>
                  <div className="mt-1 space-y-0.5">
                    {list.slice(0, 3).map((a) => (
                      <div key={a.id} className="truncate text-2xs text-slate-600">
                        <span className="ltr-nums">{hhmm(a.start_time)}</span> {patientName(a, lang)}
                      </div>
                    ))}
                    {list.length > 3 && <div className="text-2xs text-slate-400">+{list.length - 3}</div>}
                  </div>
                </button>
              );
            })}
          </div>
        </Card>
      )}

      {view === 'list' && (
        <Card>
          {!q.data?.length ? (
            <EmptyState title={t('common.noResults')} />
          ) : (
            <Table>
              <thead className="bg-slate-50">
                <tr>
                  {['common.date', 'common.time', 'common.patient', 'common.protocol', 'common.cycle', 'common.chair', 'common.physician', 'appointments.whatsapp', 'common.status'].map((k) => (
                    <th key={k} className={th}>
                      {t(k)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {q.data.map((a) => (
                  <tr key={a.id} className="cursor-pointer hover:bg-slate-50" onClick={() => setOpenId(a.id)}>
                    <td className={clsx(td, 'whitespace-nowrap')}>{fmtDate(a.appointment_date, lang, { weekday: 'short', day: '2-digit', month: 'short' })}</td>
                    <td className={clsx(td, 'ltr-nums')}>{hhmm(a.start_time)}</td>
                    <td className={td}>
                      <div className="font-medium text-slate-900">{patientName(a, lang)}</div>
                      <div className="ltr-nums text-xs text-slate-500">{a.mrn}</div>
                    </td>
                    <td className={td}>{a.protocol_name ?? t(`appointments.types.${a.appointment_type}`)}</td>
                    <td className={clsx(td, 'ltr-nums')}>{a.cycle_number ? `C${a.cycle_number}D${a.day_number}` : '—'}</td>
                    <td className={td}>{a.chair_name ?? '—'}</td>
                    <td className={clsx(td, 'whitespace-nowrap')}>{a.physician_name ?? '—'}</td>
                    <td className={td}>
                      {a.whatsapp_status ? <StatusBadge kind="message" status={a.whatsapp_status} /> : '—'}
                      {a.patient_response && <div className="mt-0.5 text-2xs text-violet-700">{t(`appointments.responses.${a.patient_response}`)}</div>}
                    </td>
                    <td className={td}>
                      <StatusBadge kind="appointment" status={a.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      )}

      {view === 'messages' && <MessageQueue />}

      <AppointmentDetailModal id={openId} onClose={closeDetail} />
      <AppointmentFormModal open={!!creating} onClose={() => setCreating(null)} prefill={creating ?? undefined} onSaved={(a) => setOpenId(a.id)} />
    </div>
  );
}

function MessageQueue() {
  const { t, lang } = useI18n();
  const { can } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [status, setStatus] = useState('');
  const [type, setType] = useState('');
  const [selected, setSelected] = useState<any>(null);
  const q = useQuery({ queryKey: ['notifications', status, type], queryFn: () => api.get<any[]>(`/notifications${qs({ status, type })}`), refetchInterval: 8000 });
  const process = useMutation({
    mutationFn: () => api.post('/notifications/process'),
    onSuccess: (r) => {
      toast.success(`${r.processed} processed`);
      qc.invalidateQueries({ queryKey: ['notifications'] });
    },
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ['notifications'] });
  return (
    <div className="grid gap-3 lg:grid-cols-5">
      <Card className="lg:col-span-3">
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-3">
          <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-40">
            <option value="">{t('common.status')}: {t('common.all')}</option>
            {['PENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'CANCELLED'].map((s) => (
              <option key={s} value={s}>
                {t(`status.message.${s}`)}
              </option>
            ))}
          </Select>
          <Select value={type} onChange={(e) => setType(e.target.value)} className="w-48">
            <option value="">{t('common.type')}: {t('common.all')}</option>
            {['APPOINTMENT_CREATED', 'APPOINTMENT_RESCHEDULED', 'APPOINTMENT_CANCELLED', 'REMINDER_24H', 'REMINDER_2H', 'REMINDER_SAME_DAY', 'MANUAL_REMINDER'].map((s) => (
              <option key={s} value={s}>
                {t(`appointments.notificationTypes.${s}`)}
              </option>
            ))}
          </Select>
          {can('notifications.send') && (
            <Button size="sm" className="ms-auto" icon={<RefreshCw className="h-4 w-4" />} loading={process.isPending} onClick={() => process.mutate()}>
              {t('appointments.processNow')}
            </Button>
          )}
        </div>
        <p className="border-b border-slate-100 bg-emerald-50 px-3 py-1.5 text-xs text-emerald-800">{t('appointments.mockNotice')}</p>
        {q.isLoading ? (
          <div className="flex justify-center p-8">
            <Spinner />
          </div>
        ) : (
          <Table>
            <thead className="bg-slate-50">
              <tr>
                {['appointments.scheduledFor', 'common.patient', 'common.type', 'appointments.recipient', 'common.status', 'appointments.patientResponse'].map((k) => (
                  <th key={k} className={th}>
                    {t(k)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {q.data?.map((n) => (
                <tr key={n.id} className={clsx('cursor-pointer hover:bg-slate-50', selected?.id === n.id && 'bg-brand-50/60')} onClick={() => setSelected(n)}>
                  <td className={clsx(td, 'ltr-nums whitespace-nowrap')}>{fmtDateTime(n.scheduled_for, lang)}</td>
                  <td className={td}>
                    <div className="font-medium">{n.patient_name}</div>
                    <div className="ltr-nums text-xs text-slate-500">{n.appointment_number}</div>
                  </td>
                  <td className={clsx(td, 'whitespace-nowrap')}>{t(`appointments.notificationTypes.${n.notification_type}`)}</td>
                  <td className={clsx(td, 'ltr-nums whitespace-nowrap text-xs')}>{n.recipient ?? '—'}</td>
                  <td className={td}>
                    <StatusBadge kind="message" status={n.status} />
                  </td>
                  <td className={td}>{n.patient_response ? <Badge tone="violet">{t(`appointments.responses.${n.patient_response}`)}</Badge> : '—'}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      <div className="lg:col-span-2">
        {selected ? (
          <div className="lg:sticky lg:top-20">
            <MessageCard n={q.data?.find((x) => x.id === selected.id) ?? selected} onChanged={refresh} allowSimulate={can('notifications.send')} />
          </div>
        ) : (
          <Card>
            <EmptyState icon={<MessageCircle className="h-9 w-9" />} title={t('appointments.messageQueue')} />
          </Card>
        )}
      </div>
    </div>
  );
}
