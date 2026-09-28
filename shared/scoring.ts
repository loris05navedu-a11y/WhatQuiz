import type { QuestionType, ScoringMode, SubmittedAnswer } from './types';

export interface GradableQuestion {
  type: QuestionType;
  answers: { text: string; isCorrect: boolean }[];
}

/** Normalise une réponse libre : casse, accents, espaces et ponctuation finale ignorés. */
export function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.!?;,]+$/, '')
    .trim();
}

export function correctChoiceIndexes(question: GradableQuestion): number[] {
  return question.answers.flatMap((answer, index) => (answer.isCorrect ? [index] : []));
}

export function isAnswerCorrect(question: GradableQuestion, answer: SubmittedAnswer): boolean {
  if (question.type === 'text') {
    if (answer.kind !== 'text') return false;
    const given = normalizeText(answer.text);
    return given.length > 0 && question.answers.some((accepted) => normalizeText(accepted.text) === given);
  }
  if (answer.kind !== 'choice') return false;
  const expected = correctChoiceIndexes(question);
  const given = [...new Set(answer.choices)].sort((a, b) => a - b);
  return given.length === expected.length && given.every((choice, i) => choice === expected[i]);
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
