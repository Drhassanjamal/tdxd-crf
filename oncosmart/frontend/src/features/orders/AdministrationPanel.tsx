import clsx from 'clsx';
import { Ban, CheckCircle2, Pause, Play, Square, Timer } from 'lucide-react';
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { StatusBadge } from '../../components/StatusBadge';
import { Button, Card, CardHeader, Checkbox, ErrorBox, Field, Input, Modal, Textarea } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { useNow } from '../../hooks/useNow';
import { useI18n } from '../../i18n/I18nProvider';
import { api } from '../../services/api';
import { fmtClock, fmtNum, fmtTime } from '../../utils/format';

/** Computes infusion timer values, accounting for paused time. */
export function timerState(a: any, now: number) {
  if (!a.start_time) return null;
  const start = new Date(a.start_time).getTime();
  const end = a.end_time ? new Date(a.end_time).getTime() : null;
  const pausedNow = a.paused_at ? Math.max(0, (now - new Date(a.paused_at).getTime()) / 1000) : 0;
  const pausedTotal = (a.total_paused_seconds ?? 0) + pausedNow;
  const reference = end ?? now;
  const elapsed = Math.max(0, (reference - start) / 1000 - pausedTotal);
  const planned = (a.planned_duration_min ?? 0) * 60;
  const remaining = planned ? planned - elapsed : null;
  const expectedEnd = planned ? new Date(start + (planned + pausedTotal) * 1000) : null;
  const pct = planned ? Math.min(100, (elapsed / planned) * 100) : null;
  return { elapsed, remaining, expectedEnd, pct, overdue: remaining !== null && remaining < 0 && !end };
}

export function InfusionTimer({ a, compact }: { a: any; compact?: boolean }) {
  const { t } = useI18n();
  const now = useNow(1000);
  const s = timerState(a, now);
  if (!s) return <span className="text-xs text-slate-400">—</span>;
  return (
    <div className={clsx('min-w-[180px]', compact && 'min-w-0')}>
      {s.pct !== null && (
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-blue-100">
          <div className={clsx('h-full rounded-full', a.status === 'PAUSED' ? 'bg-amber-500' : s.overdue ? 'bg-orange-500' : a.status === 'COMPLETED' ? 'bg-emerald-500' : 'bg-blue-600')} style={{ width: `${s.pct}%` }} />
        </div>
      )}
      <div className="mt-1 flex flex-wrap gap-x-3 text-2xs text-slate-600 ltr-nums">
        <span>
          {t('orders.elapsed')} <b className="tabular text-slate-900">{fmtClock(s.elapsed)}</b>
        </span>
        {s.remaining !== null && !a.end_time && (
          <span className={clsx(s.overdue && 'font-semibold text-orange-700')}>
            {t('orders.remaining')} <b className="tabular">{s.overdue ? `+${fmtClock(-s.remaining)}` : fmtClock(s.remaining)}</b>
          </span>
        )}
        {s.expectedEnd && !a.end_time && (
          <span>
            {t('orders.expectedEnd')} <b>{fmtTime(s.expectedEnd.toISOString())}</b>
          </span>
        )}
      </div>
    </div>
  );
}

