import { io, type Socket } from 'socket.io-client';
import type { AckResult, ClientToServerEvents, ServerToClientEvents } from '../../../shared/types';
import { ERRORS } from '../../../shared/constants';
import { StandaloneSocket } from '../standalone/socket';
import { API_ORIGIN, getToken, STANDALONE } from './backend';

export type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export function createGameSocket(code: string): GameSocket {
  if (STANDALONE) return new StandaloneSocket(code) as unknown as GameSocket;
  // WebSocket direct (pas de long-polling) : moins de requêtes, plus fluide sur tablette.
  const options = { transports: ['websocket'], reconnectionDelayMax: 4000, auth: (send: (data: object) => void) => send({ token: getToken() ?? undefined }) };
  return API_ORIGIN ? io(API_ORIGIN, options) : io(options);
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
