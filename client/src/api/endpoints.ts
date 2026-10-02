import type {
  BankFolder,
  BankQuestion,
  BankQuestionPatch,
  DashboardStats,
  Difficulty,
  QuestionInput,
  GameResults,
  GameSettings,
  GameSummary,
  HostView,
  PublicUser,
  Quiz,
  QuizInput,
  QuizSummary,
  QuizVersionSummary,
  Role,
  StudentHistoryEntry,
} from '../../../shared/types';
import { setToken } from '../lib/backend';
import type { FirebaseProfile } from '../lib/firebaseAccount';
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
  /** Compte Google ou Furious-Tube (Firebase) : ouvre le compte de cet appareil, créé au besoin. */
  firebase: (profile: FirebaseProfile, role: Role) => openedSession(api<SessionResponse>('POST', '/auth/firebase', { ...profile, role })),
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
  update: (id: number, input: QuizInput, options: { autosave?: boolean } = {}) =>
    api<{ quiz: Quiz }>('PUT', `/quizzes/${id}${options.autosave ? '?autosave=1' : ''}`, input),
  library: () => api<{ quizzes: (QuizSummary & { ownerName: string })[] }>('GET', '/quizzes/library'),
  shared: (code: string) => api<{ quiz: Quiz }>('GET', `/quizzes/shared/${encodeURIComponent(code)}`),
  copyShared: (code: string) => api<{ quiz: Quiz }>('POST', `/quizzes/shared/${encodeURIComponent(code)}/copy`),
  versions: (id: number) => api<{ versions: QuizVersionSummary[] }>('GET', `/quizzes/${id}/versions`),
  version: (id: number, versionId: string) => api<{ quiz: QuizInput }>('GET', `/quizzes/${id}/versions/${versionId}`),
  remove: (id: number) => api<{ ok: true }>('DELETE', `/quizzes/${id}`),
  duplicate: (id: number) => api<{ quiz: Quiz }>('POST', `/quizzes/${id}/duplicate`),
  addDemo: () => api<{ quiz: Quiz }>('POST', '/quizzes/demo'),
};

export interface BankAddOptions {
  folderId?: string | null;
  tags?: string[];
  difficulty?: Difficulty | null;
  source?: string;
}

export const bankApi = {
  list: () => api<{ questions: BankQuestion[]; folders: BankFolder[] }>('GET', '/bank'),
  add: (questions: QuestionInput[], options: BankAddOptions = {}) => api<{ questions: BankQuestion[] }>('POST', '/bank/questions', { questions, ...options }),
  addFromQuiz: (quizId: number, options: { folderId?: string | null } = {}) =>
    api<{ questions: BankQuestion[]; skipped: number }>('POST', `/bank/from-quiz/${quizId}`, options),
  update: (id: string, patch: BankQuestionPatch) => api<{ question: BankQuestion }>('PUT', `/bank/questions/${id}`, patch),
  remove: (id: string) => api<{ ok: true }>('DELETE', `/bank/questions/${id}`),
  move: (ids: string[], folderId: string | null) => api<{ count: number }>('POST', '/bank/bulk', { action: 'move', ids, folderId }),
  tag: (ids: string[], tags: string[]) => api<{ count: number }>('POST', '/bank/bulk', { action: 'tag', ids, tags }),
  removeMany: (ids: string[]) => api<{ count: number }>('POST', '/bank/bulk', { action: 'delete', ids }),
  use: (ids: string[]) => api<{ questions: QuestionInput[] }>('POST', '/bank/use', { ids }),
  createQuiz: (ids: string[], title: string) => api<{ quiz: Quiz }>('POST', '/bank/quiz', { ids, title }),
  createFolder: (name: string, parentId: string | null) => api<{ folder: BankFolder }>('POST', '/bank/folders', { name, parentId }),
  updateFolder: (id: string, patch: { name?: string; parentId?: string | null }) => api<{ folder: BankFolder }>('PUT', `/bank/folders/${id}`, patch),
  removeFolder: (id: string) => api<{ ok: true }>('DELETE', `/bank/folders/${id}`),
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

export const metaApi = {
  get: () => api<{ lanUrls: string[] }>('GET', '/meta'),
};
