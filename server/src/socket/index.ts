import type { Server as HttpServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import { ZodError } from 'zod';
import { ERRORS, REACTIONS } from '../../../shared/constants';
import type { AckResult, ClientToServerEvents, PublicUser, ServerToClientEvents } from '../../../shared/types';
import { GameError } from '../game/errors';
import { GameManager } from '../game/GameManager';
import type { GameRoom, RoomTransport } from '../game/GameRoom';
import { bearerToken, userFromCookieHeader } from '../http/auth';
import { RateLimiter } from '../http/rateLimit';
import type { Services } from '../services';
import { answerPayloadSchema, hostActionSchema, joinSchema, presenceReportSchema } from '../validation';

interface SocketData {
  user?: PublicUser;
  player?: { code: string; playerId: string };
  hostCode?: string;
  joinLimiter: RateLimiter;
  reactLimiter: RateLimiter;
  presenceLimiter: RateLimiter;
}

type IoServer = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;
type IoSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

const hostRoom = (code: string) => `host:${code}`;

/** Transforme toute erreur en réponse d'acquittement lisible (jamais de trace technique). */
function toAckError(error: unknown): { ok: false; error: string } {
  if (error instanceof GameError) return { ok: false, error: error.message };
  if (error instanceof ZodError) return { ok: false, error: ERRORS.invalidInput };
  console.error('[whatquiz] Erreur Socket.IO :', error);
  return { ok: false, error: ERRORS.generic };
}

function handle<T extends object>(ack: unknown, work: () => AckResult<T>): void {
  const reply = typeof ack === 'function' ? (ack as (result: AckResult<T>) => void) : () => {};
  try {
    reply(work());
  } catch (error) {
    reply(toAckError(error));
  }
}

function createTransport(getIo: () => IoServer): RoomTransport {
  return {
    sendHost: (room) => void getIo().to(hostRoom(room.code)).emit('host:state', room.hostView()),
    sendPlayer: (room, player) => {
      if (player.socketId) getIo().to(player.socketId).emit('game:state', room.playerView(player));
    },
    kicked: (_room, player) => {
      if (!player.socketId) return;
      const socket = getIo().sockets.sockets.get(player.socketId);
      socket?.emit('game:kicked');
      if (socket) socket.data.player = undefined;
    },
  };
}

export function createRealtime(httpServer: HttpServer, services: Services): { io: IoServer; manager: GameManager } {
  const io: IoServer = new Server(httpServer, {
    serveClient: false,
    pingInterval: 20_000,
    pingTimeout: 25_000,
    maxHttpBufferSize: 16_000,
    cors: services.config.corsOrigins.length > 0 ? { origin: services.config.corsOrigins } : undefined,
  });
  const manager = new GameManager(services.games, createTransport(() => io));

  io.on('connection', (socket: IoSocket) => {
    const authToken = socket.handshake.auth?.token;
    socket.data.user = userFromCookieHeader(
      services,
      socket.handshake.headers.cookie,
      typeof authToken === 'string' ? bearerToken(`Bearer ${authToken}`) : undefined,
    )?.user;
    socket.data.joinLimiter = new RateLimiter(15, 60_000);
    socket.data.reactLimiter = new RateLimiter(6, 5_000);
    // Un signe de vie toutes les 2 s, plus les sorties et retours : large marge, mais pas d'inondation possible.
    socket.data.presenceLimiter = new RateLimiter(40, 10_000);

    const currentPlayerRoom = (): GameRoom | undefined => {
      const player = socket.data.player;
      return player ? manager.get(player.code) : undefined;
    };

    socket.on('game:join', (payload, ack) =>
      handle(ack, () => {
        if (!socket.data.joinLimiter.consume('join')) throw new GameError('Trop de tentatives, patientez une minute');
        const input = joinSchema.safeParse(payload);
        if (!input.success) throw new GameError(ERRORS.gameNotFound);
        const room = manager.get(input.data.code);
        if (!room) throw new GameError(ERRORS.gameNotFound);

        const previous = currentPlayerRoom();
        if (previous && previous !== room) previous.leave(socket.id);
        const userId = socket.data.user?.role === 'student' ? socket.data.user.id : null;
        const player = room.join({ nickname: input.data.nickname, token: input.data.token, userId, socketId: socket.id });
        socket.data.player = { code: room.code, playerId: player.id };
        socket.emit('game:state', room.playerView(player));
        return { ok: true, playerId: player.id, token: player.token };
      }),
    );

    socket.on('game:answer', (payload, ack) =>
      handle(ack, () => {
        const room = currentPlayerRoom();
        if (!room || !socket.data.player) throw new GameError(ERRORS.gameNotFound);
        const input = answerPayloadSchema.parse(payload);
        room.answer(socket.data.player.playerId, input.questionIndex, input.answer);
        return { ok: true };
      }),
    );

    socket.on('game:react', (payload) => {
      const room = currentPlayerRoom();
      const player = socket.data.player && room?.players.get(socket.data.player.playerId);
      if (!room || !player) return;
      const emoji = typeof payload?.emoji === 'string' ? payload.emoji : '';
      if (!(REACTIONS as readonly string[]).includes(emoji)) return;
      if (!socket.data.reactLimiter.consume('react')) return;
      io.to(hostRoom(room.code)).emit('host:reaction', { emoji, nickname: player.nickname });
    });

    socket.on('game:presence', (payload) => {
      const room = currentPlayerRoom();
      if (!room || !socket.data.player || !socket.data.presenceLimiter.consume('presence')) return;
      const report = presenceReportSchema.safeParse(payload);
      if (report.success) room.reportPresence(socket.data.player.playerId, report.data);
    });

    socket.on('game:leave', () => {
      currentPlayerRoom()?.leave(socket.id);
      socket.data.player = undefined;
    });

    socket.on('host:join', (payload, ack) =>
      handle(ack, () => {
        const user = socket.data.user;
        if (!user) throw new GameError(ERRORS.unauthenticated);
        const room = typeof payload?.code === 'string' ? manager.get(payload.code) : undefined;
        if (!room) throw new GameError(ERRORS.gameNotFound);
        if (room.hostUserId !== user.id) throw new GameError(ERRORS.forbidden);
        if (socket.data.hostCode) void socket.leave(hostRoom(socket.data.hostCode));
        socket.data.hostCode = room.code;
        void socket.join(hostRoom(room.code));
        socket.emit('host:state', room.hostView());
        return { ok: true };
      }),
    );

    socket.on('host:action', (payload, ack) =>
      handle(ack, () => {
        const code = socket.data.hostCode;
        const room = code ? manager.get(code) : undefined;
        if (!room || room.hostUserId !== socket.data.user?.id) throw new GameError(ERRORS.forbidden);
        room.applyHostAction(hostActionSchema.parse(payload));
        return { ok: true };
      }),
    );

    socket.on('disconnect', () => {
      currentPlayerRoom()?.disconnect(socket.id);
    });
  });

  return { io, manager };
}
