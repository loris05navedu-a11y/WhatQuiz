import type { DataConnection, Peer } from 'peerjs';
import { ERRORS } from '../../../shared/constants';
import type { AckResult } from '../../../shared/types';
import { ApiError } from '../api/errors';
import { DoorTakenError, type Door, type Hub, type HubClient } from './hub';

/**
 * Liaison pair-à-pair (WebRTC via PeerJS) entre l'appareil du professeur et ceux des élèves.
 * Le serveur public de PeerJS ne sert qu'à la mise en relation : les échanges de jeu passent en direct.
 */

const PEER_PREFIX = 'whatquiz-v1-';
const OPEN_TIMEOUT_MS = 15_000;
const PING_EVERY_MS = 5_000;
const SILENCE_LIMIT_MS = 20_000;
const RETRY_MAX_MS = 4_000;

export const NO_NETWORK = 'Connexion Internet requise : impossible de joindre le service de mise en relation';

type Wire =
  | { t: 'emit'; e: string; p?: unknown; id?: number }
  | { t: 'ack'; id: number; r: AckResult<object> }
  | { t: 'evt'; e: string; p?: unknown }
  | { t: 'ping' }
  | { t: 'pong' };

const peerIdFor = (code: string) => PEER_PREFIX + code;

/** Mêmes données qu'avec Socket.IO (JSON) : sans cela, le format binaire de PeerJS change `undefined` en `null`. */
const asJson = (value: unknown): unknown => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));

/**
 * Serveurs utilisés pour établir la liaison directe : plusieurs STUN (adresse vue d'Internet) et le TURN public de
 * PeerJS (relais réseau). Si la liaison directe échoue malgré tout, le relais en ligne prend le relais (voir link.ts).
 */
const ICE_SERVERS: RTCIceServer[] = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  { urls: 'stun:stun.cloudflare.com:3478' },
  { urls: ['turn:eu-0.turn.peerjs.com:3478', 'turn:us-0.turn.peerjs.com:3478'], username: 'peerjs', credential: 'peerjsp' },
];

/** Tests uniquement : serveur PeerJS local « hôte:port » (jamais défini dans le site publié). */
const LOCAL_PEER_SERVER: string | undefined = import.meta.env.VITE_PEER_SERVER || undefined;

async function createPeer(id?: string): Promise<Peer> {
  const { Peer } = await import('peerjs');
  const [host, port] = LOCAL_PEER_SERVER?.split(':') ?? [];
  const options = LOCAL_PEER_SERVER
    ? { debug: 0, host, port: Number(port), path: '/', secure: false, config: { iceServers: [] } }
    : { debug: 0, config: { iceServers: ICE_SERVERS } };
  return id ? new Peer(id, options) : new Peer(options);
}

function send(conn: DataConnection, message: Wire): void {
  if (!conn.open) return;
  try {
    void conn.send(message);
  } catch {
    // Canal en cours de fermeture : le message est perdu, la reconnexion resynchronise l'état.
  }
}

/* ───────────── Côté professeur : la porte d'entrée de la partie ───────────── */

export async function openPeerDoor(code: string, hub: Hub): Promise<Door> {
  const peer = await createPeer(peerIdFor(code));
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => fail(new ApiError(503, NO_NETWORK)), OPEN_TIMEOUT_MS);
    function fail(error: Error) {
      clearTimeout(timer);
      peer.destroy();
      reject(error);
    }
    peer.once('open', () => {
      clearTimeout(timer);
      resolve();
    });
    peer.once('error', (error) => fail(error.type === 'unavailable-id' ? new DoorTakenError() : new ApiError(503, NO_NETWORK)));
  });

  let closed = false;
  // Perte du service de mise en relation : les élèves déjà connectés continuent, on se réinscrit pour les suivants.
  peer.on('disconnected', () => {
    setTimeout(() => {
      if (!closed && !peer.destroyed && peer.disconnected) peer.reconnect();
    }, 2_000);
  });
  peer.on('error', (error) => console.warn('[whatquiz] Pair-à-pair :', error.type));
  peer.on('connection', (conn) => serveConnection(conn, hub));

  return {
    close() {
      closed = true;
      peer.destroy();
    },
  };
}

