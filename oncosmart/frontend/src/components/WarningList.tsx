import clsx from 'clsx';
import { AlertOctagon, AlertTriangle, Info, ShieldAlert } from 'lucide-react';
import { useI18n } from '../i18n/I18nProvider';
import type { ClinicalWarning } from '../types';

export function warningText(w: ClinicalWarning, t: ReturnType<typeof useI18n>['t'], lang: string) {
  // Arabic: translate by code when parameters allow; otherwise show the server message (English).
  if (lang === 'ar') {
    const key = `warnings.${w.code}`;
    const translated = t(key, w.params as any, '');
    if (translated && !/\{\w+\}/.test(translated)) return translated;
  }
  return w.message;
}

export function WarningList({ warnings, compact, hideInfo }: { warnings: ClinicalWarning[]; compact?: boolean; hideInfo?: boolean }) {
  const { t, lang } = useI18n();
  const list = hideInfo ? warnings.filter((w) => w.severity !== 'INFO') : warnings;
  if (!list.length) return <p className="text-sm text-slate-500">{t('orders.noWarnings')}</p>;
  return (
    <ul className={clsx('space-y-1.5', compact && 'space-y-1')}>
      {list.map((w, i) => {
        const Icon = w.severity === 'CRITICAL' ? AlertOctagon : w.severity === 'WARNING' ? AlertTriangle : w.code === 'DEMO_PROTOCOL' ? ShieldAlert : Info;
        return (
          <li
            key={`${w.code}-${i}`}
            className={clsx(
              'flex items-start gap-2 rounded-md border px-2.5 py-1.5 text-sm',
              w.severity === 'CRITICAL' && 'border-rose-200 bg-rose-50 text-rose-800',
              w.severity === 'WARNING' && 'border-amber-200 bg-amber-50 text-amber-900',
              w.severity === 'INFO' && 'border-slate-200 bg-slate-50 text-slate-700',
            )}
          >
            <Icon className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="min-w-0">
              <span className="me-1 text-2xs font-bold uppercase tracking-wide opacity-80">{t(`warnings.severity.${w.severity}`)}</span>
              {warningText(w, t, lang)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
