import { ERRORS } from '../../../shared/constants';
import type { AckResult } from '../../../shared/types';
import { ApiError } from '../api/errors';
import { readStorage, writeStorage } from '../lib/storage';
import { PeerLink } from './peer';
import { RelayLink } from './relay';

/**
 * Liaison d'un élève vers la partie hébergée sur l'appareil du professeur, quel que soit le réseau :
 *  - liaison directe (WebRTC) en priorité : rapide et gratuite, elle marche quand les appareils peuvent se joindre ;
 *  - relais en ligne (Firestore) lancé en parallèle si la liaison directe tarde : il passe partout où Internet passe.
 * La première qui répond est gardée ; l'autre est fermée. Ensuite (reconnexion, page de jeu après la vérification du
 * code, rechargement), on tente d'abord celle qui avait fonctionné pour cette partie.
 */

type Kind = 'direct' | 'relay';
type Ack = (result: AckResult<object>) => void;

interface SubLink {
  send(event: string, payload: unknown, ack?: Ack): void;
  close(): void;
  setQuiet?(quiet: boolean): void;
}

export interface GameLinkHandlers {
  onOpen(): void;
  onClose(): void;
  onEvent(event: string, payload: unknown): void;
  /** Aucune partie ne répond à ce code, ni en direct ni par le relais. */
  onUnavailable?(): void;
}

/** Délai laissé à la liaison directe avant de lancer aussi le relais. */
const RELAY_HEAD_START_MS = 2_500;
/** Le relais ne trouve pas la partie : on laisse encore ce délai à la liaison directe avant de conclure. */
const ABSENT_GRACE_MS = 12_000;

const other = (kind: Kind): Kind => (kind === 'direct' ? 'relay' : 'direct');
const preferenceKey = (code: string) => `wq:link:${code}`;

export class GameLink {
  private readonly links: Record<Kind, SubLink | null> = { direct: null, relay: null };
  private active: Kind | null = null;
  private preferred: Kind = 'direct';
  private readonly absent: Record<Kind, boolean> = { direct: false, relay: false };
  /** Relais désactivé (règles Firestore non publiées) : seule la liaison directe peut trancher. */
  private relayBlocked = false;
  private fallbackTimer: ReturnType<typeof setTimeout> | null = null;
  private absentTimer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;
  private quiet = false;

  constructor(
    private readonly code: string,
    private readonly handlers: GameLinkHandlers,
  ) {
    if (readStorage('session', preferenceKey(code)) === 'relay') this.preferred = 'relay';
    this.connect();
  }

  /** Liaison utilisée en ce moment (null : en cours de connexion). */
  get kind(): Kind | null {
    return this.active;
  }

  send(event: string, payload: unknown, ack?: Ack): void {
    const link = this.active ? this.links[this.active] : null;
    if (link) link.send(event, payload, ack);
  }

  setQuiet(quiet: boolean): void {
    this.quiet = quiet;
    if (this.active) this.links[this.active]?.setQuiet?.(quiet);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.clearTimers();
    for (const kind of ['direct', 'relay'] as const) {
      this.links[kind]?.close();
      this.links[kind] = null;
    }
    this.active = null;
  }

  private connect(): void {
    this.start(this.preferred);
    this.fallbackTimer = setTimeout(() => this.start(other(this.preferred)), RELAY_HEAD_START_MS);
  }

  private start(kind: Kind): void {
    if (this.closed || this.active || this.links[kind]) return;
    const handlers = {
      onOpen: () => this.opened(kind),
      onClose: () => this.dropped(kind),
      onEvent: (event: string, payload: unknown) => {
        if (this.active === kind) this.handlers.onEvent(event, payload);
      },
      onUnavailable: (reason: 'absent' | 'blocked' = 'absent') => this.missing(kind, reason),
    };
    this.links[kind] = kind === 'direct' ? new PeerLink(this.code, handlers) : new RelayLink(this.code, handlers);
  }

  private opened(kind: Kind): void {
    if (this.closed) return;
    if (this.active && this.active !== kind) {
      this.links[kind]?.close();
      this.links[kind] = null;
      return;
    }
    this.clearTimers();
    this.active = kind;
    this.preferred = kind;
    writeStorage('session', preferenceKey(this.code), kind);
    this.absent.direct = this.absent.relay = false;
    this.relayBlocked = false;
    const loser = other(kind);
    this.links[loser]?.close();
    this.links[loser] = null;
    if (this.quiet) this.links[kind]?.setQuiet?.(true);
    this.handlers.onOpen();
  }

  private dropped(kind: Kind): void {
    if (this.closed || this.active !== kind) return;
    this.active = null;
    this.handlers.onClose();
    // La liaison coupée se reconnecte d'elle-même ; l'autre est relancée si elle tarde.
    this.fallbackTimer = setTimeout(() => this.start(other(kind)), RELAY_HEAD_START_MS);
  }

  private missing(kind: Kind, reason: 'absent' | 'blocked'): void {
    if (this.closed || this.active) return;
    if (kind === 'relay' && reason === 'blocked') {
      this.relayBlocked = true;
      if (this.absent.direct) this.unavailable();
      return;
    }
    this.absent[kind] = true;
    if (kind === 'direct') {
      // La partie n'est pas joignable en direct : inutile d'attendre pour essayer le relais.
      this.start('relay');
      if (this.absent.relay || this.relayBlocked) this.unavailable();
    } else if (this.absent.direct) {
      this.unavailable();
    } else {
      this.absentTimer ??= setTimeout(() => {
        this.absentTimer = null;
        if (!this.active && this.absent.relay) this.unavailable();
      }, ABSENT_GRACE_MS);
    }
  }

  private unavailable(): void {
    this.handlers.onUnavailable?.();
  }

  private clearTimers(): void {
    if (this.fallbackTimer) clearTimeout(this.fallbackTimer);
    if (this.absentTimer) clearTimeout(this.absentTimer);
    this.fallbackTimer = null;
    this.absentTimer = null;
  }
}

const PROBE_TIMEOUT_MS = 25_000;

/** Vérifie qu'une partie existe avant de demander le pseudo. */
export function probeGame(code: string): Promise<{ code: string; quizTitle: string }> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (work: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      link.close();
      work();
    };
    const timer = setTimeout(
      () =>
        finish(() =>
          reject(new ApiError(0, 'La partie ne répond pas : vérifiez le code, la connexion Internet, et que l’écran de la partie est bien ouvert chez le professeur')),
        ),
      PROBE_TIMEOUT_MS,
    );
    const link = new GameLink(code, {
      onOpen: () =>
        link.send('game:check', { code }, (result) =>
          finish(() => {
            if (result.ok) resolve(result as unknown as { code: string; quizTitle: string });
            else reject(new ApiError(404, result.error));
          }),
        ),
      onClose: () => {},
      onEvent: () => {},
      onUnavailable: () => finish(() => reject(new ApiError(404, ERRORS.gameNotFound))),
    });
  });
}
