import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, ErrorBox, Field, Input, Modal, Select, Textarea } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { usePhysicians, useProtocols } from '../../hooks/useSettings';
import { useI18n } from '../../i18n/I18nProvider';
import { api } from '../../services/api';
import { addDays, todayLocal } from '../../utils/format';
import { CANCER_TYPES } from '../../utils/constants';

function useSaved(patientId: string, onClose: () => void) {
  const qc = useQueryClient();
  const toast = useToast();
  const { t } = useI18n();
  return () => {
    toast.success(t('common.success'));
    qc.invalidateQueries({ queryKey: ['patient', patientId] });
    qc.invalidateQueries({ queryKey: ['patient-tab', patientId] });
    qc.invalidateQueries({ queryKey: ['patients'] });
    onClose();
  };
}

const footer = (t: any, onClose: () => void, m: any, disabled?: boolean) => (
  <>
    <Button onClick={onClose}>{t('common.cancel')}</Button>
    <Button variant="primary" loading={m.isPending} onClick={() => m.mutate()} disabled={disabled}>
      {t('common.save')}
    </Button>
  </>
);

export function DiagnosisModal({ open, onClose, patientId, diagnosis }: { open: boolean; onClose: () => void; patientId: string; diagnosis?: any }) {
  const { t } = useI18n();
  const physicians = usePhysicians();
  const [f, setF] = useState<any>({});
  useEffect(() => {
    if (!open) return;
    setF(
      diagnosis
        ? { primaryCancer: diagnosis.primary_cancer, cancerType: diagnosis.cancer_type, icd10Code: diagnosis.icd10_code ?? '', histology: diagnosis.histology ?? '', stage: diagnosis.stage ?? '', biomarkers: diagnosis.biomarkers ?? '', diagnosisDate: diagnosis.diagnosis_date ?? '', oncologistId: diagnosis.oncologist_id ?? '', notes: diagnosis.notes ?? '' }
        : { primaryCancer: '', cancerType: 'Colorectal', icd10Code: '', histology: '', stage: '', biomarkers: '', diagnosisDate: todayLocal(), oncologistId: '', notes: '' },
    );
  }, [open, diagnosis]);
  const set = (k: string) => (e: any) => setF((x: any) => ({ ...x, [k]: e.target.value }));
  const saved = useSaved(patientId, onClose);
  const m = useMutation({
    mutationFn: () => {
      const body = { ...f, diagnosisDate: f.diagnosisDate || null, oncologistId: f.oncologistId || null };
      return diagnosis ? api.patch(`/diagnoses/${diagnosis.id}`, body) : api.post(`/patients/${patientId}/diagnoses`, body);
    },
    onSuccess: saved,
  });
  return (
    <Modal open={open} onClose={onClose} size="lg" title={diagnosis ? t('common.edit') : t('chart.addDiagnosis')} footer={footer(t, onClose, m)}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('chart.primaryCancer')} required className="sm:col-span-2">
          <Input value={f.primaryCancer ?? ''} onChange={set('primaryCancer')} placeholder="e.g. Adenocarcinoma of sigmoid colon" />
        </Field>
        <Field label={t('patients.cancerType')} required>
          <Select value={f.cancerType ?? ''} onChange={set('cancerType')}>
            {CANCER_TYPES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </Select>
        </Field>
        <Field label={t('chart.icd10')}>
          <Input value={f.icd10Code ?? ''} onChange={set('icd10Code')} className="ltr-nums" placeholder="C18.7" />
        </Field>
        <Field label={t('chart.histology')}>
          <Input value={f.histology ?? ''} onChange={set('histology')} />
        </Field>
        <Field label={t('chart.stage')}>
          <Input value={f.stage ?? ''} onChange={set('stage')} />
        </Field>
        <Field label={t('chart.biomarkers')} className="sm:col-span-2">
          <Input value={f.biomarkers ?? ''} onChange={set('biomarkers')} />
        </Field>
        <Field label={t('chart.diagnosisDate')}>
          <Input type="date" value={f.diagnosisDate ?? ''} onChange={set('diagnosisDate')} />
        </Field>
        <Field label={t('patients.oncologist')}>
          <Select value={f.oncologistId ?? ''} onChange={set('oncologistId')}>
            <option value="">—</option>
            {physicians.data?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.full_name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('common.notes')} className="sm:col-span-2">
          <Textarea value={f.notes ?? ''} onChange={set('notes')} />
        </Field>
        <div className="sm:col-span-2">
          <ErrorBox error={m.error} />
        </div>
      </div>
    </Modal>
  );
}

