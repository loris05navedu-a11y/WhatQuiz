import type { FinalPlayerResult, QuizSnapshot } from '../../../server/src/db/games';
import type { RoomStore } from '../../../server/src/game/GameRoom';
import { randomToken } from '../../../shared/random';
import type { GameSettings, GameSummary, PublicUser, Quiz, Role, StudentHistoryEntry, SubmittedAnswer } from '../../../shared/types';
import { readStorage, writeStorage } from '../lib/storage';

/**
 * Données du mode sans serveur, conservées dans le navigateur (IndexedDB).
 * Chaque compte, quiz, partie ou entrée d'historique est un enregistrement distinct : deux onglets ouverts
 * n'écrasent jamais l'enregistrement modifié par l'autre.
 */

export interface LocalUser {
  id: number;
  email: string;
  displayName: string;
  role: Role;
  isDemo: boolean;
  createdAt: string;
  /** Vide pour un compte ouvert avec Google (pas de mot de passe). */
  passwordHash: string;
  /** Identifiant Firebase du compte Google lié. */
  googleUid?: string;
}

export interface LocalPlayer {
  id: string;
  nickname: string;
  userId: number | null;
  score: number;
  kicked: boolean;
}

export interface LocalAnswer {
  playerId: string;
  questionIndex: number;
  answer: SubmittedAnswer;
  correct: boolean;
  points: number;
  responseMs: number;
}

export interface LocalGame {
  id: string;
  code: string;
  quizId: number | null;
  hostId: number;
  quizTitle: string;
  snapshot: QuizSnapshot;
  settings: GameSettings;
  status: GameSummary['status'];
  questionsPlayed: number;
  resultsVisible: boolean;
  createdAt: string;
  startedAt: string | null;
  endedAt: string | null;
  players: LocalPlayer[];
  answers: LocalAnswer[];
  results: FinalPlayerResult[];
}

export interface LocalHistory extends StudentHistoryEntry {
  userId: number;
}

type Tables = {
  user: Map<number, LocalUser>;
  quiz: Map<number, Quiz>;
  game: Map<string, LocalGame>;
  history: Map<string, LocalHistory>;
};
type Kind = keyof Tables;

export interface LocalData {
  users: Map<number, LocalUser>;
  quizzes: Map<number, Quiz>;
  games: Map<string, LocalGame>;
  history: Map<string, LocalHistory>;
}

const DB_NAME = 'whatquiz';
const STORE = 'records';
const REVISION_KEY = 'wq:local-rev';
const SESSION_KEY = 'wq:local-session';
const SAVE_DELAY_MS = 250;

let data: LocalData | null = null;
let loading: Promise<LocalData> | null = null;
let knownRevision: string | null = null;
const dirty = new Set<string>();
let saveTimer: ReturnType<typeof setTimeout> | null = null;

export const nowIso = () => new Date().toISOString();

function openIdb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

let idb: Promise<IDBDatabase | null> | null = null;
const database = () => (idb ??= openIdb());

async function readAll(): Promise<LocalData> {
  const fresh: LocalData = { users: new Map(), quizzes: new Map(), games: new Map(), history: new Map() };
  const db = await database();
  if (!db) return fresh;
  const entries = await new Promise<[string, unknown][]>((resolve) => {
    const out: [string, unknown][] = [];
    const cursor = db.transaction(STORE, 'readonly').objectStore(STORE).openCursor();
    cursor.onsuccess = () => {
      const current = cursor.result;
      if (!current) return resolve(out);
      out.push([String(current.key), current.value]);
      current.continue();
    };
    cursor.onerror = () => resolve(out);
  });
  for (const [key, value] of entries) {
    const kind = key.slice(0, key.indexOf(':')) as Kind;
    if (kind === 'user') fresh.users.set((value as LocalUser).id, value as LocalUser);
    else if (kind === 'quiz') fresh.quizzes.set((value as Quiz).id, value as Quiz);
    else if (kind === 'game') fresh.games.set((value as LocalGame).id, value as LocalGame);
    else if (kind === 'history') fresh.history.set(key.slice(8), value as LocalHistory);
  }
  return fresh;
}

function tables(d: LocalData): Tables {
  return { user: d.users, quiz: d.quizzes, game: d.games, history: d.history };
}

/** Parties hébergées par cet onglet : leur version en mémoire fait foi. */
const hostedHere = new Set<string>();

/** Charge les données (une seule fois, puis à nouveau si un autre onglet les a modifiées). */
export async function loadData(): Promise<LocalData> {
  const revision = readStorage('local', REVISION_KEY);
  if (data && (revision === knownRevision || dirty.size > 0)) return data;
  loading ??= readAll().then((loaded) => {
    knownRevision = revision;
    if (data) {
      for (const id of hostedHere) {
        const hosted = data.games.get(id);
        if (hosted) loaded.games.set(id, hosted);
      }
    }
    data = loaded;
    loading = null;
    return loaded;
  });
  return loading;
}

