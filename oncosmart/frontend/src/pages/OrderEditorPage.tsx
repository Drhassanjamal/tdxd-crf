import clsx from 'clsx';
import { ArrowLeft, Calculator, Save, Send, ShieldAlert } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { WarningList } from '../components/WarningList';
import { Badge, Button, Card, CardHeader, Checkbox, EmptyState, ErrorBox, Field, Input, PageHeader, PageLoader, Select, Spinner, Table, td, Textarea, th } from '../components/ui';
import { useToast } from '../components/Toast';
import { useI18n } from '../i18n/I18nProvider';
import { api } from '../services/api';
import { doseLabel, fmtDate, fmtDuration, fmtNum, patientName, todayLocal, fmtBsa } from '../utils/format';

interface Override {
  include?: boolean;
  dosePercent?: string;
  finalDose?: string;
  modificationReason?: string;
  diluent?: string;
  finalVolumeMl?: string;
  infusionDurationMin?: string;
}

export function OrderEditorPage() {
  const { id } = useParams(); // edit mode when present
  const [params] = useSearchParams();
  const { t, lang } = useI18n();
  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const [patientId, setPatientId] = useState(params.get('patient') ?? '');
  const [patientSearch, setPatientSearch] = useState('');
  const [form, setForm] = useState<any>({ cycleNumber: '', dayNumber: '', plannedDate: todayLocal(), heightCm: '', weightKg: '', gfr: '', gfrSource: '' });
  const [texts, setTexts] = useState<Record<string, string | undefined>>({});
  const [overrides, setOverrides] = useState<Record<string, Override>>({});
  const [initialised, setInitialised] = useState(false);

  const existing = useQuery({ queryKey: ['order', id], queryFn: () => api.get(`/orders/${id}`), enabled: !!id });
  const effectivePatient = id ? existing.data?.patient?.id : patientId;
  const patient = useQuery({ queryKey: ['patient', effectivePatient], queryFn: () => api.get(`/patients/${effectivePatient}`), enabled: !!effectivePatient });
  const picker = useQuery({
    queryKey: ['patients', 'order-picker', patientSearch],
    queryFn: () => api.post('/patients/query', { search: patientSearch || undefined, status: 'ACTIVE_TREATMENT', pageSize: 40 }),
    enabled: !id && !patientId,
  });
  const plan = id ? existing.data?.plan : patient.data?.activePlan;

  // Initialise the form from the plan (new) or the stored order (edit)
  useEffect(() => {
    if (initialised) return;
    if (id && existing.data) {
      const o = existing.data.order;
      setForm({ cycleNumber: o.cycle_number, dayNumber: o.day_number, plannedDate: o.planned_date, heightCm: o.height_cm ?? '', weightKg: o.weight_kg ?? '', gfr: o.gfr_ml_min ?? '', gfrSource: o.gfr_source ?? '' });
      setTexts({ premedications: o.premedications ?? '', hydration: o.hydration ?? '', supportiveMedications: o.supportive_medications ?? '', specialInstructions: o.special_instructions ?? '', clinicalNotes: o.clinical_notes ?? '' });
      const ov: Record<string, Override> = {};
      for (const it of existing.data.items) {
        if (!it.protocol_drug_id) continue;
        ov[it.protocol_drug_id] = {
          dosePercent: String(it.dose_percent),
          finalDose: it.is_manually_adjusted ? String(it.final_dose) : undefined,
          modificationReason: it.dose_modification_reason ?? '',
          diluent: it.diluent ?? '',
          finalVolumeMl: it.final_volume_ml ? String(it.final_volume_ml) : '',
          infusionDurationMin: it.infusion_duration_min ? String(it.infusion_duration_min) : '',
        };
      }
      setOverrides(ov);
      setInitialised(true);
    } else if (!id && patient.data && plan) {
      setForm((f: any) => ({
        ...f,
        cycleNumber: plan.next_cycle ?? plan.current_cycle + 1,
        dayNumber: plan.next_day ?? 1,
        plannedDate: plan.next_due_date && plan.next_due_date > todayLocal() ? plan.next_due_date : todayLocal(),
        heightCm: patient.data.height_cm ?? '',
        weightKg: patient.data.weight_kg ?? '',
      }));
      setInitialised(true);
    }
  }, [id, existing.data, patient.data, plan, initialised]);

  const payload = useMemo(() => {
    if (!plan || !form.cycleNumber || !form.dayNumber || !form.plannedDate) return null;
    const items = Object.entries(overrides).map(([protocolDrugId, o]) => ({
      protocolDrugId,
      include: o.include,
      dosePercent: o.dosePercent ? Number(o.dosePercent) : undefined,
      finalDose: o.finalDose ? Number(o.finalDose) : undefined,
      modificationReason: o.modificationReason || null,
      diluent: o.diluent !== undefined ? o.diluent || null : undefined,
      finalVolumeMl: o.finalVolumeMl !== undefined ? (o.finalVolumeMl ? Number(o.finalVolumeMl) : null) : undefined,
      infusionDurationMin: o.infusionDurationMin !== undefined ? (o.infusionDurationMin ? Number(o.infusionDurationMin) : null) : undefined,
    }));
    return {
      treatmentPlanId: plan.id,
      cycleNumber: Number(form.cycleNumber),
      dayNumber: Number(form.dayNumber),
      plannedDate: form.plannedDate,
      heightCm: form.heightCm === '' ? null : Number(form.heightCm),
      weightKg: form.weightKg === '' ? null : Number(form.weightKg),
      gfr: form.gfr === '' ? null : Number(form.gfr),
      gfrSource: form.gfrSource || null,
      items,
      ...Object.fromEntries(Object.entries(texts).filter(([, v]) => v !== undefined).map(([k, v]) => [k, v || null])),
    };
  }, [plan, form, overrides, texts]);

  // Debounced live calculation preview (server is the single source of truth for doses)
  const [debouncedPayload, setDebouncedPayload] = useState<any>(null);
  useEffect(() => {
    const h = setTimeout(() => setDebouncedPayload(payload), 350);
    return () => clearTimeout(h);
  }, [payload]);
  const preview = useQuery({
    queryKey: ['order-preview', debouncedPayload],
    queryFn: () => api.post('/orders/preview', debouncedPayload),
    enabled: !!debouncedPayload,
    placeholderData: (prev) => prev,
    retry: false,
  });
  useEffect(() => {
    // Prefill protocol texts once (new orders)
    if (!id && preview.data && texts.premedications === undefined) {
      const p = preview.data.protocol;
      setTexts({ premedications: p.premedications ?? '', hydration: p.hydration ?? '', supportiveMedications: p.supportiveMedications ?? '', specialInstructions: p.specialInstructions ?? '', clinicalNotes: '' });
    }
  }, [preview.data, id, texts.premedications]);

  const save = useMutation({
    mutationFn: (submit: boolean) => (id ? api.put(`/orders/${id}`, { ...payload, submit }) : api.post('/orders', { ...payload, submit })),
    onSuccess: (d: any) => {
      toast.success(t('orders.draftCreated'));
      qc.invalidateQueries({ queryKey: ['orders'] });
      qc.invalidateQueries({ queryKey: ['order', d.order.id] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      qc.invalidateQueries({ queryKey: ['patient'] });
      navigate(`/orders/${d.order.id}`);
    },
  });

  if (id && existing.isLoading) return <PageLoader />;
  const setF = (k: string) => (e: any) => setForm((f: any) => ({ ...f, [k]: e.target.value }));
  const setO = (drugId: string, k: keyof Override, v: any) =>
    setOverrides((o) => ({ ...o, [drugId]: { ...o[drugId], [k]: v, ...(k === 'dosePercent' ? { finalDose: undefined } : {}) } }));
  const hasAuc = preview.data?.items?.some((i: any) => i.doseUnit === 'AUC');
  const renal = preview.data?.renalReference;

  return (
    <div className="space-y-4">
      <Link to={id ? `/orders/${id}` : '/orders'} className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
        <ArrowLeft className="h-4 w-4 rtl:rotate-180" /> {t('common.back')}
      </Link>
      <PageHeader icon={<Calculator className="h-5 w-5" />} title={id ? `${t('orders.editOrder')} · ${existing.data?.order.order_number}` : t('orders.new')} subtitle={t('orders.prescriptionOnly')} />

      {!id && !patientId && (
        <Card className="p-4">
          <Field label={t('orders.selectPatient')}>
            <div className="grid gap-2 sm:grid-cols-2">
              <Input placeholder={t('patients.searchHint')} value={patientSearch} onChange={(e) => setPatientSearch(e.target.value)} />
              <Select value={patientId} onChange={(e) => setPatientId(e.target.value)}>
                <option value="">—</option>
                {picker.data?.rows.map((p: any) => (
                  <option key={p.id} value={p.id}>
                    {patientName(p, lang)} · {p.mrn} {p.protocol_name ? `· ${p.protocol_name}` : ''}
                  </option>
                ))}
              </Select>
            </div>
          </Field>
        </Card>
      )}

      {effectivePatient && patient.isLoading && <PageLoader />}
      {effectivePatient && patient.data && !plan && (
        <Card>
          <EmptyState title={t('orders.noActivePlan')}>
            <Button className="mt-2" onClick={() => navigate(`/patients/${effectivePatient}`)}>
              {t('common.open')} {patientName(patient.data, lang)}
            </Button>
          </EmptyState>
        </Card>
      )}

      {plan && patient.data && (
        <div className="grid gap-4 xl:grid-cols-3">
          <div className="space-y-4 xl:col-span-2">
            <Card>
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2 p-4">
                <div>
                  <div className="text-lg font-semibold text-slate-900">{patientName(patient.data, lang)}</div>
                  <div className="ltr-nums text-sm text-slate-500">
                    {patient.data.mrn} · {patient.data.age} · {t(`patients.${patient.data.sex}`)}
                  </div>
                </div>
                <div>
                  <div className="text-2xs font-semibold uppercase text-slate-500">{t('common.protocol')}</div>
                  <div className="flex items-center gap-2 text-sm font-medium">
                    {plan.protocol_name} {preview.data?.protocol.isDemo && <Badge tone="amber">{t('app.demoProtocol')}</Badge>}
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {patient.data.allergies.map((a: any) => (
                    <Badge key={a.id} tone="red">
                      {a.allergen}
                    </Badge>
                  ))}
                </div>
              </div>
              <div className="grid gap-3 border-t border-slate-100 p-4 sm:grid-cols-3 lg:grid-cols-6">
                <Field label={t('common.cycle')} required>
                  <Input type="number" min={1} value={form.cycleNumber} onChange={setF('cycleNumber')} />
                </Field>
                <Field label={t('common.day')} required>
                  <Input type="number" min={1} value={form.dayNumber} onChange={setF('dayNumber')} />
                </Field>
                <Field label={t('orders.plannedDate')} required className="lg:col-span-2">
                  <Input type="date" value={form.plannedDate} onChange={setF('plannedDate')} />
                </Field>
                <Field label={t('orders.height')} required>
                  <Input type="number" step="0.1" value={form.heightCm} onChange={setF('heightCm')} />
                </Field>
                <Field label={t('orders.weight')} required>
                  <Input type="number" step="0.1" value={form.weightKg} onChange={setF('weightKg')} />
                </Field>
              </div>
              <div className="flex flex-wrap items-center gap-4 border-t border-slate-100 bg-brand-50/40 px-4 py-3">
                <div>
                  <div className="text-2xs font-semibold uppercase text-slate-500">{t('orders.bsa')}</div>
                  <div className="ltr-nums text-2xl font-semibold text-brand-800">{preview.data?.bsa ? `${fmtBsa(preview.data.bsa)} m²` : '—'}</div>
                </div>
                <div className="text-xs text-slate-500">
                  {t('orders.bsaFormula')}
                  {preview.data?.bsaError && <div className="text-rose-600">{preview.data.bsaError}</div>}
                </div>
                {preview.isFetching && <Spinner className="ms-auto h-4 w-4" />}
              </div>
              {hasAuc && (
                <div className="grid gap-3 border-t border-slate-100 p-4 sm:grid-cols-3">
                  <Field label={t('orders.gfr')} required hint={t('orders.gfrRequired')}>
                    <Input type="number" step="0.1" value={form.gfr} onChange={setF('gfr')} />
                  </Field>
                  <Field label={t('orders.gfrSource')} className="sm:col-span-2">
                    <Input value={form.gfrSource} onChange={setF('gfrSource')} placeholder="e.g. Measured CrCl / Cockcroft–Gault" />
                  </Field>
                  {renal && (
                    <div className="rounded-md border border-slate-200 bg-slate-50 p-2.5 text-xs text-slate-600 sm:col-span-3">
                      <div className="mb-1 font-semibold text-slate-700">{t('orders.gfrReference')}</div>
                      <div className="flex flex-wrap gap-x-5 gap-y-1">
                        <span>
                          {t('orders.latestCreatinine')}: <b className="ltr-nums">{renal.latestCreatinine ? `${renal.latestCreatinine.value} ${renal.latestCreatinine.unit} (${fmtDate(renal.latestCreatinine.collectedAt, lang)})` : '—'}</b>
                        </span>
                        <span>
                          {t('orders.latestEgfr')}: <b className="ltr-nums">{renal.latestEgfr ? `${renal.latestEgfr.value} ${renal.latestEgfr.unit}` : '—'}</b>
                        </span>
                        <span className="flex items-center gap-1">
                          {t('orders.cockcroftGault')}: <b className="ltr-nums">{renal.cockcroftGault ?? '—'} mL/min</b>
                          {renal.cockcroftGault && (
                            <Button size="xs" onClick={() => setForm((f: any) => ({ ...f, gfr: renal.cockcroftGault, gfrSource: `Cockcroft–Gault estimate (creatinine ${renal.latestCreatinine?.value} mg/dL) — verified by prescriber` }))}>
                              {t('orders.useValue')}
                            </Button>
                          )}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </Card>

            <Card>
              <CardHeader title={t('orders.doseTable')} subtitle={<span className="font-semibold text-amber-700">{t('app.calcDisclaimer')}</span>} />
              {!preview.data ? (
                <div className="flex justify-center p-8">{preview.error ? <ErrorBox error={preview.error} /> : <Spinner />}</div>
              ) : (
                <Table>
                  <thead className="bg-slate-50">
                    <tr>
                      <th className={th}>{t('orders.include')}</th>
                      <th className={th}>{t('chart.drug')}</th>
                      <th className={th}>{t('orders.perUnit')}</th>
                      <th className={th}>{t('orders.calculated')}</th>
                      <th className={th}>{t('orders.dosePercent')}</th>
                      <th className={th}>{t('orders.final')}</th>
                      <th className={th}>{t('orders.previousDose')}</th>
                      <th className={th}>{t('chart.diluent')} / {t('orders.volume')}</th>
                      <th className={th}>{t('chart.infusionTime')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {preview.data.items.map((it: any) => {
                      const o = overrides[it.protocolDrugId] ?? {};
                      const needReason = Number(o.dosePercent ?? 100) !== 100 || it.isManuallyAdjusted;
                      return (
                        <tr key={it.protocolDrugId} className="align-top">
                          <td className={td}>
                            <input type="checkbox" className="h-4 w-4 rounded border-slate-300 text-brand-700" checked={o.include !== false} onChange={(e) => setO(it.protocolDrugId, 'include', e.target.checked)} />
                          </td>
                          <td className={td}>
                            <div className="font-semibold text-slate-900">{it.drugName}</div>
                            <div className="text-xs text-slate-500">
                              {it.route} · {t(`protocols.methods.${it.administrationMethod}`, undefined, it.administrationMethod ?? '')}
                            </div>
                          </td>
                          <td className={clsx(td, 'ltr-nums whitespace-nowrap')}>{doseLabel(it.doseValue, it.doseUnit)}</td>
                          <td className={clsx(td, 'min-w-[160px]')}>
                            {it.calculationError ? (
                              <span className="text-xs font-medium text-rose-700">{it.calculationError}</span>
                            ) : (
                              <>
                                <div className="ltr-nums font-medium">{fmtNum(it.calculatedDose, 2)} mg</div>
                                <div className="ltr-nums text-2xs text-slate-500">{it.formula}</div>
                              </>
                            )}
                          </td>
                          <td className={td}>
                            <Input type="number" min={1} max={150} step={5} className="w-20" value={o.dosePercent ?? '100'} onChange={(e) => setO(it.protocolDrugId, 'dosePercent', e.target.value)} />
                          </td>
                          <td className={clsx(td, 'min-w-[150px]')}>
                            <div className="flex items-center gap-1">
                              <Input type="number" step="any" className={clsx('w-24 font-semibold', it.isManuallyAdjusted && 'border-amber-400 bg-amber-50')} value={o.finalDose ?? (it.finalDose ?? '')} onChange={(e) => setO(it.protocolDrugId, 'finalDose', e.target.value)} />
                              <span className="text-xs text-slate-500">mg</span>
                            </div>
                            {it.isManuallyAdjusted && <div className="mt-0.5 text-2xs font-medium text-amber-700">{t('orders.manualAdjusted')} ({t('orders.rounded')}: {fmtNum(it.roundedDose)})</div>}
                            {needReason && (
                              <Input className="mt-1 text-xs" placeholder={t('orders.modificationReason')} value={o.modificationReason ?? ''} onChange={(e) => setO(it.protocolDrugId, 'modificationReason', e.target.value)} />
                            )}
                          </td>
                          <td className={clsx(td, 'ltr-nums whitespace-nowrap text-slate-500')}>{it.previousFinalDose ? `${fmtNum(it.previousFinalDose)} mg` : '—'}</td>
                          <td className={clsx(td, 'min-w-[170px]')}>
                            <Input className="text-xs" placeholder={t('app.notConfigured')} value={o.diluent ?? it.diluent ?? ''} onChange={(e) => setO(it.protocolDrugId, 'diluent', e.target.value)} />
                            <div className="mt-1 flex items-center gap-1">
                              <Input type="number" className="w-20 text-xs" placeholder="—" value={o.finalVolumeMl ?? it.finalVolumeMl ?? ''} onChange={(e) => setO(it.protocolDrugId, 'finalVolumeMl', e.target.value)} />
                              <span className="text-xs text-slate-500">mL</span>
                            </div>
                          </td>
                          <td className={td}>
                            <div className="flex items-center gap-1">
                              <Input type="number" className="w-20 text-xs" placeholder="—" value={o.infusionDurationMin ?? it.infusionDurationMin ?? ''} onChange={(e) => setO(it.protocolDrugId, 'infusionDurationMin', e.target.value)} />
                              <span className="text-xs text-slate-500">{t('common.minutes')}</span>
                            </div>
                            <div className="mt-0.5 text-2xs text-slate-500">{fmtDuration(Number(o.infusionDurationMin ?? it.infusionDurationMin) || null, lang)}</div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </Table>
              )}
            </Card>

            <Card>
              <div className="grid gap-3 p-4 sm:grid-cols-2">
                {(['premedications', 'hydration', 'supportiveMedications', 'specialInstructions'] as const).map((k) => (
                  <Field key={k} label={t(`orders.${k === 'supportiveMedications' ? 'supportive' : k}`)}>
                    <Textarea value={texts[k] ?? ''} placeholder={t('app.notConfigured')} onChange={(e) => setTexts((x) => ({ ...x, [k]: e.target.value }))} />
                  </Field>
                ))}
                <Field label={t('orders.clinicalNotes')} className="sm:col-span-2">
                  <Textarea value={texts.clinicalNotes ?? ''} onChange={(e) => setTexts((x) => ({ ...x, clinicalNotes: e.target.value }))} />
                </Field>
              </div>
            </Card>
          </div>

          <div className="space-y-4">
            <Card className="xl:sticky xl:top-20">
              <CardHeader title={t('orders.warnings')} icon={<ShieldAlert className="h-4 w-4" />} />
              <div className="space-y-3 p-3">
                {preview.data ? <WarningList warnings={preview.data.warnings} /> : <Spinner />}
                <p className="text-2xs text-slate-500">{t('warnings.neverCancels')}</p>
                {preview.data?.previous && (
                  <div className="rounded-md border border-slate-200 p-2.5 text-xs">
                    <div className="mb-1 font-semibold text-slate-700">
                      {t('orders.previousCycle')}: <span className="ltr-nums">C{preview.data.previous.cycleNumber}D{preview.data.previous.dayNumber} · {fmtDate(preview.data.previous.plannedDate, lang)}</span>
                    </div>
                    <div className="ltr-nums text-slate-600">
                      {preview.data.previous.weightKg} kg · BSA {fmtBsa(preview.data.previous.bsa)} m²
                    </div>
                    <ul className="mt-1 space-y-0.5 text-slate-600">
                      {preview.data.previous.items.map((i: any) => (
                        <li key={i.drug_name} className="flex justify-between gap-2">
                          <span>{i.drug_name}</span>
                          <span className="ltr-nums">{fmtNum(i.final_dose)} mg</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <ErrorBox error={save.error} />
                <div className="flex flex-col gap-2">
                  <Button icon={<Save className="h-4 w-4" />} loading={save.isPending} disabled={!payload} onClick={() => save.mutate(false)}>
                    {t('orders.saveDraft')}
                  </Button>
                  <Button variant="primary" icon={<Send className="h-4 w-4" />} loading={save.isPending} disabled={!payload} onClick={() => save.mutate(true)}>
                    {t('orders.submitReview')}
                  </Button>
                </div>
                <Checkbox checked disabled onChange={() => undefined} label={<span className="text-xs text-slate-500">{t('app.clinicalJudgement')}</span>} />
              </div>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
