import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { PublicUser, Role } from '../../../shared/types';
import { authApi } from '../api/endpoints';

interface AuthApi {
  user: PublicUser | null;
  loading: boolean;
  login(email: string, password: string): Promise<PublicUser>;
  register(input: { email: string; password: string; displayName: string; role: Role }): Promise<PublicUser>;
  startDemo(): Promise<PublicUser>;
  logout(): Promise<void>;
  setUser(user: PublicUser | null): void;
}

const AuthContext = createContext<AuthApi | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    authApi
      .me()
      .then(({ user: current }) => setUser(current))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  const withUser = useCallback(async (request: Promise<{ user: PublicUser }>) => {
    const { user: next } = await request;
    setUser(next);
    return next;
  }, []);

  const api = useMemo<AuthApi>(
    () => ({
      user,
      loading,
      login: (email, password) => withUser(authApi.login(email, password)),
      register: (input) => withUser(authApi.register(input)),
      startDemo: () => withUser(authApi.demo()),
      logout: async () => {
        await authApi.logout().catch(() => undefined);
        setUser(null);
      },
      setUser,
    }),
    [user, loading, withUser],
  );

  return <AuthContext.Provider value={api}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthApi {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth doit être utilisé dans <AuthProvider>');
  return context;
}

export const homePathFor = (user: PublicUser | null) => (!user ? '/' : user.role === 'teacher' ? '/dashboard' : '/me');
