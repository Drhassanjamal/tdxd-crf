import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../services/api';
import type { User } from '../types';

interface AuthCtx {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<User>;
  logout: () => Promise<void>;
  can: (permission: string) => boolean;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const qc = useQueryClient();

  useEffect(() => {
    api
      .get<{ user: User | null }>('/auth/session')
      .then((r) => setUser(r.user))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
    const onUnauthorized = () => {
      setUser(null);
      qc.clear();
    };
    window.addEventListener('oncosmart:unauthorized', onUnauthorized);
    return () => window.removeEventListener('oncosmart:unauthorized', onUnauthorized);
  }, [qc]);

  const login = useCallback(async (email: string, password: string) => {
    const r = await api.post<{ user: User }>('/auth/login', { email, password });
    qc.clear();
    setUser(r.user);
    return r.user;
  }, [qc]);

  const logout = useCallback(async () => {
    await api.post('/auth/logout').catch(() => undefined);
    qc.clear();
    setUser(null);
  }, [qc]);

  const can = useCallback((p: string) => !!user?.permissions.includes(p), [user]);

  return <Ctx.Provider value={{ user, loading, login, logout, can }}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useAuth outside provider');
  return c;
}