export function AdministrationPanel({ detail, onChanged, canAct }: { detail: any; onChanged: () => void; canAct: boolean }) {
  const { t } = useI18n();
  const toast = useToast();
  const [ending, setEnding] = useState<any>(null);
  const [notGiven, setNotGiven] = useState<{ a: any; mode: 'not_given' | 'stop' } | null>(null);
  const act = useMutation({
    mutationFn: ({ id, action, body }: { id: string; action: string; body?: any }) => api.post(`/administrations/${id}/${action}`, body ?? {}),
    onSuccess: () => onChanged(),
    onError: (e) => toast.error(e),
  });
  const orderStatus = detail.order.status;
  const itemsById = Object.fromEntries(detail.items.map((i: any) => [i.id, i]));
  return (
    <Card>
      <CardHeader title={t('orders.administration')} subtitle={t('orders.continuousInfusionNote')} icon={<Timer className="h-4 w-4" />} />
      <div className="divide-y divide-slate-100">
        {detail.administrations.map((a: any) => {
          const item = itemsById[a.treatment_order_item_id] ?? {};
          const ciOpen = orderStatus === 'COMPLETED' && item.administration_method === 'CONTINUOUS_INFUSION' && a.status === 'IN_PROGRESS';
          const live = canAct && (orderStatus === 'IN_PROGRESS' || ciOpen);
          return (
            <div key={a.id} className="grid gap-3 px-4 py-3 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_auto] md:items-center">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-semibold text-slate-400 ltr-nums">#{a.sequence}</span>
                  <span className="font-semibold text-slate-900">{a.drug_name}</span>
                  <StatusBadge kind="admin" status={a.status} />
                </div>
                <div className="mt-0.5 text-xs text-slate-600 ltr-nums">
                  {fmtNum(a.planned_dose)} mg · {a.route} · {a.diluent ?? t('app.notConfigured')} {a.volume_ml ? `· ${a.volume_ml} mL` : ''} · {a.planned_duration_min ? `${a.planned_duration_min} ${t('common.minutes')}` : 'bolus'}
                </div>
                {(a.start_time || a.end_time) && (
                  <div className="mt-0.5 text-2xs text-slate-500 ltr-nums">
                    {t('orders.started')} {fmtTime(a.start_time)} {a.started_by_name && `(${a.started_by_name})`} {a.end_time && `· ${t('orders.ended')} ${fmtTime(a.end_time)}`}{' '}
                    {a.dose_administered && `· ${fmtNum(a.dose_administered)} mg`}
                  </div>
                )}
                {a.reaction && <div className="mt-0.5 text-xs font-medium text-rose-700">⚠ {a.reaction_details}</div>}
                {a.not_given_reason && <div className="mt-0.5 text-xs text-slate-500">{a.not_given_reason}</div>}
                {a.notes && <div className="mt-0.5 text-xs text-slate-500">{a.notes}</div>}
              </div>
              <InfusionTimer a={a} />
              {live && (
                <div className="flex flex-wrap gap-1.5">
                  {a.status === 'NOT_STARTED' && (
                    <>
                      <Button size="sm" variant="primary" icon={<Play className="h-4 w-4" />} loading={act.isPending} onClick={() => act.mutate({ id: a.id, action: 'start' })}>
                        {t('orders.startInfusion')}
                      </Button>
                      <Button size="sm" variant="ghost" icon={<Ban className="h-4 w-4" />} onClick={() => setNotGiven({ a, mode: 'not_given' })}>
                        {t('orders.notGiven')}
                      </Button>
                    </>
                  )}
                  {a.status === 'IN_PROGRESS' && (
                    <Button size="sm" variant="warning" icon={<Pause className="h-4 w-4" />} loading={act.isPending} onClick={() => act.mutate({ id: a.id, action: 'pause' })}>
                      {t('orders.pause')}
                    </Button>
                  )}
                  {a.status === 'PAUSED' && (
                    <Button size="sm" variant="primary" icon={<Play className="h-4 w-4" />} loading={act.isPending} onClick={() => act.mutate({ id: a.id, action: 'resume' })}>
                      {t('orders.resumeInfusion')}
                    </Button>
                  )}
                  {['IN_PROGRESS', 'PAUSED'].includes(a.status) && (
                    <>
                      <Button size="sm" variant="success" icon={<CheckCircle2 className="h-4 w-4" />} onClick={() => setEnding(a)}>
                        {t('orders.completeInfusion')}
                      </Button>
                      <Button size="sm" variant="ghost" icon={<Square className="h-4 w-4" />} onClick={() => setNotGiven({ a, mode: 'stop' })}>
                        {t('orders.stop')}
                      </Button>
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <EndInfusionModal a={ending} onClose={() => setEnding(null)} onDone={onChanged} />
      <ReasonActionModal target={notGiven} onClose={() => setNotGiven(null)} onDone={onChanged} />
    </Card>
  );
}

function EndInfusionModal({ a, onClose, onDone }: { a: any; onClose: () => void; onDone: () => void }) {
  const { t } = useI18n();
  const [dose, setDose] = useState('');
  const [reaction, setReaction] = useState(false);
  const [details, setDetails] = useState('');
  const [observations, setObservations] = useState('');
  const m = useMutation({
    mutationFn: () =>
      api.post(`/administrations/${a.id}/complete`, {
        doseAdministered: Number(dose || a.planned_dose),
        reaction,
        reactionDetails: reaction ? details : null,
        observations: observations || null,
      }),
    onSuccess: () => {
      onDone();
      onClose();
    },
  });
  if (!a) return null;
  return (
    <Modal
      open={!!a}
      onClose={onClose}
      title={`${t('orders.completeInfusion')} — ${a.drug_name}`}
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="success" loading={m.isPending} onClick={() => m.mutate()}>
            {t('common.confirm')}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label={t('orders.doseAdministered')} hint={`${t('orders.final')}: ${fmtNum(a.planned_dose)} mg`}>
          <Input type="number" step="any" placeholder={String(a.planned_dose)} value={dose} onChange={(e) => setDose(e.target.value)} />
        </Field>
        <Field label={t('orders.observations')}>
          <Textarea value={observations} onChange={(e) => setObservations(e.target.value)} />
        </Field>
        <Checkbox checked={reaction} onChange={setReaction} label={t('orders.reactionOccurred')} />
        {reaction && (
          <Field label={t('orders.reactionDetails')} required>
            <Textarea value={details} onChange={(e) => setDetails(e.target.value)} />
          </Field>
        )}
        <ErrorBox error={m.error} />
      </div>
    </Modal>
  );
}

function ReasonActionModal({ target, onClose, onDone }: { target: { a: any; mode: 'not_given' | 'stop' } | null; onClose: () => void; onDone: () => void }) {
  const { t } = useI18n();
  const [reason, setReason] = useState('');
  const m = useMutation({
    mutationFn: () => api.post(`/administrations/${target!.a.id}/${target!.mode}`, { reason }),
    onSuccess: () => {
      setReason('');
      onDone();
      onClose();
    },
  });
  if (!target) return null;
  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title={`${target.mode === 'stop' ? t('orders.stop') : t('orders.notGiven')} — ${target.a.drug_name}`}
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="danger" loading={m.isPending} disabled={reason.trim().length < 3} onClick={() => m.mutate()}>
            {t('common.confirm')}
          </Button>
        </>
      }
    >
      <Field label={t('common.reason')} required>
        <Textarea value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
      <div className="mt-2">
        <ErrorBox error={m.error} />
      </div>
    </Modal>
  );
}
