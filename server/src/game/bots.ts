import { correctChoiceIndexes } from '../../../shared/scoring';
import type { QuestionInput, SubmittedAnswer } from '../../../shared/types';

/** Élèves fictifs du mode démo / test : ils répondent avec un délai et une justesse aléatoires. */
const BOT_NAMES = [
  'Alex', 'Emma', 'Lucas', 'Léa', 'Hugo', 'Chloé', 'Nathan', 'Inès', 'Louis', 'Jade',
  'Gabriel', 'Manon', 'Adam', 'Zoé', 'Arthur', 'Lina', 'Raphaël', 'Camille', 'Noah', 'Sarah',
  'Jules', 'Alice', 'Tom', 'Rose', 'Enzo', 'Lou', 'Maël', 'Anna', 'Sacha', 'Nina',
];
const BOT_ACCURACY = 0.7;

export function pickBotNames(count: number, isTaken: (name: string) => boolean): string[] {
  const names: string[] = [];
  for (const base of shuffle(BOT_NAMES)) {
    if (names.length >= count) break;
    if (!isTaken(base)) names.push(base);
  }
  for (let n = 2; names.length < count; n++) {
    const name = `Élève ${n}`;
    if (!isTaken(name) && !names.includes(name)) names.push(name);
  }
  return names;
}

export function pickBotDelay(remainingMs: number): number {
  return Math.round(remainingMs * (0.15 + Math.random() * 0.6));
}

export function pickBotAnswer(question: QuestionInput): SubmittedAnswer {
  const right = Math.random() < BOT_ACCURACY;
  if (question.type === 'text') {
    return { kind: 'text', text: right ? question.answers[0]?.text ?? '?' : 'Je ne sais pas' };
  }
  const correct = correctChoiceIndexes(question);
  if (right) return { kind: 'choice', choices: correct };
  const wrong = question.answers.map((_, i) => i).filter((i) => !correct.includes(i));
  const choice = wrong.length ? wrong[Math.floor(Math.random() * wrong.length)] : 0;
  return { kind: 'choice', choices: [choice] };
}

function shuffle<T>(items: readonly T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}
