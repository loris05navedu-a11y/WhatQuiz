import type { DocumentData, DocumentReference, Firestore, Unsubscribe } from 'firebase/firestore';
import { RELAY_BEAT_MS } from '../../../shared/presence';
import { ERRORS } from '../../../shared/constants';
import type { AckResult } from '../../../shared/types';
import { loadFirestore, writeDocumentOnUnload } from '../lib/firebaseAccount';
import { DoorTakenError, type Door, type Hub, type HubClient } from './hub';
import { createRelayKeys, deriveChannel, Mailbox, randomId, RELAY_PROTOCOL, seal, unseal, type ChannelSecret, type RelayKeys, type SendOptions } from './relayChannel';

/**
 * Relais en ligne des parties (Firestore) : utilisé quand l'appareil d'un élève ne peut pas joindre directement
 * celui du professeur (réseaux différents, données mobiles, Wi-Fi qui isole les appareils…).
 *
 *   whatquizRelay/{code}             salle : clé publique du professeur (créée au lancement, figée pendant 12 h)
 *   whatquizRelay/{code}/live/host   signe de vie du professeur (toutes les 30 s)
 *   whatquizRelay/{code}/up/{id}     boîte élève → professeur (clé publique de l'élève + messages chiffrés)
 *   whatquizRelay/{code}/down/{box}  boîte professeur → élève (nom secret, dérivé de la clé commune)
 *
 * Le professeur reste l'hôte de la partie : le relais ne fait que transporter des messages chiffrés.
 */

export const RELAY_ROOT = 'whatquizRelay';
const ROOM_TIMEOUT_MS = 12_000;
const LIVE_EVERY_MS = 30_000;
const SWEEP_EVERY_MS = 15_000;
/** Élève sans nouvelles depuis ce délai : sa liaison est fermée (il se reconnecte s'il est toujours là). */
const CONN_SILENCE_MS = 100_000;
/** Côté élève : signe de vie si rien n'a été écrit depuis ce délai. */
const KEEPALIVE_MS = 30_000;
/** Côté élève : sans signe de vie du professeur depuis ce délai, la liaison est considérée comme perdue. */
const HOST_SILENCE_MS = 100_000;
const WELCOME_TIMEOUT_MS = 15_000;
const RETRY_MAX_MS = 30_000;

type Sdk = typeof import('firebase/firestore');

/** Le relais ne peut pas être utilisé (hors ligne, ou règles Firestore du relais non publiées). */
export class RelayUnavailableError extends Error {
  constructor(
    message: string,
    readonly blocked = false,
  ) {
    super(message);
  }
}

export const RELAY_BLOCKED = 'Relais en ligne désactivé : les règles Firestore de WhatQuiz (relais des parties) ne sont pas publiées';

const errorCode = (error: unknown) => (error as { code?: string } | null)?.code ?? '';

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Object.assign(new Error('timeout'), { code: 'timeout' })), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

interface Message {
  t: 'hello' | 'welcome' | 'emit' | 'evt' | 'ack' | 'quiet';
  e?: string;
  p?: unknown;
  id?: number;
  r?: AckResult<object>;
  on?: boolean;
}

const asMessage = (value: unknown): Message | null => (value && typeof value === 'object' && typeof (value as Message).t === 'string' ? (value as Message) : null);

/* ───────────── Côté professeur : la porte d'entrée relayée ───────────── */

export async function openRelayDoor(code: string, hub: Hub): Promise<Door> {
  let store: { db: Firestore; sdk: Sdk };
  try {
    store = await withTimeout(loadFirestore(), ROOM_TIMEOUT_MS);
  } catch {
    throw new RelayUnavailableError('Relais en ligne indisponible (connexion Internet ?)');
  }
  const { db, sdk } = store;
  const keys = await createRelayKeys();
  const roomRef = sdk.doc(db, RELAY_ROOT, code);
  try {
    await withTimeout(sdk.setDoc(roomRef, { k: keys.publicKey, v: RELAY_PROTOCOL, at: sdk.serverTimestamp() }), ROOM_TIMEOUT_MS);
  } catch (error) {
    if (errorCode(error) !== 'permission-denied') throw new RelayUnavailableError('Relais en ligne indisponible (connexion Internet ?)');
    // Refus : soit une salle récente utilise déjà ce code, soit les règles du relais ne sont pas publiées.
    const existing = await withTimeout(sdk.getDoc(roomRef), ROOM_TIMEOUT_MS).catch(() => null);
    if (existing?.exists()) throw new DoorTakenError();
    throw new RelayUnavailableError(RELAY_BLOCKED, true);
  }
  return new RelayDoor(code, hub, db, sdk, keys);
}

