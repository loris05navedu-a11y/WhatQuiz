import { ZodError } from 'zod';
import { DEMO_QUIZ } from '../../../server/src/demo/demoQuiz';
import { GameError } from '../../../server/src/game/errors';
import { ServiceError } from '../../../shared/documents';
import { isScored } from '../../../shared/questionTypes';
import { generateShareCode, isShareCode, normalizeShareCode, quizMetaFrom, toQuizInput } from '../../../shared/quizMeta';
import { quizProblems } from '../../../shared/quizRules';
import { matchSharedRoute } from '../../../shared/services';
import type { QuizGateway } from '../../../shared/services/context';
import { deleteQuizVersions, recordQuizVersion } from '../../../shared/services/versions';
import { z } from 'zod';
import {
  createGameSchema,
  embeddedQuestionListSchema,
  embeddedQuizSchema,
  firstIssue,
  loginSchema,
  passwordChangeSchema,
  profileSchema,
  registerSchema,
} from '../../../server/src/validation';
import { ERRORS } from '../../../shared/constants';
import { randomToken } from '../../../shared/random';
import type {
  DashboardStats,
  GameResults,
  GameSummary,
  PlayerResultRow,
  PlayerView,
  Question,
  QuestionStat,
  QuizInput,
  QuizSummary,
} from '../../../shared/types';
import type { HttpMethod } from '../api/client';
import { ApiError } from '../api/errors';
import {
  flush,
  loadData,
  markDirty,
  nextNumericId,
  nowIso,
  sessionUser,
  setSession,
  toPublicUser,
  localDocStore,
  type LocalData,
  type LocalGame,
  type LocalQuiz,
  type LocalUser,
} from './db';
import { hub } from './hub';

/**
 * API du mode sans serveur : mêmes routes et mêmes réponses que le serveur Express, mais sur les données
 * conservées dans ce navigateur. Les comptes sont propres à l'appareil.
 */

const DEMO_ACCOUNT_TTL_MS = 24 * 3_600_000;

interface Context {
  d: LocalData;
  user: LocalUser | null;
  body: unknown;
  params: string[];
  query: Record<string, string>;
}
type Handler = (ctx: Context) => unknown;

/** Compte Firebase (Google ou Furious-Tube) dont Firebase a vérifié l'identité. */
const firebaseSchema = z.object({
  uid: z.string().min(1).max(128),
  email: z.string().trim().toLowerCase().email().max(160),
  emailVerified: z.boolean().default(false),
  displayName: z.string().trim().max(60),
  role: z.enum(['teacher', 'student']).default('teacher'),
});

const notFound = (message: string = ERRORS.notFound) => new ApiError(404, message);
const forbidden = () => new ApiError(403, ERRORS.forbidden);

/* ───────────── Mots de passe (PBKDF2, WebCrypto) ───────────── */

const PBKDF2_ITERATIONS = 150_000;
const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const fromBase64 = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new ApiError(500, 'Ce navigateur ne permet pas de créer un compte (page non sécurisée)');
  const key = await subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations }, key, 256);
  return new Uint8Array(bits);
}

