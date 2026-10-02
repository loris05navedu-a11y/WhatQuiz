import type { PresenceEvent, PresenceInfo, PresenceReport } from './presence';
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
  /** Association : élément à relier à `text`. */
  match?: string;
}

export type MediaKind = 'image' | 'audio' | 'video';

/** Média joint à une question (en plus de l'image principale `imageUrl`). */
export interface MediaItem {
  kind: MediaKind;
  url: string;
}

/** Réglages propres à certains types (réponse numérique, curseur). */
export interface QuestionConfig {
  answer?: number;
  /** Écart accepté autour de la réponse (0 = valeur exacte). */
  tolerance?: number;
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
}

export interface QuestionInput {
  type: QuestionType;
  text: string;
  imageUrl: string | null;
  timeLimit: number;
  points: number;
  pointsEnabled: boolean;
  /**
   * Choix proposés (QCM, Vrai/Faux, sondage), réponses acceptées (texte), éléments dans le bon ordre
   * (ordre, classement) ou paires (association : `text` ↔ `match`).
   */
  answers: AnswerInput[];
  /** Explication affichée avec la correction. */
  explanation?: string;
  /** Question bonus : points doublés. */
  bonus?: boolean;
  /** Images supplémentaires, audio, vidéo. */
  media?: MediaItem[];
  config?: QuestionConfig;
}

export type QuizStatus = 'draft' | 'published';
/** private : seul l'auteur ; code : quiconque connaît le code d'accès ; public : bibliothèque des professeurs. */
export type QuizVisibility = 'private' | 'code' | 'public';
export type Difficulty = 'easy' | 'medium' | 'hard';

export interface QuizInput {
  title: string;
  description: string;
  imageUrl: string | null;
  category: string;
  questions: QuestionInput[];
  /** Brouillon : peut être incomplet, n'apparaît ni dans la bibliothèque ni dans les devoirs. */
  status?: QuizStatus;
  visibility?: QuizVisibility;
  subcategory?: string;
  tags?: string[];
  difficulty?: Difficulty | null;
  /** Niveau scolaire (ex. « 2nde »). */
  level?: string;
}

export interface Question extends QuestionInput {
  id: number;
  position: number;
}

export interface QuizMeta {
  status: QuizStatus;
  visibility: QuizVisibility;
  /** Code d'accès (6 caractères sans ambiguïté), attribué quand le quiz est partagé. */
  accessCode: string | null;
  subcategory: string;
  tags: string[];
  difficulty: Difficulty | null;
  level: string;
}

export interface Quiz extends Omit<QuizInput, 'questions' | keyof QuizMeta>, QuizMeta {
  id: number;
  ownerId: number;
  questions: Question[];
  createdAt: string;
  updatedAt: string;
}

