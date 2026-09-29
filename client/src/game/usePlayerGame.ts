import { useCallback, useEffect, useRef, useState } from 'react';
import { ERRORS } from '../../../shared/constants';
import type { PlayerView, SubmittedAnswer } from '../../../shared/types';
import { createGameSocket, emitWithAck, type GameSocket } from '../lib/socket';
import { readStorage, writeStorage } from '../lib/storage';

export type PlayerStatus = 'connecting' | 'needsNickname' | 'joining' | 'joined' | 'kicked' | 'failed';

interface StoredPlayer {
  token: string;
  nickname: string;
}

const storageKey = (code: string) => `wq:player:${code}`;

function readStoredPlayer(code: string): StoredPlayer | null {
  try {
    return JSON.parse(readStorage('session', storageKey(code)) ?? 'null') as StoredPlayer | null;
  } catch {
    return null;
  }
}

/**
 * Connexion d'un élève à une partie : rejoindre, reprendre après une coupure (jeton en
 * sessionStorage), recevoir l'état autoritaire du serveur et envoyer ses réponses.
 */
export function usePlayerGame(code: string, autoJoinNickname?: string) {
  const [status, setStatus] = useState<PlayerStatus>('connecting');
  const [view, setView] = useState<PlayerView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(true);
  const [clockOffset, setClockOffset] = useState(0);
  const socketRef = useRef<GameSocket | null>(null);

  const join = useCallback(
    async (nickname: string, token?: string): Promise<string | null> => {
      const socket = socketRef.current;
      if (!socket) return ERRORS.connectionLost;
      setStatus('joining');
      const result = await emitWithAck<{ playerId: string; token: string }>((ack) => socket.emit('game:join', { code, nickname, token }, ack));
      if (result.ok) {
        writeStorage('session', storageKey(code), JSON.stringify({ token: result.token, nickname }));
        setError(null);
        setStatus('joined');
        return null;
      }
      if (token) writeStorage('session', storageKey(code), null);
      const fatal = result.error === ERRORS.gameNotFound || result.error === ERRORS.gameEnded || result.error === ERRORS.kicked;
      setError(result.error);
      setStatus(fatal ? 'failed' : 'needsNickname');
      return result.error;
    },
    [code],
  );

  useEffect(() => {
    const socket = createGameSocket();
    socketRef.current = socket;
    let firstConnection = true;

    socket.on('connect', () => {
      setConnected(true);
      const stored = readStoredPlayer(code);
      if (stored) void join(stored.nickname, stored.token);
      else if (firstConnection && autoJoinNickname) void join(autoJoinNickname);
      else if (firstConnection) setStatus('needsNickname');
      firstConnection = false;
    });
    socket.on('disconnect', () => setConnected(false));
    socket.on('game:state', (next) => {
      if (next.timer) setClockOffset(next.timer.serverNow - Date.now());
      setView(next);
    });
    socket.on('game:kicked', () => {
      writeStorage('session', storageKey(code), null);
      setStatus('kicked');
    });

    return () => {
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
    };
  }, [code, autoJoinNickname, join]);

  const answer = useCallback(
    async (questionIndex: number, submitted: SubmittedAnswer): Promise<string | null> => {
      const socket = socketRef.current;
      if (!socket) return ERRORS.connectionLost;
      const result = await emitWithAck((ack) => socket.emit('game:answer', { questionIndex, answer: submitted }, ack));
      return result.ok ? null : result.error;
    },
    [],
  );

  const react = useCallback((emoji: string) => {
    socketRef.current?.emit('game:react', { emoji });
  }, []);

  const leave = useCallback(() => {
    socketRef.current?.emit('game:leave');
    writeStorage('session', storageKey(code), null);
  }, [code]);

  return { status, view, error, connected, clockOffset, join, answer, react, leave };
}
