/**
 * Canal du relais en ligne (parties à distance quand la liaison directe entre appareils est impossible).
 *
 * Chaque sens de la liaison est une « boîte aux lettres » : un seul document, réécrit à chaque envoi, qui contient
 * les messages que l'autre côté n'a pas encore confirmés. Un lecteur peut donc manquer des versions intermédiaires
 * du document sans rien perdre : la dernière version contient tout ce qui reste à recevoir. Les messages sont
 * numérotés et les accusés de réception voyagent avec les envois.
 *
 * Deux voies : les messages courants (états de la partie, réponses) passent toujours en entier ; les gros messages
 * (fichiers des questions) sont découpés et envoyés morceau par morceau sur une voie à part, au rythme des accusés,
 * sans jamais retarder la partie. Tout le contenu est chiffré (ECDH P-256 + AES-GCM) : le service qui héberge les
 * documents ne voit que des données illisibles.
 */

export const RELAY_PROTOCOL = 1;

/** Taille maximale (octets UTF-8) des messages placés dans une même version du document (≈ 850 Ko une fois chiffrés). */
const MAX_PAYLOAD_BYTES = 640_000;
/** Au-delà, un message part sur la voie des gros messages, découpé en morceaux de cette taille. */
const BULK_THRESHOLD_BYTES = 64_000;
const CHUNK_CHARS = 60_000;
/** Mesures d'aller-retour conservées (la plus petite est retenue : elle écarte les retards ponctuels). */
const RTT_SAMPLES = 6;
/** Sans accusé de réception pour des morceaux envoyés, on les renvoie après ce délai. */
const BULK_RESEND_MS = 12_000;

/** Message courant. `r` : clé de remplacement (un nouveau message avec la même clé rend l'ancien inutile). */
interface Frame {
  n: number;
  o: unknown;
  r?: string;
}

/** Morceau d'un gros message : texte, rang, nombre de morceaux. */
interface Chunk {
  n: number;
  c: string;
  i: number;
  z: number;
}

interface Payload {
  /** Accusés de réception (dernier message reçu de l'autre côté), voie courante puis gros messages. */
  a: [number, number];
  f: Frame[];
  b: Chunk[];
  /** Heure d'envoi (horloge de l'expéditeur), renvoyée par l'autre côté pour mesurer l'aller-retour. */
  h: number;
  e?: number;
  w?: number;
  /** Fermeture de la liaison. */
  x?: 1;
}

interface Pending<T> {
  wire: T;
  bytes: number;
  /** Heure limite d'envoi : un message « paresseux » attend une autre écriture, ou cette heure. */
  due: number;
  sent: boolean;
}

export interface MailboxOptions {
  /** Écrit la nouvelle version du document (chiffrement et stockage à la charge de l'appelant). */
  write(plain: string): Promise<void>;
  deliver(message: unknown): void;
  onClosed?(): void;
  /** Écart minimal entre deux écritures du même document. */
  minGapMs?: number;
}

export interface SendOptions {
  replace?: string;
  /** Envoi différé (au plus tard après ce délai) : le message part avec la prochaine écriture. */
  lazyMs?: number;
}

const encoder = new TextEncoder();
const byteLength = (text: string) => encoder.encode(text).length;

export class Mailbox {
  private readonly frames: Pending<Frame>[] = [];
  private readonly chunks: Pending<Chunk>[] = [];
  private seq = 0;
  private bulkSeq = 0;
  private peerAck = 0;
  private peerBulkAck = 0;
  private lastIn = 0;
  private lastBulkIn = 0;
  private readonly parts = new Map<number, string[]>();
  private writing = false;
  private rerun = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private timerAt = 0;
  private lastWriteAt = 0;
  private forceWrite = false;
  /** Les morceaux en attente ne tiennent pas tous dans un envoi : la suite attend les accusés de réception. */
  private waitingBulkAck = false;
  private bulkTimer: ReturnType<typeof setTimeout> | null = null;
  private closing = false;
  private done = false;
  private lastPeerH: number | null = null;
  private lastPeerHAt = 0;
  private readonly rtts: number[] = [];
  private failures = 0;
  private readonly minGapMs: number;

  constructor(private readonly options: MailboxOptions) {
    this.minGapMs = options.minGapMs ?? 300;
  }

