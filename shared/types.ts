import type { QuestionType } from './constants';

export type { QuestionType } from './constants';

/* ───────────── Comptes ───────────── */

export type Role = 'teacher' | 'student';

export interface PublicUser {
  id: number;
  email: string;
  displayName: string;
  role: Role;
  isDemo: boolean;
  isAdmin: boolean;
  createdAt: string;
}

export interface AdminUserRow {
  id: number;
  email: string;
  displayName: string;
  role: Role;
  isDemo: boolean;
  isAdmin: boolean;
  createdAt: string;
  quizCount: number;
  gameCount: number;
}

/* ───────────── Quiz ───────────── */

export interface AnswerInput {
  text: string;
  isCorrect: boolean;
}

export interface QuestionInput {
  type: QuestionType;
  text: string;
  imageUrl: string | null;
  timeLimit: number;
  points: number;
  pointsEnabled: boolean;
  /** Choix proposés (QCM, Vrai/Faux) ou réponses acceptées (texte). */
  answers: AnswerInput[];
}

export interface QuizInput {
  title: string;
  description: string;
  imageUrl: string | null;
  category: string;
  questions: QuestionInput[];
}

export interface Question extends QuestionInput {
  id: number;
  position: number;
}

export interface Quiz extends Omit<QuizInput, 'questions'> {
  id: number;
  ownerId: number;
  questions: Question[];
  createdAt: string;
  updatedAt: string;
}

export interface QuizSummary {
  id: number;
  title: string;
  description: string;
  category: string;
  imageUrl: string | null;
  questionCount: number;
  gameCount: number;
  createdAt: string;
  updatedAt: string;
}

/* ───────────── Parties ───────────── */

export type ScoringMode = 'speed' | 'fixed' | 'none';

export interface GameSettings {
  scoringMode: ScoringMode;
  /** L'élève peut modifier sa réponse tant que le temps n'est pas écoulé. */
  allowAnswerChange: boolean;
  /** Le professeur peut revenir à la question précédente. */
  allowBack: boolean;
  /** La question se termine dès que tous les joueurs ont répondu. */
  endWhenAllAnswered: boolean;
  /** La correction est montrée aux élèves automatiquement en fin de question. */
  autoRevealAnswers: boolean;
  /** La partie avance toute seule (correction, classement, question suivante). */
  autoAdvance: boolean;
  maxPlayers: number;
}

export type GamePhase = 'lobby' | 'ready' | 'question' | 'reveal' | 'ended';

export type SubmittedAnswer = { kind: 'choice'; choices: number[] } | { kind: 'text'; text: string };

export interface PublicQuestion {
  index: number;
  total: number;
  type: QuestionType;
  text: string;
  imageUrl: string | null;
  /** Textes des choix (vide pour une réponse texte). Jamais la bonne réponse. */
  choices: string[];
  timeLimit: number;
  points: number;
  pointsEnabled: boolean;
}

export interface HostQuestion extends PublicQuestion {
  correctChoices: number[];
  acceptedAnswers: string[];
}

export interface TimerState {
  /** Horodatage serveur de fin (null si en pause ou terminé). */
  endsAt: number | null;
  remainingMs: number;
  durationMs: number;
  paused: boolean;
  /** Heure serveur au moment de l'envoi : permet au client de corriger son décalage d'horloge. */
  serverNow: number;
}

export interface Correction {
  correctChoices: number[];
  acceptedAnswers: string[];
}

export interface QuestionOutcome {
  answered: boolean;
  correct: boolean;
  points: number;
}

export interface LeaderboardEntry {
  playerId: string;
  nickname: string;
  score: number;
  rank: number;
  previousRank: number | null;
}

export interface PlayerView {
  code: string;
  quizTitle: string;
  phase: GamePhase;
  isTest: boolean;
  allowAnswerChange: boolean;
  /** Score et rang « révélés » : ils n'évoluent qu'une fois la correction ou le classement affichés. */
  me: { id: string; nickname: string; score: number; rank: number | null };
  playerCount: number;
  questionIndex: number;
  questionCount: number;
  question: PublicQuestion | null;
  timer: TimerState | null;
  myAnswer: SubmittedAnswer | null;
  answersVisible: boolean;
  correction: Correction | null;
  outcome: QuestionOutcome | null;
  leaderboard: LeaderboardEntry[] | null;
  final: { rank: number; score: number; playerCount: number; podium: LeaderboardEntry[] } | null;
}

