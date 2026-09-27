import clsx from 'clsx';
import { KeyRound, Plus, UserCog } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Card, ErrorBox, Field, Input, Modal, PageHeader, PageLoader, Select, Table, td, th } from '../components/ui';
import { useToast } from '../components/Toast';
import { useAuth } from '../hooks/useAuth';
import { useI18n } from '../i18n/I18nProvider';
import { api } from '../services/api';
import { fmtDateTime } from '../utils/format';

const ROLES = ['ADMIN', 'PHYSICIAN', 'NURSE', 'RECEPTION'];

export function UsersPage() {
  const { t, lang } = useI18n();
  const { user: me } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['users'], queryFn: () => api.get<any[]>('/users') });
  const [editing, setEditing] = useState<any>(undefined);
  const [resetting, setResetting] = useState<any>(null);
  const [f, setF] = useState<any>({});
  const [pw, setPw] = useState('');
  useEffect(() => {
    if (editing !== undefined) setF(editing ? { fullName: editing.full_name, fullNameAr: editing.full_name_ar ?? '', role: editing.role_code, title: editing.title ?? '', phone: editing.phone ?? '', isActive: editing.is_active } : { email: '', password: '', fullName: '', fullNameAr: '', role: 'NURSE', title: '', phone: '' });
  }, [editing]);
  const save = useMutation({
    mutationFn: () => (editing ? api.put(`/users/${editing.id}`, { ...f, fullNameAr: f.fullNameAr || null, title: f.title || null, phone: f.phone || null }) : api.post('/users', { ...f, fullNameAr: f.fullNameAr || null, title: f.title || null, phone: f.phone || null })),
    onSuccess: () => {
      toast.success(t('common.success'));
      qc.invalidateQueries({ queryKey: ['users'] });
      setEditing(undefined);
    },
  });
  const reset = useMutation({
    mutationFn: () => api.post(`/users/${resetting.id}/reset-password`, { password: pw }),
    onSuccess: () => {
      toast.success(t('common.success'));
      setResetting(null);
      setPw('');
    },
  });
  const toggle = useMutation({
    mutationFn: (u: any) => api.put(`/users/${u.id}`, { isActive: !u.is_active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
    onError: (e) => toast.error(e),
  });
  if (q.isLoading) return <PageLoader />;
  const set = (k: string) => (e: any) => setF((x: any) => ({ ...x, [k]: e.target.value }));
  return (
    <div>
      <PageHeader icon={<UserCog className="h-5 w-5" />} title={t('users.title')} actions={<Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setEditing(null)}>{t('users.new')}</Button>} />
      <Card>
        <Table>
          <thead className="bg-slate-50">
            <tr>
              {['users.fullName', 'users.email', 'users.role', 'users.title2', 'users.active', 'users.lastLogin', 'common.actions'].map((k) => <th key={k} className={th}>{t(k)}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {q.data?.map((u) => (
              <tr key={u.id} className={clsx(!u.is_active && 'opacity-60')}>
                <td className={td}>
                  <div className="font-medium text-slate-900">{lang === 'ar' && u.full_name_ar ? u.full_name_ar : u.full_name}</div>
                </td>
                <td className={clsx(td, 'ltr-nums')}>{u.email}</td>
                <td className={td}><Badge tone={u.role_code === 'ADMIN' ? 'violet' : u.role_code === 'PHYSICIAN' ? 'blue' : u.role_code === 'NURSE' ? 'teal' : 'slate'}>{t(`roles.${u.role_code}`)}</Badge></td>
                <td className={td}>{u.title ?? '—'}</td>
                <td className={td}>{u.is_active ? <Badge tone="green">{t('common.yes')}</Badge> : <Badge>{t('common.no')}</Badge>}</td>
                <td className={clsx(td, 'ltr-nums whitespace-nowrap')}>{fmtDateTime(u.last_login_at, lang)}</td>
                <td className={td}>
                  <div className="flex flex-wrap gap-1">
                    <Button size="xs" onClick={() => setEditing(u)}>{t('common.edit')}</Button>
                    <Button size="xs" variant="ghost" icon={<KeyRound className="h-3.5 w-3.5" />} onClick={() => setResetting(u)}>{t('users.resetPassword')}</Button>
                    {u.id !== me?.id && <Button size="xs" variant="ghost" onClick={() => toggle.mutate(u)}>{u.is_active ? t('users.deactivate') : t('users.activate')}</Button>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
      <Modal open={editing !== undefined} onClose={() => setEditing(undefined)} title={editing ? editing.full_name : t('users.new')} footer={<><Button onClick={() => setEditing(undefined)}>{t('common.cancel')}</Button><Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>{t('common.save')}</Button></>}>
        <div className="grid gap-3 sm:grid-cols-2">
          {!editing && <Field label={t('users.email')} required><Input type="email" value={f.email ?? ''} onChange={set('email')} /></Field>}
          {!editing && <Field label={t('login.password')} required hint={t('users.passwordRule')}><Input type="password" value={f.password ?? ''} onChange={set('password')} /></Field>}
          <Field label={t('users.fullName')} required><Input value={f.fullName ?? ''} onChange={set('fullName')} /></Field>
          <Field label={t('users.fullNameAr')}><Input dir="rtl" value={f.fullNameAr ?? ''} onChange={set('fullNameAr')} /></Field>
          <Field label={t('users.role')}>
            <Select value={f.role} onChange={set('role')}>{ROLES.map((r) => <option key={r} value={r}>{t(`roles.${r}`)}</option>)}</Select>
          </Field>
          <Field label={t('users.title2')}><Input value={f.title ?? ''} onChange={set('title')} /></Field>
          <Field label={t('patients.phone')}><Input value={f.phone ?? ''} onChange={set('phone')} /></Field>
          <div className="sm:col-span-2"><ErrorBox error={save.error} /></div>
        </div>
      </Modal>
      <Modal open={!!resetting} onClose={() => setResetting(null)} size="sm" title={`${t('users.resetPassword')} · ${resetting?.email}`} footer={<><Button onClick={() => setResetting(null)}>{t('common.cancel')}</Button><Button variant="primary" loading={reset.isPending} onClick={() => reset.mutate()}>{t('common.save')}</Button></>}>
        <Field label={t('users.newPassword')} hint={t('users.passwordRule')}><Input type="password" value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
        <div className="mt-2"><ErrorBox error={reset.error} /></div>
      </Modal>
    </div>
  );
}
