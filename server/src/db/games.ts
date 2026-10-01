import type {
  DashboardStats,
  GameResults,
  GameSettings,
  GameSummary,
  PlayerResultRow,
  QuestionInput,
  QuestionStat,
  StudentHistoryEntry,
  SubmittedAnswer,
} from '../../../shared/types';
import { isScored } from '../../../shared/questionTypes';
import type { Database } from './database';

export interface QuizSnapshot {
  quizId: number;
  title: string;
  questions: QuestionInput[];
}

interface GameRow {
  id: string;
  code: string;
  quiz_id: number | null;
  host_id: number;
  quiz_title: string;
  quiz_snapshot: string;
  settings: string;
  status: GameSummary['status'];
  questions_played: number;
  created_at: string;
  ended_at: string | null;
  player_count: number;
  correct_total: number | null;
}

export interface FinalPlayerResult {
  playerId: string;
  rank: number;
  score: number;
  correctCount: number;
  answeredCount: number;
  avgResponseMs: number | null;
}

const SUMMARY_SELECT = `
  SELECT g.*,
    (SELECT COUNT(*) FROM players p WHERE p.game_id = g.id AND p.kicked = 0) AS player_count,
    (SELECT SUM(r.correct_count) FROM game_results r WHERE r.game_id = g.id) AS correct_total
  FROM game_sessions g`;

/** Questions jouées qui ont une bonne réponse (les sondages ne comptent pas dans le taux de réussite). */
export function scoredQuestionCount(snapshot: QuizSnapshot, played: number): number {
  return snapshot.questions.slice(0, played).filter(isScored).length;
}

function parseSnapshot(raw: string): QuizSnapshot {
  return JSON.parse(raw) as QuizSnapshot;
}

function toSummary(row: GameRow): GameSummary {
  const possible = row.player_count * scoredQuestionCount(parseSnapshot(row.quiz_snapshot), row.questions_played);
  return {
    id: row.id,
    code: row.code,
    quizId: row.quiz_id,
    quizTitle: row.quiz_title,
    status: row.status,
    playerCount: row.player_count,
    questionCount: row.questions_played,
    successRate: row.status === 'ended' && possible > 0 ? (row.correct_total ?? 0) / possible : null,
    createdAt: row.created_at,
    endedAt: row.ended_at,
  };
}

/** Persistance des parties en direct (les parties de test ne sont jamais enregistrées). */
export class GameRepository {
  constructor(private readonly db: Database) {}

  create(input: { id: string; code: string; hostId: number; snapshot: QuizSnapshot; settings: GameSettings }): void {
    this.db.run(
      `INSERT INTO game_sessions (id, code, quiz_id, host_id, quiz_title, quiz_snapshot, settings, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'lobby')`,
      input.id,
      input.code,
      input.snapshot.quizId,
      input.hostId,
      input.snapshot.title,
      JSON.stringify(input.snapshot),
      JSON.stringify(input.settings),
    );
  }

  markStarted(id: string, settings: GameSettings): void {
    this.db.run(
      `UPDATE game_sessions SET status = 'running', settings = ?, started_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`,
      JSON.stringify(settings),
      id,
    );
  }

  addPlayer(input: { id: string; gameId: string; nickname: string; userId: number | null }): void {
    this.db.run(
      'INSERT INTO players (id, game_id, user_id, nickname) VALUES (?, ?, ?, ?)',
      input.id,
      input.gameId,
      input.userId,
      input.nickname,
    );
  }

  markKicked(playerId: string): void {
    this.db.run('UPDATE players SET kicked = 1 WHERE id = ?', playerId);
  }

  saveAnswer(input: {
    gameId: string;
    playerId: string;
    questionIndex: number;
    answer: SubmittedAnswer;
    correct: boolean;
    points: number;
    responseMs: number;
  }): void {
    this.db.run(
      `INSERT INTO player_answers (game_id, player_id, question_index, answer, is_correct, points, response_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (player_id, question_index) DO UPDATE SET
         answer = excluded.answer, is_correct = excluded.is_correct, points = excluded.points,
         response_ms = excluded.response_ms, answered_at = excluded.answered_at`,
      input.gameId,
      input.playerId,
      input.questionIndex,
      JSON.stringify(input.answer),
      input.correct ? 1 : 0,
      input.points,
      input.responseMs,
    );
  }

