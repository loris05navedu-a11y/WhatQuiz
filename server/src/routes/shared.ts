import type { RequestHandler } from 'express';
import type { QuizGateway, ServiceContext } from '../../../shared/services/context';
import { matchSharedRoute } from '../../../shared/services';
import type { Services } from '../services';
import { questionListSchema } from '../validation';

/** Accès aux quiz pour les services partagés. */
export function quizGateway(services: Services): QuizGateway {
  return {
    getOwned: (ownerId, quizId) => services.quizzes.findOwned(ownerId, quizId),
    create: (ownerId, input) => services.quizzes.create(ownerId, input),
    listOwned: (ownerId) => services.quizzes.listByOwner(ownerId).map((summary) => services.quizzes.findById(summary.id)!),
  };
}

/** Monte les routes communes au serveur et au mode sans serveur (shared/services). */
export function sharedRoutes(services: Services): RequestHandler {
  const quizzes = quizGateway(services);
  return (req, res, next) => {
    const match = matchSharedRoute(req.method, req.path);
    if (!match) return next();
    const ctx: ServiceContext = {
      user: req.user ?? null,
      body: req.body,
      params: match.params,
      query: Object.fromEntries(Object.entries(req.query).map(([k, v]) => [k, String(v)])),
      docs: services.docs,
      quizzes,
      parseQuestions: (raw) => questionListSchema.parse({ questions: raw }).questions,
      now: () => new Date(),
    };
    Promise.resolve()
      .then(() => match.route.handler(ctx))
      .then((result) => res.status(match.route.status ?? 200).json(result))
      .catch(next);
  };
}
