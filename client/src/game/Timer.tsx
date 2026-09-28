import { useEffect, useState } from 'react';
import type { TimerState } from '../../../shared/types';

function remainingOf(timer: TimerState | null, offset: number): number {
  if (!timer) return 0;
  if (timer.paused || timer.endsAt === null) return timer.remainingMs;
  return Math.max(0, timer.endsAt - (Date.now() + offset));
}

/** Temps restant calculé à partir de l'horloge du serveur (corrigée du décalage local). */
function useRemaining(timer: TimerState | null, offset: number): number {
  const [remaining, setRemaining] = useState(() => remainingOf(timer, offset));

  useEffect(() => {
    setRemaining(remainingOf(timer, offset));
    if (!timer || timer.paused) return;
    const id = setInterval(() => setRemaining(remainingOf(timer, offset)), 100);
    return () => clearInterval(id);
  }, [timer, offset]);

  return remaining;
}

interface TimerProps {
  timer: TimerState | null;
  offset: number;
  variant?: 'ring' | 'bar';
  size?: number;
}

export function Timer({ timer, offset, variant = 'ring', size = 96 }: TimerProps) {
  const remaining = useRemaining(timer, offset);
  if (!timer) return null;
  const ratio = timer.durationMs ? remaining / timer.durationMs : 0;
  const seconds = Math.ceil(remaining / 1000);
  const urgent = seconds <= 5 && !timer.paused;
  const label = timer.paused ? `En pause, ${seconds} secondes restantes` : `${seconds} secondes restantes`;

  if (variant === 'bar') {
    return (
      <div className={`timer-bar${urgent ? ' urgent' : ''}`} role="timer" aria-label={label}>
        <span style={{ transform: `scaleX(${ratio})` }} />
        <b aria-hidden="true">{seconds}</b>
      </div>
    );
  }

  const radius = 44;
  const circumference = 2 * Math.PI * radius;
  return (
    <div className={`timer-ring${urgent ? ' urgent' : ''}${timer.paused ? ' paused' : ''}`} style={{ width: size, height: size }} role="timer" aria-label={label}>
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <circle cx="50" cy="50" r={radius} className="timer-ring-track" />
        <circle
          cx="50"
          cy="50"
          r={radius}
          className="timer-ring-value"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - ratio)}
        />
      </svg>
      <span aria-hidden="true" style={{ fontSize: size * 0.34 }}>
        {seconds}
      </span>
    </div>
  );
}
