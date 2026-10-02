import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { PublicUser, Role } from '../../../shared/types';
import { ApiError } from '../api/errors';
import { authApi } from '../api/endpoints';
import {
  connectOnlineAccount,
  createOnlineAccount,
  FIREBASE_ACCOUNTS,
  signInWithFuriousTube,
  signInWithGoogle,
  type FirebaseProfile,
} from '../lib/firebaseAccount';
import { reportCloudProblem } from '../standalone/cloudStatus';

/** Rôle et nom enregistrés en ligne (compte ouvert pour la première fois sur cet appareil). */
async function cloudProfile(uid: string) {
  const { readCloudProfile } = await import('../standalone/cloud');
  return readCloudProfile(uid);
}

/**
 * Compte de cet appareil ouvert avec son mot de passe : on le relie au compte en ligne (mêmes identifiants),
 * créé au besoin, pour que la sauvegarde suive sur le site et dans l'application. Sans Internet, rien ne bloque.
 */
async function linkOnline(user: PublicUser, email: string, password: string): Promise<void> {
  if (!FIREBASE_ACCOUNTS || user.isDemo) return;
  try {
    const { uid } = await authApi.cloud();
    const profile = await connectOnlineAccount(email, password, user.displayName);
    if (!profile) {
      reportCloudProblem('Sauvegarde en ligne impossible : cette adresse est déjà utilisée par un compte en ligne (Furious-Tube) avec un autre mot de passe. Connectez-vous avec ce mot de passe-là.');
      return;
    }
    if (uid === profile.uid) {
      const { resumeCloudSync } = await import('../standalone/cloud');
      resumeCloudSync();
    } else await authApi.linkCloud(profile.uid);
  } catch {
    // Hors ligne : la liaison se fera à la prochaine connexion.
  }
}

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
      // Compte de cet appareil, sinon compte en ligne (créé sur le site, dans l'application ou sur Furious-Tube).
      login: async (email, password) => {
        try {
          const local = await withUser(authApi.login(email, password));
          void linkOnline(local, email, password);
          return local;
        } catch (error) {
          if (!FIREBASE_ACCOUNTS || !(error instanceof ApiError) || error.status !== 401) throw error;
          const profile = await signInWithFuriousTube(email, password).catch((firebaseError: unknown) => {
            throw firebaseError instanceof ApiError && firebaseError.status !== 401 ? firebaseError : error;
          });
          const saved = await cloudProfile(profile.uid);
          return withUser(authApi.firebase({ ...profile, displayName: saved?.displayName ?? profile.displayName }, saved?.role ?? 'teacher', password));
        }
      },
      // Le compte est créé en ligne : les mêmes identifiants l'ouvrent sur le site et dans l'application.
      register: async (input) => {
        if (!FIREBASE_ACCOUNTS) return withUser(authApi.register(input));
        let profile: FirebaseProfile;
        try {
          profile = await createOnlineAccount(input.email, input.password, input.displayName);
        } catch (error) {
          // Sans Internet, le compte est créé sur l'appareil ; il sera relié en ligne à la prochaine connexion.
          if (error instanceof ApiError && error.status === 0) return withUser(authApi.register(input));
          throw error;
        }
        return withUser(authApi.firebase({ ...profile, displayName: input.displayName }, input.role, input.password));
      },
      startDemo: () => withUser(authApi.demo()),
      loginWithGoogle: async (role) => {
        const profile = await signInWithGoogle();
        const saved = await cloudProfile(profile.uid);
        return withUser(authApi.firebase({ ...profile, displayName: saved?.displayName ?? profile.displayName }, saved?.role ?? role));
      },
      continueWithFuriousTube: async (profile) => {
        const saved = await cloudProfile(profile.uid);
        return withUser(authApi.firebase({ ...profile, displayName: saved?.displayName ?? profile.displayName }, saved?.role ?? 'teacher'));
      },
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