export interface QuizSummary extends QuizMeta {
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

/** Version enregistrée d'un quiz (historique des modifications). */
export interface QuizVersionSummary {
  id: string;
  quizId: number;
  createdAt: string;
  title: string;
  questionCount: number;
  reason: 'save' | 'autosave' | 'restore';
}

/* ───────────── Banque de questions ───────────── */
export interface BankFolder {
  id: string;
  name: string;
  /** Dossier parent (null : à la racine). */
  parentId: string | null;
  createdAt: string;
}

export interface BankQuestion {
  id: string;
  question: QuestionInput;
  folderId: string | null;
  tags: string[];
  difficulty: Difficulty | null;
  /** Titre du quiz d'origine, si la question en vient. */
  source: string;
  /** Nombre de fois où la question a été ajoutée à un quiz. */
  usage: number;
  createdAt: string;
  updatedAt: string;
}

/** Champs modifiables d'une question de la banque. */
export interface BankQuestionPatch {
  question?: QuestionInput;
  folderId?: string | null;
  tags?: string[];
  difficulty?: Difficulty | null;
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
  /** Surveillance de présence : le professeur est prévenu quand un élève quitte la page ou l'application. */
  presenceWatch: boolean;
  /** Application Android : demander l'épinglage de l'écran pendant la partie (l'élève ne peut plus en sortir). */
  pinApp: boolean;
}

export type GamePhase = 'lobby' | 'ready' | 'question' | 'reveal' | 'ended';

/**
 * Réponse envoyée par un élève. Les indices se rapportent à l'ordre affiché à l'élève (`PublicQuestion`),
 * le serveur les reconvertit avant de corriger.
 */
export type SubmittedAnswer =
  | { kind: 'choice'; choices: number[] }
  | { kind: 'text'; text: string }
  | { kind: 'number'; value: number }
  | { kind: 'order'; order: number[] }
  | { kind: 'match'; pairs: number[] };

export interface PublicQuestion {
  index: number;
  total: number;
  type: QuestionType;
  text: string;
  imageUrl: string | null;
  /** Choix, éléments à ordonner (mélangés) ou éléments de gauche d'une association. Jamais la bonne réponse. */
  choices: string[];
  /** Association : éléments de droite, mélangés. */
  options?: string[];
  /** Curseur : bornes et pas. */
  range?: { min: number; max: number; step: number };
  unit?: string;
  timeLimit: number;
  points: number;
  pointsEnabled: boolean;
  bonus?: boolean;
  media?: MediaItem[];
  /** Faux pour les sondages, nuages de mots et classements : pas de bonne réponse. */
  scored?: boolean;
}

export interface HostQuestion extends PublicQuestion, Correction {}

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
  /** Ordre : indices affichés, dans le bon ordre. */
  correctOrder?: number[];
  /** Association : pour chaque élément de gauche, l'indice de l'option de droite attendue. */
  correctPairs?: number[];
  /** Numérique / curseur. */
  correctValue?: { answer: number; tolerance: number };
  explanation?: string;
}

export interface QuestionOutcome {
  answered: boolean;
  correct: boolean;
  points: number;
  /** Faux pour une question sans bonne réponse (sondage…). */
  scored?: boolean;
  /** Part de la réponse juste (ordre, association), de 0 à 1. */
  ratio?: number;
}

/** Statistiques en direct d'une question, selon son type. */
export type QuestionStats =
  | { kind: 'choices'; counts: number[] }
  | { kind: 'texts'; items: TextAnswerStat[] }
  | { kind: 'numbers'; items: { value: number; count: number; correct: boolean }[]; average: number | null }
  | { kind: 'order'; averagePositions: (number | null)[]; correctRates: number[] }
  | { kind: 'match'; correctRates: number[] };

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
  /** Surveillance de présence (null : désactivée). */
  presence: { pinApp: boolean; exits: number; awayMs: number } | null;
}

export interface HostPlayer {
  id: string;
  nickname: string;
  score: number;
  connected: boolean;
  answered: boolean;
  isBot: boolean;
  presence: PresenceInfo;
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
  stats: QuestionStats | null;
  answersVisible: boolean;
  leaderboardVisible: boolean;
  resultsVisible: boolean;
  leaderboard: LeaderboardEntry[];
  canGoBack: boolean;
  /** Journal de surveillance (sorties et retours des élèves), du plus ancien au plus récent. */
  presenceLog: PresenceEvent[];
  /** Heure de l'hôte au moment de l'envoi (pour afficher les durées en direct). */
  serverNow: number;
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
  'game:react': (payload: { emoji: string }) => void;
  'game:presence': (report: PresenceReport) => void;
  'host:join': (payload: { code: string }, ack: (result: AckResult) => void) => void;
  'host:action': (action: HostAction, ack: (result: AckResult) => void) => void;
}

export interface ServerToClientEvents {
  'game:state': (view: PlayerView) => void;
  'host:state': (view: HostView) => void;
  'game:kicked': () => void;
  'host:reaction': (payload: { emoji: string; nickname: string }) => void;
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
  /** Sorties de la partie et temps passé dehors (surveillance de présence). */
  exits: number;
  awayMs: number;
}

export interface QuestionStat {
  index: number;
  text: string;
  type: QuestionType;
  /** Faux pour une question sans bonne réponse (exclue du taux de réussite). */
  scored: boolean;
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
  presenceLog: PresenceEvent[];
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