/** Salle d'attente : chaque arrivée change le nombre de joueurs affiché ; ces mises à jour sont regroupées. */
const LOBBY_STATE_DELAY_MS = 4_000;

/** Seul le dernier état de la partie compte : un nouvel état remplace celui qui n'est pas encore parti. */
function sendOptions(event: string, payload: unknown): SendOptions {
  if (event !== 'game:state') return {};
  const lobby = (payload as { phase?: unknown } | null)?.phase === 'lobby';
  return lobby ? { replace: 'state', lazyMs: LOBBY_STATE_DELAY_MS } : { replace: 'state' };
}

interface HostConn {
  id: string;
  lastSeen: number;
  quiet: boolean;
  chain: Promise<void>;
  ready: Promise<{ secret: ChannelSecret; box: DocumentReference; mailbox: Mailbox } | null>;
  client: HubClient | null;
}

class RelayDoor implements Door {
  private readonly conns = new Map<string, HostConn>();
  /** Liaisons fermées : un élève qui écrit encore dessus est prévenu qu'il doit se reconnecter. */
  private readonly ended = new Map<string, { secret: ChannelSecret; box: DocumentReference; notifiedAt: number }>();
  /** Boîtes illisibles (anciennes parties sous le même code, données invalides) : ignorées. */
  private readonly ignored = new Set<string>();
  private unsubscribe: Unsubscribe | null = null;
  private readonly liveTimer: ReturnType<typeof setInterval>;
  private readonly sweepTimer: ReturnType<typeof setInterval>;
  private closed = false;

  constructor(
    private readonly code: string,
    private readonly hub: Hub,
    private readonly db: Firestore,
    private readonly sdk: Sdk,
    private readonly keys: RelayKeys,
  ) {
    this.listen();
    this.beat();
    this.liveTimer = setInterval(() => this.beat(), LIVE_EVERY_MS);
    this.sweepTimer = setInterval(() => this.sweep(), SWEEP_EVERY_MS);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.unsubscribe?.();
    clearInterval(this.liveTimer);
    clearInterval(this.sweepTimer);
    for (const id of [...this.conns.keys()]) this.drop(id, true);
  }

  private listen(): void {
    if (this.closed) return;
    this.unsubscribe = this.sdk.onSnapshot(
      this.sdk.collection(this.db, RELAY_ROOT, this.code, 'up'),
      (snapshot) => {
        for (const change of snapshot.docChanges()) if (change.type !== 'removed') this.onUp(change.doc.id, change.doc.data());
      },
      (error) => {
        console.warn('[whatquiz] Relais : écoute interrompue', errorCode(error));
        this.unsubscribe = null;
        setTimeout(() => this.listen(), 5_000);
      },
    );
  }

  private beat(): void {
    if (this.closed) return;
    void this.sdk.setDoc(this.sdk.doc(this.db, RELAY_ROOT, this.code, 'live', 'host'), { at: this.sdk.serverTimestamp() }).catch(() => undefined);
  }

  private onUp(id: string, data: DocumentData): void {
    if (this.closed || this.ignored.has(id)) return;
    const ended = this.ended.get(id);
    if (ended) return this.notifyEnded(ended);
    let conn = this.conns.get(id);
    if (!conn) {
      if (typeof data.k !== 'string' || data.k.length > 200) return void this.ignored.add(id);
      conn = this.createConn(id, data.k);
      this.conns.set(id, conn);
    }
    conn.lastSeen = Date.now();
    const sealed = data.d;
    const farewell = data.x;
    const current = conn;
    current.chain = current.chain
      .then(async () => {
        const state = await current.ready;
        if (!state) return;
        const plain = await unseal(state.secret.key, sealed);
        if (plain === null) {
          // Première version illisible : boîte d'une autre partie (même code) ou données invalides.
          if (!current.client) this.forget(id);
          return;
        }
        state.mailbox.receive(plain);
        // « Au revoir » de l'élève (page fermée) : authentique seulement s'il est chiffré avec la clé de la liaison.
        if (typeof farewell === 'string' && this.conns.get(id) === current) {
          const bye = await unseal(state.secret.key, farewell);
          if (bye !== null) state.mailbox.receive(bye);
        }
      })
      .catch((error: unknown) => console.warn('[whatquiz] Relais : message illisible', error));
  }