  /** Aller-retour mesuré (ms), null avant la première mesure. */
  get rttMs(): number | null {
    return this.rtts.length ? Math.min(...this.rtts) : null;
  }

  get closed(): boolean {
    return this.done || this.closing;
  }

  send(message: unknown, options: SendOptions = {}): void {
    if (this.closed) return;
    const value = message ?? null;
    let due = Date.now() + (options.lazyMs ?? 0);
    const frame: Frame = { n: 0, o: value, ...(options.replace ? { r: options.replace } : {}) };
    const bytes = byteLength(JSON.stringify(frame));
    if (bytes <= BULK_THRESHOLD_BYTES) {
      if (options.replace) {
        for (let i = this.frames.length - 1; i >= 0; i--) {
          const old = this.frames[i];
          if (old.wire.r !== options.replace) continue;
          // Le remplaçant garde l'échéance du message remplacé s'il n'était pas encore parti (sinon il ne partirait jamais).
          if (!old.sent) due = Math.min(due, old.due);
          this.frames.splice(i, 1);
        }
      }
      frame.n = ++this.seq;
      this.frames.push({ wire: frame, bytes, due, sent: false });
    } else {
      const text = JSON.stringify(value);
      const count = Math.ceil(text.length / CHUNK_CHARS);
      for (let i = 0; i < count; i++) {
        const chunk: Chunk = { n: ++this.bulkSeq, c: text.slice(i * CHUNK_CHARS, (i + 1) * CHUNK_CHARS), i, z: count };
        this.chunks.push({ wire: chunk, bytes: byteLength(JSON.stringify(chunk)), due, sent: false });
      }
    }
    this.schedule(due);
  }

  /** Écriture prochaine (signe de vie, accusé de réception) même sans nouveau message. */
  touch(): void {
    if (this.closed) return;
    this.forceWrite = true;
    this.schedule(Date.now());
  }

  /** Nouvelle version du document de l'autre côté (déjà déchiffrée). */
  receive(plain: string): void {
    if (this.done) return;
    let payload: Partial<Payload> | null;
    try {
      payload = JSON.parse(plain) as Partial<Payload> | null;
    } catch {
      return;
    }
    if (!payload || typeof payload !== 'object') return;
    const now = Date.now();
    if (typeof payload.h === 'number') {
      this.lastPeerH = payload.h;
      this.lastPeerHAt = now;
    }
    if (typeof payload.e === 'number' && typeof payload.w === 'number' && payload.e <= now) {
      const sample = now - payload.e - Math.max(0, payload.w);
      if (sample >= 0 && sample < 60_000) {
        this.rtts.push(sample);
        if (this.rtts.length > RTT_SAMPLES) this.rtts.shift();
      }
    }
    if (Array.isArray(payload.a)) this.acknowledged(Number(payload.a[0]) || 0, Number(payload.a[1]) || 0);

    for (const frame of Array.isArray(payload.f) ? payload.f : []) {
      if (!frame || typeof frame.n !== 'number' || frame.n <= this.lastIn) continue;
      this.lastIn = frame.n;
      this.deliver(frame.o);
      if (this.done) return;
    }
    let receivedChunk = false;
    for (const chunk of Array.isArray(payload.b) ? payload.b : []) {
      if (!chunk || typeof chunk.n !== 'number' || chunk.n <= this.lastBulkIn || typeof chunk.c !== 'string') continue;
      this.lastBulkIn = chunk.n;
      receivedChunk = true;
      const first = chunk.n - chunk.i;
      if (chunk.i === 0) this.parts.set(first, []);
      const parts = this.parts.get(first);
      if (!parts || parts.length !== chunk.i) {
        this.parts.delete(first);
        continue;
      }
      parts.push(chunk.c);
      if (parts.length < chunk.z) continue;
      this.parts.delete(first);
      let message: unknown;
      try {
        message = JSON.parse(parts.join(''));
      } catch {
        continue;
      }
      this.deliver(message);
      if (this.done) return;
    }
    // L'expéditeur d'un gros message attend notre accusé pour envoyer la suite (même si ces morceaux étaient déjà
    // arrivés : notre accusé précédent a pu se perdre).
    if (receivedChunk || (Array.isArray(payload.b) && payload.b.length > 0)) this.touch();
    if (payload.x === 1) {
      this.finish();
      this.options.onClosed?.();
    }
  }

