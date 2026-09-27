import clsx from 'clsx';
import { Sparkles } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, ErrorBox, Field, Input, Modal, Select, Textarea } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { useChairs, usePhysicians, useSettings } from '../../hooks/useSettings';
import { useI18n } from '../../i18n/I18nProvider';
import { api } from '../../services/api';
import { hhmm, minutesToTime, patientName, timeToMinutes, todayLocal } from '../../utils/format';

export interface AppointmentPrefill {
  patientId?: string;
  treatmentPlanId?: string | null;
  cycleNumber?: number | null;
  dayNumber?: number | null;
  appointmentDate?: string;
  startTime?: string;
  durationMinutes?: number;
  chairId?: string | null;
  physicianId?: string | null;
}

const TYPES = ['CHEMOTHERAPY', 'IMMUNOTHERAPY', 'SUPPORTIVE_CARE', 'HYDRATION', 'PROCEDURE', 'OTHER'];

/** Mini occupancy strip for one chair on the selected date. */
function ChairStrip({ chair, start, duration, open, close }: { chair: any; start: number; duration: number; open: number; close: number }) {
  const span = close - open;
  const pos = (m: number) => `${Math.max(0, Math.min(100, ((m - open) / span) * 100))}%`;
  return (
    <div className="relative h-3 w-full rounded bg-slate-100">
      {chair.bookings.map((b: any) => {
        const s = timeToMinutes(b.start_time);
        return <div key={b.id} className="absolute inset-y-0 rounded bg-slate-400/80" style={{ insetInlineStart: pos(s), width: `calc(${pos(s + b.duration_minutes)} - ${pos(s)})` }} title={`${hhmm(b.start_time)} · ${b.patient_name}`} />;
      })}
      <div className="absolute inset-y-0 rounded border-2 border-brand-600 bg-brand-500/20" style={{ insetInlineStart: pos(start), width: `calc(${pos(start + duration)} - ${pos(start)})` }} />
    </div>
  );
}

