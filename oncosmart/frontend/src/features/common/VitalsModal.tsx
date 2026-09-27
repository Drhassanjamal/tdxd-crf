import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Button, ErrorBox, Field, Input, Modal, Select, Textarea } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { useI18n } from '../../i18n/I18nProvider';
import { api } from '../../services/api';

const FIELDS = [
  ['bpSystolic', 'vitals.systolic', 'mmHg'],
  ['bpDiastolic', 'vitals.diastolic', 'mmHg'],
  ['heartRate', 'vitals.hr', '/min'],
  ['respRate', 'vitals.rr', '/min'],
  ['temperatureC', 'vitals.temp', '°C'],
  ['spo2', 'vitals.spo2', '%'],
  ['weightKg', 'vitals.weight', 'kg'],
  ['painScore', 'vitals.pain', '0–10'],
] as const;

export function VitalsModal({ open, onClose, patientId, orderId, defaultPhase = 'PRE', onSaved }: {
  open: boolean; onClose: () => void; patientId: string; orderId?: string | null; defaultPhase?: string; onSaved?: () => void;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const [phase, setPhase] = useState(defaultPhase);
  const [v, setV] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState('');
  useEffect(() => {
    if (open) {
      setPhase(defaultPhase);
      setV({});
      setNotes('');
    }
  }, [open, defaultPhase]);
  const m = useMutation({
    mutationFn: () => {
      const body: any = { phase, treatmentOrderId: orderId ?? null, notes: notes || null };
      for (const [k] of FIELDS) body[k] = v[k] === undefined || v[k] === '' ? null : Number(v[k]);
      return api.post(`/patients/${patientId}/vitals`, body);
    },
    onSuccess: () => {
      toast.success(t('common.success'));
      onSaved?.();
      onClose();
    },
  });
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('chart.addVitals')}
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" loading={m.isPending} onClick={() => m.mutate()}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label={t('vitals.phase')}>
          <Select value={phase} onChange={(e) => setPhase(e.target.value)}>
            {['PRE', 'DURING', 'POST', 'OTHER'].map((p) => (
              <option key={p} value={p}>
                {t(`vitals.${p}`)}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {FIELDS.map(([k, label, unit]) => (
            <Field key={k} label={`${t(label)} (${unit})`}>
              <Input type="number" inputMode="decimal" step={k === 'temperatureC' || k === 'weightKg' ? '0.1' : '1'} value={v[k] ?? ''} onChange={(e) => setV((x) => ({ ...x, [k]: e.target.value }))} />
            </Field>
          ))}
        </div>
        <Field label={t('common.notes')}>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        <ErrorBox error={m.error} />
      </div>
    </Modal>
  );
}
