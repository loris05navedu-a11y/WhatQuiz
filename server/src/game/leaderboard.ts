import type { LeaderboardEntry } from '../../../shared/types';

export interface RankablePlayer {
  id: string;
  nickname: string;
  score: number;
}

/** Classement avec ex-aequo (même score ⇒ même rang), trié ensuite par pseudo. */
export function rankPlayers<T extends RankablePlayer>(
  players: Iterable<T>,
  scoreOf: (player: T) => number = (player) => player.score,
): { player: T; score: number; rank: number }[] {
  const sorted = [...players]
    .map((player) => ({ player, score: scoreOf(player) }))
    .sort((a, b) => b.score - a.score || a.player.nickname.localeCompare(b.player.nickname, 'fr'));
  let rank = 0;
  return sorted.map((entry, index) => {
    if (index === 0 || entry.score !== sorted[index - 1].score) rank = index + 1;
    return { ...entry, rank };
  });
}

export function toLeaderboard<T extends RankablePlayer>(
  ranked: { player: T; score: number; rank: number }[],
  previousRanks: Map<string, number>,
): LeaderboardEntry[] {
  return ranked.map(({ player, score, rank }) => ({
    playerId: player.id,
    nickname: player.nickname,
    score,
    rank,
    previousRank: previousRanks.get(player.id) ?? null,
  }));
}