export interface HostPlayer {
  id: string;
  nickname: string;
  score: number;
  connected: boolean;
  answered: boolean;
  isBot: boolean;
}

export interface TextAnswerStat {
  text: string;
  count: number;
  correct: boolean;
}

export interface HostView {
  gameId: string;
  code: string;
  quizId: number;
  quizTitle: string;
  phase: GamePhase;
  isTest: boolean;
  locked: boolean;
  settings: GameSettings;
  players: HostPlayer[];
  questionIndex: number;
  questionCount: number;
  question: HostQuestion | null;
  timer: TimerState | null;
  answeredCount: number;
  distribution: number[] | null;
  textAnswers: TextAnswerStat[] | null;
  correctCount: number | null;
  answersVisible: boolean;
  leaderboardVisible: boolean;
  resultsVisible: boolean;
  leaderboard: LeaderboardEntry[];
  canGoBack: boolean;
}

export type HostAction =
  | { type: 'start' }
  | { type: 'startQuestion' }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'endQuestion' }
  | { type: 'next' }
  | { type: 'previous' }
  | { type: 'setAnswersVisible'; value: boolean }
  | { type: 'setLeaderboardVisible'; value: boolean }
  | { type: 'setResultsVisible'; value: boolean }
  | { type: 'setLocked'; value: boolean }
  | { type: 'kick'; playerId: string }
  | { type: 'updateSettings'; settings: Partial<GameSettings> }
  | { type: 'addBots'; count: number }
  | { type: 'end' };

export type AckResult<T extends object = object> = ({ ok: true } & T) | { ok: false; error: string };

export interface ClientToServerEvents {
  'game:join': (
    payload: { code: string; nickname: string; token?: string },
    ack: (result: AckResult<{ playerId: string; token: string }>) => void,
  ) => void;
  'game:answer': (payload: { questionIndex: number; answer: SubmittedAnswer }, ack: (result: AckResult) => void) => void;
  'game:leave': () => void;
  'host:join': (payload: { code: string }, ack: (result: AckResult) => void) => void;
  'host:action': (action: HostAction, ack: (result: AckResult) => void) => void;
}

export interface ServerToClientEvents {
  'game:state': (view: PlayerView) => void;
  'host:state': (view: HostView) => void;
  'game:kicked': () => void;
  'game:closed': (payload: { reason: string }) => void;
}

/* ───────────── Résultats / statistiques ───────────── */

export interface GameSummary {
  id: string;
  code: string;
  quizId: number | null;
  quizTitle: string;
  status: 'lobby' | 'running' | 'ended' | 'aborted';
  playerCount: number;
  questionCount: number;
  successRate: number | null;
  createdAt: string;
  endedAt: string | null;
}

export interface PlayerResultRow {
  playerId: string;
  nickname: string;
  rank: number;
  score: number;
  correctCount: number;
  answeredCount: number;
  avgResponseMs: number | null;
}

export interface QuestionStat {
  index: number;
  text: string;
  type: QuestionType;
  answeredCount: number;
  correctCount: number;
  successRate: number;
  avgResponseMs: number | null;
}

export interface GameResults {
  game: GameSummary;
  settings: GameSettings;
  players: PlayerResultRow[];
  questions: QuestionStat[];
  totals: {
    successRate: number;
    answerCount: number;
    avgResponseMs: number | null;
    hardest: QuestionStat | null;
    easiest: QuestionStat | null;
  };
}

export interface DashboardStats {
  quizCount: number;
  gameCount: number;
  playerCount: number;
  avgSuccessRate: number | null;
  recentGames: GameSummary[];
}

export interface StudentHistoryEntry {
  gameId: string;
  quizTitle: string;
  nickname: string;
  /** Rang et score ne sont connus que si le professeur a affiché les résultats. */
  rank: number | null;
  score: number | null;
  playerCount: number;
  endedAt: string | null;
}
