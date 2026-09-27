import { CalendarPlus, CheckCircle2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { WarningList } from '../../components/WarningList';
import { Button, Checkbox, ErrorBox, Field, Input, Modal, Select, Textarea } from '../../components/ui';
import { useI18n } from '../../i18n/I18nProvider';
import { api } from '../../services/api';
import { fmtDate } from '../../utils/format';

export function ApproveModal({ open, onClose, detail, onDone }: { open: boolean; onClose: () => void; detail: any; onDone: () => void }) {
  const { t } = useI18n();
  const [ack, setAck] = useState(false);
  const [note, setNote] = useState('');
  useEffect(() => {
    if (open) {
      setAck(false);
      setNote('');
    }
  }, [open]);
  const warnings = detail.warnings.filter((w: any) => w.code !== 'NOT_APPROVED');
  const m = useMutation({
    mutationFn: () => api.post(`/orders/${detail.order.id}/approve`, { acknowledgeWarnings: ack, note: note || null }),
    onSuccess: () => {
      onDone();
      onClose();
    },
  });
  const needAck = detail.requiresAcknowledgement;
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={t('orders.approve')}
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="success" icon={<CheckCircle2 className="h-4 w-4" />} loading={m.isPending} disabled={needAck && !ack} onClick={() => m.mutate()}>
            {t('orders.approve')}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-sm font-semibold text-amber-800">{t('app.calcDisclaimer')}</p>
        <WarningList warnings={warnings} />
        {needAck && <Checkbox checked={ack} onChange={setAck} label={<span className="font-medium">{t('orders.acknowledge')}</span>} />}
        <Field label={t('orders.approvalNote')}>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <ErrorBox error={m.error} />
      </div>
    </Modal>
  );
}

export function ReasonModal({ open, onClose, title, action, orderId, withDate, onDone, variant = 'danger' }: {
  open: boolean; onClose: () => void; title: string; action: string; orderId: string; withDate?: boolean; onDone: () => void; variant?: 'danger' | 'warning' | 'primary';
}) {
  const { t } = useI18n();
  const [reason, setReason] = useState('');
  const [date, setDate] = useState('');
  useEffect(() => {
    if (open) {
      setReason('');
      setDate('');
    }
  }, [open]);
  const m = useMutation({
    mutationFn: () => api.post(`/orders/${orderId}/${action}`, withDate ? { reason, delayedUntil: date || null } : { reason }),
    onSuccess: () => {
      onDone();
      onClose();
    },
  });
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title={title}
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant={variant} loading={m.isPending} disabled={reason.trim().length < 3} onClick={() => m.mutate()}>
            {t('common.confirm')}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label={t('common.reason')} required>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        {withDate && (
          <Field label={t('orders.delayUntil')}>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
        )}
        <ErrorBox error={m.error} />
      </div>
    </Modal>
  );
}

export function VerifyModal({ open, onClose, detail, onDone, onRecordVitals }: { open: boolean; onClose: () => void; detail: any; onDone: () => void; onRecordVitals: () => void }) {
  const { t, lang } = useI18n();
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  useEffect(() => {
    if (open) setChecked({});
  }, [open]);
  const hasPre = detail.vitals.some((v: any) => v.phase === 'PRE');
  const all = detail.checklist.every((c: any) => checked[c.id]);
  const m = useMutation({
    mutationFn: () => api.post(`/orders/${detail.order.id}/verify`, { checklist: checked }),
    onSuccess: () => {
      onDone();
      onClose();
    },
  });
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={t('orders.checklist')}
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" loading={m.isPending} disabled={!all || !hasPre} onClick={() => m.mutate()}>
            {t('orders.verify')}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-slate-600">{t('orders.checklistHint')}</p>
        <div className="flex justify-between gap-2">
          <Button size="xs" variant="ghost" onClick={() => setChecked(Object.fromEntries(detail.checklist.map((c: any) => [c.id, true])))}>
            ✓ {t('common.all')}
          </Button>
        </div>
        <div className="space-y-2">
          {detail.checklist.map((c: any) => (
            <div key={c.id} className="rounded-md border border-slate-200 px-3 py-2">
              <Checkbox checked={!!checked[c.id]} onChange={(v) => setChecked((x) => ({ ...x, [c.id]: v }))} label={lang === 'ar' ? c.ar : c.en} />
            </div>
          ))}
        </div>
        {!hasPre && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            <span>{t('vitals.PRE')}: {t('common.required')}</span>
            <Button size="sm" onClick={onRecordVitals}>
              {t('chart.addVitals')}
            </Button>
          </div>
        )}
        <ErrorBox error={m.error} />
      </div>
    </Modal>
  );
}

