import clsx from 'clsx';
import { FlaskConical, Pencil, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Card, CardHeader, Checkbox, ErrorBox, Field, InfoRow, Input, Modal, PageHeader, PageLoader, Select, Table, Tabs, td, Textarea, th } from '../components/ui';
import { useToast } from '../components/Toast';
import { useAuth } from '../hooks/useAuth';
import { useI18n } from '../i18n/I18nProvider';
import { api } from '../services/api';
import { doseLabel, fmtDate, fmtDuration, fmtNum } from '../utils/format';
import { NotConfigured } from './OrderDetailPage';
import { CANCER_TYPES } from '../utils/constants';

const LAB_CODES = ['HB', 'WBC', 'ANC', 'PLT', 'CREAT', 'EGFR', 'AST', 'ALT', 'ALP', 'BILI', 'ALB', 'NA', 'K', 'MG', 'TSH'];

function ProtocolEditor({ open, onClose, protocol }: { open: boolean; onClose: () => void; protocol?: any }) {
  const { t } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const rules = useQuery({ queryKey: ['rounding-rules'], queryFn: () => api.get<any[]>('/protocols/rounding-rules') });
  const [f, setF] = useState<any>(null);
  useEffect(() => {
    if (!open) return;
    const p = protocol;
    setF({
      code: p?.code ?? '', name: p?.name ?? '', cancerType: p?.cancer_type ?? 'Colorectal', intent: p?.intent ?? 'PALLIATIVE',
      cycleLengthDays: p?.cycle_length_days ?? 21, plannedCycles: p?.planned_cycles ?? 6, estimatedDurationMin: p?.estimated_duration_min ?? '',
      premedications: p?.premedications ?? '', hydration: p?.hydration ?? '', supportiveMedications: p?.supportive_medications ?? '',
      specialInstructions: p?.special_instructions ?? '', requiredLabs: p?.required_labs ?? ['HB', 'ANC', 'PLT', 'CREAT'],
      defaultRoundingRule: p?.default_rounding_rule ?? 'NEAREST_1', isDemo: p?.is_demo ?? true, isActive: p?.is_active ?? true,
      drugs: (p?.drugs ?? []).map((d: any) => ({
        sequence: d.sequence, drugName: d.drug_name, doseValue: d.dose_value, doseUnit: d.dose_unit, route: d.route,
        administrationMethod: d.administration_method ?? 'INFUSION', diluent: d.diluent ?? '', finalVolumeMl: d.final_volume_ml ?? '',
        infusionDurationMin: d.infusion_duration_min ?? '', treatmentDays: (d.treatment_days ?? [1]).join(','), premedicationRequired: d.premedication_required,
        roundingRule: d.rounding_rule ?? '', specialInstructions: d.special_instructions ?? '',
      })),
    });
  }, [open, protocol]);
  const m = useMutation({
    mutationFn: () => {
      const body = {
        ...f,
        cycleLengthDays: Number(f.cycleLengthDays),
        plannedCycles: Number(f.plannedCycles),
        estimatedDurationMin: f.estimatedDurationMin ? Number(f.estimatedDurationMin) : null,
        drugs: f.drugs.map((d: any) => ({
          ...d,
          sequence: Number(d.sequence),
          doseValue: Number(d.doseValue),
          finalVolumeMl: d.finalVolumeMl ? Number(d.finalVolumeMl) : null,
          infusionDurationMin: d.infusionDurationMin ? Number(d.infusionDurationMin) : null,
          treatmentDays: String(d.treatmentDays || '1').split(',').map((x: string) => Number(x.trim())).filter(Boolean),
          roundingRule: d.roundingRule || null,
        })),
      };
      return protocol ? api.put(`/protocols/${protocol.id}`, body) : api.post('/protocols', body);
    },
    onSuccess: () => {
      toast.success(t('common.success'));
      qc.invalidateQueries({ queryKey: ['protocols'] });
      onClose();
    },
  });
  if (!f) return null;
  const set = (k: string) => (e: any) => setF((x: any) => ({ ...x, [k]: e.target.value }));
  const setDrug = (i: number, k: string, v: any) => setF((x: any) => ({ ...x, drugs: x.drugs.map((d: any, j: number) => (j === i ? { ...d, [k]: v } : d)) }));
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      title={protocol ? `${t('common.edit')} · ${protocol.name}` : t('protocols.new')}
      footer={
        <>
          <span className="me-auto text-xs text-slate-500">{t('protocols.versionNote')}</span>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" loading={m.isPending} onClick={() => m.mutate()}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-4">
          <Field label={t('protocols.code')} required>
            <Input value={f.code} onChange={set('code')} disabled={!!protocol} className="ltr-nums" />
          </Field>
          <Field label={t('protocols.name')} required className="sm:col-span-3">
            <Input value={f.name} onChange={set('name')} />
          </Field>
          <Field label={t('patients.cancerType')}>
            <Select value={f.cancerType} onChange={set('cancerType')}>
              {CANCER_TYPES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </Select>
          </Field>
          <Field label={t('chart.intent')}>
            <Select value={f.intent} onChange={set('intent')}>
              {['CURATIVE', 'ADJUVANT', 'NEOADJUVANT', 'PALLIATIVE', 'MAINTENANCE'].map((i) => (
                <option key={i} value={i}>
                  {t(`intent.${i}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={`${t('chart.cycleLength')} (${t('chart.days')})`}>
            <Input type="number" value={f.cycleLengthDays} onChange={set('cycleLengthDays')} />
          </Field>
          <Field label={t('chart.plannedCycles')}>
            <Input type="number" value={f.plannedCycles} onChange={set('plannedCycles')} />
          </Field>
          <Field label={`${t('protocols.estimatedDuration')} (${t('common.minutes')})`}>
            <Input type="number" value={f.estimatedDurationMin} onChange={set('estimatedDurationMin')} />
          </Field>
          <Field label={t('protocols.defaultRounding')}>
            <Select value={f.defaultRoundingRule} onChange={set('defaultRoundingRule')}>
              {rules.data?.map((r) => (
                <option key={r.code} value={r.code}>
                  {r.label}
                </option>
              ))}
            </Select>
          </Field>
          <div className="flex flex-col justify-end gap-2 sm:col-span-2">
            <Checkbox checked={f.isDemo} onChange={(v) => setF((x: any) => ({ ...x, isDemo: v }))} label={t('protocols.demoFlag')} />
            <Checkbox checked={f.isActive} onChange={(v) => setF((x: any) => ({ ...x, isActive: v }))} label={t('protocols.active')} />
          </div>
        </div>
        <Field label={t('protocols.requiredLabs')}>
          <div className="flex flex-wrap gap-2">
            {LAB_CODES.map((c) => (
              <Checkbox key={c} checked={f.requiredLabs.includes(c)} onChange={(v) => setF((x: any) => ({ ...x, requiredLabs: v ? [...x.requiredLabs, c] : x.requiredLabs.filter((y: string) => y !== c) }))} label={c} className="rounded border border-slate-200 px-2 py-1" />
            ))}
          </div>
        </Field>
        <div className="rounded-lg border border-slate-200">
          <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
            <span className="text-sm font-semibold">{t('protocols.drugs')}</span>
            <Button
              size="xs"
              icon={<Plus className="h-3.5 w-3.5" />}
              onClick={() => setF((x: any) => ({ ...x, drugs: [...x.drugs, { sequence: x.drugs.length + 1, drugName: '', doseValue: '', doseUnit: 'MG_M2', route: 'IV', administrationMethod: 'INFUSION', diluent: '', finalVolumeMl: '', infusionDurationMin: '', treatmentDays: '1', premedicationRequired: false, roundingRule: '', specialInstructions: '' }] }))}
            >
              {t('protocols.addDrug')}
            </Button>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-[1100px] text-xs">
              <thead className="bg-slate-50">
                <tr>
                  {['orders.sequence', 'chart.drug', 'protocols.doseValue', 'protocols.doseUnit', 'chart.route', 'protocols.method', 'chart.diluent', 'orders.volume', 'chart.infusionTime', 'protocols.treatmentDays', 'orders.rounding', 'protocols.premedRequired', ''].map((k) => (
                    <th key={k} className={th}>
                      {k ? t(k) : ''}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {f.drugs.map((d: any, i: number) => (
                  <tr key={i} className="border-t border-slate-100">
                    <td className="p-1"><Input className="w-14" type="number" value={d.sequence} onChange={(e) => setDrug(i, 'sequence', e.target.value)} /></td>
                    <td className="p-1"><Input className="w-40" value={d.drugName} onChange={(e) => setDrug(i, 'drugName', e.target.value)} /></td>
                    <td className="p-1"><Input className="w-20" type="number" step="any" value={d.doseValue} onChange={(e) => setDrug(i, 'doseValue', e.target.value)} /></td>
                    <td className="p-1">
                      <Select className="w-28" value={d.doseUnit} onChange={(e) => setDrug(i, 'doseUnit', e.target.value)}>
                        {['MG', 'MG_M2', 'MG_KG', 'AUC'].map((u) => <option key={u} value={u}>{t(`protocols.units.${u}`)}</option>)}
                      </Select>
                    </td>
                    <td className="p-1">
                      <Select className="w-20" value={d.route} onChange={(e) => setDrug(i, 'route', e.target.value)}>
                        {['IV', 'PO', 'SC', 'IM'].map((r) => <option key={r}>{r}</option>)}
                      </Select>
                    </td>
                    <td className="p-1">
                      <Select className="w-36" value={d.administrationMethod} onChange={(e) => setDrug(i, 'administrationMethod', e.target.value)}>
                        {['INFUSION', 'BOLUS', 'CONTINUOUS_INFUSION', 'ORAL', 'INJECTION'].map((r) => <option key={r} value={r}>{t(`protocols.methods.${r}`)}</option>)}
                      </Select>
                    </td>
                    <td className="p-1"><Input className="w-36" value={d.diluent} placeholder={t('app.notConfigured')} onChange={(e) => setDrug(i, 'diluent', e.target.value)} /></td>
                    <td className="p-1"><Input className="w-20" type="number" value={d.finalVolumeMl} onChange={(e) => setDrug(i, 'finalVolumeMl', e.target.value)} /></td>
                    <td className="p-1"><Input className="w-20" type="number" value={d.infusionDurationMin} onChange={(e) => setDrug(i, 'infusionDurationMin', e.target.value)} /></td>
                    <td className="p-1"><Input className="w-16" value={d.treatmentDays} onChange={(e) => setDrug(i, 'treatmentDays', e.target.value)} /></td>
                    <td className="p-1">
                      <Select className="w-32" value={d.roundingRule} onChange={(e) => setDrug(i, 'roundingRule', e.target.value)}>
                        <option value="">({t('protocols.defaultRounding')})</option>
                        {rules.data?.map((r) => <option key={r.code} value={r.code}>{r.label}</option>)}
                      </Select>
                    </td>
                    <td className="p-1 text-center"><input type="checkbox" checked={d.premedicationRequired} onChange={(e) => setDrug(i, 'premedicationRequired', e.target.checked)} /></td>
                    <td className="p-1">
                      <Button size="xs" variant="ghost" onClick={() => setF((x: any) => ({ ...x, drugs: x.drugs.filter((_: any, j: number) => j !== i) }))} aria-label={t('common.delete')}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('orders.premedications')}><Textarea value={f.premedications} onChange={set('premedications')} placeholder={t('app.notConfigured')} /></Field>
          <Field label={t('orders.hydration')}><Textarea value={f.hydration} onChange={set('hydration')} placeholder={t('app.notConfigured')} /></Field>
          <Field label={t('orders.supportive')}><Textarea value={f.supportiveMedications} onChange={set('supportiveMedications')} placeholder={t('app.notConfigured')} /></Field>
          <Field label={t('orders.specialInstructions')}><Textarea value={f.specialInstructions} onChange={set('specialInstructions')} /></Field>
        </div>
        <ErrorBox error={m.error} />
      </div>
    </Modal>
  );
}

export function ProtocolsPage() {
  const { t, lang } = useI18n();
  const { can } = useAuth();
  const [params] = useSearchParams();
  const qc = useQueryClient();
  const [tab, setTab] = useState<'library' | 'catalog'>('library');
  const [selectedId, setSelectedId] = useState<string | null>(params.get('id'));
  const [editing, setEditing] = useState<any>(undefined);
  const q = useQuery({ queryKey: ['protocols', 'all'], queryFn: () => api.get<any[]>('/protocols?all=true') });
  const catalog = useQuery({ queryKey: ['drugs'], queryFn: () => api.get<any[]>('/drugs'), enabled: tab === 'catalog' });
  const toggle = useMutation({
    mutationFn: (p: any) => api.patch(`/protocols/${p.id}/active`, { isActive: !p.is_active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['protocols'] }),
  });
  if (q.isLoading) return <PageLoader />;
  const list = q.data ?? [];
  const sel = list.find((p) => p.id === selectedId) ?? list[0];
  return (
    <div>
      <PageHeader
        icon={<FlaskConical className="h-5 w-5" />}
        title={t('protocols.title')}
        subtitle={t('app.demoProtocol')}
        actions={can('protocols.write') && <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setEditing(null)}>{t('protocols.new')}</Button>}
      />
      <Tabs className="mb-3" value={tab} onChange={setTab} tabs={[{ id: 'library', label: t('protocols.title') }, { id: 'catalog', label: t('protocols.drugCatalog') }]} />
      {tab === 'library' && (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="h-fit">
            <ul className="divide-y divide-slate-100">
              {list.map((p) => (
                <li key={p.id}>
                  <button onClick={() => setSelectedId(p.id)} className={clsx('w-full px-4 py-3 text-start hover:bg-slate-50', sel?.id === p.id && 'bg-brand-50/60')}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-slate-900">{p.name}</span>
                      {!p.is_active && <Badge>{t('protocols.inactive')}</Badge>}
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                      <span className="ltr-nums">{p.code}</span>· {p.cancer_type} · q{p.cycle_length_days}d × {p.planned_cycles}
                      {p.is_demo && <Badge tone="amber">DEMO</Badge>}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </Card>
          {sel && (
            <div className="space-y-4 lg:col-span-2">
              {sel.is_demo && (
                <div className="rounded-lg border-2 border-amber-400 bg-amber-50 px-4 py-2 text-center text-sm font-bold tracking-wide text-amber-900">{t('app.demoProtocol')}</div>
              )}
              <Card>
                <CardHeader
                  title={sel.name}
                  subtitle={`${sel.code} · v${sel.version} · ${fmtDate(sel.updated_at, lang)}`}
                  actions={
                    can('protocols.write') && (
                      <>
                        <Button size="sm" onClick={() => toggle.mutate(sel)}>{sel.is_active ? t('protocols.deactivate') : t('protocols.activate')}</Button>
                        <Button size="sm" icon={<Pencil className="h-4 w-4" />} onClick={() => setEditing(sel)}>{t('common.edit')}</Button>
                      </>
                    )
                  }
                />
                <dl className="grid gap-4 p-4 sm:grid-cols-3 lg:grid-cols-6">
                  <InfoRow label={t('patients.cancerType')} value={sel.cancer_type} />
                  <InfoRow label={t('chart.intent')} value={t(`intent.${sel.intent}`)} />
                  <InfoRow label={t('chart.cycleLength')} value={`${sel.cycle_length_days} ${t('chart.days')}`} />
                  <InfoRow label={t('chart.plannedCycles')} value={sel.planned_cycles} />
                  <InfoRow label={t('protocols.estimatedDuration')} value={fmtDuration(sel.estimated_duration_min, lang)} />
                  <InfoRow label={t('protocols.defaultRounding')} value={sel.default_rounding_rule} />
                  <InfoRow label={t('protocols.requiredLabs')} value={sel.required_labs.join(', ')} className="sm:col-span-3 lg:col-span-6" />
                </dl>
                <Table>
                  <thead className="bg-slate-50">
                    <tr>
                      {['orders.sequence', 'chart.drug', 'chart.dose', 'chart.route', 'protocols.method', 'chart.diluent', 'orders.volume', 'chart.infusionTime', 'protocols.treatmentDays', 'orders.rounding'].map((k) => (
                        <th key={k} className={th}>{t(k)}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {sel.drugs.map((d: any) => (
                      <tr key={d.id}>
                        <td className={clsx(td, 'ltr-nums')}>{d.sequence}</td>
                        <td className={clsx(td, 'font-semibold')}>
                          {d.drug_name}
                          {d.premedication_required && <Badge tone="violet" className="ms-1">premed</Badge>}
                          {d.special_instructions && <div className="text-2xs font-normal text-slate-500">{d.special_instructions}</div>}
                        </td>
                        <td className={clsx(td, 'ltr-nums whitespace-nowrap')}>{doseLabel(d.dose_value, d.dose_unit)}</td>
                        <td className={td}>{d.route}</td>
                        <td className={td}>{t(`protocols.methods.${d.administration_method}`, undefined, d.administration_method ?? '—')}</td>
                        <td className={td}>{d.diluent ?? <NotConfigured />}</td>
                        <td className={clsx(td, 'ltr-nums')}>{d.final_volume_ml ? `${fmtNum(d.final_volume_ml)} mL` : d.administration_method === 'BOLUS' ? '—' : <NotConfigured />}</td>
                        <td className={td}>{d.infusion_duration_min ? fmtDuration(d.infusion_duration_min, lang) : d.administration_method === 'BOLUS' ? 'Bolus' : <NotConfigured />}</td>
                        <td className={clsx(td, 'ltr-nums')}>D{(d.treatment_days ?? [1]).join(', D')}</td>
                        <td className={td}>{d.rounding_rule ?? `(${sel.default_rounding_rule})`}</td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </Card>
              <div className="grid gap-4 md:grid-cols-2">
                {(
                  [
                    ['orders.premedications', sel.premedications],
                    ['orders.hydration', sel.hydration],
                    ['orders.supportive', sel.supportive_medications],
                    ['orders.specialInstructions', sel.special_instructions],
                  ] as const
                ).map(([k, v]) => (
                  <Card key={k} className="p-3">
                    <div className="text-2xs font-semibold uppercase tracking-wide text-slate-500">{t(k)}</div>
                    <div className="mt-1 whitespace-pre-wrap text-sm">{v || <NotConfigured />}</div>
                  </Card>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
      {tab === 'catalog' && (
        <Card>
          <Table>
            <thead className="bg-slate-50">
              <tr>
                {['chart.drug', 'protocols.strength', 'protocols.vialSize', 'protocols.manufacturer', 'protocols.batch', 'protocols.expiry', 'protocols.stock'].map((k) => (
                  <th key={k} className={th}>{t(k)}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {catalog.data?.flatMap((d) =>
                d.products.flatMap((p: any) =>
                  (p.batches.length ? p.batches : [null]).map((b: any, i: number) => (
                    <tr key={`${p.id}-${i}`}>
                      <td className={clsx(td, 'font-medium')}>{d.generic_name} <span className="text-xs font-normal text-slate-500">{d.drug_class}</span></td>
                      <td className={clsx(td, 'ltr-nums')}>{fmtNum(p.strength)} {p.strength_unit}</td>
                      <td className={clsx(td, 'ltr-nums')}>{p.vial_size_ml ? `${fmtNum(p.vial_size_ml)} mL` : '—'}</td>
                      <td className={td}>{p.manufacturer}</td>
                      <td className={clsx(td, 'ltr-nums')}>{b?.batch_number ?? '—'}</td>
                      <td className={clsx(td, 'ltr-nums')}>{b ? fmtDate(b.expiry_date, lang) : '—'}</td>
                      <td className={clsx(td, 'ltr-nums')}>{b?.quantity_on_hand ?? '—'}</td>
                    </tr>
                  )),
                ),
              )}
            </tbody>
          </Table>
          <p className="border-t border-slate-100 px-4 py-2 text-xs text-slate-500">{t('orders.vialNote')} — DEMO inventory.</p>
        </Card>
      )}
      <ProtocolEditor open={editing !== undefined} onClose={() => setEditing(undefined)} protocol={editing ?? undefined} />
    </div>
  );
}
