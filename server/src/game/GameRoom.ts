import { ERRORS, LIMITS } from '../../../shared/constants';
import {
  PRESENCE_BEAT_MS,
  PRESENCE_LOG_LIMIT,
  PRESENCE_SEVERITY,
  PRESENCE_SILENT_MS,
  PRESENCE_SILENT_RELAY_MS,
  RELAY_BEAT_MS,
  stateForReason,
  type AwayReason,
  type PresenceEvent,
  type PresenceInfo,
  type PresenceReport,
} from '../../../shared/presence';
import { randomToken, randomUuid } from '../../../shared/random';
import { questionType, type QuestionLayout } from '../../../shared/questionTypes';
import { pointsForGrade } from '../../../shared/scoring';
import { normalizeText } from '../../../shared/text';
import type {
  Correction,
  GamePhase,
  GameSettings,
  HostAction,
  HostQuestion,
  HostView,
  PlayerView,
  PublicQuestion,
  QuestionInput,
  SubmittedAnswer,
  TimerState,
} from '../../../shared/types';
import type { GameRepository, QuizSnapshot } from '../db/games';
import { pickBotAnswer, pickBotDelay, pickBotNames } from './bots';
import { GameError } from './errors';
import { rankPlayers, toLeaderboard } from './leaderboard';

type Timer = ReturnType<typeof setTimeout>;

/** Délais du mode « avance automatique » (mode test élève notamment). */
export const AUTO_DELAYS = { ready: 3000, reveal: 4000, leaderboard: 4000 };
/** Un joueur déconnecté dans le lobby est retiré après ce délai. */
const LOBBY_DISCONNECT_GRACE_MS = 20_000;
/** Regroupe les mises à jour « réponse reçue » envoyées au professeur. */
const HOST_THROTTLE_MS = 150;

export type RoomStore = Pick<
  GameRepository,
  'markStarted' | 'addPlayer' | 'markKicked' | 'saveAnswer' | 'finish' | 'abort' | 'setResultsVisible'
>;

export interface RoomTransport {
  sendHost(room: GameRoom): void;
  sendPlayer(room: GameRoom, player: RoomPlayer): void;
  kicked(room: GameRoom, player: RoomPlayer): void;
}

interface RecordedAnswer {
  /** Réponse de référence (ordre d'origine de la question). */
  answer: SubmittedAnswer;
  correct: boolean;
  /** Part juste de la réponse (crédit partiel). */
  ratio: number;
  points: number;
  responseMs: number;
}

export interface RoomPlayer {
  id: string;
  token: string;
  nickname: string;
  userId: number | null;
  isBot: boolean;
  socketId: string | null;
  /** Score réel (autorité serveur). */
  score: number;
  /** Score montré à l'élève, mis à jour uniquement quand la correction/le classement sont révélés. */
  revealedScore: number;
  answers: Map<number, RecordedAnswer>;
  disconnectTimer: Timer | null;
  presence: PlayerPresence;
  /** Relié par le relais en ligne : signes de vie espacés (voir RELAY_BEAT_MS). */
  slowLink: boolean;
}

/** Présence d'un élève, tenue par l'hôte : dernier signe de vie reçu (horloge de l'hôte). */
interface PlayerPresence extends PresenceInfo {
  lastBeat: number;
}

/** Fréquence de vérification des signes de vie pendant la partie. */
const PRESENCE_CHECK_MS = 1_000;
/** Délai d'acheminement déduit au plus du temps de réponse (liaisons lentes). */
const MAX_LAG_COMPENSATION_MS = 2_000;
/** Événements de surveillance envoyés à l'écran du professeur (le journal complet est enregistré à la fin). */
const PRESENCE_LOG_IN_VIEW = 80;

export interface RoomOptions {
  id: string;
  code: string;
  hostUserId: number;
  snapshot: QuizSnapshot;
  settings: GameSettings;
  isTest: boolean;
  /** Démarre dès l'arrivée du premier joueur (test en mode élève). */
  autoStartOnJoin?: boolean;
  /** Élèves fictifs autorisés (parties de test et comptes démo uniquement). */
  allowBots?: boolean;
  store: RoomStore | null;
  transport: RoomTransport;
}

export class GameRoom {
  readonly id: string;
  readonly code: string;
  readonly hostUserId: number;
  readonly isTest: boolean;
  readonly allowBots: boolean;
  readonly players = new Map<string, RoomPlayer>();
  settings: GameSettings;
  phase: GamePhase = 'lobby';
  questionIndex = -1;
  locked = false;
  paused = false;
  answersVisible = false;
  leaderboardVisible = false;
  resultsVisible = false;
  lastActivity = Date.now();
  endedAt: number | null = null;

