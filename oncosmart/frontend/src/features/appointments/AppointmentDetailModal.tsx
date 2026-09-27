import { Ban, Bell, CalendarClock, CheckCheck, LogIn, MessageCircle, Printer, UserX } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { StatusBadge } from '../../components/StatusBadge';
import { Badge, Button, ErrorBox, Field, InfoRow, Modal, Spinner, Textarea } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { useAuth } from '../../hooks/useAuth';
import { useI18n } from '../../i18n/I18nProvider';
import { api } from '../../services/api';
import { fmtDate, fmtDateTime, hhmm, patientName, todayLocal } from '../../utils/format';
import { AppointmentFormModal } from './AppointmentFormModal';

export function MessageCard({ n, onChanged, allowSimulate }: { n: any; onChanged: () => void; allowSimulate: boolean }) {
  const { t, lang } = useI18n();
  const toast = useToast();
  const sim = useMutation({
    mutationFn: (event: string) => api.post(`/notifications/${n.id}/simulate`, { event }),
    onSuccess: () => {
      toast.success(t('common.success'));
      onChanged();
    },
    onError: (e) => toast.error(e),
  });
  const retry = useMutation({ mutationFn: () => api.post(`/notifications/${n.id}/retry`), onSuccess: onChanged, onError: (e) => toast.error(e) });
  const options = n.interactive_options?.options ?? [];
  const delivered = ['SENT', 'DELIVERED', 'READ'].includes(n.status);
  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <MessageCircle className="h-4 w-4 text-emerald-600" />
        <span className="font-semibold text-slate-700">{t(`appointments.notificationTypes.${n.notification_type}`)}</span>
        <StatusBadge kind="message" status={n.status} />
        {n.patient_response && <Badge tone="violet">{t(`appointments.responses.${n.patient_response}`)}</Badge>}
        <span className="ltr-nums ms-auto text-slate-500">{fmtDateTime(n.scheduled_for, lang)}</span>
      </div>
      <div className="mt-2 whitespace-pre-wrap rounded-md bg-[#e7fbe5] px-3 py-2 text-sm text-slate-800" dir={n.language === 'ar' ? 'rtl' : 'ltr'}>
        {n.message_body}
      </div>
      {options.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1.5" dir={n.language === 'ar' ? 'rtl' : 'ltr'}>
          {options.map((o: any) => (
            <span key={o.id} className="rounded-full border border-emerald-300 bg-white px-2.5 py-0.5 text-xs text-emerald-700">
              {o.title}
            </span>
          ))}
        </div>
      )}
      <div className="mt-1.5 text-2xs text-slate-500 ltr-nums">
        {n.recipient ?? '—'} · {n.provider} {n.failure_reason && <span className="text-rose-600">· {n.failure_reason}</span>}
      </div>
      {allowSimulate && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-dashed border-slate-200 pt-2">
          <span className="text-2xs font-semibold uppercase text-slate-400">{t('appointments.simulate')}</span>
          {n.status === 'SENT' && <Button size="xs" onClick={() => sim.mutate('DELIVERED')}>{t('appointments.simulateDelivered')}</Button>}
          {['SENT', 'DELIVERED'].includes(n.status) && <Button size="xs" onClick={() => sim.mutate('READ')}>{t('appointments.simulateRead')}</Button>}
          {delivered && options.length > 0 && !n.patient_response && (
            <>
              <Button size="xs" variant="success" onClick={() => sim.mutate('CONFIRM')}>{t('appointments.simulateConfirm')}</Button>
              <Button size="xs" variant="warning" onClick={() => sim.mutate('RESCHEDULE')}>{t('appointments.simulateReschedule')}</Button>
              <Button size="xs" variant="danger" onClick={() => sim.mutate('CANCEL')}>{t('appointments.simulateCancel')}</Button>
            </>
          )}
          {delivered && <Button size="xs" variant="ghost" onClick={() => sim.mutate('FAILED')}>{t('appointments.simulateFailed')}</Button>}
          {n.status === 'FAILED' && <Button size="xs" onClick={() => retry.mutate()}>{t('appointments.retry')}</Button>}
        </div>
      )}
    </div>
  );
}