  /** Version « fermeture » du document (à chiffrer à l'avance : elle part à la fermeture de la page). */
  farewell(): string {
    const payload: Payload = { a: [this.lastIn, this.lastBulkIn], f: [], b: [], h: Date.now(), x: 1 };
    return JSON.stringify(payload);
  }

  /** Ferme la liaison : l'autre côté en est informé par une dernière écriture. */
  close(): void {
    if (this.closed) return;
    this.closing = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    void this.flush();
  }

  /** Arrêt sans prévenir l'autre côté. */
  dispose(): void {
    this.finish();
  }

  private acknowledged(ack: number, bulkAck: number): void {
    if (ack > this.peerAck) {
      this.peerAck = Math.min(ack, this.seq);
      for (let i = this.frames.length - 1; i >= 0; i--) if (this.frames[i].wire.n <= this.peerAck) this.frames.splice(i, 1);
    }
    if (bulkAck > this.peerBulkAck) {
      this.peerBulkAck = Math.min(bulkAck, this.bulkSeq);
      while (this.chunks.length && this.chunks[0].wire.n <= this.peerBulkAck) this.chunks.shift();
      if (this.waitingBulkAck) {
        this.setWaitingBulkAck(false);
        this.schedule(Date.now());
      }
    }
  }

  private finish(): void {
    this.done = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.setWaitingBulkAck(false);
  }

  private setWaitingBulkAck(waiting: boolean): void {
    this.waitingBulkAck = waiting;
    if (this.bulkTimer) clearTimeout(this.bulkTimer);
    this.bulkTimer = null;
    if (!waiting) return;
    this.bulkTimer = setTimeout(() => {
      this.bulkTimer = null;
      if (!this.waitingBulkAck || this.done) return;
      this.waitingBulkAck = false;
      this.forceWrite = true;
      this.schedule(Date.now());
    }, BULK_RESEND_MS);
  }

  private deliver(message: unknown): void {
    try {
      this.options.deliver(message);
    } catch (error) {
      console.warn('[whatquiz] Relais : message ignoré', error);
    }
  }

  private schedule(due: number): void {
    if (this.done) return;
    if (this.writing) {
      this.rerun = true;
      return;
    }
    const at = Math.max(due, this.lastWriteAt + this.minGapMs);
    if (this.timer && this.timerAt <= at) return;
    if (this.timer) clearTimeout(this.timer);
    this.timerAt = at;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, Math.max(0, at - Date.now()));
  }

  private needsWrite(now: number): boolean {
    if (this.closing || this.forceWrite) return true;
    if (this.frames.some((p) => !p.sent && p.due <= now)) return true;
    return !this.waitingBulkAck && this.chunks.some((p) => !p.sent && p.due <= now);
  }

  /** Prochaine heure à laquelle un message en attente doit partir. */
  private nextDue(): number | null {
    let next: number | null = null;
    const consider = (p: Pending<unknown>) => {
      if (!p.sent && (next === null || p.due < next)) next = p.due;
    };
    this.frames.forEach(consider);
    if (!this.waitingBulkAck) this.chunks.forEach(consider);
    return next;
  }

  private async flush(): Promise<void> {
    if (this.done || this.writing) return;
    const now = Date.now();
    if (!this.closing && now < this.lastWriteAt + this.minGapMs) return this.schedule(now);
    if (!this.needsWrite(now)) {
      const next = this.nextDue();
      if (next !== null) this.schedule(next);
      return;
    }
    this.writing = true;
    this.rerun = false;
    this.forceWrite = false;
    const closing = this.closing;

    // Tous les messages courants non confirmés, puis autant de morceaux que la place le permet.
    let bytes = 0;
    const frames = this.frames.map((p) => {
      p.sent = true;
      bytes += p.bytes;
      return p.wire;
    });
    const chunks: Chunk[] = [];
    let truncated = false;
    for (const p of this.chunks) {
      if ((frames.length > 0 || chunks.length > 0) && bytes + p.bytes > MAX_PAYLOAD_BYTES) {
        truncated = true;
        break;
      }
      bytes += p.bytes;
      p.sent = true;
      chunks.push(p.wire);
    }
    const payload: Payload = { a: [this.lastIn, this.lastBulkIn], f: frames, b: chunks, h: now };
    if (this.lastPeerH !== null) {
      payload.e = this.lastPeerH;
      payload.w = now - this.lastPeerHAt;
    }
    if (closing) payload.x = 1;
    this.lastWriteAt = now;
    this.setWaitingBulkAck(truncated);
    try {
      await this.options.write(JSON.stringify(payload));
      this.failures = 0;
    } catch (error) {
      this.failures += 1;
      console.warn('[whatquiz] Relais : envoi impossible', error);
      this.writing = false;
      if (closing) return this.finish();
      // Les messages restent dans la boîte : ils repartiront avec la prochaine écriture.
      for (const p of [...this.frames, ...this.chunks]) p.sent = false;
      this.setWaitingBulkAck(false);
      this.forceWrite = true;
      this.schedule(Date.now() + Math.min(10_000, 1_000 * 2 ** Math.min(this.failures, 4)));
      return;
    }
    this.writing = false;
    if (closing) return this.finish();
    const later = Date.now();
    if (this.rerun || this.needsWrite(later)) this.schedule(later);
    else {
      const next = this.nextDue();
      if (next !== null) this.schedule(next);
    }
  }
}

