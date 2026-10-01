import type { DocStore } from '../documents';
import type { PublicUser, Quiz, QuizInput } from '../types';

/** Accès aux quiz depuis les services partagés (implémenté par le serveur et par le mode sans serveur). */
export interface QuizGateway {
  /** Quiz de l'utilisateur (non supprimé), sinon undefined. */
  getOwned(ownerId: number, quizId: number): Quiz | undefined;
  create(ownerId: number, input: QuizInput): Quiz;
  listOwned(ownerId: number): Quiz[];
}

export interface ServiceContext {
  user: PublicUser | null;
  body: unknown;
  params: string[];
  query: Record<string, string>;
  docs: DocStore;
  quizzes: QuizGateway;
  now(): Date;
}

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

export interface SharedRoute {
  method: HttpMethod;
  /** Chemin relatif à /api. */
  pattern: RegExp;
  status?: number;
  handler(ctx: ServiceContext): unknown;
}
