// Кто вошёл и куда его вести: родитель — /app, водитель — /driver, диспетчер — /admin.
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { api, ApiError } from './api';
import type { Me } from '@shared/api';
import type { Role } from '@shared/domain';

interface AuthState {
  me: Me | null;
  loading: boolean;
  reload: () => Promise<void>;
  setMe: (me: Me | null) => void;
}

const Ctx = createContext<AuthState>({ me: null, loading: true, reload: async () => {}, setMe: () => {} });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const reload = useCallback(async () => {
    try {
      setMe(await api.get<Me>('/me'));
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setMe(null);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);
  return <Ctx.Provider value={{ me, loading, reload, setMe }}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);

export function homeFor(me: Me): string {
  if (me.roles.includes('parent') && me.families.length) return '/app';
  if (me.roles.includes('driver') && !me.roles.includes('dispatcher')) return '/driver';
  if (me.roles.includes('dispatcher')) return window.matchMedia('(min-width: 900px)').matches ? '/admin' : '/driver';
  return '/app';
}

export function RequireRole({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { me, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <div className="empty">Загрузка…</div>;
  if (!me) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname)}`} replace />;
  if (!roles.some((r) => me.roles.includes(r))) return <Navigate to={homeFor(me)} replace />;
  return <>{children}</>;
}