  private createConn(id: string, peerKey: string): HostConn {
    const conn: HostConn = { id, lastSeen: Date.now(), quiet: false, chain: Promise.resolve(), ready: Promise.resolve(null), client: null };
    conn.ready = deriveChannel(this.keys.privateKey, peerKey, this.code).then(
      (secret) => {
        const box = this.sdk.doc(this.db, RELAY_ROOT, this.code, 'down', secret.box);
        const mailbox = new Mailbox({
          write: async (plain) => {
            await this.sdk.setDoc(box, { d: await seal(secret.key, plain) });
          },
          deliver: (message) => this.onMessage(conn, mailbox, message),
          onClosed: () => this.drop(id, false),
        });
        return { secret, box, mailbox };
      },
      () => {
        this.forget(id);
        return null;
      },
    );
    return conn;
  }

  private onMessage(conn: HostConn, mailbox: Mailbox, raw: unknown): void {
    const message = asMessage(raw);
    if (!message || this.closed) return;
    switch (message.t) {
      case 'hello':
        conn.client ??= this.hub.connect(null, (event, payload) => mailbox.send({ t: 'evt', e: event, p: payload }, sendOptions(event, payload)), {
          slowLink: true,
          lagMs: () => mailbox.rttMs ?? 0,
        });
        mailbox.send({ t: 'welcome' });
        return;
      case 'emit': {
        if (!conn.client || typeof message.e !== 'string') return;
        const id = message.id;
        this.hub.handle(conn.client, message.e, message.p, typeof id === 'number' ? (result) => mailbox.send({ t: 'ack', id, r: result }) : undefined);
        return;
      }
      case 'quiet':
        conn.quiet = message.on === true;
        return;
      default:
        return;
    }
  }

  private forget(id: string): void {
    this.conns.delete(id);
    this.ignored.add(id);
  }

  /** Ferme une liaison ; `notify` : l'élève en est informé (il se reconnectera s'il est toujours là). */
  private drop(id: string, notify: boolean): void {
    const conn = this.conns.get(id);
    if (!conn) return;
    this.conns.delete(id);
    if (conn.client) this.hub.disconnect(conn.client);
    conn.client = null;
    void conn.ready.then((state) => {
      if (!state) return;
      if (notify) state.mailbox.close();
      else state.mailbox.dispose();
      this.ended.set(id, { secret: state.secret, box: state.box, notifiedAt: Date.now() });
    });
  }

  private notifyEnded(ended: { secret: ChannelSecret; box: DocumentReference; notifiedAt: number }): void {
    if (Date.now() - ended.notifiedAt < 10_000) return;
    ended.notifiedAt = Date.now();
    const plain = JSON.stringify({ a: [0, 0], f: [], b: [], h: Date.now(), x: 1 });
    void seal(ended.secret.key, plain)
      .then((d) => this.sdk.setDoc(ended.box, { d }))
      .catch(() => undefined);
  }

  private sweep(): void {
    const now = Date.now();
    for (const conn of [...this.conns.values()]) {
      if (!conn.quiet && now - conn.lastSeen > CONN_SILENCE_MS) this.drop(conn.id, true);
    }
    for (const [id, ended] of this.ended) if (now - ended.notifiedAt > 15 * 60_000) this.ended.delete(id);
  }
}

/* ───────────── Côté élève : liaison relayée vers la partie ───────────── */

export interface RelayLinkHandlers {
  onOpen(): void;
  onClose(): void;
  onEvent(event: string, payload: unknown): void;
  /**
   * Le relais ne mènera à aucune partie : `absent`, aucune partie relayée avec ce code ; `blocked`, relais désactivé
   * (règles Firestore non publiées) : on ne sait rien de la partie.
   */
  onUnavailable?(reason: 'absent' | 'blocked'): void;
}

