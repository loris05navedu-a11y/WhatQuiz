import { ZodError } from 'zod';
import type { QuizSnapshot } from '../../../server/src/db/games';
import { GameError } from '../../../server/src/game/errors';
import { GameRoom, type RoomTransport } from '../../../server/src/game/GameRoom';
import { RateLimiter } from '../../../server/src/http/rateLimit';
import { answerPayloadSchema, hostActionSchema, joinSchema } from '../../../server/src/validation';
import { DEFAULT_GAME_SETTINGS, ERRORS, REACTIONS } from '../../../shared/constants';
import { randomIntBetween, randomUuid } from '../../../shared/random';
import type { AckResult, GameSettings, PublicUser, Quiz } from '../../../shared/types';
import { gameStore } from './db';

/**
 * Serveur de jeu du mode sans serveur : il tourne dans l'onglet du professeur. Les élèves s'y connectent
 * par une « porte » (pair-à-pair WebRTC) ; le professeur et les tests locaux s'y branchent directement.
 * Même logique que server/src/socket : l'hôte fait autorité, les réponses correctes ne quittent jamais cet appareil.
 */

export interface HubClient {
  readonly id: string;
  readonly user: PublicUser | null;
  player?: { code: string; playerId: string };
  hostCode?: string;
  readonly joinLimiter: RateLimiter;
  readonly reactLimiter: RateLimiter;
  deliver(event: string, payload?: unknown): void;
}

/** Point d'entrée des élèves distants pour une partie. */
export interface Door {
  close(): void;
}

/** Le code de partie est déjà utilisé par une autre salle dans le monde : on en tire un autre. */
export class DoorTakenError extends Error {}

export type DoorOpener = (code: string, hub: Hub) => Promise<Door>;

type Ack = (result: AckResult<Record<string, unknown>>) => void;

const ENDED_ROOM_TTL_MS = 30 * 60_000;
const IDLE_ROOM_TTL_MS = 3 * 3_600_000;

function toAckError(error: unknown): { ok: false; error: string } {
  if (error instanceof GameError) return { ok: false, error: error.message };
  if (error instanceof ZodError) return { ok: false, error: ERRORS.invalidInput };
  console.error('[whatquiz] Erreur de partie :', error);
  return { ok: false, error: ERRORS.generic };
}

export interface CreateRoomInput {
  hostUserId: number;
  quiz: Quiz;
  settings: Partial<GameSettings>;
  isTest: boolean;
  autoStartOnJoin: boolean;
  allowBots: boolean;
}

export class Hub {
  private readonly rooms = new Map<string, GameRoom>();
  private readonly doors = new Map<string, Door>();
  private readonly clients = new Map<string, HubClient>();
  private sweeper: ReturnType<typeof setInterval> | null = null;

  openDoor: DoorOpener = async (code, hub) => (await import('./peer')).openPeerDoor(code, hub);

  private readonly transport: RoomTransport = {
    sendHost: (room) => this.toHosts(room.code, 'host:state', room.hostView()),
    sendPlayer: (room, player) => {
      if (player.socketId) this.clients.get(player.socketId)?.deliver('game:state', room.playerView(player));
    },
    kicked: (_room, player) => {
      const client = player.socketId ? this.clients.get(player.socketId) : undefined;
      if (!client) return;
      client.deliver('game:kicked');
      client.player = undefined;
    },
  };

  hasRoom(code: string): boolean {
    return this.rooms.has(code);
  }

  getRoom(code: string): GameRoom | undefined {
    return this.rooms.get(code);
  }

  getById(id: string): GameRoom | undefined {
    return [...this.rooms.values()].find((room) => room.id === id);
  }

  listByHost(hostUserId: number): GameRoom[] {
    return [...this.rooms.values()].filter((room) => room.hostUserId === hostUserId);
  }

  async createRoom(input: CreateRoomInput): Promise<GameRoom> {
    const settings: GameSettings = { ...DEFAULT_GAME_SETTINGS, ...input.settings };
    const snapshot: QuizSnapshot = {
      quizId: input.quiz.id,
      title: input.quiz.title,
      questions: input.quiz.questions.map(({ id: _id, position: _position, ...question }) => question),
    };
    for (let attempt = 0; attempt < 6; attempt++) {
      const code = this.generateCode();
      let door: Door | null = null;
      if (!input.isTest) {
        try {
          door = await this.openDoor(code, this);
        } catch (error) {
          if (error instanceof DoorTakenError) continue;
          throw error;
        }
      }
      const id = randomUuid();
      if (!input.isTest) gameStore.create({ id, code, hostId: input.hostUserId, snapshot, settings });
      const room = new GameRoom({
        id,
        code,
        hostUserId: input.hostUserId,
        snapshot,
        settings,
        isTest: input.isTest,
        autoStartOnJoin: input.autoStartOnJoin,
        allowBots: input.allowBots,
        store: input.isTest ? null : gameStore,
        transport: this.transport,
      });
      this.rooms.set(code, room);
      if (door) this.doors.set(code, door);
      this.sweeper ??= setInterval(() => this.sweep(), 60_000);
      return room;
    }
    throw new GameError('Impossible de créer la partie, réessayez');
  }

