import clsx from 'clsx';
import { CheckCircle2, XCircle } from 'lucide-react';
import { createContext, ReactNode, useCallback, useContext, useState } from 'react';

interface ToastItem {
  id: number;
  kind: 'success' | 'error';
  message: string;
}
const Ctx = createContext<{ success: (m: string) => void; error: (m: unknown) => void } | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback((kind: ToastItem['kind'], message: string) => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x, { id, kind, message }]);
    setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), kind === 'error' ? 7000 : 3500);
  }, []);
  const success = useCallback((m: string) => push('success', m), [push]);
  const error = useCallback((m: unknown) => push('error', m instanceof Error ? m.message : String(m)), [push]);
  return (
    <Ctx.Provider value={{ success, error }}>
      {children}
      <div className="pointer-events-none fixed bottom-4 end-4 z-[60] flex w-[min(92vw,380px)] flex-col gap-2 print:hidden">
        {items.map((i) => (
          <div
            key={i.id}
            role="status"
            className={clsx(
              'pointer-events-auto flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm shadow-lg',
              i.kind === 'success' ? 'border-emerald-200 bg-white text-emerald-800' : 'border-rose-200 bg-white text-rose-700',
            )}
          >
            {i.kind === 'success' ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0" />}
            <span>{i.message}</span>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToast() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useToast outside provider');
  return c;
}