  private readonly snapshot: QuizSnapshot;
  private readonly layouts: QuestionLayout[];
  private readonly store: RoomStore | null;
  private readonly transport: RoomTransport;
  private readonly autoStartOnJoin: boolean;
  private readonly kickedTokens = new Set<string>();
  private previousRanks = new Map<string, number>();
  private maxPlayedIndex = -1;

  private endsAt: number | null = null;
  private remainingMs = 0;
  private openedAt = 0;
  private pausedAt = 0;
  private pausedTotal = 0;
  private questionTimer: Timer | null = null;
  private autoTimer: Timer | null = null;
  private readonly botTimers = new Set<Timer>();

  private readonly presenceLog: PresenceEvent[] = [];
  private presenceSeq = 0;
  private presenceTimer: ReturnType<typeof setInterval> | null = null;
  private watchActive = false;

  private dirtyHost = false;
  private dirtyPlayers: Set<string> | 'all' = new Set();
  private flushScheduled = false;
  private hostThrottle: Timer | null = null;

  constructor(options: RoomOptions) {
    this.id = options.id;
    this.code = options.code;
    this.hostUserId = options.hostUserId;
    this.snapshot = options.snapshot;
    this.settings = options.settings;
    this.isTest = options.isTest;
    this.allowBots = options.allowBots ?? options.isTest;
    this.store = options.store;
    this.transport = options.transport;
    this.autoStartOnJoin = options.autoStartOnJoin ?? false;
    // Ordre de présentation tiré une fois par partie (identique pour tous les joueurs).
    this.layouts = this.snapshot.questions.map((q) => questionType(q.type).layout(q, Math.random, false));
  }

  get quizId(): number {
    return this.snapshot.quizId;
  }

  /** Le média fait partie de ce quiz (seuls ceux-là peuvent être transmis aux joueurs). */
  usesMedia(url: string): boolean {
    return this.snapshot.questions.some((q) => q.imageUrl === url || (q.media ?? []).some((m) => m.url === url));
  }

  get quizTitle(): string {
    return this.snapshot.title;
  }

  get questionCount(): number {
    return this.snapshot.questions.length;
  }

  private get currentQuestion(): QuestionInput | null {
    return this.snapshot.questions[this.questionIndex] ?? null;
  }

  private get activePlayers(): RoomPlayer[] {
    return [...this.players.values()];
  }

  /* ───────────── Joueurs ───────────── */

  join(input: { nickname: string; token?: string; userId: number | null; socketId: string; slowLink?: boolean }): RoomPlayer {
    this.touch();
    if (input.token && this.kickedTokens.has(input.token)) throw new GameError(ERRORS.kicked);
    const existing = input.token ? this.activePlayers.find((p) => p.token === input.token) : undefined;
    if (existing) {
      existing.slowLink = input.slowLink ?? false;
      return this.reconnect(existing, input.socketId);
    }

    if (this.phase === 'ended') throw new GameError(ERRORS.gameEnded);
    if (this.locked) throw new GameError(ERRORS.gameLocked);
    if (this.players.size >= this.settings.maxPlayers) throw new GameError(ERRORS.gameFull);
    const nickname = cleanNickname(input.nickname);
    if (!nickname) throw new GameError(ERRORS.nicknameInvalid);
    if (this.isNicknameTaken(nickname)) throw new GameError(ERRORS.nicknameTaken);

    const player = this.addPlayer({ nickname, userId: input.userId, isBot: false, socketId: input.socketId });
    player.slowLink = input.slowLink ?? false;
    if (this.autoStartOnJoin && this.phase === 'lobby') this.start();
    return player;
  }

  disconnect(socketId: string): void {
    const player = this.activePlayers.find((p) => p.socketId === socketId);
    if (!player) return;
    player.socketId = null;
    this.markAway(player, 'disconnected', Date.now());
    if (this.phase === 'lobby') {
      player.disconnectTimer = setTimeout(() => {
        if (!player.socketId && this.phase === 'lobby') this.removePlayer(player, false);
      }, LOBBY_DISCONNECT_GRACE_MS);
    }
    this.markDirty({ host: true });
    if (this.phase === 'question') this.checkAllAnswered();
  }

  leave(socketId: string): void {
    const player = this.activePlayers.find((p) => p.socketId === socketId);
    if (player) this.removePlayer(player, false);
  }

  findPlayerBySocket(socketId: string): RoomPlayer | undefined {
    return this.activePlayers.find((p) => p.socketId === socketId);
  }

  private reconnect(player: RoomPlayer, socketId: string): RoomPlayer {
    if (player.disconnectTimer) clearTimeout(player.disconnectTimer);
    player.disconnectTimer = null;
    player.socketId = socketId;
    this.markDirty({ host: true, players: [player.id] });
    return player;
  }

  private isNicknameTaken(nickname: string): boolean {
    const key = normalizeText(nickname);
    return this.activePlayers.some((p) => normalizeText(p.nickname) === key);
  }