interface Attempt {
  id: number;
  mailbox: Mailbox;
  unsubscribe: Unsubscribe[];
  lastWrite: number;
  lastLive: number;
  /** Chemin de la boîte de l'élève et version « fermeture » déjà chiffrée. */
  path: string;
  farewell: string | null;
  secret: ChannelSecret;
}

export class RelayLink {
  private attempt: Attempt | null = null;
  private generation = 0;
  private failures = 0;
  private connected = false;
  private closed = false;
  private quiet = false;
  private seq = 0;
  private lastBeat = '';
  private readonly acks = new Map<number, (result: AckResult<object>) => void>();
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private welcomeTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly watchTimer: ReturnType<typeof setInterval>;

  constructor(
    private readonly code: string,
    private readonly handlers: RelayLinkHandlers,
  ) {
    this.watchTimer = setInterval(() => this.watch(), 10_000);
    if (typeof window !== 'undefined') window.addEventListener('pagehide', this.onPageHide);
    void this.start();
  }

  /**
   * Page fermée ou rechargée : le professeur est prévenu tout de suite (sinon il ne le constaterait qu'au silence).
   * L'« au revoir » va dans un champ à part (x) : une dernière écriture de la page ne peut pas l'effacer.
   */
  private readonly onPageHide = () => {
    const attempt = this.attempt;
    if (!this.connected || !attempt?.farewell) return;
    writeDocumentOnUnload(attempt.path, { x: attempt.farewell });
  };

  send(event: string, payload: unknown, ack?: (result: AckResult<object>) => void): void {
    const mailbox = this.attempt?.mailbox;
    if (!mailbox || !this.connected) return;
    const message: Message = { t: 'emit', e: event, p: payload };
    if (ack) {
      message.id = ++this.seq;
      this.acks.set(message.id, ack);
    }
    // Signe de vie de la surveillance (toutes les 2 s) : envoyé seulement s'il change, sinon toutes les 15 s.
    if (event === 'game:presence' && (payload as { s?: unknown } | null)?.s === 'beat') {
      const key = JSON.stringify(payload);
      const changed = key !== this.lastBeat;
      this.lastBeat = key;
      mailbox.send(message, { replace: 'beat', lazyMs: changed ? 0 : RELAY_BEAT_MS });
      return;
    }
    mailbox.send(message);
  }

