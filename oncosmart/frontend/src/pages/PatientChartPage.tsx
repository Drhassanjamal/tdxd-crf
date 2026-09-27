import clsx from 'clsx';
import { AlertTriangle, ArrowLeft, CalendarPlus, ClipboardPlus, Pencil, Phone, Plus, Printer, ShieldCheck, X } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { StatusBadge } from '../components/StatusBadge';
import { Badge, Button, Card, CardHeader, ErrorBox, InfoRow, PageLoader, Tabs } from '../components/ui';
import { useToast } from '../components/Toast';
import { AppointmentFormModal, AppointmentPrefill } from '../features/appointments/AppointmentFormModal';
import { AllergyModal, PatientStatusModal } from '../features/patients/ChartModals';
import {
  AppointmentsTab,
  AssistantTab,
  DiagnosisTab,
  HistoryTab,
  LabsTab,
  NotesTab,
  OrdersTab,
  PlanTab,
  TimelineTab,
  VitalsTab,
} from '../features/patients/ChartTabs';
import { PatientFormModal } from '../features/patients/PatientFormModal';
import { useAuth } from '../hooks/useAuth';
import { useI18n } from '../i18n/I18nProvider';
import { api } from '../services/api';
import { fmtDate, fmtDateTime, hhmm, patientName } from '../utils/format';

type Tab = 'overview' | 'diagnosis' | 'plan' | 'orders' | 'history' | 'labs' | 'vitals' | 'notes' | 'appointments' | 'timeline' | 'assistant';

