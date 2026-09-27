import clsx from 'clsx';
import { Armchair, Pencil, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { StatusBadge, statusTone } from '../components/StatusBadge';
import { Badge, Button, Card, CardHeader, Checkbox, ErrorBox, Field, Input, Modal, PageHeader, PageLoader, Select } from '../components/ui';
import { useToast } from '../components/Toast';
import { useAuth } from '../hooks/useAuth';
import { useChairs, useSettings } from '../hooks/useSettings';
import { useI18n } from '../i18n/I18nProvider';
import { api } from '../services/api';
import { hhmm, minutesToTime, timeToMinutes, todayLocal } from '../utils/format';

const FILL: Record<string, string> = {
  slate: 'bg-slate-300', teal: 'bg-teal-400', orange: 'bg-orange-400', amber: 'bg-amber-400', violet: 'bg-violet-400',
  blue: 'bg-blue-500', green: 'bg-emerald-400', red: 'bg-rose-300', sky: 'bg-sky-400',
};

function ChairModal({ open, onClose, chair }: { open: boolean; onClose: () => void; chair?: any }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [f, setF] = useState<any>({});
  useEffect(() => {
    if (open) setF(chair ? { name: chair.name, zone: chair.zone ?? '', chairType: chair.chair_type, sortOrder: chair.sort_order, isActive: chair.is_active } : { code: '', name: '', zone: '', chairType: 'RECLINER', sortOrder: 10 });
  }, [open, chair]);
  const m = useMutation({
    mutationFn: () => (chair ? api.put(`/chairs/${chair.id}`, { ...f, sortOrder: Number(f.sortOrder), zone: f.zone || null }) : api.post('/chairs', { ...f, sortOrder: Number(f.sortOrder), zone: f.zone || null })),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['chairs'] });
      onClose();
    },
  });
  const set = (k: string) => (e: any) => setF((x: any) => ({ ...x, [k]: e.target.value }));
  return (
    <Modal open={open} onClose={onClose} size="sm" title={chair ? chair.name : t('chairs.new')} footer={<><Button onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" loading={m.isPending} onClick={() => m.mutate()}>{t('common.save')}</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        {!chair && <Field label={t('chairs.code')} required><Input value={f.code ?? ''} onChange={set('code')} placeholder="CH-07" /></Field>}
        <Field label={t('chairs.name')} required><Input value={f.name ?? ''} onChange={set('name')} /></Field>
        <Field label={t('chairs.zone')}><Input value={f.zone ?? ''} onChange={set('zone')} /></Field>
        <Field label={t('chairs.chairType')}>
          <Select value={f.chairType} onChange={set('chairType')}>
            {['RECLINER', 'BED', 'ISOLATION'].map((c) => <option key={c} value={c}>{t(`chairs.types.${c}`)}</option>)}
          </Select>
        </Field>
        <Field label="Sort"><Input type="number" value={f.sortOrder ?? 0} onChange={set('sortOrder')} /></Field>
        {chair && <Checkbox checked={!!f.isActive} onChange={(v) => setF((x: any) => ({ ...x, isActive: v }))} label={t('users.active')} />}
        <div className="sm:col-span-2"><ErrorBox error={m.error} /></div>
      </div>
    </Modal>
  );
}

