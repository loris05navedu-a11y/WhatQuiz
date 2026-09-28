import { randomInt, randomUUID } from 'node:crypto';
import { DEFAULT_GAME_SETTINGS } from '../../../shared/constants';
import type { GameSettings, Quiz } from '../../../shared/types';
import type { GameRepository, QuizSnapshot } from '../db/games';
import { GameRoom, type RoomTransport } from './GameRoom';

const ENDED_ROOM_TTL_MS = 30 * 60_000;
const IDLE_ROOM_TTL_MS = 3 * 3_600_000;

export interface CreateGameInput {
  hostUserId: number;
  quiz: Quiz;
  settings: Partial<GameSettings>;
  isTest: boolean;
  autoStartOnJoin?: boolean;
  allowBots?: boolean;
  maxPlayers: number;
}

/** Registre des parties actives (en mémoire) : un code à 6 chiffres ⇔ une salle. */
export class GameManager {
  private readonly rooms = new Map<string, GameRoom>();
  private readonly sweeper: NodeJS.Timeout;

  constructor(
    private readonly store: GameRepository,
    private readonly transport: RoomTransport,
  ) {
    this.sweeper = setInterval(() => this.sweep(), 60_000);
    this.sweeper.unref();
  }

  create(input: CreateGameInput): GameRoom {
    const settings: GameSettings = { ...DEFAULT_GAME_SETTINGS, maxPlayers: input.maxPlayers, ...input.settings };
    const snapshot: QuizSnapshot = {
      quizId: input.quiz.id,
      title: input.quiz.title,
      questions: input.quiz.questions.map(({ id: _id, position: _position, ...question }) => question),
    };
    const id = randomUUID();
    const code = this.generateCode();
    if (!input.isTest) this.store.create({ id, code, hostId: input.hostUserId, snapshot, settings });
    const room = new GameRoom({
      id,
      code,
      hostUserId: input.hostUserId,
      snapshot,
      settings,
      isTest: input.isTest,
      autoStartOnJoin: input.autoStartOnJoin,
      allowBots: input.allowBots,
      store: input.isTest ? null : this.store,
      transport: this.transport,
    });
    this.rooms.set(code, room);
    return room;
  }

  get(code: string): GameRoom | undefined {
    return this.rooms.get(code);
  }

  getById(id: string): GameRoom | undefined {
    return [...this.rooms.values()].find((room) => room.id === id);
  }

  listByHost(hostUserId: number): GameRoom[] {
    return [...this.rooms.values()].filter((room) => room.hostUserId === hostUserId);
  }

  remove(room: GameRoom): void {
    room.dispose();
    this.rooms.delete(room.code);
  }

  shutdown(): void {
    clearInterval(this.sweeper);
    for (const room of this.rooms.values()) room.dispose();
    this.rooms.clear();
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
      const code = String(randomInt(100_000, 1_000_000));
      if (!this.rooms.has(code)) return code;
    }
  }
}
