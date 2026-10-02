import { quizMediaUrls } from '../../../shared/media';
import { firebaseUid, loadFirestore } from '../lib/firebaseAccount';
import { readStorage, writeStorage } from '../lib/storage';
import { cloudStatus as status, reportCloudProblem, setCloudStatus as setStatus, type CloudStatus } from './cloudStatus';
import { assetId, blobToDataUrl, getAsset, putAsset } from './assets';
import {
  applyRemote,
  flush,
  isGlobalQuizId,
  isHostedHere,
  loadData,
  newGlobalQuizId,
  markDirty,
  requireData,
  setDirtyListener,
  type Kind,
  type LocalData,
  type LocalDoc,
  type LocalGame,
  type LocalHistory,
  type LocalQuiz,
} from './db';

/**
 * Sauvegarde en ligne des comptes du mode sans serveur (site GitHub Pages et application Android).
 *
 * Chaque enregistrement du compte (quiz, partie terminée, document de la banque ou des versions, historique d'élève,
 * profil) est copié dans Firestore sous `whatquiz/{uid}` ; les fichiers des questions sont envoyés à part, une seule
 * fois. Les autres appareils du même compte reçoivent les changements en direct. Règle de conflit : la modification
 * la plus récente l'emporte, enregistrement par enregistrement ; une suppression laisse une trace (« pierre tombale »)
 * pour atteindre aussi les appareils hors ligne. Les règles Firestore réservent ces données à leur propriétaire.
 */

/** Enregistrement Firestore : données en JSON (Firestore refuse les tableaux imbriqués), découpé au-delà de 900 Ko. */
interface CloudRecord {
  k: string;
  rev: number;
  del?: boolean;
  d?: string | null;
  parts?: number;
}

interface SyncState {
  /** Révision en ligne connue de chaque enregistrement. */
  synced: Record<string, number>;
  /** Modifications locales pas encore envoyées (clé → heure de modification). */
  pending: Record<string, number>;
  /** Fichiers déjà envoyés. */
  assets: string[];
}

const PART_SIZE = 900_000;
const PUSH_DELAY_MS = 1_200;
const RETRY_MS = 15_000;

export { reportCloudProblem };

/** Les écrans affichés se rechargent quand des données arrivent d'un autre appareil. */
export const SYNC_EVENT = 'whatquiz-sync';

interface Session {
  uid: string;
  localUserId: number;
  state: SyncState;
  unsubscribe: (() => void) | null;
  pushTimer: ReturnType<typeof setTimeout> | null;
  pushing: boolean;
  stopped: boolean;
}

let session: Session | null = null;

const stateKey = (uid: string) => `wq:cloud:${uid}`;

function readState(uid: string): SyncState {
  try {
    const raw = JSON.parse(readStorage('local', stateKey(uid)) ?? 'null') as Partial<SyncState> | null;
    return { synced: raw?.synced ?? {}, pending: raw?.pending ?? {}, assets: raw?.assets ?? [] };
  } catch {
    return { synced: {}, pending: {}, assets: [] };
  }
}

function saveState(s: Session): void {
  writeStorage('local', stateKey(s.uid), JSON.stringify(s.state));
}

/* ───────────── Correspondance enregistrement local ↔ clé en ligne ───────────── */

function cloudKey(kind: Kind, id: string | number, s: Session): string | null {
  switch (kind) {
    case 'quiz':
      return `quiz_${id}`;
    case 'game':
      return `game_${id}`;
    case 'doc':
      return `doc_${id}`;
    case 'history':
      return `history_${id}`;
    case 'user':
      return Number(id) === s.localUserId ? 'profile' : null;
  }
}

