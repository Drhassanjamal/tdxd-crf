import { KeyRound, Lock, ShieldAlert } from 'lucide-react';
import { FormEvent, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { LanguageSwitcher, Logo } from '../components/Layout';
import { Button, ErrorBox, Field, Input } from '../components/ui';
import { useAuth } from '../hooks/useAuth';
import { useI18n } from '../i18n/I18nProvider';
import { api } from '../services/api';

export function LoginPage() {
  const { t } = useI18n();
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const cfg = useQuery({ queryKey: ['public-config'], queryFn: () => api.get('/public/config') });

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-br from-slate-50 via-white to-teal-50">
      {cfg.data?.demoMode && (
        <div className="flex items-center justify-center gap-2 bg-amber-400 px-3 py-1 text-center text-xs font-semibold text-amber-950">
          <ShieldAlert className="h-3.5 w-3.5" /> {t('app.demoBanner')}
        </div>
      )}
      <div className="flex justify-end p-4">
        <LanguageSwitcher />
      </div>
      <div className="flex flex-1 items-center justify-center px-4 pb-10">
        <div className="grid w-full max-w-4xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl md:grid-cols-2">
          <div className="hidden flex-col justify-between bg-brand-800 p-8 text-white md:flex">
            <div>
              <div className="flex items-center gap-2.5">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-white/10">
                  <svg viewBox="0 0 32 32" className="h-6 w-6" aria-hidden>
                    <path d="M16 6v20M6 16h20" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" />
                    <circle cx="16" cy="16" r="6" fill="none" stroke="#99f6e4" strokeWidth="2" />
                  </svg>
                </div>
                <div>
                  <div className="text-xl font-bold">OncoSmart</div>
                  <div className="text-sm text-teal-200">{t('app.unit')}</div>
                </div>
              </div>
              <p className="mt-8 text-2xl font-semibold leading-snug">{t('app.subtitle')}</p>
              <p className="mt-3 text-sm text-teal-100/90">{cfg.data?.hospitalName}</p>
            </div>
            <ul className="space-y-2 text-sm text-teal-50/90">
              <li className="flex gap-2"><Lock className="mt-0.5 h-4 w-4 shrink-0" />{t('login.secureNote')}</li>
              <li className="flex gap-2"><ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />{t('app.clinicalJudgement')}</li>
            </ul>
          </div>
          <div className="p-6 sm:p-8">
            <div className="md:hidden">
              <Logo />
            </div>
            <h1 className="mt-4 text-xl font-semibold text-slate-900 md:mt-0">{t('login.title')}</h1>
            <form onSubmit={submit} className="mt-5 space-y-4">
              <Field label={t('login.email')}>
                <Input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
              </Field>
              <Field label={t('login.password')}>
                <Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
              </Field>
              <ErrorBox error={error} />
              <Button type="submit" variant="primary" className="w-full" loading={busy} icon={<KeyRound className="h-4 w-4" />}>
                {t('login.submit')}
              </Button>
            </form>
            {cfg.data?.demoMode && cfg.data.demoAccounts?.length > 0 && (
              <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-amber-900">{t('login.demoAccounts')}</div>
                <p className="mt-1 text-xs text-amber-900">
                  {t('login.demoHint')} <code className="ltr-nums rounded bg-white px-1 font-mono">{cfg.data.demoPassword}</code>
                </p>
                <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
                  {cfg.data.demoAccounts.map((a: any) => (
                    <button
                      key={a.email}
                      type="button"
                      onClick={() => {
                        setEmail(a.email);
                        setPassword(cfg.data.demoPassword);
                      }}
                      className="rounded-md border border-amber-200 bg-white px-2 py-1.5 text-start text-xs hover:border-brand-400 hover:bg-brand-50"
                    >
                      <div className="font-semibold text-slate-800">{t(`roles.${a.role}`)}</div>
                      <div className="ltr-nums truncate text-slate-500">{a.email}</div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
