import { LIMITS, SHARE_CODE_ALPHABET, SHARE_CODE_LENGTH } from './constants';
import { randomIntBetween } from './random';
import type { Difficulty, QuizInput, QuizMeta, QuizStatus, QuizVisibility } from './types';

export const QUIZ_STATUSES: readonly QuizStatus[] = ['draft', 'published'];
export const QUIZ_VISIBILITIES: readonly QuizVisibility[] = ['private', 'code', 'public'];
export const DIFFICULTIES: readonly Difficulty[] = ['easy', 'medium', 'hard'];

/** Tags propres : sans espaces superflus, sans doublon (casse ignorée), 10 au maximum. */
export function cleanTags(tags: readonly string[] | undefined): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of tags ?? []) {
    const tag = raw.trim().replace(/\s+/g, ' ').replace(/^#/, '').slice(0, LIMITS.tag);
    const key = tag.toLowerCase();
    if (!tag || seen.has(key)) continue;
    seen.add(key);
    result.push(tag);
    if (result.length >= LIMITS.tagsPerQuiz) break;
  }
  return result;
}

/** Métadonnées d'un quiz à partir de sa saisie (valeurs par défaut compatibles avec les anciens quiz). */
export function quizMetaFrom(input: QuizInput, accessCode: string | null): QuizMeta {
  const visibility = input.visibility ?? 'private';
  return {
    status: input.status ?? 'published',
    visibility,
    accessCode,
    subcategory: (input.subcategory ?? '').trim().slice(0, LIMITS.subcategory),
    tags: cleanTags(input.tags),
    difficulty: input.difficulty ?? null,
    level: (input.level ?? '').trim().slice(0, LIMITS.category),
  };
}

/** Code de partage : 6 caractères sans ambiguïté (≈ 900 millions de possibilités), tiré au hasard. */
export function generateShareCode(): string {
  return Array.from({ length: SHARE_CODE_LENGTH }, () => SHARE_CODE_ALPHABET[randomIntBetween(0, SHARE_CODE_ALPHABET.length)]).join('');
}

export const normalizeShareCode = (value: string) => value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
export const isShareCode = (value: string) => new RegExp(`^[${SHARE_CODE_ALPHABET}]{${SHARE_CODE_LENGTH}}$`).test(value);

/** Contenu réutilisable d'un quiz (copie, duplication, version) : sans identifiants, dates ni code d'accès. */
export function toQuizInput(quiz: import('./types').Quiz): QuizInput {
  const { id: _id, ownerId: _owner, createdAt: _c, updatedAt: _u, accessCode: _code, questions, ...rest } = quiz;
  return { ...rest, questions: questions.map(({ id: _qid, position: _p, ...question }) => question) };
}