/* ───────────── Chiffrement ───────────── */

const ECDH = { name: 'ECDH', namedCurve: 'P-256' } as const;

function subtle(): SubtleCrypto {
  const api = globalThis.crypto?.subtle;
  if (!api) throw new Error('Chiffrement indisponible (page non sécurisée)');
  return api;
}

export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

export function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

const toBase64Url = (bytes: Uint8Array) => toBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export interface RelayKeys {
  privateKey: CryptoKey;
  publicKey: string;
}

export async function createRelayKeys(): Promise<RelayKeys> {
  const pair = (await subtle().generateKey(ECDH, false, ['deriveBits'])) as CryptoKeyPair;
  const raw = new Uint8Array(await subtle().exportKey('raw', pair.publicKey));
  return { privateKey: pair.privateKey, publicKey: toBase64(raw) };
}

export interface ChannelSecret {
  key: CryptoKey;
  /** Nom du document de la boîte « professeur → élève », connu des deux seuls appareils. */
  box: string;
}

/** Clé commune à l'élève et au professeur (chacun avec sa clé privée et la clé publique de l'autre). */
export async function deriveChannel(own: CryptoKey, peerPublic: string, code: string): Promise<ChannelSecret> {
  const peer = await subtle().importKey('raw', fromBase64(peerPublic), ECDH, false, []);
  const shared = await subtle().deriveBits({ name: 'ECDH', public: peer }, own, 256);
  const base = await subtle().importKey('raw', shared, 'HKDF', false, ['deriveKey', 'deriveBits']);
  const salt = encoder.encode(`whatquiz-relay-${RELAY_PROTOCOL}-${code}`);
  const key = await subtle().deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt, info: encoder.encode('key') },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
  const boxBits = await subtle().deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info: encoder.encode('box') }, base, 128);
  return { key, box: toBase64Url(new Uint8Array(boxBits)) };
}

export async function seal(key: CryptoKey, plain: string): Promise<string> {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const sealed = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(plain)));
  const out = new Uint8Array(iv.length + sealed.length);
  out.set(iv);
  out.set(sealed, iv.length);
  return toBase64(out);
}

const decoder = new TextDecoder();

/** Déchiffre ; null si le contenu n'a pas été produit avec cette clé (document corrompu ou falsifié). */
export async function unseal(key: CryptoKey, sealed: unknown): Promise<string | null> {
  if (typeof sealed !== 'string') return null;
  try {
    const bytes = fromBase64(sealed);
    if (bytes.length < 29) return null;
    const plain = await subtle().decrypt({ name: 'AES-GCM', iv: bytes.subarray(0, 12) }, key, bytes.subarray(12));
    return decoder.decode(plain);
  } catch {
    return null;
  }
}

export function randomId(bytes = 16): string {
  return toBase64Url(globalThis.crypto.getRandomValues(new Uint8Array(bytes)));
}