export function requireData(): LocalData {
  if (!data) throw new Error('Données locales non chargées');
  return data;
}

export function markDirty(kind: Kind, id: string | number): void {
  dirty.add(`${kind}:${id}`);
  if (saveTimer === null) saveTimer = setTimeout(() => void flush(), SAVE_DELAY_MS);
}

export async function flush(): Promise<void> {
  if (saveTimer !== null) clearTimeout(saveTimer);
  saveTimer = null;
  if (dirty.size === 0 || !data) return;
  const keys = [...dirty];
  dirty.clear();
  const db = await database();
  if (!db) return;
  const t = tables(data);
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    for (const key of keys) {
      const separator = key.indexOf(':');
      const kind = key.slice(0, separator) as Kind;
      const raw = key.slice(separator + 1);
      const value = (t[kind] as Map<string | number, unknown>).get(kind === 'user' || kind === 'quiz' ? Number(raw) : raw);
      if (value === undefined) store.delete(key);
      else store.put(value, key);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => {
      console.warn('[whatquiz] Enregistrement local impossible', tx.error);
      resolve();
    };
    tx.onabort = tx.onerror;
  });
  knownRevision = randomToken(6);
  writeStorage('local', REVISION_KEY, knownRevision);
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => void flush());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void flush();
  });
}

export function nextNumericId(map: Map<number, unknown>): number {
  let max = 0;
  for (const id of map.keys()) if (id > max) max = id;
  return max + 1;
}

/* ───────────── Session (compte ouvert sur cet appareil) ───────────── */

export function sessionUser(d: LocalData): LocalUser | null {
  const id = Number(readStorage('local', SESSION_KEY));
  return (Number.isInteger(id) && d.users.get(id)) || null;
}

export function setSession(userId: number | null): void {
  writeStorage('local', SESSION_KEY, userId === null ? null : String(userId));
}

export function toPublicUser(user: LocalUser): PublicUser {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    isDemo: user.isDemo,
    isAdmin: false,
    createdAt: user.createdAt,
  };
}

export async function currentUser(): Promise<PublicUser | null> {
  const user = sessionUser(await loadData());
  return user ? toPublicUser(user) : null;
}

/* ───────────── Parties : enregistrement au fil du jeu ───────────── */

function game(id: string): LocalGame | undefined {
  return requireData().games.get(id);
}

function updateGame(id: string, change: (game: LocalGame) => void): void {
  const found = game(id);
  if (!found) return;
  change(found);
  markDirty('game', id);
}

export const gameStore: RoomStore & {
  create(input: { id: string; code: string; hostId: number; snapshot: QuizSnapshot; settings: GameSettings }): void;
} = {
  create(input) {
    hostedHere.add(input.id);
    requireData().games.set(input.id, {
      id: input.id,
      code: input.code,
      quizId: input.snapshot.quizId,
      hostId: input.hostId,
      quizTitle: input.snapshot.title,
      snapshot: input.snapshot,
      settings: input.settings,
      status: 'lobby',
      questionsPlayed: 0,
      resultsVisible: false,
      createdAt: nowIso(),
      startedAt: null,
      endedAt: null,
      players: [],
      answers: [],
      results: [],
    });
    markDirty('game', input.id);
  },
  markStarted(id, settings) {
    updateGame(id, (g) => {
      g.status = 'running';
      g.settings = { ...settings };
      g.startedAt = nowIso();
    });
  },
  addPlayer(input) {
    updateGame(input.gameId, (g) => g.players.push({ id: input.id, nickname: input.nickname, userId: input.userId, score: 0, kicked: false }));
  },
  markKicked(playerId) {
    for (const g of requireData().games.values()) {
      const player = g.players.find((p) => p.id === playerId);
      if (!player) continue;
      player.kicked = true;
      markDirty('game', g.id);
      return;
    }
  },
  saveAnswer(input) {
    updateGame(input.gameId, (g) => {
      const { gameId: _gameId, ...answer } = input;
      const index = g.answers.findIndex((a) => a.playerId === input.playerId && a.questionIndex === input.questionIndex);
      if (index >= 0) g.answers[index] = answer;
      else g.answers.push(answer);
    });
  },
  finish(id, questionsPlayed, results, scores) {
    updateGame(id, (g) => {
      g.status = 'ended';
      g.questionsPlayed = questionsPlayed;
      g.endedAt = nowIso();
      for (const player of g.players) player.score = scores.get(player.id) ?? player.score;
      g.results = results;
    });
  },
  abort(id) {
    updateGame(id, (g) => {
      g.status = 'aborted';
      g.endedAt = nowIso();
    });
  },
  setResultsVisible(id, visible) {
    updateGame(id, (g) => {
      g.resultsVisible = visible;
    });
  },
};
