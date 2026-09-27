import clsx from 'clsx';
import { ClipboardList, Plus } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { StatusBadge } from '../components/StatusBadge';
import { Badge, Button, Card, EmptyState, ErrorBox, Input, PageHeader, Segmented, Spinner, Table, td, th } from '../components/ui';
import { useAuth } from '../hooks/useAuth';
import { useI18n } from '../i18n/I18nProvider';
import { api, qs } from '../services/api';
import { addDays, fmtDate, fmtDateTime, fmtNum, patientName, todayLocal, fmtBsa } from '../utils/format';

type Filter = 'active' | 'pending' | 'all' | 'completed';
const FILTERS: Record<Filter, string | undefined> = {
  active: 'DRAFT,PENDING_REVIEW,APPROVED,READY_FOR_PREPARATION,PREPARED,READY_FOR_ADMINISTRATION,IN_PROGRESS,HELD,DELAYED',
  pending: 'PENDING_REVIEW',
  completed: 'COMPLETED',
  all: undefined,
};

export function OrdersPage() {
  const { t, lang } = useI18n();
  const { can } = useAuth();
  const navigate = useNavigate();
  const [filter, setFilter] = useState<Filter>('active');
  const [from, setFrom] = useState(addDays(todayLocal(), -30));
  const [to, setTo] = useState(addDays(todayLocal(), 30));
  const q = useQuery({
    queryKey: ['orders', filter, from, to],
    queryFn: () => api.get<any[]>(`/orders${qs({ status: FILTERS[filter], from: filter === 'active' || filter === 'pending' ? undefined : from, to: filter === 'active' || filter === 'pending' ? undefined : to })}`),
  });
  return (
    <div>
      <PageHeader
        icon={<ClipboardList className="h-5 w-5" />}
        title={t('orders.title')}
        subtitle={t('app.calcDisclaimer')}
        actions={
          can('orders.prescribe') && (
            <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => navigate('/orders/new')}>
              {t('orders.new')}
            </Button>
          )
        }
      />
      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 p-3">
          <Segmented
            value={filter}
            onChange={setFilter}
            options={[
              { id: 'active', label: t('orders.active') },
              { id: 'pending', label: t('orders.awaitingApproval') },
              { id: 'completed', label: t('status.order.COMPLETED') },
              { id: 'all', label: t('common.all') },
            ]}
          />
          {(filter === 'completed' || filter === 'all') && (
            <div className="flex items-center gap-2 text-sm">
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" />
              <span className="text-slate-400">→</span>
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" />
            </div>
          )}
        </div>
        {q.error && <div className="p-3"><ErrorBox error={q.error} /></div>}
        {q.isLoading ? (
          <div className="flex justify-center p-10">
            <Spinner />
          </div>
        ) : !q.data?.length ? (
          <EmptyState icon={<ClipboardList className="h-10 w-10" />} title={t('common.noResults')} />
        ) : (
          <Table>
            <thead className="bg-slate-50">
              <tr>
                <th className={th}>{t('orders.orderNumber')}</th>
                <th className={th}>{t('orders.plannedDate')}</th>
                <th className={th}>{t('common.patient')}</th>
                <th className={th}>{t('common.protocol')}</th>
                <th className={th}>{t('common.cycle')}</th>
                <th className={th}>{t('orders.bsa')}</th>
                <th className={th}>{t('orders.prescriber')}</th>
                <th className={th}>{t('orders.approvedBy')}</th>
                <th className={th}>{t('orders.warnings')}</th>
                <th className={th}>{t('common.status')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {q.data.map((o) => (
                <tr key={o.id} className="cursor-pointer hover:bg-slate-50" onClick={() => navigate(`/orders/${o.id}`)}>
                  <td className={clsx(td, 'ltr-nums whitespace-nowrap font-medium')}>{o.order_number}</td>
                  <td className={clsx(td, 'whitespace-nowrap')}>{fmtDate(o.planned_date, lang)}</td>
                  <td className={td}>
                    <div className="font-medium text-slate-900">{patientName(o, lang)}</div>
                    <div className="ltr-nums text-xs text-slate-500">{o.mrn}</div>
                  </td>
                  <td className={td}>
                    {o.protocol_name} {o.protocol_is_demo && <Badge tone="amber">DEMO</Badge>}
                  </td>
                  <td className={clsx(td, 'ltr-nums')}>
                    C{o.cycle_number}D{o.day_number}
                  </td>
                  <td className={clsx(td, 'ltr-nums whitespace-nowrap')}>{fmtBsa(o.bsa_m2)} m²</td>
                  <td className={clsx(td, 'whitespace-nowrap')}>
                    {o.prescribed_by_name}
                    <div className="ltr-nums text-xs text-slate-500">{fmtDateTime(o.prescribed_at, lang)}</div>
                  </td>
                  <td className={clsx(td, 'whitespace-nowrap')}>{o.approved_by_name ?? <span className="text-amber-700">{t('orders.pending')}</span>}</td>
                  <td className={td}>{o.significant_warning_count > 0 ? <Badge tone="amber">{o.significant_warning_count}</Badge> : <span className="text-slate-400">0</span>}</td>
                  <td className={td}>
                    <StatusBadge kind="order" status={o.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