export function ChairsPage() {
  const { t, lang } = useI18n();
  const { can } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const settings = useSettings();
  const [date, setDate] = useState(todayLocal());
  const chairs = useChairs(date);
  const [editing, setEditing] = useState<any>(undefined);
  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => api.post(`/chairs/${id}/status`, { status }),
    onSuccess: () => {
      toast.success(t('common.success'));
      qc.invalidateQueries({ queryKey: ['chairs'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (e) => toast.error(e),
  });
  if (chairs.isLoading) return <PageLoader />;
  const s = settings.data?.settings;
  const open = timeToMinutes(s?.unit_open_time ?? '08:00') - 60;
  const close = timeToMinutes(s?.unit_close_time ?? '16:00') + 180;
  const pos = (m: number) => `${Math.max(0, Math.min(100, ((m - open) / (close - open)) * 100))}%`;
  const hours = Array.from({ length: Math.floor((close - open) / 60) + 1 }, (_, i) => open + i * 60);
  const nowMin = timeToMinutes(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: s?.timezone ?? 'Asia/Baghdad' }).format(new Date()));
  return (
    <div className="space-y-4">
      <PageHeader
        icon={<Armchair className="h-5 w-5" />}
        title={t('chairs.title')}
        subtitle={`${chairs.data?.filter((c) => c.is_active).length} ${t('settings.chairsCount').toLowerCase()} · ${t('appointments.conflictHint')}`}
        actions={
          <>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-40" />
            {can('chairs.manage') && <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setEditing(null)}>{t('chairs.new')}</Button>}
          </>
        }
      />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {chairs.data?.map((c) => (
          <Card key={c.id} className={clsx(!c.is_active && 'opacity-60')}>
            <CardHeader
              title={<span className="flex items-center gap-2">{c.name} <span className="ltr-nums text-xs font-normal text-slate-400">{c.code}</span>{!c.is_active && <Badge>{t('chairs.inactive')}</Badge>}</span>}
              subtitle={`${c.zone ?? ''} · ${t(`chairs.types.${c.chair_type}`)}`}
              actions={
                <>
                  <StatusBadge kind="chair" status={c.status} />
                  {can('chairs.manage') && <Button size="xs" variant="ghost" onClick={() => setEditing(c)} aria-label={t('common.edit')}><Pencil className="h-3.5 w-3.5" /></Button>}
                </>
              }
            />
            <div className="space-y-2 p-3 text-sm">
              <div>
                <span className="text-xs text-slate-500">{t('chairs.occupant')}: </span>
                {c.occupant_name ? (
                  <button className="font-medium text-brand-700 hover:underline" onClick={() => navigate(`/patients/${c.occupant_patient_id}`)}>
                    {lang === 'ar' && c.occupant_name_ar ? c.occupant_name_ar : c.occupant_name} · {c.occupant_protocol} {c.occupant_cycle && `C${c.occupant_cycle}D${c.occupant_day}`}
                  </button>
                ) : (
                  <span className="text-slate-400">{t('chairs.free')}</span>
                )}
              </div>
              {c.status_note && <div className="text-xs text-slate-500">{c.status_note}</div>}
              {can('chairs.status') && c.is_active && (
                <div className="flex flex-wrap gap-1.5">
                  {['AVAILABLE', 'CLEANING', 'OUT_OF_SERVICE'].filter((st) => st !== c.status).map((st) => (
                    <Button key={st} size="xs" variant={st === 'OUT_OF_SERVICE' ? 'ghost' : 'secondary'} onClick={() => setStatus.mutate({ id: c.id, status: st })}>
                      → {t(`status.chair.${st}`)}
                    </Button>
                  ))}
                </div>
              )}
            </div>
          </Card>
        ))}
      </div>
      <Card>
        <CardHeader title={`${t('chairs.occupancy')} · ${date}`} />
        <div className="overflow-x-auto p-3">
          <div className="min-w-[760px]">
            <div className="relative ms-24 h-5 text-2xs text-slate-400">
              {hours.map((h) => (
                <span key={h} className="ltr-nums absolute -translate-x-1/2 rtl:translate-x-1/2" style={{ insetInlineStart: pos(h) }}>{minutesToTime(h)}</span>
              ))}
            </div>
            {chairs.data?.filter((c) => c.is_active).map((c) => (
              <div key={c.id} className="flex items-center gap-2 py-1">
                <div className="w-22 w-24 shrink-0 text-sm font-medium text-slate-700">{c.name}</div>
                <div className="relative h-9 flex-1 rounded-md bg-slate-100">
                  {hours.map((h) => <div key={h} className="absolute inset-y-0 border-s border-white" style={{ insetInlineStart: pos(h) }} />)}
                  {c.bookings.map((b: any) => {
                    const st = timeToMinutes(b.start_time);
                    return (
                      <div
                        key={b.id}
                        title={`${hhmm(b.start_time)} ${b.patient_name} (${b.duration_minutes} min)`}
                        className={clsx('absolute inset-y-1 overflow-hidden rounded px-1.5 text-2xs font-medium leading-7 text-slate-900 ring-2 ring-white', FILL[statusTone('appointment', b.status)])}
                        style={{ insetInlineStart: pos(st), width: `calc(${pos(st + b.duration_minutes)} - ${pos(st)})` }}
                      >
                        <span className="truncate">{lang === 'ar' && b.patient_name_ar ? b.patient_name_ar : b.patient_name}</span>
                      </div>
                    );
                  })}
                  {date === todayLocal() && nowMin > open && nowMin < close && <div className="absolute inset-y-0 w-0.5 bg-rose-500" style={{ insetInlineStart: pos(nowMin) }} />}
                </div>
              </div>
            ))}
          </div>
        </div>
      </Card>
      <ChairModal open={editing !== undefined} onClose={() => setEditing(undefined)} chair={editing ?? undefined} />
    </div>
  );
}