  private addPlayer(input: { nickname: string; userId: number | null; isBot: boolean; socketId: string | null }): RoomPlayer {
    const player: RoomPlayer = {
      id: randomUuid(),
      token: randomToken(),
      nickname: input.nickname,
      userId: input.userId,
      isBot: input.isBot,
      socketId: input.socketId,
      score: 0,
      revealedScore: 0,
      answers: new Map(),
      disconnectTimer: null,
      presence: { state: 'present', reason: null, since: null, exits: 0, awayMs: 0, app: false, pinned: false, lastBeat: Date.now() },
      slowLink: false,
    };
    this.players.set(player.id, player);
    this.store?.addPlayer({ id: player.id, gameId: this.id, nickname: player.nickname, userId: player.userId });
    this.markDirty({ host: true, players: 'all' });
    return player;
  }

  private removePlayer(player: RoomPlayer, kicked: boolean): void {
    if (player.disconnectTimer) clearTimeout(player.disconnectTimer);
    this.players.delete(player.id);
    this.store?.markKicked(player.id);
    if (kicked) {
      this.kickedTokens.add(player.token);
      this.transport.kicked(this, player);
    }
    this.markDirty({ host: true, players: 'all' });
    if (this.phase === 'question') this.checkAllAnswered();
  }

  addBots(count: number): void {
    if (!this.allowBots) throw new GameError(ERRORS.forbidden);
    if (this.phase === 'ended') throw new GameError(ERRORS.gameEnded);
    const available = Math.min(count, this.settings.maxPlayers - this.players.size);
    const names = pickBotNames(available, (name) => this.isNicknameTaken(name));
    for (const nickname of names) this.addPlayer({ nickname, userId: null, isBot: true, socketId: null });
    if (this.phase === 'question') for (const bot of this.activePlayers.filter((p) => p.isBot)) this.scheduleBot(bot);
  }

  /* ───────────── Réponses ───────────── */

  /** `lagMs` : délai d'acheminement estimé de la liaison de l'élève, déduit de son temps de réponse. */
  answer(playerId: string, questionIndex: number, answer: SubmittedAnswer, lagMs = 0): void {
    const player = this.players.get(playerId);
    const question = this.currentQuestion;
    if (!player || !question) throw new GameError(ERRORS.notAccepting);
    if (questionIndex !== this.questionIndex) throw new GameError(ERRORS.notAccepting);
    if (this.phase !== 'question') throw new GameError(this.phase === 'reveal' ? ERRORS.timeUp : ERRORS.notAccepting);
    if (this.paused) throw new GameError(ERRORS.notAccepting);
    const now = Date.now();
    if (this.endsAt === null || now >= this.endsAt) throw new GameError(ERRORS.timeUp);
    if (player.answers.has(questionIndex) && !this.settings.allowAnswerChange) throw new GameError(ERRORS.alreadyAnswered);
    const definition = questionType(question.type);
    const accepted = definition.accept(answer, question, this.layouts[questionIndex]);
    if (!accepted) throw new GameError(ERRORS.invalidInput);

    const lag = Math.min(MAX_LAG_COMPENSATION_MS, Math.max(0, Number.isFinite(lagMs) ? lagMs : 0));
    const responseMs = Math.max(0, now - this.openedAt - this.pausedTotal - lag);
    const grade = definition.grade(question, accepted);
    const points = pointsForGrade(grade, {
      basePoints: question.points,
      pointsEnabled: question.pointsEnabled && definition.scored,
      bonus: question.bonus,
      mode: this.settings.scoringMode,
      responseMs,
      timeLimitMs: question.timeLimit * 1000,
    });
    const recorded: RecordedAnswer = { answer: accepted, correct: grade.correct, ratio: grade.ratio, points, responseMs };
    player.answers.set(questionIndex, recorded);
    this.store?.saveAnswer({ gameId: this.id, playerId, questionIndex, ...recorded });
    this.touch();
    this.markDirty({ host: true, players: [player.id] }, HOST_THROTTLE_MS);
    this.checkAllAnswered();
  }

  private checkAllAnswered(): void {
    if (this.phase !== 'question' || !this.settings.endWhenAllAnswered) return;
    const expected = this.activePlayers.filter((p) => p.isBot || p.socketId);
    if (expected.length === 0) return;
    if (expected.every((p) => p.answers.has(this.questionIndex))) this.endQuestion();
  }

  /* ───────────── Actions du professeur ───────────── */

