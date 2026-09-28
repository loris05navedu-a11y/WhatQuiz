import { Router, type Request } from 'express';
import type { Quiz } from '../../../shared/types';
import { DEMO_QUIZ } from '../demo/demoQuiz';
import { requireTeacher } from '../http/auth';
import { forbidden, notFound } from '../http/errors';
import type { Services } from '../services';
import { quizSchema } from '../validation';

/** Charge un quiz en vérifiant qu'il appartient bien à l'utilisateur connecté. */
export function loadOwnedQuiz(services: Services, req: Request, rawId: unknown): Quiz {
  const id = Number(rawId);
  const quiz = Number.isInteger(id) && id > 0 ? services.quizzes.findById(id) : undefined;
  if (!quiz) throw notFound('Quiz introuvable');
  if (quiz.ownerId !== req.user!.id) throw forbidden();
  return quiz;
}

function stripIds({ id: _id, ownerId: _o, createdAt: _c, updatedAt: _u, questions, ...rest }: Quiz) {
  return { ...rest, questions: questions.map(({ id: _qid, position: _p, ...question }) => question) };
}

export function quizRoutes(services: Services): Router {
  const router = Router();
  router.use(requireTeacher);

  router.get('/', (req, res) => {
    res.json({ quizzes: services.quizzes.listByOwner(req.user!.id) });
  });

  router.post('/', (req, res) => {
    const input = quizSchema.parse(req.body);
    res.status(201).json({ quiz: services.quizzes.create(req.user!.id, input) });
  });

  router.post('/demo', (req, res) => {
    res.status(201).json({ quiz: services.quizzes.create(req.user!.id, DEMO_QUIZ) });
  });

  router.get('/:id', (req, res) => {
    res.json({ quiz: loadOwnedQuiz(services, req, req.params.id) });
  });

  router.put('/:id', (req, res) => {
    const quiz = loadOwnedQuiz(services, req, req.params.id);
    const input = quizSchema.parse(req.body);
    res.json({ quiz: services.quizzes.update(quiz.id, input) });
  });

  router.delete('/:id', (req, res) => {
    const quiz = loadOwnedQuiz(services, req, req.params.id);
    services.quizzes.delete(quiz.id);
    res.json({ ok: true });
  });

  router.post('/:id/duplicate', (req, res) => {
    const quiz = loadOwnedQuiz(services, req, req.params.id);
    const copy = stripIds(quiz);
    const title = `${copy.title} (copie)`.slice(0, 120);
    res.status(201).json({ quiz: services.quizzes.create(req.user!.id, { ...copy, title }) });
  });

  return router;
}