  /** Partie terminée : plus de signes de vie réguliers (la liaison reste ouverte pour les derniers résultats). */
  setQuiet(quiet: boolean): void {
    if (quiet === this.quiet) return;
    this.quiet = quiet;
    if (this.connected) this.attempt?.mailbox.send({ t: 'quiet', on: quiet });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.watchTimer);
    if (typeof window !== 'undefined') window.removeEventListener('pagehide', this.onPageHide);
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.end(this.connected);
  }

  private async start(): Promise<void> {
    this.retryTimer = null;
    if (this.closed) return;
    const id = ++this.generation;
    try {
      const { db, sdk } = await withTimeout(loadFirestore(), ROOM_TIMEOUT_MS);
      if (this.closed || id !== this.generation) return;
      const room = await withTimeout(sdk.getDoc(sdk.doc(db, RELAY_ROOT, this.code)), ROOM_TIMEOUT_MS);
      if (this.closed || id !== this.generation) return;
      const data = room.exists() ? room.data() : null;
      if (!data || data.v !== RELAY_PROTOCOL || typeof data.k !== 'string') {
        this.handlers.onUnavailable?.('absent');
        return this.retry();
      }
      const keys = await createRelayKeys();
      const secret = await deriveChannel(keys.privateKey, data.k, this.code);
      if (this.closed || id !== this.generation) return;
      const up = sdk.doc(db, RELAY_ROOT, this.code, 'up', randomId());
      const box = sdk.doc(db, RELAY_ROOT, this.code, 'down', secret.box);
      const attempt: Attempt = {
        id,
        unsubscribe: [],
        lastWrite: Date.now(),
        lastLive: Date.now(),
        path: up.path,
        farewell: null,
        secret,
        mailbox: new Mailbox({
          write: async (plain) => {
            attempt.lastWrite = Date.now();
            // Fusion : le champ « au revoir » (x), écrit à la fermeture de la page, n'est jamais effacé.
            await sdk.setDoc(up, { k: keys.publicKey, d: await seal(secret.key, plain) }, { merge: true });
          },
          deliver: (message) => this.onMessage(attempt, message),
          onClosed: () => this.lost(attempt),
        }),
      };
      this.attempt = attempt;
      let chain = Promise.resolve();
      attempt.unsubscribe.push(
        sdk.onSnapshot(
          box,
          (snapshot) => {
            if (!snapshot.exists()) return;
            const sealed = snapshot.data().d;
            chain = chain.then(async () => {
              const plain = await unseal(secret.key, sealed);
              if (plain !== null && this.attempt === attempt) attempt.mailbox.receive(plain);
            });
          },
          () => this.lost(attempt),
        ),
        sdk.onSnapshot(
          sdk.doc(db, RELAY_ROOT, this.code, 'live', 'host'),
          () => {
            attempt.lastLive = Date.now();
          },
          () => undefined,
        ),
      );
      attempt.mailbox.send({ t: 'hello' });
      this.welcomeTimer = setTimeout(() => this.lost(attempt), WELCOME_TIMEOUT_MS);
    } catch (error) {
      if (this.closed || id !== this.generation) return;
      // Règles du relais non publiées : ce chemin ne mènera à aucune partie.
      if (errorCode(error) === 'permission-denied') this.handlers.onUnavailable?.('blocked');
      this.retry();
    }
  }

  private onMessage(attempt: Attempt, raw: unknown): void {
    const message = asMessage(raw);
    if (!message || this.attempt !== attempt) return;
    if (message.t === 'welcome') {
      if (this.connected) return;
      if (this.welcomeTimer) clearTimeout(this.welcomeTimer);
      this.welcomeTimer = null;
      this.connected = true;
      this.failures = 0;
      if (this.quiet) attempt.mailbox.send({ t: 'quiet', on: true });
      void seal(attempt.secret.key, attempt.mailbox.farewell()).then((sealed) => (attempt.farewell = sealed));
      this.handlers.onOpen();
    } else if (message.t === 'evt' && typeof message.e === 'string') {
      if (this.connected) this.handlers.onEvent(message.e, message.p);
    } else if (message.t === 'ack' && typeof message.id === 'number') {
      const ack = this.acks.get(message.id);
      this.acks.delete(message.id);
      ack?.(message.r ?? { ok: false, error: ERRORS.generic });
    }
  }

  /** Signe de vie de l'élève, et professeur muet depuis trop longtemps. */
  private watch(): void {
    const attempt = this.attempt;
    if (!attempt || !this.connected) return;
    const now = Date.now();
    if (now - attempt.lastLive > HOST_SILENCE_MS) return this.lost(attempt);
    if (!this.quiet && now - attempt.lastWrite > KEEPALIVE_MS) attempt.mailbox.touch();
  }

  private lost(attempt: Attempt): void {
    if (this.attempt !== attempt || this.closed) return;
    this.end(false);
    this.retry();
  }

  /** Abandonne la tentative en cours ; `notify` : le professeur est prévenu (dernière écriture). */
  private end(notify: boolean): void {
    if (this.welcomeTimer) clearTimeout(this.welcomeTimer);
    this.welcomeTimer = null;
    const attempt = this.attempt;
    this.attempt = null;
    if (attempt) {
      for (const stop of attempt.unsubscribe) stop();
      if (notify) attempt.mailbox.close();
      else attempt.mailbox.dispose();
    }
    for (const ack of this.acks.values()) ack({ ok: false, error: ERRORS.connectionLost });
    this.acks.clear();
    this.lastBeat = '';
    const wasConnected = this.connected;
    this.connected = false;
    if (wasConnected && !this.closed) this.handlers.onClose();
  }

  private retry(): void {
    if (this.closed || this.retryTimer) return;
    const delay = Math.min(RETRY_MAX_MS, 2_000 * 2 ** Math.min(this.failures++, 4));
    this.retryTimer = setTimeout(() => void this.start(), delay);
  }
}