  applyHostAction(action: HostAction): void {
    this.touch();
    switch (action.type) {
      case 'start':
        return this.start();
      case 'startQuestion':
        return this.startQuestion();
      case 'pause':
        return this.pause();
      case 'resume':
        return this.resume();
      case 'endQuestion':
        return this.endQuestion();
      case 'next':
        return this.next();
      case 'previous':
        return this.previous();
      case 'setAnswersVisible':
        return this.setAnswersVisible(action.value);
      case 'setLeaderboardVisible':
        return this.setLeaderboardVisible(action.value);
      case 'setResultsVisible':
        return this.setResultsVisible(action.value);
      case 'setLocked':
        this.locked = action.value;
        return this.markDirty({ host: true });
      case 'kick': {
        const player = this.players.get(action.playerId);
        if (player) this.removePlayer(player, true);
        return;
      }
      case 'updateSettings':
        return this.updateSettings(action.settings);
      case 'addBots':
        return this.addBots(action.count);
      case 'end':
        return this.end();
    }
  }

  start(): void {
    this.requirePhase('lobby');
    if (this.questionCount === 0) throw new GameError('Ce quiz ne contient aucune question');
    if (this.players.size === 0) throw new GameError('Attendez au moins un joueur pour démarrer');
    this.store?.markStarted(this.id, this.settings);
    this.goToReady(0);
    this.syncPresenceWatch();
  }

  startQuestion(): void {
    this.requirePhase('ready');
    const question = this.currentQuestion!;
    this.clearAuto();
    const now = Date.now();
    this.phase = 'question';
    this.paused = false;
    this.openedAt = now;
    this.pausedTotal = 0;
    this.remainingMs = question.timeLimit * 1000;
    this.endsAt = now + this.remainingMs;
    this.questionTimer = setTimeout(() => this.endQuestion(), this.remainingMs);
    this.maxPlayedIndex = Math.max(this.maxPlayedIndex, this.questionIndex);
    for (const bot of this.activePlayers.filter((p) => p.isBot)) this.scheduleBot(bot);
    this.markDirty({ host: true, players: 'all' });
  }

  pause(): void {
    this.requirePhase('question');
    if (this.paused || this.endsAt === null) return;
    const now = Date.now();
    this.remainingMs = Math.max(0, this.endsAt - now);
    this.endsAt = null;
    this.paused = true;
    this.pausedAt = now;
    this.clearQuestionTimer();
    this.markDirty({ host: true, players: 'all' });
  }

  resume(): void {
    this.requirePhase('question');
    if (!this.paused) return;
    const now = Date.now();
    this.pausedTotal += now - this.pausedAt;
    this.paused = false;
    this.endsAt = now + this.remainingMs;
    this.questionTimer = setTimeout(() => this.endQuestion(), this.remainingMs);
    this.markDirty({ host: true, players: 'all' });
  }

  endQuestion(): void {
    if (this.phase !== 'question') return;
    this.clearQuestionTimer();
    this.clearBots();
    this.previousRanks = new Map(rankPlayers(this.activePlayers).map((e) => [e.player.id, e.rank]));
    for (const player of this.activePlayers) {
      player.score = [...player.answers.values()].reduce((sum, a) => sum + a.points, 0);
    }
    this.phase = 'reveal';
    this.paused = false;
    this.endsAt = null;
    this.remainingMs = 0;
    this.answersVisible = false;
    this.leaderboardVisible = false;
    if (this.settings.autoRevealAnswers || this.settings.autoAdvance) this.setAnswersVisible(true);
    this.markDirty({ host: true, players: 'all' });
    if (this.settings.autoAdvance) this.scheduleAutoAfterReveal();
  }

  next(): void {
    this.requirePhase('reveal');
    this.clearAuto();
    const nextIndex = this.questionIndex + 1;
    if (nextIndex >= this.questionCount) return this.finish();
    if (nextIndex <= this.maxPlayedIndex) return this.showReveal(nextIndex);
    this.goToReady(nextIndex);
  }

  previous(): void {
    if (!this.canGoBack()) throw new GameError(ERRORS.forbidden);
    this.clearAuto();
    this.showReveal(this.questionIndex - 1);
  }

  end(): void {
    if (this.phase === 'ended') return;
    if (this.phase === 'lobby') {
      this.store?.abort(this.id);
      this.phase = 'ended';
      this.endedAt = Date.now();
      this.markDirty({ host: true, players: 'all' });
      return;
    }
    if (this.phase === 'question') this.endQuestion();
    this.finish();
  }

  canGoBack(): boolean {
    return this.settings.allowBack && this.questionIndex > 0 && (this.phase === 'ready' || this.phase === 'reveal');
  }

  private setAnswersVisible(value: boolean): void {
    if (this.phase !== 'reveal') throw new GameError(ERRORS.forbidden);
    this.answersVisible = value;
    if (value) this.revealScores();
    this.markDirty({ host: true, players: 'all' });
  }

  private setLeaderboardVisible(value: boolean): void {
    if (this.phase !== 'reveal' && this.phase !== 'ended') throw new GameError(ERRORS.forbidden);
    this.leaderboardVisible = value;
    if (value) this.revealScores();
    this.markDirty({ host: true, players: 'all' });
  }