/** Contenu à envoyer (propriétaire remplacé par 0 : il dépend de l'appareil), ou null si l'enregistrement n'est pas à ce compte. */
function outgoing(d: LocalData, key: string, s: Session): unknown | null | undefined {
  const me = s.localUserId;
  const [prefix, ...rest] = key.split('_');
  const id = rest.join('_');
  switch (prefix) {
    case 'quiz': {
      const quiz = d.quizzes.get(Number(id));
      if (!quiz) return undefined;
      return quiz.ownerId === me ? { ...quiz, ownerId: 0 } : null;
    }
    case 'game': {
      const game = d.games.get(id);
      if (!game) return undefined;
      // Une partie est envoyée une fois terminée (pas à chaque réponse pendant le jeu).
      if (game.hostId !== me || game.status === 'lobby' || game.status === 'running') return null;
      return { ...game, hostId: 0 };
    }
    case 'doc': {
      const doc = d.docs.get(id);
      if (!doc) return undefined;
      return doc.ownerId === me ? { ...doc, ownerId: 0 } : null;
    }
    case 'history': {
      const entry = d.history.get(id);
      if (!entry) return undefined;
      return entry.userId === me ? { ...entry, userId: 0 } : null;
    }
    case 'profile': {
      const user = d.users.get(me);
      if (!user) return null;
      return { displayName: user.displayName, role: user.role, email: user.email, createdAt: user.createdAt };
    }
    default:
      return null;
  }
}

/** Applique un enregistrement reçu (ou sa suppression). Renvoie les fichiers à télécharger. */
function incoming(d: LocalData, key: string, value: unknown | undefined, s: Session): string[] {
  const me = s.localUserId;
  const [prefix, ...rest] = key.split('_');
  const id = rest.join('_');
  switch (prefix) {
    case 'quiz': {
      const quizId = Number(id);
      if (value === undefined) {
        if (d.quizzes.get(quizId)?.ownerId === me) d.quizzes.delete(quizId);
      } else {
        const quiz = { ...(value as LocalQuiz), ownerId: me };
        d.quizzes.set(quizId, quiz);
        markDirty('quiz', quizId);
        return quizMediaUrls(quiz).flatMap((url) => assetId(url) ?? []);
      }
      markDirty('quiz', quizId);
      return [];
    }
    case 'game': {
      if (isHostedHere(id)) return [];
      if (value === undefined) d.games.delete(id);
      else d.games.set(id, { ...(value as LocalGame), hostId: me });
      markDirty('game', id);
      return [];
    }
    case 'doc': {
      if (value === undefined) d.docs.delete(id);
      else d.docs.set(id, { ...(value as LocalDoc), ownerId: me });
      markDirty('doc', id);
      return [];
    }
    case 'history': {
      if (value === undefined) d.history.delete(id);
      else d.history.set(id, { ...(value as LocalHistory), userId: me });
      markDirty('history', id);
      return [];
    }
    case 'profile': {
      const user = d.users.get(me);
      const profile = value as { displayName?: string; role?: 'teacher' | 'student' } | undefined;
      if (user && profile?.displayName) {
        user.displayName = profile.displayName;
        if (profile.role) user.role = profile.role;
        markDirty('user', me);
      }
      return [];
    }
    default:
      return [];
  }
}

/** Toutes les clés en ligne des données de ce compte présentes sur l'appareil. */
function ownedKeys(d: LocalData, s: Session): string[] {
  const me = s.localUserId;
  return [
    'profile',
    ...[...d.quizzes.values()].filter((q) => q.ownerId === me).map((q) => `quiz_${q.id}`),
    ...[...d.games.values()].filter((g) => g.hostId === me && g.status !== 'lobby' && g.status !== 'running').map((g) => `game_${g.id}`),
    ...[...d.docs.entries()].filter(([, doc]) => doc.ownerId === me).map(([id]) => `doc_${id}`),
    ...[...d.history.entries()].filter(([, entry]) => entry.userId === me).map(([id]) => `history_${id}`),
  ];
}

/* ───────────── Identifiants de quiz communs à tous les appareils ───────────── */

/**
 * Les quiz créés avant la synchronisation portent des numéros propres à l'appareil (1, 2, 3…) : deux appareils
 * pourraient avoir chacun un « quiz 1 ». Ils reçoivent un numéro unique, et les parties et versions qui les citent suivent.
 */
function renumberLocalQuizzes(d: LocalData, me: number): boolean {
  let changed = false;
  for (const quiz of [...d.quizzes.values()]) {
    if (quiz.ownerId !== me || isGlobalQuizId(quiz.id)) continue;
    changed = true;
    const oldId = quiz.id;
    const newId = newGlobalQuizId(d.quizzes);
    d.quizzes.delete(oldId);
    markDirty('quiz', oldId);
    d.quizzes.set(newId, { ...quiz, id: newId });
    markDirty('quiz', newId);
    for (const game of d.games.values()) {
      if (game.quizId !== oldId && game.snapshot.quizId !== oldId) continue;
      if (game.quizId === oldId) game.quizId = newId;
      if (game.snapshot.quizId === oldId) game.snapshot = { ...game.snapshot, quizId: newId };
      markDirty('game', game.id);
    }
    for (const [id, doc] of d.docs) {
      const record = doc as LocalDoc & { quizId?: number };
      if (record.quizId !== oldId) continue;
      d.docs.set(id, { ...record, quizId: newId } as LocalDoc);
      markDirty('doc', id);
    }
  }
  return changed;
}