  remove(room: GameRoom): void {
    room.dispose();
    this.rooms.delete(room.code);
    this.doors.get(room.code)?.close();
    this.doors.delete(room.code);
    if (this.rooms.size === 0 && this.sweeper) {
      clearInterval(this.sweeper);
      this.sweeper = null;
    }
  }

  /** Vérification d'un code avant de demander le pseudo. */
  checkCode(code: string): { code: string; quizTitle: string } {
    const room = /^\d{6}$/.test(code) ? this.rooms.get(code) : undefined;
    if (!room) throw new GameError(ERRORS.gameNotFound);
    if (room.phase === 'ended') throw new GameError(ERRORS.gameEnded);
    if (room.locked) throw new GameError(ERRORS.gameLocked);
    return { code: room.code, quizTitle: room.quizTitle };
  }

  connect(user: PublicUser | null, deliver: (event: string, payload?: unknown) => void): HubClient {
    const client: HubClient = {
      id: randomUuid(),
      user,
      joinLimiter: new RateLimiter(15, 60_000),
      reactLimiter: new RateLimiter(6, 5_000),
      deliver,
    };
    this.clients.set(client.id, client);
    return client;
  }

  disconnect(client: HubClient): void {
    if (!this.clients.delete(client.id)) return;
    this.playerRoom(client)?.disconnect(client.id);
  }

  handle(client: HubClient, event: string, payload: unknown, ack?: Ack): void {
    const reply = ack ?? (() => {});
    try {
      const result = this.dispatch(client, event, payload);
      if (result) reply(result);
    } catch (error) {
      reply(toAckError(error));
    }
  }

  private dispatch(client: HubClient, event: string, payload: unknown): AckResult<Record<string, unknown>> | null {
    switch (event) {
      case 'game:check':
        return { ok: true, ...this.checkCode(String((payload as { code?: unknown } | null)?.code ?? '')) };

      case 'game:join': {
        if (!client.joinLimiter.consume('join')) throw new GameError('Trop de tentatives, patientez une minute');
        const input = joinSchema.safeParse(payload);
        if (!input.success) throw new GameError(ERRORS.gameNotFound);
        const room = this.rooms.get(input.data.code);
        if (!room) throw new GameError(ERRORS.gameNotFound);
        const previous = this.playerRoom(client);
        if (previous && previous !== room) previous.leave(client.id);
        const player = room.join({ nickname: input.data.nickname, token: input.data.token, userId: null, socketId: client.id });
        client.player = { code: room.code, playerId: player.id };
        client.deliver('game:state', room.playerView(player));
        return { ok: true, playerId: player.id, token: player.token };
      }

      case 'game:answer': {
        const room = this.playerRoom(client);
        if (!room || !client.player) throw new GameError(ERRORS.gameNotFound);
        const input = answerPayloadSchema.parse(payload);
        room.answer(client.player.playerId, input.questionIndex, input.answer);
        return { ok: true };
      }

      case 'game:react': {
        const room = this.playerRoom(client);
        const player = client.player && room?.players.get(client.player.playerId);
        const emoji = (payload as { emoji?: unknown } | null)?.emoji;
        if (!room || !player || typeof emoji !== 'string' || !(REACTIONS as readonly string[]).includes(emoji)) return null;
        if (client.reactLimiter.consume('react')) this.toHosts(room.code, 'host:reaction', { emoji, nickname: player.nickname });
        return null;
      }

      case 'game:leave':
        this.playerRoom(client)?.leave(client.id);
        client.player = undefined;
        return null;

      case 'host:join': {
        if (!client.user) throw new GameError(ERRORS.unauthenticated);
        const code = (payload as { code?: unknown } | null)?.code;
        const room = typeof code === 'string' ? this.rooms.get(code) : undefined;
        if (!room) throw new GameError(ERRORS.gameNotFound);
        if (room.hostUserId !== client.user.id) throw new GameError(ERRORS.forbidden);
        client.hostCode = room.code;
        client.deliver('host:state', room.hostView());
        return { ok: true };
      }

      case 'host:action': {
        const room = client.hostCode ? this.rooms.get(client.hostCode) : undefined;
        if (!room || !client.user || room.hostUserId !== client.user.id) throw new GameError(ERRORS.forbidden);
        room.applyHostAction(hostActionSchema.parse(payload));
        return { ok: true };
      }

      default:
        return null;
    }
  }

  private playerRoom(client: HubClient): GameRoom | undefined {
    return client.player ? this.rooms.get(client.player.code) : undefined;
  }

  private toHosts(code: string, event: string, payload: unknown): void {
    for (const client of this.clients.values()) if (client.hostCode === code) client.deliver(event, payload);
  }

  private sweep(): void {
    const now = Date.now();
    for (const room of this.rooms.values()) {
      const endedLongAgo = room.endedAt !== null && now - room.endedAt > ENDED_ROOM_TTL_MS;
      const idle = now - room.lastActivity > IDLE_ROOM_TTL_MS;
      if (idle && room.phase !== 'ended') room.end();
      if (endedLongAgo || idle) this.remove(room);
    }
  }

  private generateCode(): string {
    for (;;) {
      const code = String(randomIntBetween(100_000, 1_000_000));
      if (!this.rooms.has(code)) return code;
    }
  }
}

export const hub = new Hub();