export function AppointmentDetailModal({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { t, lang } = useI18n();
  const { can } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState('');
  const q = useQuery({ queryKey: ['appointment', id], queryFn: () => api.get(`/appointments/${id}`), enabled: !!id, refetchInterval: 8000 });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['appointment', id] });
    qc.invalidateQueries({ queryKey: ['appointments'] });
    qc.invalidateQueries({ queryKey: ['notifications'] });
    qc.invalidateQueries({ queryKey: ['dashboard'] });
    qc.invalidateQueries({ queryKey: ['infusion'] });
    qc.invalidateQueries({ queryKey: ['chairs'] });
  };
  const act = useMutation({
    mutationFn: ({ url, body }: { url: string; body?: any }) => api.post(url, body),
    onSuccess: () => {
      toast.success(t('common.success'));
      refresh();
    },
    onError: (e) => toast.error(e),
  });
  if (!id) return null;
  const a = q.data;
  const open = a && ['SCHEDULED', 'CONFIRMED', 'NEEDS_RESCHEDULING'].includes(a.status);
  return (
    <>
      <Modal open={!!id && !editing} onClose={onClose} size="lg" title={a ? `${a.appointment_number} · ${patientName(a, lang)}` : t('common.loading')}>
        {!a ? (
          <div className="flex justify-center p-8">
            <Spinner />
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge kind="appointment" status={a.status} />
              {a.order_status && <StatusBadge kind="order" status={a.order_status} />}
              {a.protocol_is_demo && <Badge tone="amber">DEMO</Badge>}
            </div>
            <dl className="grid gap-3 sm:grid-cols-3">
              <InfoRow label={t('common.patient')} value={<button className="font-medium text-brand-700 hover:underline" onClick={() => navigate(`/patients/${a.patient_id}`)}>{patientName(a, lang)} · <span className="ltr-nums">{a.mrn}</span></button>} />
              <InfoRow label={t('common.date')} value={<span className="ltr-nums">{fmtDate(a.appointment_date, lang, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</span>} />
              <InfoRow label={t('common.time')} value={<span className="ltr-nums">{hhmm(a.start_time)} · {a.duration_minutes} {t('common.minutes')}</span>} />
              <InfoRow label={t('common.protocol')} value={a.protocol_name} />
              <InfoRow label={t('common.cycle')} value={a.cycle_number ? <span className="ltr-nums">C{a.cycle_number}D{a.day_number}</span> : null} />
              <InfoRow label={t('common.chair')} value={a.chair_name ?? t('appointments.noChair')} />
              <InfoRow label={t('common.physician')} value={a.physician_name} />
              <InfoRow label={t('appointments.type')} value={t(`appointments.types.${a.appointment_type}`)} />
              <InfoRow label={t('patients.phone')} value={<span className="ltr-nums">{a.phone}</span>} />
              {a.cancel_reason && <InfoRow label={t('common.reason')} value={a.cancel_reason} className="sm:col-span-3" />}
              {a.notes && <InfoRow label={t('common.notes')} value={a.notes} className="sm:col-span-3" />}
            </dl>
            <div className="flex flex-wrap gap-2">
              {open && can('appointments.write') && (
                <Button size="sm" icon={<CalendarClock className="h-4 w-4" />} onClick={() => setEditing(true)}>
                  {t('appointments.reschedule')}
                </Button>
              )}
              {open && can('appointments.checkin') && a.appointment_date === todayLocal() && (
                <Button size="sm" variant="primary" icon={<LogIn className="h-4 w-4 rtl:rotate-180" />} onClick={() => act.mutate({ url: `/appointments/${a.id}/check-in` })}>
                  {t('appointments.checkIn')}
                </Button>
              )}
              {['SCHEDULED', 'NEEDS_RESCHEDULING'].includes(a.status) && can('appointments.write') && (
                <Button size="sm" icon={<CheckCheck className="h-4 w-4" />} onClick={() => act.mutate({ url: `/appointments/${a.id}/status`, body: { status: 'CONFIRMED' } })}>
                  {t('appointments.confirmManual')}
                </Button>
              )}
              {open && can('notifications.send') && (
                <Button size="sm" icon={<Bell className="h-4 w-4" />} onClick={() => act.mutate({ url: `/appointments/${a.id}/reminder` })}>
                  {t('appointments.sendReminder')}
                </Button>
              )}
              {open && can('appointments.write') && (
                <Button size="sm" variant="ghost" icon={<UserX className="h-4 w-4" />} onClick={() => act.mutate({ url: `/appointments/${a.id}/status`, body: { status: 'NO_SHOW' } })}>
                  {t('appointments.noShow')}
                </Button>
              )}
              {open && can('appointments.write') && (
                <Button size="sm" variant="ghost" className="text-rose-700" icon={<Ban className="h-4 w-4" />} onClick={() => setCancelling(true)}>
                  {t('appointments.cancelAppointment')}
                </Button>
              )}
              <Button size="sm" variant="ghost" icon={<Printer className="h-4 w-4" />} onClick={() => window.open(`/print/appointment/${a.id}`, '_blank')}>
                {t('appointments.printSlip')}
              </Button>
              {a.treatment_order_id && can('orders.read') && (
                <Button size="sm" variant="ghost" onClick={() => navigate(`/orders/${a.treatment_order_id}`)}>
                  {t('infusion.openOrder')}
                </Button>
              )}
            </div>
            {cancelling && (
              <div className="space-y-2 rounded-lg border border-rose-200 bg-rose-50 p-3">
                <Field label={t('common.reason')} required>
                  <Textarea value={reason} onChange={(e) => setReason(e.target.value)} />
                </Field>
                <div className="flex justify-end gap-2">
                  <Button size="sm" onClick={() => setCancelling(false)}>{t('common.cancel')}</Button>
                  <Button
                    size="sm"
                    variant="danger"
                    disabled={reason.trim().length < 3}
                    loading={act.isPending}
                    onClick={() => act.mutate({ url: `/appointments/${a.id}/cancel`, body: { reason } }, { onSuccess: () => { setCancelling(false); setReason(''); } })}
                  >
                    {t('appointments.cancelAppointment')}
                  </Button>
                </div>
              </div>
            )}
            <ErrorBox error={act.error} />
            <div>
              <div className="mb-2 flex items-center justify-between">
                <h4 className="text-sm font-semibold text-slate-800">{t('appointments.whatsapp')}</h4>
                <span className="text-2xs text-slate-500">{t('appointments.mockNotice')}</span>
              </div>
              <div className="space-y-2">
                {a.notifications.length === 0 && <p className="text-sm text-slate-500">{t('common.noResults')}</p>}
                {a.notifications.map((n: any) => (
                  <MessageCard key={n.id} n={n} onChanged={refresh} allowSimulate={can('notifications.send')} />
                ))}
              </div>
            </div>
          </div>
        )}
      </Modal>
      {a && <AppointmentFormModal open={editing} onClose={() => setEditing(false)} appointment={a} onSaved={refresh} />}
    </>
  );
}
