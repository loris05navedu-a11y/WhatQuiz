import type {
  DashboardStats,
  GameResults,
  GameSettings,
  GameSummary,
  HostView,
  PublicUser,
  Quiz,
  QuizInput,
  QuizSummary,
  Role,
  StudentHistoryEntry,
} from '../../../shared/types';
import { setToken } from '../lib/backend';
import type { GoogleProfile } from '../lib/google';
import { api } from './client';

export type GameMode = 'live' | 'test-host' | 'test-player';

export interface ActiveGame {
  id: string;
  code: string;
  quizTitle: string;
  phase: HostView['phase'];
  playerCount: number;
}

interface SessionResponse {
  user: PublicUser;
  token?: string;
}

/** Mémorise le jeton de session renvoyé par le serveur (site hébergé séparément). */
async function openedSession(request: Promise<SessionResponse>): Promise<{ user: PublicUser }> {
  const { user, token } = await request;
  if (token) setToken(token);
  return { user };
}

export const authApi = {
  me: () => api<{ user: PublicUser | null }>('GET', '/auth/me'),
  login: (email: string, password: string) => openedSession(api<SessionResponse>('POST', '/auth/login', { email, password })),
  register: (input: { email: string; password: string; displayName: string; role: Role }) =>
    openedSession(api<SessionResponse>('POST', '/auth/register', input)),
  demo: () => openedSession(api<SessionResponse>('POST', '/auth/demo')),
  google: (profile: GoogleProfile, role: Role) => openedSession(api<SessionResponse>('POST', '/auth/google', { ...profile, role })),
  logout: async () => {
    try {
      return await api<{ ok: true }>('POST', '/auth/logout');
    } finally {
      setToken(null);
    }
  },
};

export const accountApi = {
  updateProfile: (input: { email: string; displayName: string }) => api<{ user: PublicUser }>('PUT', '/account/profile', input),
  changePassword: (currentPassword: string, newPassword: string) =>
    api<{ ok: true }>('PUT', '/account/password', { currentPassword, newPassword }),
  remove: () => api<{ ok: true }>('DELETE', '/account'),
  history: () => api<{ history: StudentHistoryEntry[] }>('GET', '/account/history'),
};

export const quizApi = {
  list: () => api<{ quizzes: QuizSummary[] }>('GET', '/quizzes'),
  get: (id: number) => api<{ quiz: Quiz }>('GET', `/quizzes/${id}`),
  create: (input: QuizInput) => api<{ quiz: Quiz }>('POST', '/quizzes', input),
  update: (id: number, input: QuizInput) => api<{ quiz: Quiz }>('PUT', `/quizzes/${id}`, input),
  remove: (id: number) => api<{ ok: true }>('DELETE', `/quizzes/${id}`),
  duplicate: (id: number) => api<{ quiz: Quiz }>('POST', `/quizzes/${id}/duplicate`),
  addDemo: () => api<{ quiz: Quiz }>('POST', '/quizzes/demo'),
};

export const gameApi = {
  create: (quizId: number, mode: GameMode, settings: Partial<GameSettings> = {}) =>
    api<{ gameId: string; code: string }>('POST', '/games', { quizId, mode, settings }),
  list: () => api<{ games: GameSummary[]; active: ActiveGame[] }>('GET', '/games'),
  stats: () => api<{ stats: DashboardStats }>('GET', '/games/stats'),
  results: (id: string) => api<{ results: GameResults }>('GET', `/games/${id}/results`),
  remove: (id: string) => api<{ ok: true }>('DELETE', `/games/${id}`),
  checkCode: (code: string) => api<{ code: string; quizTitle: string }>('GET', `/games/code/${code}`),
};

export const uploadApi = {
  image: (dataUrl: string) => api<{ url: string }>('POST', '/uploads', { dataUrl }),
};

export const metaApi = {
  get: () => api<{ lanUrls: string[] }>('GET', '/meta'),
};
