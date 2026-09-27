import clsx from 'clsx';
import { BarChart3, FileSpreadsheet, FileText, Printer } from 'lucide-react';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button, Card, CardHeader, EmptyState, ErrorBox, Input, PageHeader, Spinner, Table, td, th } from '../components/ui';
import { useSettings } from '../hooks/useSettings';
import { useI18n } from '../i18n/I18nProvider';
import { api, qs } from '../services/api';
import { addDays, downloadUrl, fmtDate, fmtNum, todayLocal } from '../utils/format';

const TYPES = [
  'daily-activity', 'monthly-activity', 'patients-treated', 'treatment-cycles', 'drug-usage', 'chair-utilization',
  'cancelled-appointments', 'delayed-treatments', 'treatment-completion', 'cancer-type-distribution', 'protocol-distribution', 'physician-workload',
];

// Single-series magnitude → one sequential hue (blue), thin bars with rounded data ends.
const BAR = '#2a78d6';

function BarChart({ rows, labelKey, valueKey, title, vertical }: { rows: any[]; labelKey: string; valueKey: string; title: string; vertical?: boolean }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...rows.map((r) => Number(r[valueKey]) || 0));
  if (vertical) {
    return (
      <figure aria-label={title}>
        <div className="relative flex h-44 items-end gap-[2px] border-b border-slate-200 px-1">
          {rows.map((r, i) => {
            const v = Number(r[valueKey]) || 0;
            return (
              <div key={i} className="relative flex h-full flex-1 items-end" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
                <div className="w-full rounded-t-[4px]" style={{ height: `${(v / max) * 100}%`, minHeight: v ? 2 : 0, background: BAR, opacity: hover === null || hover === i ? 1 : 0.55 }} />
                {hover === i && (
                  <div className="pointer-events-none absolute bottom-full start-1/2 z-10 mb-1 -translate-x-1/2 whitespace-nowrap rounded-md border border-slate-200 bg-white px-2 py-1 text-xs shadow-lg rtl:translate-x-1/2">
                    <div className="text-slate-500">{String(r[labelKey])}</div>
                    <div className="font-semibold text-slate-900 ltr-nums">{fmtNum(v)}</div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <div className="mt-1 flex justify-between text-2xs text-slate-500 ltr-nums">
          <span>{rows[0]?.[labelKey]}</span>
          <span>{rows[rows.length - 1]?.[labelKey]}</span>
        </div>
      </figure>
    );
  }
  return (
    <figure aria-label={title} className="space-y-1.5">
      {rows.slice(0, 15).map((r, i) => {
        const v = Number(r[valueKey]) || 0;
        return (
          <div key={i} className="grid grid-cols-[minmax(90px,200px)_1fr_auto] items-center gap-2 text-xs" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
            <span className="truncate text-slate-600" title={String(r[labelKey])}>{r[labelKey]}</span>
            <div className="relative h-3">
              <div className="h-full rounded-e-[4px]" style={{ width: `${(v / max) * 100}%`, minWidth: v ? 2 : 0, background: BAR, opacity: hover === null || hover === i ? 1 : 0.55 }} />
            </div>
            <span className={clsx('ltr-nums tabular text-slate-700', hover === i && 'font-semibold text-slate-900')}>{fmtNum(v)}</span>
          </div>
        );
      })}
    </figure>
  );
}

export function ReportsPage() {
  const { t, lang } = useI18n();
  const settings = useSettings();
  const [type, setType] = useState('daily-activity');
  const [from, setFrom] = useState(addDays(todayLocal(), -30));
  const [to, setTo] = useState(todayLocal());
  const [day, setDay] = useState(todayLocal());
  const range = type === 'daily-activity' ? { from: day, to: day } : { from, to };
  const q = useQuery({ queryKey: ['report', type, range.from, range.to], queryFn: () => api.get(`/reports/${type}${qs(range)}`) });
  const r = q.data;
  const exportAs = (format: 'csv' | 'xlsx') => downloadUrl(`/api/reports/${type}/export${qs({ ...range, format })}`);

  return (
    <div>
      <PageHeader icon={<BarChart3 className="h-5 w-5" />} title={t('reports.title')} subtitle={`${settings.data?.settings.hospital_name ?? ''} · DEMO / TEST DATA`} />
      <div className="grid gap-4 lg:grid-cols-4">
        <Card className="h-fit no-print">
          <ul className="p-1.5">
            {TYPES.map((ty) => (
              <li key={ty}>
                <button onClick={() => setType(ty)} className={clsx('w-full rounded-md px-3 py-2 text-start text-sm', type === ty ? 'bg-brand-50 font-semibold text-brand-800' : 'text-slate-600 hover:bg-slate-50')}>
                  {t(`reports.types.${ty}`)}
                </button>
              </li>
            ))}
          </ul>
        </Card>
        <div className="space-y-4 lg:col-span-3">
          <Card className="no-print flex flex-wrap items-center gap-2 p-3">
            <span className="text-sm font-medium text-slate-600">{t('reports.period')}</span>
            {type === 'daily-activity' ? (
              <Input type="date" value={day} onChange={(e) => setDay(e.target.value)} className="w-40" />
            ) : (
              <>
                <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" />
                <span className="text-slate-400">→</span>
                <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" />
              </>
            )}
            <div className="ms-auto flex gap-2">
              <Button size="sm" icon={<FileText className="h-4 w-4" />} onClick={() => exportAs('csv')}>{t('reports.exportCsv')}</Button>
              <Button size="sm" icon={<FileSpreadsheet className="h-4 w-4" />} onClick={() => exportAs('xlsx')}>{t('reports.exportXlsx')}</Button>
              <Button size="sm" icon={<Printer className="h-4 w-4" />} onClick={() => window.print()}>{t('reports.printPdf')}</Button>
            </div>
          </Card>
          <ErrorBox error={q.error} />
          {q.isLoading && <div className="flex justify-center p-10"><Spinner /></div>}
          {r && (
            <Card className="print-sheet">
              <CardHeader
                title={`${t(`reports.types.${r.type}`)}`}
                subtitle={<span className="ltr-nums">{r.title} · {fmtDate(r.from, lang)} → {fmtDate(r.to, lang)} · {r.rows.length} {t('reports.rows')}</span>}
              />
              <div className="hidden px-4 pt-3 text-xs text-slate-600 print:block">
                {settings.data?.settings.hospital_name} — {settings.data?.settings.unit_name} · DEMO / TEST DATA
              </div>
              {r.summary && (
                <div className="grid grid-cols-2 gap-2 border-b border-slate-100 p-3 sm:grid-cols-5">
                  {r.summary.map((s: any) => (
                    <div key={s.label} className="rounded-md bg-slate-50 px-3 py-2">
                      <div className="text-xs text-slate-500">{s.label}</div>
                      <div className="text-xl font-semibold text-slate-900">{s.value}</div>
                    </div>
                  ))}
                </div>
              )}
              {r.chart && r.rows.length > 0 && (
                <div className="border-b border-slate-100 p-4 print-avoid-break">
                  <div className="mb-2 text-xs font-semibold text-slate-600">{r.chart.title}</div>
                  <BarChart rows={r.rows} labelKey={r.chart.labelKey} valueKey={r.chart.valueKey} title={r.chart.title} vertical={r.type === 'monthly-activity'} />
                </div>
              )}
              {r.rows.length === 0 ? (
                <EmptyState title={t('common.noResults')} />
              ) : (
                <Table>
                  <thead className="bg-slate-50">
                    <tr>
                      {r.columns.map((c: any) => (
                        <th key={c.key} className={clsx(th, ['number', 'percent'].includes(c.type) && 'text-end')}>{c.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {r.rows.map((row: any, i: number) => (
                      <tr key={i}>
                        {r.columns.map((c: any) => (
                          <td key={c.key} className={clsx(td, ['number', 'percent'].includes(c.type) && 'ltr-nums tabular text-end', c.type === 'date' && 'ltr-nums whitespace-nowrap')}>
                            {row[c.key] === null || row[c.key] === undefined || row[c.key] === '' ? '—' : c.type === 'percent' ? `${fmtNum(row[c.key])}%` : String(row[c.key])}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