  private setResultsVisible(value: boolean): void {
    this.requirePhase('ended');
    this.resultsVisible = value;
    if (value) this.revealScores();
    this.store?.setResultsVisible(this.id, value);
    this.markDirty({ host: true, players: 'all' });
  }

  private updateSettings(settings: Partial<GameSettings>): void {
    if (this.phase === 'ended') throw new GameError(ERRORS.gameEnded);
    const { maxPlayers, scoringMode, ...rest } = settings;
    // Le mode de score ne change plus une fois la partie lancée (équité entre les questions).
    if (scoringMode && this.phase === 'lobby') this.settings.scoringMode = scoringMode;
    if (maxPlayers) this.settings.maxPlayers = Math.max(maxPlayers, this.players.size);
    Object.assign(this.settings, rest);
    this.syncPresenceWatch();
    this.markDirty({ host: true, players: 'all' });
  }

  private goToReady(index: number): void {
    this.questionIndex = index;
    this.phase = 'ready';
    this.answersVisible = false;
    this.leaderboardVisible = false;
    this.markDirty({ host: true, players: 'all' });
    if (this.settings.autoAdvance) this.scheduleAuto(() => this.startQuestion(), AUTO_DELAYS.ready);
  }

  private showReveal(index: number): void {
    this.questionIndex = index;
    this.phase = 'reveal';
    this.leaderboardVisible = false;
    this.markDirty({ host: true, players: 'all' });
  }

  private finish(): void {
    this.clearAuto();
    this.clearQuestionTimer();
    this.clearBots();
    this.phase = 'ended';
    this.syncPresenceWatch();
    this.endedAt = Date.now();
    this.leaderboardVisible = false;
    const questionsPlayed = this.maxPlayedIndex + 1;
    if (this.store) {
      const ranked = rankPlayers(this.activePlayers);
      const results = ranked.map(({ player, score, rank }) => {
        const answers = [...player.answers.values()];
        const totalMs = answers.reduce((sum, a) => sum + a.responseMs, 0);
        return {
          playerId: player.id,
          rank,
          score,
          correctCount: answers.filter((a) => a.correct).length,
          answeredCount: answers.length,
          avgResponseMs: answers.length ? Math.round(totalMs / answers.length) : null,
          exits: player.presence.exits,
          awayMs: player.presence.awayMs,
        };
      });
      this.store.finish(this.id, questionsPlayed, results, new Map(this.activePlayers.map((p) => [p.id, p.score])), [...this.presenceLog]);
    }
    if (this.settings.autoAdvance) this.setResultsVisible(true);
    this.markDirty({ host: true, players: 'all' });
  }

  private revealScores(): void {
    for (const player of this.activePlayers) player.revealedScore = player.score;
  }

  private requirePhase(phase: GamePhase): void {
    if (this.phase === phase) return;
    throw new GameError(this.phase === 'ended' ? ERRORS.gameEnded : ERRORS.forbidden);
  }

  /* ───────────── Surveillance de présence ───────────── */

  /** La surveillance compte les sorties pendant la partie (de son lancement à sa fin), si le professeur l'a activée. */
  get watching(): boolean {
    return this.watchActive;
  }

  private shouldWatch(): boolean {
    return this.settings.presenceWatch && (this.phase === 'ready' || this.phase === 'question' || this.phase === 'reveal');
  }

  /** Signal envoyé par l'appareil d'un élève. Les heures et les durées sont celles de l'hôte. */
  reportPresence(playerId: string, report: PresenceReport): void {
    const player = this.players.get(playerId);
    if (!player || player.isBot || !player.socketId) return;
    const presence = player.presence;
    const now = Date.now();
    presence.lastBeat = now;
    if (report.app && !presence.app) {
      presence.app = true;
      this.markDirty({ host: true });
    }
    switch (report.s) {
      case 'beat':
        if (report.pinned !== undefined && report.pinned !== presence.pinned) {
          const unpinned = presence.pinned && !report.pinned;
          presence.pinned = report.pinned;
          if (unpinned && this.settings.pinApp && this.watching) {
            // Alerte ponctuelle : l'élève reste dans l'application, mais peut désormais en sortir.
            presence.exits += 1;
            this.logPresence(player, { kind: 'away', state: 'unfocused', reason: 'unpinned', at: now });
          }
          this.markDirty({ host: true });
        }
        // Le signe de vie porte l'état vu par l'appareil : il rattrape un message de sortie ou de retour perdu.
        if (report.v) this.markBack(player, now);
        else if (presence.state === 'present') this.markAway(player, 'hidden', now);
        return;
      case 'away':
        return this.markAway(player, report.r, now);
      case 'back':
        return this.markBack(player, now);
    }
  }