export function CompleteModal({ open, onClose, detail, onDone }: { open: boolean; onClose: () => void; detail: any; onDone: (result: any) => void }) {
  const { t } = useI18n();
  const [ae, setAe] = useState(false);
  const [details, setDetails] = useState('');
  const [notes, setNotes] = useState('');
  const [disposition, setDisposition] = useState('HOME');
  useEffect(() => {
    if (open) {
      setAe(detail.events.length > 0);
      setDetails(detail.events.map((e: any) => e.description).join('; '));
      setNotes('');
      setDisposition('HOME');
    }
  }, [open, detail.events]);
  const m = useMutation({
    mutationFn: () => api.post(`/orders/${detail.order.id}/complete`, { adverseEvent: ae, adverseEventDetails: ae ? details : null, notes: notes || null, disposition }),
    onSuccess: (r) => {
      onDone(r);
      onClose();
    },
  });
  const started = detail.order.treatment_started_at ? new Date(detail.order.treatment_started_at).getTime() : null;
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('orders.completionTitle')}
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="success" icon={<CheckCircle2 className="h-4 w-4" />} loading={m.isPending} onClick={() => m.mutate()}>
            {t('orders.complete')}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {started && (
          <p className="text-sm text-slate-600">
            {t('orders.treatmentDuration')}: <b className="ltr-nums">{Math.round((Date.now() - started) / 60000)} {t('common.minutes')}</b>
          </p>
        )}
        <Checkbox checked={ae} onChange={setAe} label={t('orders.adverseEvent')} />
        {ae && (
          <Field label={t('orders.adverseEventDetails')} required>
            <Textarea value={details} onChange={(e) => setDetails(e.target.value)} />
          </Field>
        )}
        <Field label={t('orders.disposition')}>
          <Select value={disposition} onChange={(e) => setDisposition(e.target.value)}>
            {['HOME', 'OBSERVATION', 'ADMITTED', 'TRANSFERRED_ER', 'OTHER'].map((d) => (
              <option key={d} value={d}>
                {t(`disposition.${d}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('common.notes')}>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        <ErrorBox error={m.error} />
      </div>
    </Modal>
  );
}

export function CompletionResultModal({ result, onClose, onBook }: { result: any; onClose: () => void; onBook: (s: any) => void }) {
  const { t, lang } = useI18n();
  if (!result) return null;
  const s = result.nextSuggestion;
  return (
    <Modal
      open
      onClose={onClose}
      title={t('orders.completionTitle')}
      footer={
        <>
          <Button onClick={onClose}>{t('common.close')}</Button>
          {s && (
            <Button variant="primary" icon={<CalendarPlus className="h-4 w-4" />} onClick={() => onBook(s)}>
              {t('orders.bookNext')}
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-3 text-sm">
        <div className="flex items-center gap-2 rounded-md bg-emerald-50 px-3 py-2 font-medium text-emerald-800">
          <CheckCircle2 className="h-5 w-5" /> {t('status.order.COMPLETED')}
        </div>
        {result.chairStatus && (
          <p>
            {t('orders.chairReleased')}: <b>{t(`status.chair.${result.chairStatus}`)}</b>
          </p>
        )}
        <div className="rounded-md border border-slate-200 p-3">
          <div className="text-xs font-semibold uppercase text-slate-500">{t('orders.nextSuggestion')}</div>
          {s ? (
            <div className="mt-1 space-y-0.5">
              <div className="text-base font-semibold ltr-nums">
                C{s.cycle}D{s.day} · {fmtDate(s.dueDate, lang, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
              </div>
              <div className="text-slate-600">
                {s.protocolName} · <span className="ltr-nums">{s.startTime}</span> · {s.durationMinutes} {t('common.minutes')} {s.suggestedChairName && `· ${s.suggestedChairName}`}
              </div>
            </div>
          ) : (
            <p className="mt-1 text-slate-700">{t('orders.allCyclesDone')}</p>
          )}
        </div>
      </div>
    </Modal>
  );
}

export function EventModal({ open, onClose, orderId, onDone }: { open: boolean; onClose: () => void; orderId: string; onDone: () => void }) {
  const { t } = useI18n();
  const [f, setF] = useState<any>({});
  useEffect(() => {
    if (open) setF({ eventType: 'INFUSION_REACTION', severity: 'MILD', description: '', actionTaken: '', physicianNotified: true });
  }, [open]);
  const m = useMutation({
    mutationFn: () => api.post(`/orders/${orderId}/events`, { ...f, actionTaken: f.actionTaken || null }),
    onSuccess: () => {
      onDone();
      onClose();
    },
  });
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('orders.reportEvent')}
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="danger" loading={m.isPending} disabled={(f.description ?? '').trim().length < 3} onClick={() => m.mutate()}>
            {t('orders.reportEvent')}
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('orders.eventType')}>
          <Select value={f.eventType} onChange={(e) => setF((x: any) => ({ ...x, eventType: e.target.value }))}>
            {['INFUSION_REACTION', 'HYPERSENSITIVITY', 'EXTRAVASATION', 'NAUSEA_VOMITING', 'VASOVAGAL', 'DEVICE_ISSUE', 'OTHER'].map((x) => (
              <option key={x} value={x}>
                {t(`events.${x}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('patients.severity')}>
          <Select value={f.severity} onChange={(e) => setF((x: any) => ({ ...x, severity: e.target.value }))}>
            {['MILD', 'MODERATE', 'SEVERE', 'LIFE_THREATENING'].map((x) => (
              <option key={x} value={x}>
                {t(`events.${x}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('common.details')} required className="sm:col-span-2">
          <Textarea value={f.description} onChange={(e) => setF((x: any) => ({ ...x, description: e.target.value }))} />
        </Field>
        <Field label={t('orders.actionTaken')} className="sm:col-span-2">
          <Textarea value={f.actionTaken} onChange={(e) => setF((x: any) => ({ ...x, actionTaken: e.target.value }))} />
        </Field>
        <Checkbox checked={!!f.physicianNotified} onChange={(v) => setF((x: any) => ({ ...x, physicianNotified: v }))} label={t('orders.physicianNotified')} />
        <div className="sm:col-span-2">
          <ErrorBox error={m.error} />
        </div>
      </div>
    </Modal>
  );
}
