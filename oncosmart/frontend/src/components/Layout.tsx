import clsx from 'clsx';
import {
  Activity,
  Armchair,
  BarChart3,
  CalendarDays,
  ChevronsLeft,
  ClipboardList,
  FileClock,
  FlaskConical,
  LayoutDashboard,
  LogOut,
  Menu,
  Search,
  Settings as SettingsIcon,
  ShieldAlert,
  UserCog,
  Users,
  X,
} from 'lucide-react';
import { ReactNode, useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../hooks/useAuth';
import { useSettings } from '../hooks/useSettings';
import { useI18n } from '../i18n/I18nProvider';
import { api } from '../services/api';
import { fmtDate, hhmm, patientName, setUnitTimezone } from '../utils/format';
import { Badge } from './ui';
import { StatusBadge } from './StatusBadge';

interface NavItem {
  to: string;
  key: string;
  icon: ReactNode;
  permission?: string;
}

const NAV: NavItem[] = [
  { to: '/', key: 'nav.dashboard', icon: <LayoutDashboard className="h-[18px] w-[18px]" /> },
  { to: '/patients', key: 'nav.patients', icon: <Users className="h-[18px] w-[18px]" />, permission: 'patients.read' },
  { to: '/appointments', key: 'nav.appointments', icon: <CalendarDays className="h-[18px] w-[18px]" />, permission: 'appointments.read' },
  { to: '/infusion', key: 'nav.infusion', icon: <Activity className="h-[18px] w-[18px]" />, permission: 'infusion.read' },
  { to: '/orders', key: 'nav.orders', icon: <ClipboardList className="h-[18px] w-[18px]" />, permission: 'orders.read' },
  { to: '/protocols', key: 'nav.protocols', icon: <FlaskConical className="h-[18px] w-[18px]" />, permission: 'protocols.read' },
  { to: '/chairs', key: 'nav.chairs', icon: <Armchair className="h-[18px] w-[18px]" />, permission: 'chairs.read' },
  { to: '/reports', key: 'nav.reports', icon: <BarChart3 className="h-[18px] w-[18px]" />, permission: 'reports.read' },
  { to: '/users', key: 'nav.users', icon: <UserCog className="h-[18px] w-[18px]" />, permission: 'users.manage' },
  { to: '/settings', key: 'nav.settings', icon: <SettingsIcon className="h-[18px] w-[18px]" />, permission: 'settings.manage' },
  { to: '/audit', key: 'nav.audit', icon: <FileClock className="h-[18px] w-[18px]" />, permission: 'audit.read' },
];

export function Logo({ compact }: { compact?: boolean }) {
  const { t } = useI18n();
  return (
    <div className="flex items-center gap-2.5">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-700 text-white shadow-sm">
        <svg viewBox="0 0 32 32" className="h-5 w-5" aria-hidden>
          <path d="M16 6v20M6 16h20" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" />
          <circle cx="16" cy="16" r="6" fill="none" stroke="#99f6e4" strokeWidth="2" />
        </svg>
      </div>
      {!compact && (
        <div className="min-w-0 leading-tight">
          <div className="text-sm font-bold tracking-tight text-slate-900">OncoSmart</div>
          <div className="truncate text-2xs font-medium text-brand-700">{t('app.unit')}</div>
        </div>
      )}
    </div>
  );
}

export function LanguageSwitcher({ className }: { className?: string }) {
  const { lang, setLang } = useI18n();
  return (
    <div className={clsx('inline-flex items-center rounded-md border border-slate-300 bg-white text-xs font-semibold shadow-sm', className)} role="group" aria-label="Language">
      <button onClick={() => setLang('en')} className={clsx('rounded-s-md px-2 py-1', lang === 'en' ? 'bg-brand-700 text-white' : 'text-slate-600 hover:bg-slate-50')}>
        EN
      </button>
      <span className="h-4 w-px bg-slate-300" />
      <button onClick={() => setLang('ar')} className={clsx('rounded-e-md px-2 py-1 font-[\'IBM_Plex_Sans_Arabic\']', lang === 'ar' ? 'bg-brand-700 text-white' : 'text-slate-600 hover:bg-slate-50')}>
        العربية
      </button>
    </div>
  );
}

export function DemoBanner() {
  const { t } = useI18n();
  return (
    <div className="flex items-center justify-center gap-2 bg-amber-400 px-3 py-1 text-center text-xs font-semibold text-amber-950 print:hidden">
      <ShieldAlert className="h-3.5 w-3.5 shrink-0" />
      <span>{t('app.demoBanner')}</span>
    </div>
  );
}

function GlobalSearch() {
  const { t, lang } = useI18n();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(q.trim()), 250);
    return () => clearTimeout(id);
  }, [q]);
  useEffect(() => {
    const onDoc = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '/' && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, []);
  const { data, isFetching } = useQuery({
    queryKey: ['search', debounced],
    // Search terms are sent in the request body — never placed in URLs.
    queryFn: () => api.post<{ patients: any[]; protocols: any[]; appointments: any[] }>('/search', { q: debounced }),
    enabled: debounced.length >= 2,
  });
  const go = (to: string) => {
    setOpen(false);
    setQ('');
    navigate(to);
  };
  const empty = data && !data.patients.length && !data.protocols.length && !data.appointments.length;
  return (
    <div ref={ref} className="relative w-full max-w-xl">
      <Search className="pointer-events-none absolute start-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
      <input
        ref={inputRef}
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder={t('common.searchPlaceholder')}
        className="h-9 w-full rounded-md border border-slate-300 bg-slate-50 ps-8 pe-8 text-sm placeholder:text-slate-400 focus:border-brand-500 focus:bg-white focus:outline-none focus:ring-1 focus:ring-brand-500"
        aria-label={t('common.search')}
      />
      <kbd className="absolute end-2 top-1/2 hidden -translate-y-1/2 rounded border border-slate-300 bg-white px-1.5 text-2xs text-slate-500 sm:block">/</kbd>
      {open && debounced.length >= 2 && (
        <div className="absolute z-40 mt-1 max-h-[70vh] w-full overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-xl">
          {isFetching && !data && <div className="px-3 py-2 text-sm text-slate-500">{t('common.loading')}</div>}
          {empty && <div className="px-3 py-2 text-sm text-slate-500">{t('common.noResults')}</div>}
          {!!data?.patients.length && (
            <div>
              <div className="px-3 pt-1.5 text-2xs font-semibold uppercase tracking-wide text-slate-400">{t('nav.patients')}</div>
              {data.patients.map((p) => (
                <button key={p.id} onClick={() => go(`/patients/${p.id}`)} className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-start hover:bg-slate-50">
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-slate-800">{patientName(p, lang)}</span>
                    <span className="text-xs text-slate-500">
                      {p.mrn} · {p.patient_code}
                    </span>
                  </span>
                  <StatusBadge kind="patient" status={p.status} />
                </button>
              ))}
            </div>
          )}
          {!!data?.protocols.length && (
            <div>
              <div className="px-3 pt-1.5 text-2xs font-semibold uppercase tracking-wide text-slate-400">{t('nav.protocols')}</div>
              {data.protocols.map((p) => (
                <button key={p.id} onClick={() => go(`/protocols?id=${p.id}`)} className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-start hover:bg-slate-50">
                  <span className="truncate text-sm text-slate-800">{p.name}</span>
                  {p.is_demo && <Badge tone="amber">DEMO</Badge>}
                </button>
              ))}
            </div>
          )}
          {!!data?.appointments.length && (
            <div>
              <div className="px-3 pt-1.5 text-2xs font-semibold uppercase tracking-wide text-slate-400">{t('nav.appointments')}</div>
              {data.appointments.map((a) => (
                <button key={a.id} onClick={() => go(`/appointments?date=${a.appointment_date}&open=${a.id}`)} className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-start hover:bg-slate-50">
                  <span className="min-w-0 truncate text-sm text-slate-800">
                    {a.appointment_number} · {a.patient_name}
                  </span>
                  <span className="text-xs text-slate-500">
                    {fmtDate(a.appointment_date, lang)} {hhmm(a.start_time)}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function AppLayout() {
  const { user, logout, can } = useAuth();
  const { t, lang } = useI18n();
  const settings = useSettings();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem('oncosmart.sidebar') === 'collapsed';
    } catch {
      return false;
    }
  });
  const [mobileOpen, setMobileOpen] = useState(false);
  useEffect(() => setMobileOpen(false), [location.pathname]);
  useEffect(() => {
    if (settings.data?.settings.timezone) setUnitTimezone(settings.data.settings.timezone);
  }, [settings.data]);
  const toggle = () => {
    setCollapsed((c) => {
      try {
        localStorage.setItem('oncosmart.sidebar', c ? 'expanded' : 'collapsed');
      } catch {
        /* ignore */
      }
      return !c;
    });
  };
  const items = NAV.filter((n) => !n.permission || can(n.permission));
  const demo = settings.data?.demoMode ?? true;

  const nav = (isMobile: boolean) => (
    <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 py-3">
      {items.map((n) => (
        <NavLink
          key={n.to}
          to={n.to}
          end={n.to === '/'}
          title={collapsed && !isMobile ? t(n.key) : undefined}
          className={({ isActive }) =>
            clsx(
              'flex items-center gap-3 rounded-md px-2.5 py-2 text-sm font-medium transition-colors',
              isActive ? 'bg-brand-50 text-brand-800' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
              collapsed && !isMobile && 'justify-center px-0',
            )
          }
        >
          <span className="shrink-0">{n.icon}</span>
          {(!collapsed || isMobile) && <span className="truncate">{t(n.key)}</span>}
        </NavLink>
      ))}
    </nav>
  );

  return (
    <div className="flex min-h-screen flex-col">
      {demo && <DemoBanner />}
      <div className="flex flex-1">
        {/* Desktop sidebar */}
        <aside className={clsx('sticky top-0 hidden h-screen shrink-0 flex-col border-e border-slate-200 bg-white transition-[width] duration-150 lg:flex print:hidden', collapsed ? 'w-[64px]' : 'w-60')}>
          <div className={clsx('flex h-14 items-center border-b border-slate-100', collapsed ? 'justify-center' : 'px-4')}>
            <Logo compact={collapsed} />
          </div>
          {nav(false)}
          <button onClick={toggle} className="flex items-center gap-2 border-t border-slate-100 px-4 py-3 text-xs text-slate-500 hover:bg-slate-50" title={collapsed ? t('nav.expand') : t('nav.collapse')}>
            <ChevronsLeft className={clsx('h-4 w-4 transition-transform rtl:rotate-180', collapsed && 'rotate-180 rtl:rotate-0')} />
            {!collapsed && t('nav.collapse')}
          </button>
        </aside>
        {/* Mobile drawer */}
        {mobileOpen && (
          <div className="fixed inset-0 z-40 lg:hidden print:hidden">
            <div className="absolute inset-0 bg-slate-900/40" onClick={() => setMobileOpen(false)} />
            <aside className="absolute inset-y-0 start-0 flex w-64 flex-col bg-white shadow-xl">
              <div className="flex h-14 items-center justify-between border-b border-slate-100 px-4">
                <Logo />
                <button onClick={() => setMobileOpen(false)} className="rounded p-1 text-slate-500 hover:bg-slate-100">
                  <X className="h-5 w-5" />
                </button>
              </div>
              {nav(true)}
            </aside>
          </div>
        )}
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-slate-200 bg-white/95 px-3 backdrop-blur sm:px-5 print:hidden">
            <button onClick={() => setMobileOpen(true)} className="rounded p-1.5 text-slate-600 hover:bg-slate-100 lg:hidden" aria-label="Menu">
              <Menu className="h-5 w-5" />
            </button>
            <div className="lg:hidden">
              <Logo compact />
            </div>
            <GlobalSearch />
            <div className="ms-auto flex items-center gap-3">
              <LanguageSwitcher />
              <div className="hidden text-end leading-tight md:block">
                <div className="text-sm font-medium text-slate-800">{lang === 'ar' && user?.fullNameAr ? user.fullNameAr : user?.fullName}</div>
                <div className="text-2xs font-semibold uppercase tracking-wide text-brand-700">{t(`roles.${user?.role}`)}</div>
              </div>
              <button onClick={() => logout()} className="rounded-md p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800" title={t('common.signOut')} aria-label={t('common.signOut')}>
                <LogOut className="h-[18px] w-[18px] rtl:rotate-180" />
              </button>
            </div>
          </header>
          <main className="mx-auto w-full max-w-[1600px] flex-1 px-3 py-4 sm:px-5 sm:py-5">
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  );
}