export function PatientChartPage() {
  const { id } = useParams();
  const { t, lang } = useI18n();
  const { can } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>('overview');
  const [editing, setEditing] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const [allergyOpen, setAllergyOpen] = useState(false);
  const [booking, setBooking] = useState<AppointmentPrefill | null>(null);
  const q = useQuery({ queryKey: ['patient', id], queryFn: () => api.get(`/patients/${id}`) });
  const inactivate = useMutation({
    mutationFn: (allergyId: string) => api.post(`/allergies/${allergyId}/inactivate`, { reason: 'Entered in error / resolved' }),
    onSuccess: () => {
      toast.success(t('common.success'));
      qc.invalidateQueries({ queryKey: ['patient', id] });
    },
    onError: (e) => toast.error(e),
  });
  if (q.isLoading) return <PageLoader />;
  if (q.error) return <ErrorBox error={q.error} />;
  const p = q.data;
  const clinical = p.clinicalAccess;
  const dx = p.diagnoses?.[0];
  const plan = p.activePlan ?? p.plans?.[0];

  const tabs: { id: Tab; label: string }[] = [
    { id: 'overview', label: t('chart.overview') },
    ...(clinical ? [{ id: 'diagnosis' as Tab, label: t('chart.diagnosis') }] : []),
    { id: 'plan', label: t('chart.plan') },
    ...(clinical
      ? [
          { id: 'orders' as Tab, label: t('chart.orders') },
          { id: 'history' as Tab, label: t('chart.history') },
          { id: 'labs' as Tab, label: t('chart.labs') },
          { id: 'vitals' as Tab, label: t('chart.vitals') },
          { id: 'notes' as Tab, label: t('chart.notes') },
        ]
      : []),
    { id: 'appointments', label: t('chart.appointments') },
    { id: 'timeline', label: t('chart.timeline') },
    ...(can('assistant.use') ? [{ id: 'assistant' as Tab, label: t('chart.assistant') }] : []),
  ];

  const openTimeline = (e: any) => {
    if (e.refType === 'order') navigate(`/orders/${e.refId}`);
    else if (e.refType === 'diagnosis') setTab('diagnosis');
    else if (e.refType === 'plan') setTab('plan');
    else if (e.refType === 'appointment') setTab('appointments');
  };
  const bookFromPlan = () =>
    setBooking(
      plan && plan.status === 'ACTIVE'
        ? { patientId: p.id, treatmentPlanId: plan.id, cycleNumber: plan.next_cycle, dayNumber: plan.next_day, appointmentDate: plan.next_due_date ?? undefined, durationMinutes: plan.estimated_duration_min, physicianId: plan.physician_id }
        : { patientId: p.id },
    );

  return (
    <div className="space-y-4">
      <Link to="/patients" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
        <ArrowLeft className="h-4 w-4 rtl:rotate-180" /> {t('nav.patients')}
      </Link>

      {/* Patient header */}
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-start justify-between gap-4 p-4">
          <div className="flex min-w-0 items-start gap-3">
            <div className={clsx('flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-lg font-semibold', p.sex === 'FEMALE' ? 'bg-rose-50 text-rose-700' : 'bg-sky-50 text-sky-700')}>
              {p.first_name[0]}
              {p.last_name[0]}
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl font-semibold text-slate-900">{patientName(p, lang)}</h1>
                {lang === 'en' && p.full_name_ar && <span className="text-sm text-slate-500" dir="rtl">{p.full_name_ar}</span>}
                <StatusBadge kind="patient" status={p.status} />
                {p.is_demo && <Badge tone="amber">DEMO</Badge>}
              </div>
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-600">
                <span>
                  {t('patients.mrn')}: <b className="ltr-nums">{p.mrn}</b>
                </span>
                <span>
                  {t('patients.patientId')}: <b className="ltr-nums">{p.patient_code}</b>
                </span>
                <span>
                  {p.age} · {t(`patients.${p.sex}`)} · {fmtDate(p.date_of_birth, lang)}
                </span>
                {p.phone && (
                  <span className="inline-flex items-center gap-1 ltr-nums">
                    <Phone className="h-3.5 w-3.5" /> {p.phone}
                  </span>
                )}
              </div>
              {/* Allergy banner */}
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {p.allergies.length > 0 ? (
                  p.allergies.map((a: any) => (
                    <Badge key={a.id} tone="red">
                      <AlertTriangle className="h-3 w-3" /> {a.allergen}
                      {a.reaction ? ` — ${a.reaction}` : ''}
                      {can('allergies.inactivate') && (
                        <button className="ms-0.5 rounded hover:bg-rose-100" title={t('patients.inactivate')} onClick={() => confirm(`${t('patients.inactivate')}: ${a.allergen}?`) && inactivate.mutate(a.id)}>
                          <X className="h-3 w-3" />
                        </button>
                      )}
                    </Badge>
                  ))
                ) : p.no_known_allergies ? (
                  <Badge tone="green">
                    <ShieldCheck className="h-3 w-3" /> {t('patients.noKnownAllergies')}
                  </Badge>
                ) : (
                  <Badge tone="amber">
                    <AlertTriangle className="h-3 w-3" /> {t('patients.allergyNotDocumented')}
                  </Badge>
                )}
                {can('allergies.create') && (
                  <button onClick={() => setAllergyOpen(true)} className="inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-xs font-medium text-brand-700 hover:bg-brand-50">
                    <Plus className="h-3 w-3" /> {t('patients.addAllergy')}
                  </button>
                )}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {can('patients.update') && (
              <Button size="sm" icon={<Pencil className="h-4 w-4" />} onClick={() => setEditing(true)}>
                {t('common.edit')}
              </Button>
            )}
            {can('patients.status') && (
              <Button size="sm" onClick={() => setStatusOpen(true)}>
                {t('patients.changeStatus')}
              </Button>
            )}
            {can('appointments.write') && (
              <Button size="sm" icon={<CalendarPlus className="h-4 w-4" />} onClick={bookFromPlan}>
                {t('chart.bookAppointment')}
              </Button>
            )}
            {can('orders.prescribe') && p.activePlan && (
              <Button size="sm" variant="primary" icon={<ClipboardPlus className="h-4 w-4" />} onClick={() => navigate(`/orders/new?patient=${p.id}`)}>
                {t('chart.newOrder')}
              </Button>
            )}
            {clinical && (
              <Button size="sm" variant="ghost" icon={<Printer className="h-4 w-4" />} onClick={() => window.open(`/print/summary/${p.id}`, '_blank')}>
                {t('chart.treatmentSummary')}
              </Button>
            )}
          </div>
        </div>
        {/* Clinical strip */}
        <div className="grid gap-3 border-t border-slate-100 bg-slate-50/70 px-4 py-3 sm:grid-cols-2 lg:grid-cols-5">
          {clinical && <InfoRow label={t('patients.diagnosis')} value={dx ? `${dx.primary_cancer}${dx.stage ? ` · ${dx.stage}` : ''}` : null} className="lg:col-span-2" />}
          <InfoRow
            label={t('patients.currentProtocol')}
            value={
              plan ? (
                <span className="flex flex-wrap items-center gap-1.5">
                  {plan.protocol_name} {plan.protocol_is_demo && <Badge tone="amber">DEMO</Badge>}
                </span>
              ) : null
            }
          />
          <InfoRow label={t('patients.currentCycle')} value={plan ? (plan.current_cycle ? <span className="ltr-nums">{t('patients.cycleOf', { cycle: plan.current_cycle, planned: plan.planned_cycles })}</span> : t('patients.notStarted')) : null} />
          <InfoRow
            label={t('patients.nextAppointment')}
            value={
              p.nextAppointment ? (
                <span className="ltr-nums">
                  {fmtDate(p.nextAppointment.appointment_date, lang)} {hhmm(p.nextAppointment.start_time)} {p.nextAppointment.chair_name && `· ${p.nextAppointment.chair_name}`}
                </span>
              ) : null
            }
          />
        </div>
      </Card>

      <Tabs tabs={tabs} value={tab} onChange={setTab} />

      {tab === 'overview' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader title={t('chart.patientInfo')} />
            <dl className="grid grid-cols-2 gap-4 p-4">
              <InfoRow label={t('patients.patientId')} value={<span className="ltr-nums">{p.patient_code}</span>} />
              <InfoRow label={t('patients.mrn')} value={<span className="ltr-nums">{p.mrn}</span>} />
              <InfoRow label={t('patients.name')} value={`${p.first_name} ${p.last_name}`} />
              <InfoRow label={t('patients.nameAr')} value={p.full_name_ar} />
              <InfoRow label={t('patients.dob')} value={fmtDate(p.date_of_birth, lang)} />
              <InfoRow label={t('patients.age')} value={p.age} />
              <InfoRow label={t('patients.sex')} value={t(`patients.${p.sex}`)} />
              <InfoRow label={t('patients.phone')} value={<span className="ltr-nums">{p.phone}</span>} />
              <InfoRow label={t('patients.governorate')} value={p.governorate} />
              <InfoRow label={t('patients.address')} value={p.address} />
              <InfoRow label={t('patients.preferredLanguage')} value={p.preferred_language === 'ar' ? 'العربية' : 'English'} />
              <InfoRow label={t('patients.oncologist')} value={p.oncologist_name} />
              <InfoRow label={`${t('patients.height')} / ${t('patients.weight')}`} value={p.height_cm ? <span className="ltr-nums">{p.height_cm} cm / {p.weight_kg} kg</span> : null} />
              <InfoRow label={t('patients.registeredBy')} value={fmtDateTime(p.created_at, lang)} />
            </dl>
          </Card>
          <div className="space-y-4">
            <Card>
              <CardHeader title={t('patients.emergencyContact')} />
              <dl className="grid grid-cols-3 gap-4 p-4">
                <InfoRow label={t('patients.emergencyName')} value={p.emergency_contact_name} />
                <InfoRow label={t('patients.emergencyRelation')} value={p.emergency_contact_relation} />
                <InfoRow label={t('patients.emergencyPhone')} value={<span className="ltr-nums">{p.emergency_contact_phone}</span>} />
              </dl>
            </Card>
            <Card>
              <CardHeader title={t('patients.allergies')} />
              <div className="p-4 text-sm">
                {p.allergies.length ? (
                  <ul className="space-y-1.5">
                    {p.allergies.map((a: any) => (
                      <li key={a.id} className="flex flex-wrap items-center gap-2">
                        <Badge tone="red">{a.allergen}</Badge>
                        <span className="text-slate-600">{a.reaction}</span>
                        <span className="text-xs text-slate-400">
                          {t(`events.${a.severity}`)} · {a.recorded_by_name}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : p.no_known_allergies ? (
                  <span className="text-emerald-700">{t('patients.noKnownAllergies')}</span>
                ) : (
                  <span className="text-amber-700">{t('patients.allergyNotDocumented')}</span>
                )}
              </div>
            </Card>
            {clinical && dx && (
              <Card>
                <CardHeader title={t('chart.diagnosis')} />
                <dl className="grid grid-cols-2 gap-4 p-4">
                  <InfoRow label={t('chart.primaryCancer')} value={dx.primary_cancer} className="col-span-2" />
                  <InfoRow label={t('chart.icd10')} value={<span className="ltr-nums">{dx.icd10_code}</span>} />
                  <InfoRow label={t('chart.stage')} value={dx.stage} />
                  <InfoRow label={t('chart.histology')} value={dx.histology} />
                  <InfoRow label={t('chart.biomarkers')} value={dx.biomarkers} />
                </dl>
              </Card>
            )}
          </div>
        </div>
      )}
      {tab === 'diagnosis' && <DiagnosisTab patient={p} />}
      {tab === 'plan' && <PlanTab patient={p} onBook={setBooking} />}
      {tab === 'orders' && <OrdersTab patientId={p.id} />}
      {tab === 'history' && <HistoryTab patientId={p.id} />}
      {tab === 'labs' && <LabsTab patientId={p.id} />}
      {tab === 'vitals' && <VitalsTab patientId={p.id} />}
      {tab === 'notes' && <NotesTab patientId={p.id} />}
      {tab === 'appointments' && <AppointmentsTab patientId={p.id} onBook={bookFromPlan} />}
      {tab === 'timeline' && <TimelineTab patientId={p.id} onOpen={openTimeline} />}
      {tab === 'assistant' && <AssistantTab patientId={p.id} />}

      <PatientFormModal open={editing} onClose={() => setEditing(false)} patient={p} />
      <PatientStatusModal open={statusOpen} onClose={() => setStatusOpen(false)} patient={p} />
      <AllergyModal open={allergyOpen} onClose={() => setAllergyOpen(false)} patientId={p.id} />
      <AppointmentFormModal
        open={!!booking}
        onClose={() => setBooking(null)}
        prefill={booking ?? undefined}
        onSaved={() => qc.invalidateQueries({ queryKey: ['patient-tab', p.id] })}
      />
    </div>
  );
}
