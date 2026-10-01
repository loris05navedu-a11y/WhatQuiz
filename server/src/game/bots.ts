import { questionType, type QuestionLayout } from '../../../shared/questionTypes';
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

/** Réponse (dans l'ordre affiché) d'un élève fictif : juste avec une probabilité de 70 %. */
export function pickBotAnswer(question: QuestionInput, layout: QuestionLayout): SubmittedAnswer {
  return questionType(question.type).botAnswer(question, layout, Math.random() < BOT_ACCURACY, Math.random);
}

function shuffle<T>(items: readonly T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}
