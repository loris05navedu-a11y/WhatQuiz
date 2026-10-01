import { gradeAnswer, type Grade, type GradableQuestion } from './questionTypes';
import type { ScoringMode, SubmittedAnswer } from './types';

export { normalizeText } from './text';
export { correctChoiceIndexes, type GradableQuestion } from './questionTypes';

/** Bonne réponse ou non, sans mélange des choix (la correction détaillée est dans shared/questionTypes). */
export function isAnswerCorrect(question: GradableQuestion, answer: SubmittedAnswer): boolean {
  return gradeAnswer(question, answer).correct;
}

export interface PointsInput {
  correct: boolean;
  basePoints: number;
  pointsEnabled: boolean;
  mode: ScoringMode;
  responseMs: number;
  timeLimitMs: number;
}

/**
 * Points gagnés pour une réponse.
 * - `fixed` : tous les points pour une bonne réponse ;
 * - `speed` : de 100 % (réponse immédiate) à 50 % (dernière seconde) des points ;
 * - `none`  : aucun point.
 */
export function computePoints(input: PointsInput): number {
  if (!input.correct || !input.pointsEnabled || input.mode === 'none') return 0;
  if (input.mode === 'fixed') return input.basePoints;
  const ratio = Math.min(Math.max(input.responseMs / input.timeLimitMs, 0), 1);
  return Math.round(input.basePoints * (1 - ratio / 2));
}

/** Points d'une réponse corrigée : crédit partiel (ordre, association) et question bonus (×2). */
export function pointsForGrade(grade: Grade, input: Omit<PointsInput, 'correct'> & { bonus?: boolean }): number {
  if (grade.ratio <= 0) return 0;
  const full = computePoints({ ...input, correct: true });
  return Math.round(full * grade.ratio * (input.bonus ? 2 : 1));
}
