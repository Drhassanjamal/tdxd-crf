import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { ar } from './ar';
import { en } from './en';

export type Lang = 'en' | 'ar';
const DICTS = { en, ar } as const;

function lookup(dict: any, key: string): string | undefined {
  const v = key.split('.').reduce((o, k) => (o == null ? undefined : o[k]), dict);
  return typeof v === 'string' ? v : undefined;
}

export type TFn = (key: string, params?: Record<string, string | number | null | undefined>, fallback?: string) => string;

interface I18nCtx {
  lang: Lang;
  dir: 'ltr' | 'rtl';
  setLang: (l: Lang) => void;
  t: TFn;
}

const Ctx = createContext<I18nCtx | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => {
    try {
      const saved = localStorage.getItem('oncosmart.lang');
      return saved === 'ar' ? 'ar' : 'en';
    } catch {
      return 'en';
    }
  });
  const dir = lang === 'ar' ? 'rtl' : 'ltr';
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = dir;
  }, [lang, dir]);
  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try {
      localStorage.setItem('oncosmart.lang', l);
    } catch {
      /* ignore */
    }
  }, []);
  const t = useCallback<TFn>(
    (key, params, fallback) => {
      let s = lookup(DICTS[lang], key) ?? lookup(en, key) ?? fallback ?? key;
      if (params) s = s.replace(/\{(\w+)\}/g, (m, k) => (params[k] === undefined || params[k] === null ? m : String(params[k])));
      return s;
    },
    [lang],
  );
  const value = useMemo(() => ({ lang, dir: dir as 'ltr' | 'rtl', setLang, t }), [lang, dir, setLang, t]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useI18n outside provider');
  return c;
}
