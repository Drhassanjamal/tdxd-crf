import clsx from 'clsx';
import { Search, UserPlus, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { StatusBadge } from '../components/StatusBadge';
import { Badge, Button, Card, EmptyState, ErrorBox, Input, PageHeader, Select, Spinner, Table, td, th } from '../components/ui';
import { PatientFormModal } from '../features/patients/PatientFormModal';
import { useAuth } from '../hooks/useAuth';
import { usePhysicians, useProtocols } from '../hooks/useSettings';
import { useI18n } from '../i18n/I18nProvider';
import { api } from '../services/api';
import { CANCER_TYPES } from '../utils/constants';
import { fmtDate, hhmm, patientName } from '../utils/format';

const STATUSES = ['ACTIVE_TREATMENT', 'TREATMENT_COMPLETED', 'ON_HOLD', 'DISCONTINUED', 'FOLLOW_UP', 'PALLIATIVE_CARE', 'DECEASED'];

export function PatientsPage() {
  const { t, lang } = useI18n();
  const { can } = useAuth();
  const navigate = useNavigate();
  const physicians = usePhysicians();
  const protocols = useProtocols();
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [filters, setFilters] = useState({ cancerType: '', oncologistId: '', status: '', protocolId: '', appointmentDate: '' });
  const [page, setPage] = useState(1);
  const [showNew, setShowNew] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => {
      setDebounced(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(id);
  }, [search]);
  const body = { search: debounced || undefined, page, pageSize: 25, ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v)) };
  const q = useQuery({
    queryKey: ['patients', body],
    // Filters (including the search text) are sent in the POST body, never in the URL.
    queryFn: () => api.post('/patients/query', body),
    placeholderData: keepPreviousData,
  });
  const setFilter = (k: keyof typeof filters) => (e: any) => {
    setFilters((f) => ({ ...f, [k]: e.target.value }));
    setPage(1);
  };
  const clinical = can('clinical.read');
  const pages = q.data ? Math.max(1, Math.ceil(q.data.total / q.data.pageSize)) : 1;

  return (
    <div>
      <PageHeader
        icon={<Users className="h-5 w-5" />}
        title={t('patients.title')}
        subtitle={q.data ? `${q.data.total} ${t('nav.patients').toLowerCase()}` : undefined}
        actions={
          can('patients.create') && (
            <Button variant="primary" icon={<UserPlus className="h-4 w-4" />} onClick={() => setShowNew(true)}>
              {t('patients.register')}
            </Button>
          )
        }
      />
      <Card>
        <div className="grid gap-2 border-b border-slate-100 p-3 md:grid-cols-6">
          <div className="relative md:col-span-2">
            <Search className="pointer-events-none absolute start-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input className="ps-8" placeholder={t('patients.searchHint')} value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          {clinical && (
            <Select value={filters.cancerType} onChange={setFilter('cancerType')} aria-label={t('patients.cancerType')}>
              <option value="">{t('patients.cancerType')}: {t('common.all')}</option>
              {CANCER_TYPES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </Select>
          )}
          <Select value={filters.oncologistId} onChange={setFilter('oncologistId')} aria-label={t('patients.oncologist')}>
            <option value="">{t('patients.oncologist')}: {t('common.all')}</option>
            {physicians.data?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.full_name}
              </option>
            ))}
          </Select>
          <Select value={filters.status} onChange={setFilter('status')} aria-label={t('common.status')}>
            <option value="">{t('common.status')}: {t('common.all')}</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`status.patient.${s}`)}
              </option>
            ))}
          </Select>
          <Select value={filters.protocolId} onChange={setFilter('protocolId')} aria-label={t('common.protocol')}>
            <option value="">{t('common.protocol')}: {t('common.all')}</option>
            {protocols.data?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
          <div className="flex items-center gap-2 md:col-span-2">
            <span className="whitespace-nowrap text-xs text-slate-500">{t('patients.anyAppointmentDate')}</span>
            <Input type="date" value={filters.appointmentDate} onChange={setFilter('appointmentDate')} />
          </div>
          {(search || Object.values(filters).some(Boolean)) && (
            <Button
              variant="ghost"
              size="sm"
              className="self-center justify-self-start"
              onClick={() => {
                setSearch('');
                setFilters({ cancerType: '', oncologistId: '', status: '', protocolId: '', appointmentDate: '' });
              }}
            >
              {t('common.clear')}
            </Button>
          )}
        </div>
        {q.error && (
          <div className="p-3">
            <ErrorBox error={q.error} />
          </div>
        )}
        {q.isLoading ? (
          <div className="flex justify-center p-10">
            <Spinner />
          </div>
        ) : q.data?.rows.length === 0 ? (
          <EmptyState icon={<Users className="h-10 w-10" />} title={t('common.noResults')} />
        ) : (
          <Table>
            <thead className="bg-slate-50">
              <tr>
                <th className={th}>{t('patients.patientId')}</th>
                <th className={th}>{t('patients.mrn')}</th>
                <th className={th}>{t('patients.name')}</th>
                <th className={th}>{t('patients.age')}</th>
                <th className={th}>{t('patients.sex')}</th>
                {clinical && <th className={th}>{t('patients.diagnosis')}</th>}
                {clinical && <th className={th}>{t('patients.cancerType')}</th>}
                <th className={th}>{t('patients.oncologist')}</th>
                <th className={th}>{t('patients.currentProtocol')}</th>
                <th className={th}>{t('patients.currentCycle')}</th>
                <th className={th}>{t('patients.nextAppointment')}</th>
                <th className={th}>{t('common.status')}</th>
              </tr>
            </thead>
            <tbody className={clsx('divide-y divide-slate-100', q.isFetching && 'opacity-70')}>
              {q.data?.rows.map((p: any) => (
                <tr key={p.id} className="cursor-pointer hover:bg-brand-50/40" onClick={() => navigate(`/patients/${p.id}`)}>
                  <td className={clsx(td, 'ltr-nums whitespace-nowrap text-xs text-slate-500')}>{p.patient_code}</td>
                  <td className={clsx(td, 'ltr-nums whitespace-nowrap font-medium')}>{p.mrn}</td>
                  <td className={td}>
                    <div className="font-medium text-slate-900">{patientName(p, lang)}</div>
                    {lang === 'en' && p.full_name_ar && <div className="text-xs text-slate-500" dir="rtl">{p.full_name_ar}</div>}
                  </td>
                  <td className={td}>{p.age}</td>
                  <td className={td}>{t(`patients.${p.sex}`)}</td>
                  {clinical && <td className={clsx(td, 'max-w-[220px]')}>{p.primary_cancer ?? '—'}</td>}
                  {clinical && <td className={td}>{p.cancer_type ?? '—'}</td>}
                  <td className={clsx(td, 'whitespace-nowrap')}>{p.oncologist_name ?? '—'}</td>
                  <td className={clsx(td, 'max-w-[220px]')}>
                    {p.protocol_name ? (
                      <span>
                        {p.protocol_name} {p.protocol_is_demo && <Badge tone="amber">DEMO</Badge>}
                      </span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className={clsx(td, 'ltr-nums whitespace-nowrap')}>
                    {p.plan_id ? (p.current_cycle ? t('patients.cycleOf', { cycle: p.current_cycle, planned: p.planned_cycles }) : t('patients.notStarted')) : '—'}
                  </td>
                  <td className={clsx(td, 'whitespace-nowrap')}>
                    {p.next_appointment_date ? (
                      <span className="ltr-nums">
                        {fmtDate(p.next_appointment_date, lang)} {hhmm(p.next_appointment_time)}
                      </span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className={td}>
                    <StatusBadge kind="patient" status={p.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        {pages > 1 && (
          <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-3 py-2 text-sm">
            <Button size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              {t('common.previous')}
            </Button>
            <span className="text-slate-500">
              {t('common.page')} {page} {t('common.of')} {pages}
            </span>
            <Button size="sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
              {t('common.next')}
            </Button>
          </div>
        )}
      </Card>
      <PatientFormModal open={showNew} onClose={() => setShowNew(false)} onSaved={(p) => navigate(`/patients/${p.id}`)} />
    </div>
  );
}
