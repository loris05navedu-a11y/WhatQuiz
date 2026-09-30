import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { PublicUser, Role } from '../../../shared/types';
import { ApiError } from '../api/errors';
import { authApi } from '../api/endpoints';
import { FIREBASE_ACCOUNTS, signInWithFuriousTube, signInWithGoogle, type FirebaseProfile } from '../lib/firebaseAccount';

interface AuthApi {
  user: PublicUser | null;
  loading: boolean;
  login(email: string, password: string): Promise<PublicUser>;
  register(input: { email: string; password: string; displayName: string; role: Role }): Promise<PublicUser>;
  startDemo(): Promise<PublicUser>;
  /** Ouvre la fenêtre Google ; le rôle sert seulement si le compte n'existe pas encore sur cet appareil. */
  loginWithGoogle(role: Role): Promise<PublicUser>;
  /** Compte Furious-Tube déjà connecté dans ce navigateur : entrée directe, sans inscription. */
  continueWithFuriousTube(profile: FirebaseProfile): Promise<PublicUser>;
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
      // Compte WhatQuiz de cet appareil, sinon compte Furious-Tube avec les mêmes identifiants.
      login: async (email, password) => {
        try {
          return await withUser(authApi.login(email, password));
        } catch (error) {
          if (!FIREBASE_ACCOUNTS || !(error instanceof ApiError) || error.status !== 401) throw error;
          const profile = await signInWithFuriousTube(email, password).catch((firebaseError: unknown) => {
            throw firebaseError instanceof ApiError && firebaseError.status !== 401 ? firebaseError : error;
          });
          return withUser(authApi.firebase(profile, 'teacher'));
        }
      },
      register: (input) => withUser(authApi.register(input)),
      startDemo: () => withUser(authApi.demo()),
      loginWithGoogle: async (role) => withUser(authApi.firebase(await signInWithGoogle(), role)),
      continueWithFuriousTube: (profile) => withUser(authApi.firebase(profile, 'teacher')),
      logout: async () => {
        // La session Furious-Tube (autre site) reste ouverte : seule celle de WhatQuiz est fermée.
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