export function PlanModal({ open, onClose, patientId, diagnoses }: { open: boolean; onClose: () => void; patientId: string; diagnoses: any[] }) {
  const { t } = useI18n();
  const protocols = useProtocols();
  const [f, setF] = useState<any>({});
  useEffect(() => {
    if (open) setF({ protocolId: '', diagnosisId: diagnoses[0]?.id ?? '', intent: '', cycleLengthDays: '', plannedCycles: '', startDate: todayLocal(), notes: '' });
  }, [open, diagnoses]);
  const proto = protocols.data?.find((p) => p.id === f.protocolId);
  useEffect(() => {
    if (proto) setF((x: any) => ({ ...x, intent: proto.intent, cycleLengthDays: proto.cycle_length_days, plannedCycles: proto.planned_cycles }));
  }, [proto?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k: string) => (e: any) => setF((x: any) => ({ ...x, [k]: e.target.value }));
  const saved = useSaved(patientId, onClose);
  const m = useMutation({
    mutationFn: () =>
      api.post(`/patients/${patientId}/plans`, {
        protocolId: f.protocolId,
        diagnosisId: f.diagnosisId || null,
        intent: f.intent || undefined,
        cycleLengthDays: Number(f.cycleLengthDays) || undefined,
        plannedCycles: Number(f.plannedCycles) || undefined,
        startDate: f.startDate,
        notes: f.notes || null,
      }),
    onSuccess: saved,
  });
  const dx = diagnoses.find((d) => d.id === f.diagnosisId);
  const sorted = [...(protocols.data ?? [])].sort((a, b) => Number(b.cancer_type === dx?.cancer_type) - Number(a.cancer_type === dx?.cancer_type));
  const end = f.startDate && f.cycleLengthDays && f.plannedCycles ? addDays(f.startDate, (Number(f.plannedCycles) - 1) * Number(f.cycleLengthDays)) : null;
  return (
    <Modal open={open} onClose={onClose} size="lg" title={t('chart.createPlan')} footer={footer(t, onClose, m, !f.protocolId)}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('chart.diagnosis')}>
          <Select value={f.diagnosisId ?? ''} onChange={set('diagnosisId')}>
            <option value="">—</option>
            {diagnoses.map((d) => (
              <option key={d.id} value={d.id}>
                {d.primary_cancer}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('common.protocol')} required>
          <Select value={f.protocolId ?? ''} onChange={set('protocolId')}>
            <option value="">—</option>
            {sorted.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.cancer_type})
              </option>
            ))}
          </Select>
        </Field>
        {proto?.is_demo && (
          <div className="sm:col-span-2">
            <Badge tone="amber">{t('app.demoProtocol')}</Badge>
          </div>
        )}
        <Field label={t('chart.intent')}>
          <Select value={f.intent ?? ''} onChange={set('intent')}>
            {['CURATIVE', 'ADJUVANT', 'NEOADJUVANT', 'PALLIATIVE', 'MAINTENANCE'].map((i) => (
              <option key={i} value={i}>
                {t(`intent.${i}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('chart.startDate')} required>
          <Input type="date" value={f.startDate ?? ''} onChange={set('startDate')} />
        </Field>
        <Field label={`${t('chart.cycleLength')} (${t('chart.days')})`}>
          <Input type="number" min={1} value={f.cycleLengthDays ?? ''} onChange={set('cycleLengthDays')} />
        </Field>
        <Field label={t('chart.plannedCycles')} hint={end ? `${t('chart.plannedEnd')}: ${end}` : undefined}>
          <Input type="number" min={1} value={f.plannedCycles ?? ''} onChange={set('plannedCycles')} />
        </Field>
        <Field label={t('common.notes')} className="sm:col-span-2">
          <Textarea value={f.notes ?? ''} onChange={set('notes')} />
        </Field>
        <div className="sm:col-span-2">
          <ErrorBox error={m.error} />
        </div>
      </div>
    </Modal>
  );
}

export function PlanEditModal({ open, onClose, patientId, plan }: { open: boolean; onClose: () => void; patientId: string; plan: any }) {
  const { t } = useI18n();
  const [f, setF] = useState<any>({});
  useEffect(() => {
    if (open && plan) setF({ status: plan.status, plannedCycles: plan.planned_cycles, notes: plan.notes ?? '', nextDueDate: plan.next_due_date ?? '' });
  }, [open, plan]);
  const set = (k: string) => (e: any) => setF((x: any) => ({ ...x, [k]: e.target.value }));
  const saved = useSaved(patientId, onClose);
  const m = useMutation({
    mutationFn: () => api.patch(`/plans/${plan.id}`, { status: f.status, plannedCycles: Number(f.plannedCycles), notes: f.notes || null, nextDueDate: f.nextDueDate || null }),
    onSuccess: saved,
  });
  return (
    <Modal open={open} onClose={onClose} title={t('chart.modifyPlan')} footer={footer(t, onClose, m)}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('chart.planStatus')}>
          <Select value={f.status ?? ''} onChange={set('status')}>
            {['ACTIVE', 'ON_HOLD', 'COMPLETED', 'DISCONTINUED'].map((s) => (
              <option key={s} value={s}>
                {t(`status.plan.${s}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('chart.plannedCycles')}>
          <Input type="number" min={1} value={f.plannedCycles ?? ''} onChange={set('plannedCycles')} />
        </Field>
        <Field label={t('chart.nextSuggested')}>
          <Input type="date" value={f.nextDueDate ?? ''} onChange={set('nextDueDate')} />
        </Field>
        <Field label={t('common.notes')} className="sm:col-span-2">
          <Textarea value={f.notes ?? ''} onChange={set('notes')} />
        </Field>
        <div className="sm:col-span-2">
          <ErrorBox error={m.error} />
        </div>
      </div>
    </Modal>
  );
}

export function LabEntryModal({ open, onClose, patientId }: { open: boolean; onClose: () => void; patientId: string }) {
  const { t } = useI18n();
  const defs = useQuery({ queryKey: ['lab-tests'], queryFn: () => api.get<any[]>('/lab-tests'), staleTime: 600_000 });
  const [collectedAt, setCollectedAt] = useState('');
  const [values, setValues] = useState<Record<string, string>>({});
  useEffect(() => {
    if (open) {
      const now = new Date();
      now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
      setCollectedAt(now.toISOString().slice(0, 16));
      setValues({});
    }
  }, [open]);
  const saved = useSaved(patientId, onClose);
  const m = useMutation({
    mutationFn: () =>
      api.post(`/patients/${patientId}/labs`, {
        collectedAt: new Date(collectedAt).toISOString(),
        results: Object.entries(values)
          .filter(([, v]) => v !== '')
          .map(([code, v]) => ({ code, value: Number(v) })),
      }),
    onSuccess: saved,
  });
  const panels = ['CBC', 'RENAL', 'LIVER', 'OTHER'];
  return (
    <Modal open={open} onClose={onClose} size="lg" title={t('chart.addLabs')} footer={footer(t, onClose, m)}>
      <div className="space-y-3">
        <Field label={t('chart.collected')}>
          <Input type="datetime-local" value={collectedAt} onChange={(e) => setCollectedAt(e.target.value)} />
        </Field>
        {panels.map((panel) => (
          <fieldset key={panel} className="rounded-lg border border-slate-200 p-3">
            <legend className="px-1 text-xs font-semibold text-slate-600">{panel}</legend>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {defs.data?.filter((d) => d.panel === panel).map((d) => (
                <Field key={d.code} label={`${d.name} (${d.unit})`} hint={`${d.ref_low ?? '—'}–${d.ref_high ?? '—'}`}>
                  <Input type="number" step="any" inputMode="decimal" value={values[d.code] ?? ''} onChange={(e) => setValues((v) => ({ ...v, [d.code]: e.target.value }))} />
                </Field>
              ))}
            </div>
          </fieldset>
        ))}
        <p className="text-xs text-slate-500">{t('chart.labsDemoNote')}</p>
        <ErrorBox error={m.error} />
      </div>
    </Modal>
  );
}

export function AllergyModal({ open, onClose, patientId }: { open: boolean; onClose: () => void; patientId: string }) {
  const { t } = useI18n();
  const [f, setF] = useState<any>({});
  useEffect(() => {
    if (open) setF({ allergen: '', allergenType: 'DRUG', reaction: '', severity: 'UNKNOWN' });
  }, [open]);
  const set = (k: string) => (e: any) => setF((x: any) => ({ ...x, [k]: e.target.value }));
  const saved = useSaved(patientId, onClose);
  const m = useMutation({ mutationFn: () => api.post(`/patients/${patientId}/allergies`, { ...f, reaction: f.reaction || null }), onSuccess: saved });
  return (
    <Modal open={open} onClose={onClose} title={t('patients.addAllergy')} footer={footer(t, onClose, m)}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('patients.allergen')} required>
          <Input value={f.allergen ?? ''} onChange={set('allergen')} />
        </Field>
        <Field label={t('common.type')}>
          <Select value={f.allergenType ?? ''} onChange={set('allergenType')}>
            {['DRUG', 'FOOD', 'ENVIRONMENTAL', 'OTHER'].map((x) => (
              <option key={x}>{x}</option>
            ))}
          </Select>
        </Field>
        <Field label={t('patients.reaction')}>
          <Input value={f.reaction ?? ''} onChange={set('reaction')} />
        </Field>
        <Field label={t('patients.severity')}>
          <Select value={f.severity ?? ''} onChange={set('severity')}>
            {['UNKNOWN', 'MILD', 'MODERATE', 'SEVERE'].map((s) => (
              <option key={s} value={s}>
                {t(`events.${s}`)}
              </option>
            ))}
          </Select>
        </Field>
        <div className="sm:col-span-2">
          <ErrorBox error={m.error} />
        </div>
      </div>
    </Modal>
  );
}

export function PatientStatusModal({ open, onClose, patient }: { open: boolean; onClose: () => void; patient: any }) {
  const { t } = useI18n();
  const [status, setStatus] = useState('');
  const [reason, setReason] = useState('');
  useEffect(() => {
    if (open) {
      setStatus(patient.status);
      setReason('');
    }
  }, [open, patient]);
  const saved = useSaved(patient.id, onClose);
  const m = useMutation({ mutationFn: () => api.patch(`/patients/${patient.id}/status`, { status, reason: reason || null }), onSuccess: saved });
  return (
    <Modal open={open} onClose={onClose} size="sm" title={t('patients.changeStatus')} footer={footer(t, onClose, m)}>
      <div className="space-y-3">
        <Field label={t('common.status')}>
          <Select value={status} onChange={(e) => setStatus(e.target.value)}>
            {['ACTIVE_TREATMENT', 'TREATMENT_COMPLETED', 'ON_HOLD', 'DISCONTINUED', 'FOLLOW_UP', 'PALLIATIVE_CARE', 'DECEASED'].map((s) => (
              <option key={s} value={s}>
                {t(`status.patient.${s}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('common.reason')}>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <ErrorBox error={m.error} />
      </div>
    </Modal>
  );
}
