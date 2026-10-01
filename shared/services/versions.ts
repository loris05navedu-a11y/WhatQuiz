import type { DocStore, StoredDoc } from '../documents';
import { ServiceError } from '../documents';
import { randomUuid } from '../random';
import type { QuizInput, QuizVersionSummary } from '../types';
import { nowIso, ownedQuiz } from './access';
import type { SharedRoute } from './context';

/**
 * Historique des modifications d'un quiz : une version à chaque enregistrement. Les enregistrements automatiques
 * rapprochés sont regroupés, une version identique à la précédente n'est pas dupliquée, 30 versions au maximum.
 */
export const VERSION_KIND = 'quizVersion';
const MAX_VERSIONS = 30;
const AUTOSAVE_MERGE_MS = 10 * 60_000;

interface QuizVersionDoc extends StoredDoc {
  quizId: number;
  reason: QuizVersionSummary['reason'];
  quiz: QuizInput;
}

const summary = (doc: QuizVersionDoc): QuizVersionSummary => ({
  id: doc.id,
  quizId: doc.quizId,
  createdAt: doc.updatedAt,
  title: doc.quiz.title,
  questionCount: doc.quiz.questions.length,
  reason: doc.reason,
});

function versionsOf(docs: DocStore, ownerId: number, quizId: number): QuizVersionDoc[] {
  return docs
    .list<QuizVersionDoc>(VERSION_KIND, ownerId)
    .filter((v) => v.quizId === quizId)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** Enregistre l'état d'un quiz après une sauvegarde. */
export function recordQuizVersion(docs: DocStore, ownerId: number, quizId: number, quiz: QuizInput, reason: QuizVersionSummary['reason'], now: Date): void {
  const existing = versionsOf(docs, ownerId, quizId);
  const latest = existing[0];
  const snapshot = JSON.stringify(quiz);
  if (latest && JSON.stringify(latest.quiz) === snapshot) return;
  // Horodatage strictement croissant : deux enregistrements dans la même milliseconde restent ordonnés.
  const at = new Date(Math.max(now.getTime(), latest ? Date.parse(latest.updatedAt) + 1 : 0)).toISOString();
  if (latest && reason === 'autosave' && latest.reason === 'autosave' && now.getTime() - Date.parse(latest.updatedAt) < AUTOSAVE_MERGE_MS) {
    docs.put<QuizVersionDoc>(VERSION_KIND, { ...latest, quiz, updatedAt: at });
    return;
  }
  docs.put<QuizVersionDoc>(VERSION_KIND, { id: randomUuid(), ownerId, quizId, reason, quiz, createdAt: at, updatedAt: at });
  for (const old of existing.slice(MAX_VERSIONS - 1)) docs.delete(VERSION_KIND, old.id);
}

export function deleteQuizVersions(docs: DocStore, ownerId: number, quizId: number): void {
  for (const version of versionsOf(docs, ownerId, quizId)) docs.delete(VERSION_KIND, version.id);
}

export const versionRoutes: SharedRoute[] = [
  {
    method: 'GET',
    pattern: /^\/quizzes\/(\d+)\/versions$/,
    handler(ctx) {
      const quiz = ownedQuiz(ctx, ctx.params[0]);
      return { versions: versionsOf(ctx.docs, quiz.ownerId, quiz.id).map(summary) };
    },
  },
  {
    method: 'GET',
    pattern: /^\/quizzes\/(\d+)\/versions\/([\w-]+)$/,
    handler(ctx) {
      const quiz = ownedQuiz(ctx, ctx.params[0]);
      const version = ctx.docs.get<QuizVersionDoc>(VERSION_KIND, ctx.params[1]);
      if (!version || version.quizId !== quiz.id || version.ownerId !== quiz.ownerId) throw new ServiceError(404, 'Version introuvable');
      return { version: summary(version), quiz: version.quiz, restoredAt: nowIso(ctx) };
    },
  },
];