/* ───────────── Envoi ───────────── */

function schedulePush(s: Session, delay = PUSH_DELAY_MS): void {
  if (s.stopped) return;
  if (s.pushTimer) clearTimeout(s.pushTimer);
  s.pushTimer = setTimeout(() => void push(s), delay);
}

function onLocalChange(kind: Kind, id: string | number): void {
  const s = session;
  if (!s) return;
  const key = cloudKey(kind, id, s);
  if (!key) return;
  s.state.pending[key] = Date.now();
  saveState(s);
  schedulePush(s);
}

const errorCode = (error: unknown) => String((error as { code?: string } | null)?.code ?? '');

function describeError(error: unknown): CloudStatus {
  const code = errorCode(error);
  if (code === 'permission-denied') {
    return {
      state: 'error',
      message: 'Sauvegarde en ligne refusée par Firebase : les règles Firestore de WhatQuiz ne sont pas encore publiées (voir le README).',
    };
  }
  if (code === 'unauthenticated') return { state: 'error', message: 'Reconnectez-vous pour reprendre la synchronisation.' };
  if (code === 'resource-exhausted') return { state: 'error', message: 'Quota gratuit de Firebase atteint pour aujourd’hui : la synchronisation reprendra demain.' };
  return { state: 'offline', message: 'Hors ligne : les modifications seront envoyées au retour de la connexion.' };
}

async function push(s: Session): Promise<void> {
  if (s.stopped || s.pushing) return;
  s.pushTimer = null;
  const keys = Object.keys(s.state.pending);
  if (keys.length === 0) return;
  s.pushing = true;
  setStatus({ state: 'syncing' });
  try {
    const { db, sdk } = await loadFirestore();
    const d = await loadData();
    for (const key of keys) {
      if (s.stopped) return;
      const changedAt = s.state.pending[key];
      if (changedAt === undefined) continue;
      const value = outgoing(d, key, s);
      if (value === null) {
        // Pas à ce compte (ou partie encore en cours) : rien à envoyer.
        delete s.state.pending[key];
        continue;
      }
      const rev = Math.max(changedAt, (s.state.synced[key] ?? 0) + 1);
      if (value === undefined && s.state.synced[key] === undefined) {
        delete s.state.pending[key];
        continue;
      }
      if (key.startsWith('quiz_') && value) await pushAssets(s, value as LocalQuiz);
      const ref = sdk.doc(db, 'whatquiz', s.uid, 'records', key);
      const batch = sdk.writeBatch(db);
      if (value === undefined) {
        batch.set(ref, { k: key, rev, del: true, d: null } satisfies CloudRecord);
      } else {
        const json = JSON.stringify(value);
        if (json.length <= PART_SIZE) {
          batch.set(ref, { k: key, rev, d: json } satisfies CloudRecord);
        } else {
          const parts = Math.ceil(json.length / PART_SIZE);
          for (let i = 0; i < parts; i++) {
            batch.set(sdk.doc(db, 'whatquiz', s.uid, 'parts', `${key}~${i}`), { rev, d: json.slice(i * PART_SIZE, (i + 1) * PART_SIZE) });
          }
          batch.set(ref, { k: key, rev, d: null, parts } satisfies CloudRecord);
        }
      }
      await batch.commit();
      s.state.synced[key] = rev;
      // Modifié de nouveau pendant l'envoi : il repartira au prochain passage.
      if (s.state.pending[key] === changedAt) delete s.state.pending[key];
      saveState(s);
    }
    setStatus({ state: 'synced', syncedAt: new Date().toISOString() });
  } catch (error) {
    if (s.stopped) return;
    setStatus(describeError(error));
    schedulePush(s, RETRY_MS);
  } finally {
    s.pushing = false;
    saveState(s);
    if (!s.stopped && Object.keys(s.state.pending).length > 0 && !s.pushTimer) schedulePush(s);
  }
}

