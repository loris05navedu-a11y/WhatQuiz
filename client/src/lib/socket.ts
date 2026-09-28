import { io, type Socket } from 'socket.io-client';
import type { AckResult, ClientToServerEvents, ServerToClientEvents } from '../../../shared/types';
import { ERRORS } from '../../../shared/constants';

export type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export function createGameSocket(): GameSocket {
  // WebSocket direct (pas de long-polling) : moins de requêtes, plus fluide sur tablette.
  return io({ transports: ['websocket'], reconnectionDelayMax: 4000 });
}

/** Émet un événement avec acquittement, en échouant proprement si le serveur ne répond pas. */
export function emitWithAck<T extends object>(
  send: (ack: (result: AckResult<T>) => void) => void,
  timeoutMs = 8000,
): Promise<AckResult<T>> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ ok: false, error: ERRORS.connectionLost }), timeoutMs);
    send((result) => {
      clearTimeout(timer);
      resolve(result);
    });
  });
}