export function AppointmentFormModal({ open, onClose, prefill, appointment, onSaved }: {
  open: boolean; onClose: () => void; prefill?: AppointmentPrefill; appointment?: any; onSaved?: (a: any) => void;
}) {
  const { t, lang } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const settings = useSettings();
  const physicians = usePhysicians();
  const editing = !!appointment;
  const [f, setF] = useState<any>({});
  const [patientSearch, setPatientSearch] = useState('');

  useEffect(() => {
    if (!open) return;
    if (appointment) {
      setF({
        patientId: appointment.patient_id, treatmentPlanId: appointment.treatment_plan_id, cycleNumber: appointment.cycle_number ?? '',
        dayNumber: appointment.day_number ?? '', appointmentType: appointment.appointment_type, appointmentDate: appointment.appointment_date,
        startTime: hhmm(appointment.start_time), durationMinutes: appointment.duration_minutes, chairId: appointment.chair_id ?? '',
        physicianId: appointment.physician_id ?? '', notes: appointment.notes ?? '',
      });
    } else {
      setF({
        patientId: prefill?.patientId ?? '', treatmentPlanId: prefill?.treatmentPlanId ?? null, cycleNumber: prefill?.cycleNumber ?? '',
        dayNumber: prefill?.dayNumber ?? '', appointmentType: 'CHEMOTHERAPY', appointmentDate: prefill?.appointmentDate ?? todayLocal(),
        startTime: prefill?.startTime ?? '09:00', durationMinutes: prefill?.durationMinutes ?? '', chairId: prefill?.chairId ?? '',
        physicianId: prefill?.physicianId ?? '', notes: '',
      });
    }
    setPatientSearch('');
  }, [open, appointment, prefill]);

  const set = (k: string) => (e: any) => setF((x: any) => ({ ...x, [k]: e.target.value }));
  const patients = useQuery({
    queryKey: ['patients', 'picker', patientSearch],
    queryFn: () => api.post('/patients/query', { search: patientSearch || undefined, pageSize: 30 }),
    enabled: open && !editing && !prefill?.patientId,
  });
  const patient = useQuery({ queryKey: ['patient', f.patientId], queryFn: () => api.get(`/patients/${f.patientId}`), enabled: open && !!f.patientId });
  const chairs = useChairs(f.appointmentDate);
  const plan = patient.data?.activePlan;

  // When a patient with an active plan is selected, prefill plan/cycle/duration
  useEffect(() => {
    if (!open || editing || !plan) return;
    setF((x: any) => ({
      ...x,
      treatmentPlanId: x.treatmentPlanId ?? plan.id,
      cycleNumber: x.cycleNumber || plan.next_cycle || '',
      dayNumber: x.dayNumber || plan.next_day || '',
      durationMinutes: x.durationMinutes || plan.estimated_duration_min || settings.data?.settings.default_appointment_duration_min || 120,
      physicianId: x.physicianId || plan.physician_id,
      appointmentType: plan.protocol_name?.toLowerCase().includes('pembro') ? 'IMMUNOTHERAPY' : x.appointmentType,
    }));
  }, [plan?.id, open]); // eslint-disable-line react-hooks/exhaustive-deps

  const s = settings.data?.settings;
  const openMin = timeToMinutes(s?.unit_open_time ?? '08:00') - 60;
  const closeMin = timeToMinutes(s?.unit_close_time ?? '16:00') + 180;
  const startMin = f.startTime ? timeToMinutes(f.startTime) : 540;
  const duration = Number(f.durationMinutes) || 60;
  const clashes = useMemo(() => {
    const map: Record<string, boolean> = {};
    for (const c of chairs.data ?? []) {
      map[c.id] = c.bookings.some((b: any) => b.id !== appointment?.id && timeToMinutes(b.start_time) < startMin + duration && startMin < timeToMinutes(b.start_time) + b.duration_minutes);
    }
    return map;
  }, [chairs.data, startMin, duration, appointment?.id]);

  const m = useMutation({
    mutationFn: () => {
      const common = {
        appointmentDate: f.appointmentDate,
        startTime: f.startTime,
        durationMinutes: Number(f.durationMinutes) || undefined,
        chairId: f.chairId || null,
        physicianId: f.physicianId || null,
        notes: f.notes || null,
        appointmentType: f.appointmentType,
      };
      if (editing) return api.put(`/appointments/${appointment.id}`, common);
      return api.post('/appointments', {
        ...common,
        patientId: f.patientId,
        treatmentPlanId: f.treatmentPlanId || null,
        cycleNumber: f.cycleNumber ? Number(f.cycleNumber) : null,
        dayNumber: f.dayNumber ? Number(f.dayNumber) : null,
      });
    },
    onSuccess: (a) => {
      toast.success(t('appointments.booked'));
      qc.invalidateQueries({ queryKey: ['appointments'] });
      qc.invalidateQueries({ queryKey: ['patient'] });
      qc.invalidateQueries({ queryKey: ['chairs'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      qc.invalidateQueries({ queryKey: ['notifications'] });
      onSaved?.(a);
      onClose();
    },
  });
  const suggest = async () => {
    const c = await api.get(`/appointments/suggest-chair?date=${f.appointmentDate}&time=${f.startTime}&duration=${duration}`);
    if (c?.id) setF((x: any) => ({ ...x, chairId: c.id }));
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={editing ? `${t('appointments.reschedule')} · ${appointment.appointment_number}` : t('appointments.new')}
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" loading={m.isPending} onClick={() => m.mutate()} disabled={!f.patientId}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {!editing && !prefill?.patientId && (
          <Field label={t('common.patient')} required>
            <div className="space-y-1.5">
              <Input placeholder={t('patients.searchHint')} value={patientSearch} onChange={(e) => setPatientSearch(e.target.value)} />
              <Select value={f.patientId ?? ''} onChange={(e) => setF((x: any) => ({ ...x, patientId: e.target.value, treatmentPlanId: null, cycleNumber: '', dayNumber: '' }))}>
                <option value="">—</option>
                {patients.data?.rows.map((p: any) => (
                  <option key={p.id} value={p.id}>
                    {patientName(p, lang)} · {p.mrn}
                  </option>
                ))}
              </Select>
            </div>
          </Field>
        )}
        {patient.data && (
          <div className="flex flex-wrap items-center gap-2 rounded-md bg-slate-50 px-3 py-2 text-sm">
            <span className="font-semibold">{patientName(patient.data, lang)}</span>
            <span className="ltr-nums text-slate-500">{patient.data.mrn}</span>
            {plan ? (
              <Badge tone="blue">
                {plan.protocol_name} {plan.next_cycle ? `· C${plan.next_cycle}D${plan.next_day}` : ''}
              </Badge>
            ) : (
              <Badge>{t('chart.noPlan')}</Badge>
            )}
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-4">
          <Field label={t('appointments.type')}>
            <Select value={f.appointmentType ?? 'CHEMOTHERAPY'} onChange={set('appointmentType')}>
              {TYPES.map((x) => (
                <option key={x} value={x}>
                  {t(`appointments.types.${x}`)}
                </option>
              ))}
            </Select>
          </Field>
          {!editing && (
            <>
              <Field label={t('common.cycle')}>
                <Input type="number" min={1} value={f.cycleNumber ?? ''} onChange={set('cycleNumber')} disabled={!f.treatmentPlanId} />
              </Field>
              <Field label={t('common.day')}>
                <Input type="number" min={1} value={f.dayNumber ?? ''} onChange={set('dayNumber')} disabled={!f.treatmentPlanId} />
              </Field>
            </>
          )}
          <Field label={t('common.physician')}>
            <Select value={f.physicianId ?? ''} onChange={set('physicianId')}>
              <option value="">—</option>
              {physicians.data?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.full_name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('common.date')} required>
            <Input type="date" value={f.appointmentDate ?? ''} onChange={set('appointmentDate')} />
          </Field>
          <Field label={t('appointments.startTime')} required>
            <Input type="time" step={300} value={f.startTime ?? ''} onChange={set('startTime')} />
          </Field>
          <Field label={`${t('appointments.estimatedDuration')} (${t('common.minutes')})`}>
            <Input type="number" min={10} max={720} step={15} value={f.durationMinutes ?? ''} onChange={set('durationMinutes')} />
          </Field>
          <Field label={t('common.chair')}>
            <Select value={f.chairId ?? ''} onChange={set('chairId')}>
              <option value="">{t('appointments.noChair')}</option>
              {chairs.data?.filter((c) => c.is_active).map((c) => (
                <option key={c.id} value={c.id} disabled={c.status === 'OUT_OF_SERVICE' || clashes[c.id]}>
                  {c.name}
                  {c.status === 'OUT_OF_SERVICE' ? ` — ${t('status.chair.OUT_OF_SERVICE')}` : clashes[c.id] ? ' — ✕' : ''}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="rounded-lg border border-slate-200 p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-600">
              {t('appointments.chairOccupancy')} · <span className="ltr-nums">{f.appointmentDate}</span>
            </span>
            <Button size="xs" icon={<Sparkles className="h-3.5 w-3.5" />} onClick={suggest}>
              {t('appointments.suggestedChair')}
            </Button>
          </div>
          <div className="space-y-1.5">
            {chairs.data?.filter((c) => c.is_active).map((c) => (
              <button type="button" key={c.id} onClick={() => !clashes[c.id] && c.status !== 'OUT_OF_SERVICE' && setF((x: any) => ({ ...x, chairId: c.id }))} className={clsx('grid w-full grid-cols-[72px_1fr] items-center gap-2 rounded px-1 py-0.5 text-start', f.chairId === c.id && 'bg-brand-50')}>
                <span className={clsx('text-xs', clashes[c.id] ? 'text-rose-600' : 'text-slate-600', f.chairId === c.id && 'font-semibold text-brand-800')}>{c.name}</span>
                <ChairStrip chair={c} start={startMin} duration={duration} open={openMin} close={closeMin} />
              </button>
            ))}
          </div>
          <div className="mt-1 flex justify-between text-2xs text-slate-400 ltr-nums">
            <span>{minutesToTime(openMin)}</span>
            <span>{minutesToTime(closeMin)}</span>
          </div>
          <p className="mt-1 text-2xs text-slate-500">{t('appointments.conflictHint')}</p>
        </div>
        <Field label={t('common.notes')}>
          <Textarea value={f.notes ?? ''} onChange={set('notes')} />
        </Field>
        <ErrorBox error={m.error} />
      </div>
    </Modal>
  );
}