function serveConnection(conn: DataConnection, hub: Hub): void {
  let client: HubClient | null = null;
  let lastSeen = Date.now();
  const watchdog = setInterval(() => {
    if (Date.now() - lastSeen > SILENCE_LIMIT_MS) {
      conn.close();
      release();
    }
  }, PING_EVERY_MS);

  function release() {
    clearInterval(watchdog);
    if (client) hub.disconnect(client);
    client = null;
  }

  conn.on('open', () => {
    client = hub.connect(null, (e, p) => send(conn, { t: 'evt', e, p: asJson(p) }));
  });
  conn.on('data', (raw) => {
    lastSeen = Date.now();
    const message = raw as Wire | null;
    if (!client || !message || typeof message !== 'object') return;
    if (message.t === 'ping') return send(conn, { t: 'pong' });
    if (message.t !== 'emit' || typeof message.e !== 'string') return;
    const id = message.id;
    hub.handle(client, message.e, asJson(message.p), typeof id === 'number' ? (r) => send(conn, { t: 'ack', id, r: asJson(r) as AckResult<object> }) : undefined);
  });
  conn.on('close', release);
  conn.on('error', release);
}

/* ───────────── Côté élève : liaison vers la partie, avec reconnexion ───────────── */

export interface LinkHandlers {
  onOpen(): void;
  onClose(): void;
  onEvent(event: string, payload: unknown): void;
  /** La partie n'existe pas (ou plus) sur le service de mise en relation. */
  onUnavailable?(): void;
}

export class PeerLink {
  private peer: Peer | null = null;
  private conn: DataConnection | null = null;
  private connected = false;
  private closed = false;
  private attempt = 0;
  private seq = 0;
  private lastMessage = 0;
  private readonly acks = new Map<number, (result: AckResult<object>) => void>();
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private openTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly code: string,
    private readonly handlers: LinkHandlers,
  ) {
    void this.start();
  }

  send(event: string, payload: unknown, ack?: (result: AckResult<object>) => void): void {
    if (!this.conn || !this.connected) return;
    const message: Wire = { t: 'emit', e: event, p: asJson(payload) };
    if (ack) {
      message.id = ++this.seq;
      this.acks.set(message.id, ack);
    }
    send(this.conn, message);
  }

  close(): void {
    this.closed = true;
    this.dropConnection(false);
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.peer?.destroy();
    this.peer = null;
  }

  private async start(): Promise<void> {
    if (this.closed) return;
    try {
      const peer = await this.readyPeer();
      if (this.closed) return;
      const conn = peer.connect(peerIdFor(this.code), { reliable: true });
      this.conn = conn;
      this.openTimer = setTimeout(() => this.retry(), OPEN_TIMEOUT_MS);
      conn.on('open', () => {
        if (this.conn !== conn) return;
        if (this.openTimer) clearTimeout(this.openTimer);
        this.connected = true;
        this.attempt = 0;
        this.lastMessage = Date.now();
        this.pingTimer = setInterval(() => {
          if (Date.now() - this.lastMessage > SILENCE_LIMIT_MS) return this.retry();
          send(conn, { t: 'ping' });
        }, PING_EVERY_MS);
        this.handlers.onOpen();
      });
      conn.on('data', (raw) => {
        if (this.conn !== conn) return;
        this.lastMessage = Date.now();
        const message = raw as Wire | null;
        if (!message || typeof message !== 'object') return;
        if (message.t === 'evt') this.handlers.onEvent(message.e, message.p);
        else if (message.t === 'ack') {
          this.acks.get(message.id)?.(message.r);
          this.acks.delete(message.id);
        }
      });
      conn.on('close', () => this.conn === conn && this.retry());
      conn.on('error', () => this.conn === conn && this.retry());
    } catch {
      this.retry();
    }
  }

  private readyPeer(): Promise<Peer> {
    const current = this.peer;
    if (current && !current.destroyed && !current.disconnected && current.open) return Promise.resolve(current);
    current?.destroy();
    return createPeer().then(
      (peer) =>
        new Promise<Peer>((resolve, reject) => {
          this.peer = peer;
          const timer = setTimeout(() => reject(new Error('timeout')), OPEN_TIMEOUT_MS);
          peer.once('open', () => {
            clearTimeout(timer);
            resolve(peer);
          });
          peer.on('error', (error) => {
            clearTimeout(timer);
            if (error.type === 'peer-unavailable') {
              this.handlers.onUnavailable?.();
              this.retry();
            } else if (this.peer === peer) {
              reject(error);
              peer.destroy();
              this.retry();
            }
          });
        }),
    );
  }

  private dropConnection(notify: boolean): void {
    if (this.openTimer) clearTimeout(this.openTimer);
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.openTimer = null;
    this.pingTimer = null;
    const conn = this.conn;
    this.conn = null;
    conn?.close();
    for (const ack of this.acks.values()) ack({ ok: false, error: ERRORS.connectionLost });
    this.acks.clear();
    const wasConnected = this.connected;
    this.connected = false;
    if (notify && wasConnected) this.handlers.onClose();
  }

  private retry(): void {
    this.dropConnection(true);
    if (this.closed || this.retryTimer) return;
    const delay = Math.min(RETRY_MAX_MS, 1000 * 2 ** this.attempt++);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.start();
    }, delay);
  }
}
