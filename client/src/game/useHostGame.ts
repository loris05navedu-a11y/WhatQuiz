import { useCallback, useEffect, useRef, useState } from 'react';
import { ERRORS } from '../../../shared/constants';
import type { HostAction, HostView } from '../../../shared/types';
import { createGameSocket, emitWithAck, type GameSocket } from '../lib/socket';

/** Connexion du professeur à sa partie : état complet + envoi des actions de contrôle. */
export function useHostGame(code: string) {
  const [view, setView] = useState<HostView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(true);
  const [clockOffset, setClockOffset] = useState(0);
  const socketRef = useRef<GameSocket | null>(null);

  useEffect(() => {
    const socket = createGameSocket();
    socketRef.current = socket;
    socket.on('connect', async () => {
      setConnected(true);
      const result = await emitWithAck((ack) => socket.emit('host:join', { code }, ack));
      setError(result.ok ? null : result.error);
    });
    socket.on('disconnect', () => setConnected(false));
    socket.on('host:state', (next) => {
      if (next.timer) setClockOffset(next.timer.serverNow - Date.now());
      setView(next);
    });
    return () => {
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
    };
  }, [code]);

  const act = useCallback(async (action: HostAction): Promise<string | null> => {
    const socket = socketRef.current;
    if (!socket) return ERRORS.connectionLost;
    const result = await emitWithAck((ack) => socket.emit('host:action', action, ack));
    return result.ok ? null : result.error;
  }, []);

  return { view, error, connected, clockOffset, act };
}