async function hashPassword(password: string): Promise<string> {
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${PBKDF2_ITERATIONS}$${toBase64(salt)}$${toBase64(await derive(password, salt, PBKDF2_ITERATIONS))}`;
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, iterations, salt, hash] = stored.split('$');
  if (scheme !== 'pbkdf2' || !salt || !hash) return false;
  const actual = toBase64(await derive(password, fromBase64(salt), Number(iterations)));
  return actual === hash;
}

/* ───────────── Accès ───────────── */

function requireAuth(ctx: Context): LocalUser {
  if (!ctx.user) throw new ApiError(401, ERRORS.unauthenticated);
  return ctx.user;
}

function requireTeacher(ctx: Context): LocalUser {
  const user = requireAuth(ctx);
  if (user.role !== 'teacher') throw new ApiError(403, 'Réservé aux comptes professeur');
  return user;
}

function findByEmail(d: LocalData, email: string): LocalUser | undefined {
  const key = email.trim().toLowerCase();
  return [...d.users.values()].find((u) => u.email.toLowerCase() === key);
}

function ownedQuiz(ctx: Context, rawId: unknown): LocalQuiz {
  const user = requireTeacher(ctx);
  const quiz = ctx.d.quizzes.get(Number(rawId));
  if (!quiz || quiz.deletedAt) throw notFound('Quiz introuvable');
  if (quiz.ownerId !== user.id) throw forbidden();
  return quiz;
}

function ownedGame(ctx: Context, id: string): LocalGame {
  const user = requireTeacher(ctx);
  const game = ctx.d.games.get(id);
  if (!game) throw notFound('Partie introuvable');
  if (game.hostId !== user.id) throw forbidden();
  return game;
}

/* ───────────── Comptes ───────────── */

function createUser(d: LocalData, input: Omit<LocalUser, 'id' | 'createdAt'>): LocalUser {
  const user: LocalUser = { ...input, id: nextNumericId(d.users), createdAt: nowIso() };
  d.users.set(user.id, user);
  markDirty('user', user.id);
  return user;
}

function deleteUser(d: LocalData, userId: number): void {
  d.users.delete(userId);
  markDirty('user', userId);
  for (const quiz of [...d.quizzes.values()]) if (quiz.ownerId === userId) deleteQuiz(d, quiz.id);
  for (const game of [...d.games.values()]) if (game.hostId === userId) deleteGame(d, game.id);
  for (const [key, entry] of d.history) {
    if (entry.userId !== userId) continue;
    d.history.delete(key);
    markDirty('history', key);
  }
}

function purgeDemoAccounts(d: LocalData): void {
  const cutoff = Date.now() - DEMO_ACCOUNT_TTL_MS;
  for (const user of [...d.users.values()]) if (user.isDemo && Date.parse(user.createdAt) < cutoff) deleteUser(d, user.id);
}

/* ───────────── Quiz ───────────── */

function toQuestions(input: QuizInput): Question[] {
  return input.questions.map((question, position) => ({ ...structuredClone(question), id: position + 1, position }));
}

/** Code d'accès unique, attribué dès que le quiz est partagé (et conservé ensuite). */
function accessCodeFor(d: LocalData, input: QuizInput, current: string | null): string | null {
  if (current || (input.visibility ?? 'private') === 'private') return current;
  const used = new Set([...d.quizzes.values()].map((q) => q.accessCode));
  for (;;) {
    const code = generateShareCode();
    if (!used.has(code)) return code;
  }
}

function createQuiz(d: LocalData, ownerId: number, input: QuizInput): LocalQuiz {
  const now = nowIso();
  const quiz: LocalQuiz = {
    id: nextNumericId(d.quizzes),
    ownerId,
    title: input.title,
    description: input.description,
    imageUrl: input.imageUrl,
    category: input.category,
    ...quizMetaFrom(input, accessCodeFor(d, input, null)),
    questions: toQuestions(input),
    createdAt: now,
    updatedAt: now,
  };
  d.quizzes.set(quiz.id, quiz);
  markDirty('quiz', quiz.id);
  return quiz;
}

function updateQuiz(d: LocalData, quiz: LocalQuiz, input: QuizInput): LocalQuiz {
  Object.assign(quiz, {
    title: input.title,
    description: input.description,
    imageUrl: input.imageUrl,
    category: input.category,
    ...quizMetaFrom(input, accessCodeFor(d, input, quiz.accessCode)),
    questions: toQuestions(input),
    updatedAt: nowIso(),
  });
  markDirty('quiz', quiz.id);
  return quiz;
}

function deleteQuiz(d: LocalData, quizId: number): void {
  const quiz = d.quizzes.get(quizId);
  d.quizzes.delete(quizId);
  markDirty('quiz', quizId);
  if (quiz) deleteQuizVersions(localDocStore(d), quiz.ownerId, quizId);
  for (const game of d.games.values()) {
    if (game.quizId !== quizId) continue;
    game.quizId = null;
    markDirty('game', game.id);
  }
}

function quizSummary(d: LocalData, q: LocalQuiz): QuizSummary {
  return {
    id: q.id,
    title: q.title,
    description: q.description,
    category: q.category,
    imageUrl: q.imageUrl,
    status: q.status,
    visibility: q.visibility,
    accessCode: q.accessCode,
    subcategory: q.subcategory,
    tags: q.tags,
    difficulty: q.difficulty,
    level: q.level,
    questionCount: q.questions.length,
    gameCount: [...d.games.values()].filter((g) => g.status === 'ended' && g.quizId === q.id).length,
    createdAt: q.createdAt,
    updatedAt: q.updatedAt,
  };
}

function sharedQuiz(d: LocalData, rawCode: string): LocalQuiz {
  const code = normalizeShareCode(rawCode);
  const quiz = isShareCode(code)
    ? [...d.quizzes.values()].find((q) => q.accessCode === code && q.visibility !== 'private' && q.status === 'published' && !q.deletedAt)
    : undefined;
  if (!quiz) throw notFound('Aucun quiz partagé ne correspond à ce code');
  return quiz;
}

const saveVersion = (d: LocalData, quiz: LocalQuiz, reason: 'save' | 'autosave') =>
  recordQuizVersion(localDocStore(d), quiz.ownerId, quiz.id, toQuizInput(quiz), reason, new Date());

/* ───────────── Parties et statistiques ───────────── */

/** Une partie restée ouverte sans salle active a été interrompue (page fermée ou rechargée). */
function effectiveStatus(game: LocalGame): GameSummary['status'] {
  if ((game.status === 'lobby' || game.status === 'running') && !hub.getById(game.id)) return 'aborted';
  return game.status;
}

function toSummary(game: LocalGame): GameSummary {
  const status = effectiveStatus(game);
  const playerCount = game.players.filter((p) => !p.kicked).length;
  const possible = playerCount * game.snapshot.questions.slice(0, game.questionsPlayed).filter(isScored).length;
  const correctTotal = game.results.reduce((sum, r) => sum + r.correctCount, 0);
  return {
    id: game.id,
    code: game.code,
    quizId: game.quizId,
    quizTitle: game.quizTitle,
    status,
    playerCount,
    questionCount: game.questionsPlayed,
    successRate: status === 'ended' && possible > 0 ? correctTotal / possible : null,
    createdAt: game.createdAt,
    endedAt: game.endedAt,
  };
}

function hostedGames(d: LocalData, hostId: number): LocalGame[] {
  return [...d.games.values()].filter((g) => g.hostId === hostId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function listByHost(d: LocalData, hostId: number, limit = 50): GameSummary[] {
  return hostedGames(d, hostId)
    .filter((g) => g.status !== 'lobby')
    .slice(0, limit)
    .map(toSummary);
}

function dashboardStats(d: LocalData, hostId: number): DashboardStats {
  const ended = hostedGames(d, hostId).filter((g) => g.status === 'ended');
  const rates = ended.map(toSummary).flatMap((g) => (g.successRate === null ? [] : [g.successRate]));
  return {
    quizCount: [...d.quizzes.values()].filter((q) => q.ownerId === hostId).length,
    gameCount: ended.length,
    playerCount: ended.reduce((sum, g) => sum + g.players.filter((p) => !p.kicked).length, 0),
    avgSuccessRate: rates.length ? rates.reduce((a, b) => a + b, 0) / rates.length : null,
    recentGames: listByHost(d, hostId, 5),
  };
}

function results(game: LocalGame): GameResults {
  const summary = toSummary(game);
  const nicknames = new Map(game.players.map((p) => [p.id, p.nickname]));
  const kept = new Set(game.players.filter((p) => !p.kicked).map((p) => p.id));
  const players: PlayerResultRow[] = game.results
    .filter((r) => nicknames.has(r.playerId))
    .map((r) => ({ ...r, nickname: nicknames.get(r.playerId)! }))
    .sort((a, b) => a.rank - b.rank || a.nickname.localeCompare(b.nickname, 'fr'));

  const perQuestion = new Map<number, { answered: number; correct: number; totalMs: number }>();
  for (const answer of game.answers) {
    if (!kept.has(answer.playerId)) continue;
    const stat = perQuestion.get(answer.questionIndex) ?? { answered: 0, correct: 0, totalMs: 0 };
    stat.answered += 1;
    stat.correct += answer.correct ? 1 : 0;
    stat.totalMs += answer.responseMs;
    perQuestion.set(answer.questionIndex, stat);
  }
  const questions: QuestionStat[] = game.snapshot.questions.slice(0, game.questionsPlayed).map((question, index) => {
    const stat = perQuestion.get(index);
    const correctCount = stat?.correct ?? 0;
    return {
      index,
      text: question.text,
      type: question.type,
      scored: isScored(question),
      answeredCount: stat?.answered ?? 0,
      correctCount,
      successRate: players.length ? correctCount / players.length : 0,
      avgResponseMs: stat ? Math.round(stat.totalMs / stat.answered) : null,
    };
  });
  const answerCount = questions.reduce((sum, q) => sum + q.answeredCount, 0);
  const totalMs = [...perQuestion.values()].reduce((sum, s) => sum + s.totalMs, 0);
  const timedCount = [...perQuestion.values()].reduce((sum, s) => sum + s.answered, 0);
  const sorted = questions.filter((q) => q.scored).sort((a, b) => a.successRate - b.successRate);
  return {
    game: summary,
    settings: game.settings,
    players,
    questions,
    totals: {
      successRate: summary.successRate ?? 0,
      answerCount,
      avgResponseMs: timedCount ? Math.round(totalMs / timedCount) : null,
      hardest: sorted[0] ?? null,
      easiest: sorted.length > 1 ? sorted[sorted.length - 1] : null,
    },
  };
}

function deleteGame(d: LocalData, gameId: string): void {
  const room = hub.getById(gameId);
  if (room) hub.remove(room);
  d.games.delete(gameId);
  markDirty('game', gameId);
}

/** Vérifie un code : partie hébergée ici, sinon sur l'appareil d'un professeur (pair-à-pair). */
async function checkCode(code: string): Promise<{ code: string; quizTitle: string }> {
  if (!/^\d{6}$/.test(code)) throw notFound(ERRORS.gameNotFound);
  if (hub.hasRoom(code)) {
    try {
      return hub.checkCode(code);
    } catch (error) {
      throw new ApiError(410, (error as Error).message);
    }
  }
  const { probeGame } = await import('./peer');
  return probeGame(code);
}

/* ───────────── Routes ───────────── */

const routes: [HttpMethod, RegExp, Handler][] = [
  ['GET', /^\/auth\/me$/, ({ user }) => ({ user: user ? toPublicUser(user) : null })],
  [
    'POST',
    /^\/auth\/register$/,
    async (ctx) => {
      const input = registerSchema.parse(ctx.body);
      const passwordHash = await hashPassword(input.password);
      if (findByEmail(ctx.d, input.email)) throw new ApiError(409, 'Un compte existe déjà avec cette adresse sur cet appareil');
      const user = createUser(ctx.d, { email: input.email, displayName: input.displayName, role: input.role, isDemo: false, passwordHash });
      setSession(user.id);
      return { user: toPublicUser(user) };
    },
  ],
  [
    'POST',
    /^\/auth\/login$/,
    async (ctx) => {
      const input = loginSchema.parse(ctx.body);
      const user = findByEmail(ctx.d, input.email);
      if (!user || !(await verifyPassword(input.password, user.passwordHash))) {
        throw new ApiError(401, 'E-mail ou mot de passe incorrect');
      }
      setSession(user.id);
      return { user: toPublicUser(user) };
    },
  ],
  [
    'POST',
    /^\/auth\/firebase$/,
    (ctx) => {
      const input = firebaseSchema.parse(ctx.body);
      let user = [...ctx.d.users.values()].find((u) => u.firebaseUid === input.uid || u.googleUid === input.uid);
      if (!user) {
        const sameEmail = findByEmail(ctx.d, input.email);
        // Relier par e-mail seulement si Firebase a vérifié l'adresse : sinon n'importe qui pourrait prendre ce compte.
        if (sameEmail && !input.emailVerified) {
          throw new ApiError(409, 'Un compte WhatQuiz existe déjà avec cette adresse sur cet appareil : connectez-vous avec son mot de passe');
        }
        if (sameEmail) {
          sameEmail.firebaseUid = input.uid;
          markDirty('user', sameEmail.id);
        }
        user = sameEmail;
      }
      user ??= createUser(ctx.d, {
        email: input.email,
        displayName: (input.displayName || input.email.split('@')[0]).slice(0, 60),
        role: input.role,
        isDemo: false,
        passwordHash: '',
        firebaseUid: input.uid,
      });
      setSession(user.id);
      return { user: toPublicUser(user) };
    },
  ],
  [
    'POST',
    /^\/auth\/logout$/,
    () => {
      setSession(null);
      return { ok: true };
    },
  ],
  [
    'POST',
    /^\/auth\/demo$/,
    (ctx) => {
      purgeDemoAccounts(ctx.d);
      const user = createUser(ctx.d, {
        email: `demo-${randomToken(6).toLowerCase()}@demo.whatquiz.local`,
        displayName: 'Professeur démo',
        role: 'teacher',
        isDemo: true,
        passwordHash: '',
      });
      createQuiz(ctx.d, user.id, DEMO_QUIZ);
      setSession(user.id);
      return { user: toPublicUser(user) };
    },
  ],

  [
    'PUT',
    /^\/account\/profile$/,
    (ctx) => {
      const user = requireAuth(ctx);
      const input = profileSchema.parse(ctx.body);
      if (user.isDemo) throw new ApiError(403, 'Le profil du compte démo ne peut pas être modifié');
      const existing = findByEmail(ctx.d, input.email);
      if (existing && existing.id !== user.id) throw new ApiError(409, 'Un compte existe déjà avec cette adresse sur cet appareil');
      user.email = input.email;
      user.displayName = input.displayName;
      markDirty('user', user.id);
      return { user: toPublicUser(user) };
    },
  ],
  [
    'PUT',
    /^\/account\/password$/,
    async (ctx) => {
      const user = requireAuth(ctx);
      const input = passwordChangeSchema.parse(ctx.body);
      if (user.isDemo) throw new ApiError(403, 'Le mot de passe du compte démo ne peut pas être modifié');
      // Compte ouvert avec Google : le premier mot de passe se définit sans ancien mot de passe.
      if (user.passwordHash && !(await verifyPassword(input.currentPassword, user.passwordHash))) {
        throw new ApiError(400, 'Mot de passe actuel incorrect');
      }
      user.passwordHash = await hashPassword(input.newPassword);
      markDirty('user', user.id);
      return { ok: true };
    },
  ],
  [
    'DELETE',
    /^\/account$/,
    (ctx) => {
      deleteUser(ctx.d, requireAuth(ctx).id);
      setSession(null);
      return { ok: true };
    },
  ],
  [
    'GET',
    /^\/account\/history$/,
    (ctx) => {
      const user = requireAuth(ctx);
      const history = [...ctx.d.history.values()]
        .filter((entry) => entry.userId === user.id)
        .sort((a, b) => (b.endedAt ?? '').localeCompare(a.endedAt ?? ''))
        .slice(0, 50)
        .map(({ userId: _userId, ...entry }) => entry);
      return { history };
    },
  ],

  [
    'GET',
    /^\/quizzes$/,
    (ctx) => {
      const user = requireTeacher(ctx);
      const quizzes = [...ctx.d.quizzes.values()]
        .filter((q) => q.ownerId === user.id && !q.deletedAt)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .map((q) => quizSummary(ctx.d, q));
      return { quizzes };
    },
  ],
  [
    'POST',
    /^\/quizzes$/,
    (ctx) => {
      const quiz = createQuiz(ctx.d, requireTeacher(ctx).id, embeddedQuizSchema.parse(ctx.body));
      saveVersion(ctx.d, quiz, 'save');
      return { quiz };
    },
  ],
  ['POST', /^\/quizzes\/demo$/, (ctx) => ({ quiz: createQuiz(ctx.d, requireTeacher(ctx).id, DEMO_QUIZ) })],
  [
    'GET',
    /^\/quizzes\/library$/,
    (ctx) => {
      const user = requireTeacher(ctx);
      const quizzes = [...ctx.d.quizzes.values()]
        .filter((q) => q.ownerId !== user.id && q.visibility === 'public' && q.status === 'published' && !q.deletedAt)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .map((q) => ({ ...quizSummary(ctx.d, q), ownerName: ctx.d.users.get(q.ownerId)?.displayName ?? '' }));
      return { quizzes };
    },
  ],
  ['GET', /^\/quizzes\/shared\/([^/]+)$/, (ctx) => (requireTeacher(ctx), { quiz: sharedQuiz(ctx.d, ctx.params[0]) })],
  [
    'POST',
    /^\/quizzes\/shared\/([^/]+)\/copy$/,
    (ctx) => {
      const user = requireTeacher(ctx);
      const source = sharedQuiz(ctx.d, ctx.params[0]);
      const quiz = createQuiz(ctx.d, user.id, { ...toQuizInput(source), visibility: 'private', status: 'draft' });
      saveVersion(ctx.d, quiz, 'save');
      return { quiz };
    },
  ],
  ['GET', /^\/quizzes\/(\d+)$/, (ctx) => ({ quiz: ownedQuiz(ctx, ctx.params[0]) })],
  [
    'PUT',
    /^\/quizzes\/(\d+)$/,
    (ctx) => {
      const quiz = updateQuiz(ctx.d, ownedQuiz(ctx, ctx.params[0]), embeddedQuizSchema.parse(ctx.body));
      saveVersion(ctx.d, quiz, ctx.query.autosave === '1' ? 'autosave' : 'save');
      return { quiz };
    },
  ],
  [
    'DELETE',
    /^\/quizzes\/(\d+)$/,
    (ctx) => {
      deleteQuiz(ctx.d, ownedQuiz(ctx, ctx.params[0]).id);
      return { ok: true };
    },
  ],
  [
    'POST',
    /^\/quizzes\/(\d+)\/duplicate$/,
    (ctx) => {
      const copy = toQuizInput(ownedQuiz(ctx, ctx.params[0]));
      const quiz = createQuiz(ctx.d, ctx.user!.id, { ...copy, title: `${copy.title} (copie)`.slice(0, 120), visibility: 'private' });
      saveVersion(ctx.d, quiz, 'save');
      return { quiz };
    },
  ],

  ['GET', /^\/games\/code\/([^/]+)$/, (ctx) => checkCode(ctx.params[0])],
  [
    'POST',
    /^\/games$/,
    async (ctx) => {
      const user = requireTeacher(ctx);
      const input = createGameSchema.parse(ctx.body);
      const quiz = ownedQuiz(ctx, input.quizId);
      if (quiz.questions.length === 0) throw new ApiError(400, 'Ajoutez au moins une question avant de lancer une partie');
      const problems = quizProblems(quiz);
      if (problems.length > 0) throw new ApiError(400, `Corrigez le quiz avant de le lancer — ${problems[0]}`);
      const isTest = input.mode !== 'live';
      const room = await hub.createRoom({
        hostUserId: user.id,
        quiz,
        isTest,
        settings: input.mode === 'test-player' ? { ...input.settings, autoAdvance: true } : input.settings,
        autoStartOnJoin: input.mode === 'test-player',
        allowBots: isTest || user.isDemo,
      });
      return { gameId: room.id, code: room.code };
    },
  ],
  [
    'GET',
    /^\/games$/,
    (ctx) => {
      const user = requireTeacher(ctx);
      const active = hub
        .listByHost(user.id)
        .filter((room) => room.phase !== 'ended' && !room.isTest)
        .map((room) => ({ id: room.id, code: room.code, quizTitle: room.quizTitle, phase: room.phase, playerCount: room.players.size }));
      return { games: listByHost(ctx.d, user.id), active };
    },
  ],
  ['GET', /^\/games\/stats$/, (ctx) => ({ stats: dashboardStats(ctx.d, requireTeacher(ctx).id) })],
  ['GET', /^\/games\/([\w-]+)\/results$/, (ctx) => ({ results: results(ownedGame(ctx, ctx.params[0])) })],
  [
    'DELETE',
    /^\/games\/([\w-]+)$/,
    (ctx) => {
      deleteGame(ctx.d, ownedGame(ctx, ctx.params[0]).id);
      return { ok: true };
    },
  ],

  ['GET', /^\/meta$/, () => ({ lanUrls: [] })],
];

function localQuizGateway(d: LocalData): QuizGateway {
  return {
    getOwned: (ownerId, quizId) => {
      const quiz = d.quizzes.get(quizId);
      return quiz && quiz.ownerId === ownerId && !quiz.deletedAt ? quiz : undefined;
    },
    create: (ownerId, input) => createQuiz(d, ownerId, input),
    listOwned: (ownerId) => [...d.quizzes.values()].filter((q) => q.ownerId === ownerId && !q.deletedAt),
  };
}

export async function localApi<T>(method: HttpMethod, path: string, body?: unknown): Promise<T> {
  try {
    const d = await loadData();
    const [pathname, search = ''] = path.split('?');
    const query = Object.fromEntries(new URLSearchParams(search));
    const user = sessionUser(d);
    const cloned = body === undefined ? undefined : structuredClone(body);
    let result: unknown;
    let found = false;
    for (const [routeMethod, pattern, handler] of routes) {
      if (routeMethod !== method) continue;
      const match = pattern.exec(pathname);
      if (!match) continue;
      result = await handler({ d, user, body: cloned, params: match.slice(1), query });
      found = true;
      break;
    }
    if (!found) {
      const shared = matchSharedRoute(method, pathname);
      if (!shared) throw notFound();
      result = await shared.route.handler({
        user: user ? toPublicUser(user) : null,
        body: cloned,
        params: shared.params,
        query,
        docs: localDocStore(d),
        quizzes: localQuizGateway(d),
        parseQuestions: (raw) => embeddedQuestionListSchema.parse({ questions: raw }).questions,
        now: () => new Date(),
      });
    }
    // Une modification est écrite avant de répondre : l'écran suivant (ou un rechargement) la retrouve.
    if (method === 'GET') void flush();
    else await flush();
    return structuredClone(result) as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error instanceof ZodError) throw new ApiError(400, firstIssue(error));
    if (error instanceof GameError) throw new ApiError(409, error.message);
    if (error instanceof ServiceError) throw new ApiError(error.status, error.message);
    console.error('[whatquiz] Erreur locale :', error);
    throw new ApiError(500, ERRORS.generic);
  }
}

/** Élève connecté à un compte sur cet appareil : ses parties terminées rejoignent son historique. */
export async function recordPlayedGame(view: PlayerView): Promise<void> {
  if (view.phase !== 'ended' || view.isTest) return;
  const d = await loadData();
  const user = sessionUser(d);
  if (!user || user.role !== 'student') return;
  const key = `${view.code}:${view.me.id}`;
  const previous = d.history.get(key);
  const entry = {
    userId: user.id,
    gameId: key,
    quizTitle: view.quizTitle,
    nickname: view.me.nickname,
    rank: view.final?.rank ?? null,
    score: view.final?.score ?? null,
    playerCount: view.final?.playerCount ?? view.playerCount,
    endedAt: previous?.endedAt ?? nowIso(),
  };
  if (previous && JSON.stringify(previous) === JSON.stringify(entry)) return;
  d.history.set(key, entry);
  markDirty('history', key);
}
