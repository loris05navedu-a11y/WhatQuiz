import { useLayoutEffect, useRef } from 'react';
import type { LeaderboardEntry } from '../../../shared/types';
import { formatNumber } from '../lib/format';

interface LeaderboardProps {
  entries: LeaderboardEntry[];
  highlightId?: string;
  limit?: number;
}

/**
 * Classement animé (technique FLIP) : chaque ligne glisse de son ancienne position
 * vers la nouvelle, uniquement avec `transform` (fluide même sur une tablette modeste).
 */
export function Leaderboard({ entries, highlightId, limit = 10 }: LeaderboardProps) {
  const listRef = useRef<HTMLOListElement>(null);
  const positions = useRef(new Map<string, number>());

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const next = new Map<string, number>();
    for (const row of list.querySelectorAll<HTMLElement>('[data-id]')) {
      const id = row.dataset.id!;
      const top = row.offsetTop;
      next.set(id, top);
      const previous = positions.current.get(id);
      if (previous !== undefined && previous !== top) {
        row.animate([{ transform: `translateY(${previous - top}px)` }, { transform: 'none' }], {
          duration: 600,
          easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
        });
      }
    }
    positions.current = next;
  }, [entries]);

  return (
    <ol className="leaderboard" ref={listRef} aria-label="Classement">
      {entries.slice(0, limit).map((entry) => {
        const moved = entry.previousRank !== null ? entry.previousRank - entry.rank : 0;
        return (
          <li key={entry.playerId} data-id={entry.playerId} className={entry.playerId === highlightId ? 'me' : undefined}>
            <span className={`lb-rank rank-${entry.rank}`}>{entry.rank}</span>
            <span className="lb-name">{entry.nickname}</span>
            {moved > 0 && (
              <span className="lb-move up" aria-label={`gagne ${moved} place${moved > 1 ? 's' : ''}`}>
                ▲ {moved}
              </span>
            )}
            <span className="lb-score">{formatNumber(entry.score)}</span>
          </li>
        );
      })}
    </ol>
  );
}

export function Podium({ entries }: { entries: LeaderboardEntry[] }) {
  const order = [entries[1], entries[0], entries[2]];
  return (
    <div className="podium" aria-label="Podium">
      {order.map((entry, index) =>
        entry ? (
          <div key={entry.playerId} className={`podium-step step-${entry.rank}`} style={{ animationDelay: `${[0.3, 0.6, 0][index]}s` }}>
            <span className="podium-name">{entry.nickname}</span>
            <span className="podium-score">{formatNumber(entry.score)}</span>
            <span className="podium-block">{entry.rank}</span>
          </div>
        ) : (
          <div key={`empty-${index}`} className="podium-step empty" />
        ),
      )}
    </div>
  );
}
