import { Database, Plus, Save, Settings as SettingsIcon, Trash2 } from 'lucide-react';
import { ReactNode, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Card, CardHeader, Checkbox, ErrorBox, Field, Input, PageHeader, PageLoader, Select, Textarea } from '../components/ui';
import { useToast } from '../components/Toast';
import { useChairs, useSettings } from '../hooks/useSettings';
import { useI18n } from '../i18n/I18nProvider';
import { api } from '../services/api';

function Section({ title, children, note }: { title: string; children: ReactNode; note?: ReactNode }) {
  return (
    <Card>
      <CardHeader title={title} subtitle={note} />
      <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">{children}</div>
    </Card>
  );
}

export function SettingsPage() {
  const { t } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const settings = useSettings();
  const chairs = useChairs();
  const rules = useQuery({ queryKey: ['rounding-rules'], queryFn: () => api.get<any[]>('/protocols/rounding-rules') });
  const [f, setF] = useState<any>(null);
  useEffect(() => {
    if (settings.data) setF(structuredClone(settings.data.settings));
  }, [settings.data]);
  const save = useMutation({
    mutationFn: () => {
      const { ...body } = f;
      for (const k of ['default_appointment_duration_min', 'arrival_minutes_before', 'delay_grace_minutes', 'dose_difference_threshold_pct', 'weight_change_threshold_pct', 'lab_validity_days', 'calvert_gfr_review_threshold']) body[k] = Number(body[k]);
      return api.put('/settings', body);
    },
    onSuccess: () => {
      toast.success(t('common.success'));
      qc.invalidateQueries({ queryKey: ['settings'] });
    },
    onError: (e) => toast.error(e),
  });
  const reset = useMutation({
    mutationFn: () => api.post('/admin/reset-demo'),
    onSuccess: () => {
      toast.success(t('common.success'));
      qc.invalidateQueries();
    },
    onError: (e) => toast.error(e),
  });
  if (!f) return <PageLoader />;
  const set = (k: string) => (e: any) => setF((x: any) => ({ ...x, [k]: e.target.value }));
  const setB = (k: string) => (v: boolean) => setF((x: any) => ({ ...x, [k]: v }));
  const setUnit = (k: string) => (e: any) => setF((x: any) => ({ ...x, units: { ...x.units, [k]: e.target.value } }));
  return (
    <div className="space-y-4">
      <PageHeader
        icon={<SettingsIcon className="h-5 w-5" />}
        title={t('settings.title')}
        actions={<Button variant="primary" icon={<Save className="h-4 w-4" />} loading={save.isPending} onClick={() => save.mutate()}>{t('common.save')}</Button>}
      />
      <Section title={t('settings.general')}>
        <Field label={t('settings.hospitalName')}><Input value={f.hospital_name} onChange={set('hospital_name')} /></Field>
        <Field label={t('settings.unitName')}><Input value={f.unit_name} onChange={set('unit_name')} /></Field>
        <Field label={t('settings.unitPhone')}><Input value={f.unit_phone} onChange={set('unit_phone')} className="ltr-nums" /></Field>
        <Field label={t('settings.timezone')}><Input value={f.timezone} onChange={set('timezone')} /></Field>
        <Field label={t('settings.defaultLanguage')}>
          <Select value={f.default_language} onChange={set('default_language')}>
            <option value="en">English</option>
            <option value="ar">العربية</option>
          </Select>
        </Field>
        <Field label={t('settings.languagesEnabled')}>
          <div className="flex gap-4 pt-2">
            {['en', 'ar'].map((l) => (
              <Checkbox key={l} checked={f.languages_enabled.includes(l)} onChange={(v) => setF((x: any) => ({ ...x, languages_enabled: v ? [...new Set([...x.languages_enabled, l])] : x.languages_enabled.filter((y: string) => y !== l) }))} label={l === 'en' ? 'English' : 'العربية'} />
            ))}
          </div>
        </Field>
        <Field label={`${t('settings.units')} — height / weight`}>
          <div className="flex gap-2">
            <Select value={f.units.height} onChange={setUnit('height')}><option>cm</option></Select>
            <Select value={f.units.weight} onChange={setUnit('weight')}><option>kg</option></Select>
          </div>
        </Field>
        <Field label={`${t('settings.units')} — creatinine`}>
          <Select value={f.units.creatinine} onChange={setUnit('creatinine')}><option>mg/dL</option><option>µmol/L</option></Select>
        </Field>
        <div className="flex items-end text-sm text-slate-600">
          {t('settings.chairsLink')}&nbsp;
          <Link to="/chairs" className="font-medium text-brand-700 hover:underline">{t('settings.chairsCount')}: {chairs.data?.filter((c) => c.is_active).length ?? '—'}</Link>
        </div>
      </Section>
      <Section title={t('settings.scheduling')}>
        <Field label={t('settings.openTime')}><Input type="time" value={f.unit_open_time} onChange={set('unit_open_time')} /></Field>
        <Field label={t('settings.closeTime')}><Input type="time" value={f.unit_close_time} onChange={set('unit_close_time')} /></Field>
        <Field label={t('settings.defaultDuration')}><Input type="number" value={f.default_appointment_duration_min} onChange={set('default_appointment_duration_min')} /></Field>
        <Field label={t('settings.arrivalMinutes')}><Input type="number" value={f.arrival_minutes_before} onChange={set('arrival_minutes_before')} /></Field>
        <Field label={t('settings.delayGrace')}><Input type="number" value={f.delay_grace_minutes} onChange={set('delay_grace_minutes')} /></Field>
        <div className="flex items-end"><Checkbox checked={f.chair_cleaning_after_treatment} onChange={setB('chair_cleaning_after_treatment')} label={t('settings.cleaningAfter')} /></div>
      </Section>
      <Section title={t('settings.reminders')} note={<>{t('settings.messaging')}: <Badge tone="green">{settings.data?.messagingProvider}</Badge> — {t('appointments.mockNotice')}</>}>
        <Checkbox checked={f.reminder_24h_enabled} onChange={setB('reminder_24h_enabled')} label={t('settings.reminder24')} />
        <Checkbox checked={f.reminder_2h_enabled} onChange={setB('reminder_2h_enabled')} label={t('settings.reminder2')} />
        <div className="flex items-center gap-2">
          <Checkbox checked={f.reminder_same_day_enabled} onChange={setB('reminder_same_day_enabled')} label={t('settings.reminderSameDay')} />
          <Input type="time" className="w-28" value={f.reminder_same_day_time} onChange={set('reminder_same_day_time')} />
        </div>
        <Field label={t('settings.templateEn')} hint={t('settings.templateVars')} className="sm:col-span-2 lg:col-span-3">
          <Textarea rows={7} value={f.whatsapp_template_en} onChange={set('whatsapp_template_en')} dir="ltr" />
        </Field>
        <Field label={t('settings.templateAr')} className="sm:col-span-2 lg:col-span-3">
          <Textarea rows={7} value={f.whatsapp_template_ar} onChange={set('whatsapp_template_ar')} dir="rtl" />
        </Field>
      </Section>
      <Section title={t('settings.dosing')} note={t('settings.thresholdNote')}>
        <Field label={t('settings.defaultRounding')}>
          <Select value={f.default_rounding_rule} onChange={set('default_rounding_rule')}>
            {rules.data?.map((r) => <option key={r.code} value={r.code}>{r.label}</option>)}
          </Select>
        </Field>
        <Field label={t('settings.doseDiff')}><Input type="number" value={f.dose_difference_threshold_pct} onChange={set('dose_difference_threshold_pct')} /></Field>
        <Field label={t('settings.weightChange')}><Input type="number" value={f.weight_change_threshold_pct} onChange={set('weight_change_threshold_pct')} /></Field>
        <Field label={t('settings.labValidity')}><Input type="number" value={f.lab_validity_days} onChange={set('lab_validity_days')} /></Field>
        <Field label={t('settings.gfrThreshold')}><Input type="number" value={f.calvert_gfr_review_threshold} onChange={set('calvert_gfr_review_threshold')} /></Field>
      </Section>
      <Card>
        <CardHeader
          title={t('settings.nursing')}
          actions={<Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setF((x: any) => ({ ...x, pretreatment_checklist: [...x.pretreatment_checklist, { id: `item_${Date.now()}`, en: '', ar: '' }] }))}>{t('settings.addItem')}</Button>}
        />
        <div className="space-y-2 p-4">
          {f.pretreatment_checklist.map((c: any, i: number) => (
            <div key={c.id} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
              <Input value={c.en} placeholder="English" onChange={(e) => setF((x: any) => ({ ...x, pretreatment_checklist: x.pretreatment_checklist.map((y: any, j: number) => (j === i ? { ...y, en: e.target.value } : y)) }))} />
              <Input value={c.ar} dir="rtl" placeholder="العربية" onChange={(e) => setF((x: any) => ({ ...x, pretreatment_checklist: x.pretreatment_checklist.map((y: any, j: number) => (j === i ? { ...y, ar: e.target.value } : y)) }))} />
              <Button size="sm" variant="ghost" onClick={() => setF((x: any) => ({ ...x, pretreatment_checklist: x.pretreatment_checklist.filter((_: any, j: number) => j !== i) }))} aria-label={t('common.delete')}><Trash2 className="h-4 w-4" /></Button>
            </div>
          ))}
        </div>
      </Card>
      {settings.data?.demoMode && (
        <Card className="border-amber-300">
          <CardHeader title={t('settings.demo')} icon={<Database className="h-4 w-4" />} />
          <div className="flex flex-wrap items-center justify-between gap-3 p-4">
            <p className="text-sm text-slate-600">{t('settings.resetDemoConfirm')}</p>
            <Button variant="warning" loading={reset.isPending} onClick={() => confirm(t('settings.resetDemoConfirm')) && reset.mutate()}>{t('settings.resetDemo')}</Button>
          </div>
          <div className="px-4 pb-3"><ErrorBox error={reset.error} /></div>
        </Card>
      )}
    </div>
  );
}
