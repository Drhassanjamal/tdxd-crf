import clsx from 'clsx';
import { FileClock } from 'lucide-react';
import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Badge, Button, Card, Input, PageHeader, Select, Spinner, Table, td, th } from '../components/ui';
import { useI18n } from '../i18n/I18nProvider';
import { api, qs } from '../services/api';
import { addDays, fmtDateTime, todayLocal } from '../utils/format';

function Json({ v }: { v: any }) {
  if (v === null || v === undefined) return <span className="text-slate-300">—</span>;
  const s = JSON.stringify(v);
  return (
    <details>
      <summary className="max-w-[240px] cursor-pointer truncate text-xs text-slate-600">{s.length > 60 ? `${s.slice(0, 60)}…` : s}</summary>
      <pre className="mt-1 max-h-60 max-w-[420px] overflow-auto rounded bg-slate-50 p-2 text-2xs text-slate-700" dir="ltr">{JSON.stringify(v, null, 2)}</pre>
    </details>
  );
}

export function AuditPage() {
  const { t, lang } = useI18n();
  const [from, setFrom] = useState(addDays(todayLocal(), -7));
  const [to, setTo] = useState(todayLocal());
  const [action, setAction] = useState('');
  const [page, setPage] = useState(1);
  const q = useQuery({
    queryKey: ['audit', from, to, action, page],
    queryFn: () => api.get(`/audit${qs({ from, to, action, page, pageSize: 50 })}`),
    placeholderData: keepPreviousData,
  });
  const pages = q.data ? Math.max(1, Math.ceil(q.data.total / q.data.pageSize)) : 1;
  return (
    <div>
      <PageHeader icon={<FileClock className="h-5 w-5" />} title={t('audit.title')} subtitle={t('audit.appendOnly')} />
      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-3">
          <Input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} className="w-40" />
          <span className="text-slate-400">→</span>
          <Input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} className="w-40" />
          <Select value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }} className="w-64">
            <option value="">{t('audit.action')}: {t('common.all')}</option>
            {q.data?.actions.map((a: string) => <option key={a}>{a}</option>)}
          </Select>
          {q.isFetching && <Spinner className="h-4 w-4" />}
          <span className="ms-auto text-sm text-slate-500">{q.data?.total ?? 0}</span>
        </div>
        <Table>
          <thead className="bg-slate-50">
            <tr>
              {['common.date', 'audit.user', 'audit.action', 'audit.entity', 'common.patient', 'common.details', 'audit.previous', 'audit.newValue', 'audit.ip'].map((k) => <th key={k} className={th}>{t(k)}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {q.data?.rows.map((r: any) => (
              <tr key={r.id}>
                <td className={clsx(td, 'ltr-nums whitespace-nowrap')}>{fmtDateTime(r.occurred_at, lang)}</td>
                <td className={td}>
                  <div className="whitespace-nowrap font-medium">{r.user_name ?? r.user_email}</div>
                  {r.user_role && <div className="text-2xs text-slate-500">{r.user_role}</div>}
                </td>
                <td className={td}><Badge tone={r.action.includes('FAILED') || r.action.includes('CANCEL') ? 'red' : r.action.includes('APPROVED') || r.action.includes('COMPLETED') ? 'green' : 'slate'}>{r.action}</Badge></td>
                <td className={clsx(td, 'text-xs text-slate-500')}>{r.entity_type}</td>
                <td className={clsx(td, 'whitespace-nowrap')}>{r.patient_name ? <>{r.patient_name}<div className="ltr-nums text-2xs text-slate-500">{r.patient_mrn}</div></> : '—'}</td>
                <td className={clsx(td, 'max-w-[260px] text-xs')}>{r.description ?? '—'}</td>
                <td className={td}><Json v={r.previous_value} /></td>
                <td className={td}><Json v={r.new_value} /></td>
                <td className={clsx(td, 'ltr-nums text-2xs text-slate-500')}>{r.ip_address ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </Table>
        <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-3 py-2 text-sm">
          <Button size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>{t('common.previous')}</Button>
          <span className="text-slate-500">{t('common.page')} {page} {t('common.of')} {pages}</span>
          <Button size="sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>{t('common.next')}</Button>
        </div>
      </Card>
    </div>
  );
}