  private markAway(player: RoomPlayer, reason: AwayReason, now: number): void {
    if (player.isBot) return;
    const presence = player.presence;
    const state = stateForReason(reason);
    if (presence.state === 'present') {
      presence.state = state;
      presence.reason = reason;
      // Silence : l'absence a commencé après le dernier signe de vie reçu, pas au moment où on la constate.
      presence.since = reason === 'silent' ? Math.min(now, presence.lastBeat + (player.slowLink ? RELAY_BEAT_MS : PRESENCE_BEAT_MS)) : now;
      if (!this.watching) return this.markDirty({ host: true });
      presence.exits += 1;
    } else if (PRESENCE_SEVERITY[state] > PRESENCE_SEVERITY[presence.state]) {
      // Aggravation d'une absence en cours (ex. : hors premier plan → application quittée) : pas de nouvelle sortie.
      presence.state = state;
      presence.reason = reason;
      if (!this.watching) return this.markDirty({ host: true });
    } else {
      return;
    }
    this.logPresence(player, { kind: 'away', state, reason, at: presence.since ?? now });
    this.markDirty({ host: true, players: [player.id] });
  }

  private markBack(player: RoomPlayer, now: number): void {
    const presence = player.presence;
    if (presence.state === 'present') return;
    const since = presence.since;
    presence.state = 'present';
    presence.reason = null;
    presence.since = null;
    if (this.watching && since !== null) {
      const durationMs = Math.max(0, now - since);
      presence.awayMs += durationMs;
      this.logPresence(player, { kind: 'back', state: 'present', reason: null, at: now, durationMs });
    }
    this.markDirty({ host: true, players: [player.id] });
  }

  private logPresence(player: RoomPlayer, event: Omit<PresenceEvent, 'id' | 'playerId' | 'nickname' | 'question'>): void {
    this.presenceLog.push({ id: ++this.presenceSeq, playerId: player.id, nickname: player.nickname, question: this.questionIndex + 1, ...event });
    if (this.presenceLog.length > PRESENCE_LOG_LIMIT) this.presenceLog.splice(0, this.presenceLog.length - PRESENCE_LOG_LIMIT);
  }

  /**
   * Début (lancement, réactivation) ou fin (fin de partie, désactivation) de la surveillance, selon la phase et le réglage.
   * Au début, un élève déjà absent compte une sortie ; à la fin, les absences en cours sont comptabilisées.
   */
  private syncPresenceWatch(): void {
    const active = this.shouldWatch();
    if (active === this.watchActive) return;
    const now = Date.now();
    if (this.presenceTimer) clearInterval(this.presenceTimer);
    this.presenceTimer = null;
    for (const player of this.activePlayers) {
      if (player.isBot) continue;
      const presence = player.presence;
      if (active) {
        presence.lastBeat = now;
        if (!player.socketId && presence.state === 'present') {
          presence.state = 'lost';
          presence.reason = 'disconnected';
        }
        if (presence.state !== 'present') {
          presence.since = now;
          presence.exits += 1;
          this.logPresence(player, { kind: 'away', state: presence.state, reason: presence.reason, at: now });
        }
      } else if (presence.since !== null && presence.state !== 'present') {
        presence.awayMs += Math.max(0, now - presence.since);
        presence.since = now;
      }
    }
    this.watchActive = active;
    if (active) {
      this.presenceTimer = setInterval(() => this.checkSilence(), PRESENCE_CHECK_MS);
      // Côté Node, cette vérification ne doit jamais empêcher le processus de s'arrêter.
      (this.presenceTimer as { unref?: () => void }).unref?.();
    }
    this.markDirty({ host: true, players: 'all' });
  }

  /** Un élève connecté qui n'envoie plus de signe de vie est déclaré injoignable. */
  private checkSilence(): void {
    if (!this.watching) return;
    const now = Date.now();
    for (const player of this.activePlayers) {
      if (player.isBot || !player.socketId) continue;
      const limit = player.slowLink ? PRESENCE_SILENT_RELAY_MS : PRESENCE_SILENT_MS;
      if (now - player.presence.lastBeat > limit) this.markAway(player, 'silent', now);
    }
  }

  /* ───────────── Minuteries ───────────── */

  private scheduleAuto(work: () => void, delayMs: number): void {
    this.clearAuto();
    this.autoTimer = setTimeout(() => {
      this.autoTimer = null;
      try {
        work();
      } catch {
        // L'état a changé entre-temps (action manuelle) : rien à faire.
      }
    }, delayMs);
  }

  private scheduleAutoAfterReveal(): void {
    const isLast = this.questionIndex + 1 >= this.questionCount;
    this.scheduleAuto(() => {
      if (isLast) return this.next();
      this.setLeaderboardVisible(true);
      this.scheduleAuto(() => this.next(), AUTO_DELAYS.leaderboard);
    }, AUTO_DELAYS.reveal);
  }

