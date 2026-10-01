import { ERRORS } from '../constants';
import { ServiceError } from '../documents';
import type { PublicUser, Quiz } from '../types';
import type { ServiceContext } from './context';

export function requireUser(ctx: ServiceContext): PublicUser {
  if (!ctx.user) throw new ServiceError(401, ERRORS.unauthenticated);
  return ctx.user;
}

export function requireTeacher(ctx: ServiceContext): PublicUser {
  const user = requireUser(ctx);
  if (user.role !== 'teacher') throw new ServiceError(403, 'Réservé aux comptes professeur');
  return user;
}

export function ownedQuiz(ctx: ServiceContext, rawId: string | number): Quiz {
  const user = requireTeacher(ctx);
  const quiz = ctx.quizzes.getOwned(user.id, Number(rawId));
  if (!quiz) throw new ServiceError(404, 'Quiz introuvable');
  return quiz;
}

export const nowIso = (ctx: ServiceContext) => ctx.now().toISOString();