  finish(gameId: string, questionsPlayed: number, results: FinalPlayerResult[], scores: Map<string, number>): void {
    this.db.transaction(() => {
      this.db.run(
        `UPDATE game_sessions SET status = 'ended', questions_played = ?,
           ended_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`,
        questionsPlayed,
        gameId,
      );
      for (const [playerId, score] of scores) this.db.run('UPDATE players SET score = ? WHERE id = ?', score, playerId);
      for (const r of results) {
        this.db.run(
          `INSERT OR REPLACE INTO game_results (game_id, player_id, rank, score, correct_count, answered_count, avg_response_ms)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          gameId,
          r.playerId,
          r.rank,
          r.score,
          r.correctCount,
          r.answeredCount,
          r.avgResponseMs,
        );
      }
    });
  }

  setResultsVisible(gameId: string, visible: boolean): void {
    this.db.run('UPDATE game_sessions SET results_visible = ? WHERE id = ?', visible ? 1 : 0, gameId);
  }

  abort(gameId: string): void {
    this.db.run(
      `UPDATE game_sessions SET status = 'aborted', ended_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`,
      gameId,
    );
  }

  /** Au démarrage du serveur, les parties restées ouvertes ne peuvent plus être reprises. */
  abortUnfinished(): void {
    this.db.run(
      `UPDATE game_sessions SET status = 'aborted', ended_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE status IN ('lobby', 'running')`,
    );
  }

  findOwner(gameId: string): number | undefined {
    return this.db.get<{ host_id: number }>('SELECT host_id FROM game_sessions WHERE id = ?', gameId)?.host_id;
  }

  listByHost(hostId: number, limit = 50): GameSummary[] {
    return this.db
      .all<GameRow>(`${SUMMARY_SELECT} WHERE g.host_id = ? AND g.status != 'lobby' ORDER BY g.created_at DESC LIMIT ?`, hostId, limit)
      .map(toSummary);
  }

  delete(gameId: string): void {
    this.db.run('DELETE FROM game_sessions WHERE id = ?', gameId);
  }

  dashboardStats(hostId: number, quizCount: number): DashboardStats {
    const totals = this.db.get<{ games: number; players: number }>(
      `SELECT COUNT(*) AS games,
         COALESCE(SUM((SELECT COUNT(*) FROM players p WHERE p.game_id = g.id AND p.kicked = 0)), 0) AS players
       FROM game_sessions g WHERE g.host_id = ? AND g.status = 'ended'`,
      hostId,
    );
    const ended = this.db
      .all<GameRow>(`${SUMMARY_SELECT} WHERE g.host_id = ? AND g.status = 'ended'`, hostId)
      .map(toSummary)
      .filter((game) => game.successRate !== null);
    const avgSuccessRate = ended.length ? ended.reduce((sum, game) => sum + (game.successRate ?? 0), 0) / ended.length : null;
    return {
      quizCount,
      gameCount: totals?.games ?? 0,
      playerCount: totals?.players ?? 0,
      avgSuccessRate,
      recentGames: this.listByHost(hostId, 5),
    };
  }

  results(gameId: string): GameResults | undefined {
    const row = this.db.get<GameRow>(`${SUMMARY_SELECT} WHERE g.id = ?`, gameId);
    if (!row) return undefined;
    const game = toSummary(row);
    const snapshot = JSON.parse(row.quiz_snapshot) as QuizSnapshot;

    const players = this.db
      .all<{
        player_id: string;
        nickname: string;
        rank: number;
        score: number;
        correct_count: number;
        answered_count: number;
        avg_response_ms: number | null;
      }>(
        `SELECT r.*, p.nickname FROM game_results r JOIN players p ON p.id = r.player_id
         WHERE r.game_id = ? ORDER BY r.rank, p.nickname`,
        gameId,
      )
      .map<PlayerResultRow>((r) => ({
        playerId: r.player_id,
        nickname: r.nickname,
        rank: r.rank,
        score: r.score,
        correctCount: r.correct_count,
        answeredCount: r.answered_count,
        avgResponseMs: r.avg_response_ms,
      }));

    const perQuestion = this.db.all<{ question_index: number; answered: number; correct: number; avg_ms: number | null }>(
      `SELECT pa.question_index, COUNT(*) AS answered, SUM(pa.is_correct) AS correct, AVG(pa.response_ms) AS avg_ms
       FROM player_answers pa JOIN players p ON p.id = pa.player_id
       WHERE pa.game_id = ? AND p.kicked = 0 GROUP BY pa.question_index`,
      gameId,
    );
    const playerCount = players.length;
    const questions: QuestionStat[] = snapshot.questions.slice(0, row.questions_played).map((question, index) => {
      const stat = perQuestion.find((q) => q.question_index === index);
      const correctCount = stat?.correct ?? 0;
      return {
        index,
        text: question.text,
        type: question.type,
        scored: isScored(question),
        answeredCount: stat?.answered ?? 0,
        correctCount,
        successRate: playerCount ? correctCount / playerCount : 0,
        avgResponseMs: stat?.avg_ms != null ? Math.round(stat.avg_ms) : null,
      };
    });

    const answerCount = questions.reduce((sum, q) => sum + q.answeredCount, 0);
    const timed = perQuestion.filter((q) => q.avg_ms != null);
    const totalMs = timed.reduce((sum, q) => sum + (q.avg_ms ?? 0) * q.answered, 0);
    const timedCount = timed.reduce((sum, q) => sum + q.answered, 0);
    const sorted = questions.filter((q) => q.scored).sort((a, b) => a.successRate - b.successRate);

    return {
      game,
      settings: JSON.parse(row.settings) as GameSettings,
      players,
      questions,
      totals: {
        successRate: game.successRate ?? 0,
        answerCount,
        avgResponseMs: timedCount ? Math.round(totalMs / timedCount) : null,
        hardest: sorted[0] ?? null,
        easiest: sorted.length > 1 ? sorted[sorted.length - 1] : null,
      },
    };
  }

  studentHistory(userId: number): StudentHistoryEntry[] {
    return this.db
      .all<{
        game_id: string;
        quiz_title: string;
        nickname: string;
        rank: number | null;
        score: number | null;
        player_count: number;
        ended_at: string | null;
      }>(
        `SELECT g.id AS game_id, g.quiz_title, p.nickname, g.ended_at,
           CASE WHEN g.results_visible = 1 THEN r.rank END AS rank,
           CASE WHEN g.results_visible = 1 THEN p.score END AS score,
           (SELECT COUNT(*) FROM players x WHERE x.game_id = g.id AND x.kicked = 0) AS player_count
         FROM players p JOIN game_sessions g ON g.id = p.game_id
         LEFT JOIN game_results r ON r.player_id = p.id
         WHERE p.user_id = ? AND p.kicked = 0 AND g.status = 'ended'
         ORDER BY g.ended_at DESC LIMIT 50`,
        userId,
      )
      .map((r) => ({
        gameId: r.game_id,
        quizTitle: r.quiz_title,
        nickname: r.nickname,
        rank: r.rank,
        score: r.score,
        playerCount: r.player_count,
        endedAt: r.ended_at,
      }));
  }
}