  private clearAuto(): void {
    if (this.autoTimer) clearTimeout(this.autoTimer);
    this.autoTimer = null;
  }

  private clearQuestionTimer(): void {
    if (this.questionTimer) clearTimeout(this.questionTimer);
    this.questionTimer = null;
  }

  private scheduleBot(bot: RoomPlayer): void {
    const question = this.currentQuestion;
    if (!question || bot.answers.has(this.questionIndex)) return;
    const index = this.questionIndex;
    const timer = setTimeout(() => {
      this.botTimers.delete(timer);
      if (this.phase !== 'question' || this.questionIndex !== index || !this.players.has(bot.id)) return;
      if (this.paused) return this.scheduleBot(bot);
      try {
        this.answer(bot.id, index, pickBotAnswer(question, this.layouts[index]));
      } catch {
        // Temps écoulé pendant le délai : le bot ne répond simplement pas.
      }
    }, pickBotDelay(this.paused ? 2000 : this.remainingMsNow()));
    this.botTimers.add(timer);
  }

  private remainingMsNow(): number {
    return this.endsAt === null ? this.remainingMs : Math.max(0, this.endsAt - Date.now());
  }

  private clearBots(): void {
    for (const timer of this.botTimers) clearTimeout(timer);
    this.botTimers.clear();
  }

  dispose(): void {
    if (this.presenceTimer) clearInterval(this.presenceTimer);
    this.presenceTimer = null;
    this.clearAuto();
    this.clearQuestionTimer();
    this.clearBots();
    if (this.hostThrottle) clearTimeout(this.hostThrottle);
    for (const player of this.activePlayers) if (player.disconnectTimer) clearTimeout(player.disconnectTimer);
  }

  private touch(): void {
    this.lastActivity = Date.now();
  }

  /* ───────────── Diffusion ───────────── */

  /**
   * Marque des vues comme obsolètes. Les envois sont regroupés (une seule émission par
   * destinataire et par tick) et les simples notifications de réponse au professeur sont limitées.
   */
  private markDirty(target: { host?: boolean; players?: string[] | 'all' }, hostDelayMs = 0): void {
    if (target.players === 'all') this.dirtyPlayers = 'all';
    else if (target.players && this.dirtyPlayers !== 'all') for (const id of target.players) this.dirtyPlayers.add(id);
    if (target.host) {
      if (hostDelayMs > 0) {
        this.hostThrottle ??= setTimeout(() => {
          this.hostThrottle = null;
          this.transport.sendHost(this);
        }, hostDelayMs);
      } else {
        this.dirtyHost = true;
      }
    }
    if (this.flushScheduled) return;
    this.flushScheduled = true;
    queueMicrotask(() => this.flush());
  }

  private flush(): void {
    this.flushScheduled = false;
    if (this.dirtyHost) {
      this.dirtyHost = false;
      if (this.hostThrottle) clearTimeout(this.hostThrottle);
      this.hostThrottle = null;
      this.transport.sendHost(this);
    }
    const targets = this.dirtyPlayers === 'all' ? this.activePlayers : [...this.dirtyPlayers].map((id) => this.players.get(id));
    this.dirtyPlayers = new Set();
    for (const player of targets) if (player?.socketId) this.transport.sendPlayer(this, player);
  }

  /* ───────────── Vues ───────────── */

  private timerState(): TimerState | null {
    const question = this.currentQuestion;
    if (this.phase !== 'question' || !question) return null;
    return {
      endsAt: this.endsAt,
      remainingMs: this.remainingMsNow(),
      durationMs: question.timeLimit * 1000,
      paused: this.paused,
      serverNow: Date.now(),
    };
  }

  private publicQuestion(): PublicQuestion | null {
    const question = this.currentQuestion;
    if (!question || this.phase === 'lobby' || this.phase === 'ended') return null;
    const definition = questionType(question.type);
    return {
      index: this.questionIndex,
      total: this.questionCount,
      type: question.type,
      text: question.text,
      imageUrl: question.imageUrl,
      ...definition.publicPart(question, this.layouts[this.questionIndex]),
      timeLimit: question.timeLimit,
      points: question.bonus ? question.points * 2 : question.points,
      pointsEnabled: question.pointsEnabled && definition.scored && this.settings.scoringMode !== 'none',
      bonus: question.bonus || undefined,
      media: question.media?.length ? question.media : undefined,
      scored: definition.scored,
    };
  }

  /** Correction de la question en cours, dans l'ordre affiché aux élèves. */
  private correction(): Correction | null {
    const question = this.currentQuestion;
    if (!question) return null;
    const correction = questionType(question.type).correction(question, this.layouts[this.questionIndex]);
    return question.explanation ? { ...correction, explanation: question.explanation } : correction;
  }