/** Fichiers (images, sons, vidéos) d'un quiz, envoyés une seule fois chacun, découpés en morceaux. */
async function pushAssets(s: Session, quiz: LocalQuiz): Promise<void> {
  const ids = quizMediaUrls(quiz).flatMap((url) => assetId(url) ?? []);
  const missing = ids.filter((id) => !s.state.assets.includes(id));
  if (missing.length === 0) return;
  const { db, sdk } = await loadFirestore();
  for (const id of missing) {
    const asset = await getAsset(id);
    if (!asset) continue;
    const dataUrl = await blobToDataUrl(asset.blob);
    const parts = Math.max(1, Math.ceil(dataUrl.length / PART_SIZE));
    for (let i = 0; i < parts; i++) {
      await sdk.setDoc(sdk.doc(db, 'whatquiz', s.uid, 'assetParts', `${id}~${i}`), { d: dataUrl.slice(i * PART_SIZE, (i + 1) * PART_SIZE) });
    }
    await sdk.setDoc(sdk.doc(db, 'whatquiz', s.uid, 'assets', id), { type: asset.type, parts });
    s.state.assets.push(id);
    saveState(s);
  }
}

async function pullAssets(s: Session, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const { db, sdk } = await loadFirestore();
  for (const id of new Set(ids)) {
    if (s.stopped) return;
    if (await getAsset(id)) continue;
    try {
      const meta = await sdk.getDoc(sdk.doc(db, 'whatquiz', s.uid, 'assets', id));
      if (!meta.exists()) continue;
      const { type, parts } = meta.data() as { type: string; parts: number };
      let dataUrl = '';
      for (let i = 0; i < parts; i++) {
        const part = await sdk.getDoc(sdk.doc(db, 'whatquiz', s.uid, 'assetParts', `${id}~${i}`));
        dataUrl += String(part.data()?.d ?? '');
      }
      const blob = await (await fetch(dataUrl)).blob();
      await putAsset(blob, type);
      if (!s.state.assets.includes(id)) s.state.assets.push(id);
    } catch {
      // Fichier indisponible pour l'instant : l'image apparaîtra au prochain passage.
    }
  }
  saveState(s);
}

/* ───────────── Réception ───────────── */

async function readRecord(s: Session, record: CloudRecord): Promise<unknown | undefined | null> {
  if (record.del) return undefined;
  if (typeof record.d === 'string') return JSON.parse(record.d) as unknown;
  if (!record.parts) return null;
  const { db, sdk } = await loadFirestore();
  let json = '';
  for (let i = 0; i < record.parts; i++) {
    const part = await sdk.getDoc(sdk.doc(db, 'whatquiz', s.uid, 'parts', `${record.k}~${i}`));
    const data = part.data() as { rev?: number; d?: string } | undefined;
    // Morceau d'une autre version (envoi en cours) : la version complète arrivera avec le prochain changement.
    if (!data || data.rev !== record.rev) return null;
    json += data.d ?? '';
  }
  return JSON.parse(json) as unknown;
}

async function receive(s: Session, records: CloudRecord[], first: boolean): Promise<void> {
  await loadData();
  const toApply: [string, unknown | undefined, number][] = [];
  for (const record of records) {
    const key = record.k;
    if (!key || typeof record.rev !== 'number') continue;
    const known = s.state.synced[key] ?? 0;
    if (record.rev <= known) continue;
    // Modification locale plus récente, pas encore envoyée : elle l'emporte et repartira.
    const local = s.state.pending[key];
    if (local !== undefined && local > record.rev) continue;
    const value = await readRecord(s, record);
    if (value === null) continue;
    toApply.push([key, value, record.rev]);
  }
  const assets: string[] = [];
  if (toApply.length > 0) {
    applyRemote((d) => {
      for (const [key, value, rev] of toApply) {
        assets.push(...incoming(d, key, value, s));
        s.state.synced[key] = rev;
        delete s.state.pending[key];
      }
    });
    saveState(s);
    await flush();
    window.dispatchEvent(new Event(SYNC_EVENT));
  }
  if (first) {
    // Première synchronisation de cet appareil : ce qu'il a et que le compte en ligne n'a pas encore part en ligne.
    const d = requireData();
    for (const key of ownedKeys(d, s)) if (s.state.synced[key] === undefined && s.state.pending[key] === undefined) s.state.pending[key] = Date.now();
    saveState(s);
    schedulePush(s, 0);
  }
  void pullAssets(s, assets);
}

