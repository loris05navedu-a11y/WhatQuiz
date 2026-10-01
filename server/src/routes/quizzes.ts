import { Router, type Request } from 'express';
import type { Quiz } from '../../../shared/types';
import { isShareCode, normalizeShareCode, toQuizInput } from '../../../shared/quizMeta';
import { deleteQuizVersions, recordQuizVersion } from '../../../shared/services/versions';
import { DEMO_QUIZ } from '../demo/demoQuiz';
import { requireTeacher } from '../http/auth';
import { forbidden, notFound } from '../http/errors';
import type { Services } from '../services';
import { quizSchema } from '../validation';

/** Charge un quiz en vérifiant qu'il appartient bien à l'utilisateur connecté. */
export function loadOwnedQuiz(services: Services, req: Request, rawId: unknown): Quiz {
  const id = Number(rawId);
  const quiz = Number.isInteger(id) && id > 0 ? services.quizzes.findById(id) : undefined;
  if (!quiz || services.quizzes.isDeleted(quiz.id)) throw notFound('Quiz introuvable');
  if (quiz.ownerId !== req.user!.id) throw forbidden();
  return quiz;
}

export function quizRoutes(services: Services): Router {
  const router = Router();
  router.use(requireTeacher);

  const save = (quiz: Quiz, reason: 'save' | 'autosave') =>
    recordQuizVersion(services.docs, quiz.ownerId, quiz.id, toQuizInput(quiz), reason, new Date());

  router.get('/', (req, res) => {
    res.json({ quizzes: services.quizzes.listByOwner(req.user!.id) });
  });

  router.post('/', (req, res) => {
    const input = quizSchema.parse(req.body);
    const quiz = services.quizzes.create(req.user!.id, input);
    save(quiz, 'save');
    res.status(201).json({ quiz });
  });

  router.post('/demo', (req, res) => {
    res.status(201).json({ quiz: services.quizzes.create(req.user!.id, DEMO_QUIZ) });
  });

  /** Bibliothèque : quiz publiés et publics des autres professeurs. */
  router.get('/library', (req, res) => {
    res.json({ quizzes: services.quizzes.listPublic(req.user!.id) });
  });

  /** Quiz partagé par son code d'accès (aperçu avant copie). */
  router.get('/shared/:code', (req, res) => {
    res.json({ quiz: sharedQuiz(services, req.params.code) });
  });

  router.post('/shared/:code/copy', (req, res) => {
    const source = sharedQuiz(services, req.params.code);
    const input = { ...toQuizInput(source), visibility: 'private' as const, status: 'draft' as const };
    const quiz = services.quizzes.create(req.user!.id, input);
    save(quiz, 'save');
    res.status(201).json({ quiz });
  });

  router.get('/:id', (req, res) => {
    res.json({ quiz: loadOwnedQuiz(services, req, req.params.id) });
  });

  router.put('/:id', (req, res) => {
    const quiz = loadOwnedQuiz(services, req, req.params.id);
    const input = quizSchema.parse(req.body);
    const updated = services.quizzes.update(quiz.id, input);
    save(updated, req.query.autosave === '1' ? 'autosave' : 'save');
    res.json({ quiz: updated });
  });

  router.delete('/:id', (req, res) => {
    const quiz = loadOwnedQuiz(services, req, req.params.id);
    services.quizzes.delete(quiz.id);
    deleteQuizVersions(services.docs, quiz.ownerId, quiz.id);
    res.json({ ok: true });
  });

  router.post('/:id/duplicate', (req, res) => {
    const quiz = loadOwnedQuiz(services, req, req.params.id);
    const copy = toQuizInput(quiz);
    const title = `${copy.title} (copie)`.slice(0, 120);
    const created = services.quizzes.create(req.user!.id, { ...copy, title, visibility: 'private' });
    save(created, 'save');
    res.status(201).json({ quiz: created });
  });

  return router;
}

function sharedQuiz(services: Services, rawCode: string): Quiz {
  const code = normalizeShareCode(rawCode);
  const quiz = isShareCode(code) ? services.quizzes.findByAccessCode(code) : undefined;
  if (!quiz) throw notFound('Aucun quiz partagé ne correspond à ce code');
  return quiz;
}