  private hostQuestion(): HostQuestion | null {
    const base = this.publicQuestion();
    const question = this.currentQuestion;
    if (!base || !question) return null;
    return { ...base, ...this.correction()! };
  }

  private answerStats(): Pick<HostView, 'distribution' | 'textAnswers' | 'correctCount' | 'stats'> {
    const question = this.currentQuestion;
    if (!question || (this.phase !== 'reveal' && this.phase !== 'question')) {
      return { distribution: null, textAnswers: null, correctCount: null, stats: null };
    }
    const definition = questionType(question.type);
    const answers = this.activePlayers.flatMap((p) => p.answers.get(this.questionIndex) ?? []);
    const stats = definition.stats(question, answers, this.layouts[this.questionIndex]);
    return {
      distribution: stats.kind === 'choices' ? stats.counts : null,
      textAnswers: stats.kind === 'texts' ? stats.items : null,
      correctCount: definition.scored ? answers.filter((a) => a.correct).length : null,
      stats,
    };
  }

  hostView(): HostView {
    const ranked = rankPlayers(this.activePlayers);
    return {
      gameId: this.id,
      code: this.code,
      quizId: this.quizId,
      quizTitle: this.quizTitle,
      phase: this.phase,
      isTest: this.isTest,
      locked: this.locked,
      settings: { ...this.settings },
      players: this.activePlayers.map((p) => ({
        id: p.id,
        nickname: p.nickname,
        score: p.score,
        connected: p.isBot || p.socketId !== null,
        answered: p.answers.has(this.questionIndex),
        isBot: p.isBot,
        presence: publicPresence(p.presence),
      })),
      questionIndex: this.questionIndex,
      questionCount: this.questionCount,
      question: this.hostQuestion(),
      timer: this.timerState(),
      answeredCount: this.activePlayers.filter((p) => p.answers.has(this.questionIndex)).length,
      ...this.answerStats(),
      answersVisible: this.answersVisible,
      leaderboardVisible: this.leaderboardVisible,
      resultsVisible: this.resultsVisible,
      leaderboard: toLeaderboard(ranked, this.previousRanks),
      canGoBack: this.canGoBack(),
      presenceLog: this.presenceLog.slice(-PRESENCE_LOG_IN_VIEW),
      serverNow: Date.now(),
    };
  }

  playerView(player: RoomPlayer): PlayerView {
    const question = this.currentQuestion;
    const recorded = player.answers.get(this.questionIndex) ?? null;
    const showCorrection = this.phase === 'reveal' && this.answersVisible && question !== null;
    const showLeaderboard = this.leaderboardVisible && (this.phase === 'reveal' || this.phase === 'ended');
    const showFinal = this.phase === 'ended' && this.resultsVisible;
    const revealed = showLeaderboard || showFinal ? rankPlayers(this.activePlayers, (p) => p.revealedScore) : null;
    const myRank = revealed?.find((e) => e.player.id === player.id)?.rank ?? null;
    const leaderboard = revealed ? toLeaderboard(revealed, this.previousRanks) : null;

    return {
      code: this.code,
      quizTitle: this.quizTitle,
      phase: this.phase,
      isTest: this.isTest,
      allowAnswerChange: this.settings.allowAnswerChange,
      me: { id: player.id, nickname: player.nickname, score: player.revealedScore, rank: myRank },
      playerCount: this.players.size,
      questionIndex: this.questionIndex,
      questionCount: this.questionCount,
      question: this.publicQuestion(),
      timer: this.timerState(),
      myAnswer: recorded && question ? questionType(question.type).toDisplay(recorded.answer, this.layouts[this.questionIndex]) : null,
      answersVisible: showCorrection,
      correction: showCorrection ? this.correction() : null,
      outcome:
        showCorrection && question
          ? {
              answered: recorded !== null,
              correct: recorded?.correct ?? false,
              points: recorded?.points ?? 0,
              scored: questionType(question.type).scored,
              ratio: recorded?.ratio ?? 0,
            }
          : null,
      leaderboard: showLeaderboard && leaderboard ? leaderboard.slice(0, 5) : null,
      final:
        showFinal && leaderboard
          ? { rank: myRank ?? leaderboard.length, score: player.revealedScore, playerCount: this.players.size, podium: leaderboard.slice(0, 3) }
          : null,
      presence: this.settings.presenceWatch && this.phase !== 'ended' ? { pinApp: this.settings.pinApp, exits: player.presence.exits, awayMs: player.presence.awayMs } : null,
    };
  }
}

function publicPresence({ lastBeat: _lastBeat, ...presence }: PlayerPresence): PresenceInfo {
  return presence;
}

export function cleanNickname(value: string): string | null {
  const cleaned = value
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f-\u009f<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.length >= 1 && cleaned.length <= LIMITS.nickname ? cleaned : null;
}