/* ───────────── Démarrage / arrêt ───────────── */

let target: { localUserId: number; uid: string } | null = null;

/** Active la synchronisation du compte ouvert (relié au compte en ligne `uid`). */
export async function startCloudSync(localUserId: number, uid: string): Promise<void> {
  if (session && session.uid === uid && session.localUserId === localUserId && !session.stopped) return;
  if (target && target.uid === uid && target.localUserId === localUserId && status().state === 'connecting') return;
  stopCloudSync();
  target = { localUserId, uid };
  setStatus({ state: 'connecting' });
  const current = await firebaseUid().catch(() => null);
  if (target?.uid !== uid || target.localUserId !== localUserId) return;
  if (current !== uid) {
    setStatus({ state: 'error', reconnect: true, message: 'Reconnectez-vous pour reprendre la sauvegarde en ligne.' });
    return;
  }
  const s: Session = { uid, localUserId, state: readState(uid), unsubscribe: null, pushTimer: null, pushing: false, stopped: false };
  session = s;
  setStatus({ state: 'connecting' });
  const d = await loadData();
  if (renumberLocalQuizzes(d, localUserId)) {
    await flush();
    window.dispatchEvent(new Event(SYNC_EVENT));
  }
  setDirtyListener(onLocalChange);
  try {
    const { db, sdk } = await loadFirestore();
    if (s.stopped) return;
    let first = true;
    s.unsubscribe = sdk.onSnapshot(
      sdk.collection(db, 'whatquiz', uid, 'records'),
      (snapshot) => {
        const changed = snapshot
          .docChanges()
          // Nos propres envois reviennent d'abord en écho local : déjà appliqués ici.
          .filter((change) => change.type !== 'removed' && !change.doc.metadata.hasPendingWrites)
          .map((change) => change.doc.data() as CloudRecord);
        const isFirst = first;
        first = false;
        void receive(s, changed, isFirst).then(
          () => {
            if (!s.pushing && Object.keys(s.state.pending).length === 0) setStatus({ state: 'synced', syncedAt: new Date().toISOString() });
          },
          (error: unknown) => setStatus(describeError(error)),
        );
      },
      (error) => {
        if (!s.stopped) setStatus(describeError(error));
      },
    );
  } catch (error) {
    setStatus(describeError(error));
  }
}

/** Après une reconnexion au compte en ligne. */
export function resumeCloudSync(): void {
  if (target) void startCloudSync(target.localUserId, target.uid);
}

export function stopCloudSync(): void {
  const s = session;
  session = null;
  target = null;
  setDirtyListener(null);
  if (!s) return;
  s.stopped = true;
  s.unsubscribe?.();
  if (s.pushTimer) clearTimeout(s.pushTimer);
  setStatus({ state: 'off' });
}

/** Envoie tout de suite ce qui attend (avant de fermer l'application, par exemple). */
export function syncNow(): void {
  if (session) schedulePush(session, 0);
}

/** Profil enregistré en ligne (rôle et nom), pour ouvrir le compte sur un nouvel appareil. */
export async function readCloudProfile(uid: string): Promise<{ displayName?: string; role?: 'teacher' | 'student' } | null> {
  try {
    const { db, sdk } = await loadFirestore();
    const snapshot = await sdk.getDoc(sdk.doc(db, 'whatquiz', uid, 'records', 'profile'));
    const record = snapshot.data() as CloudRecord | undefined;
    return record?.d ? (JSON.parse(record.d) as { displayName?: string; role?: 'teacher' | 'student' }) : null;
  } catch {
    return null;
  }
}

/** Suppression du compte : ses données en ligne sont effacées aussi. */
export async function wipeCloudData(uid: string): Promise<void> {
  const { db, sdk } = await loadFirestore();
  for (const collection of ['records', 'parts', 'assets', 'assetParts']) {
    const snapshot = await sdk.getDocs(sdk.collection(db, 'whatquiz', uid, collection));
    for (const doc of snapshot.docs) await sdk.deleteDoc(doc.ref);
  }
  writeStorage('local', stateKey(uid), null);
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => syncNow());
}
