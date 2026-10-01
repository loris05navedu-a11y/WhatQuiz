import { Router, type Request } from 'express';
import { ERRORS } from '../../../shared/constants';
import { quizProblems } from '../../../shared/quizRules';
import type { GameRoom } from '../game/GameRoom';
import type { GameManager } from '../game/GameManager';
import { requireTeacher } from '../http/auth';
import { forbidden, HttpError, notFound } from '../http/errors';
import type { Services } from '../services';
import { createGameSchema } from '../validation';
import { loadOwnedQuiz } from './quizzes';

export function gameRoutes(services: Services, manager: GameManager): Router {
  const router = Router();

  /** Vérification publique d'un code avant de demander le pseudo. */
  router.get('/code/:code', (req, res) => {
    const room = /^\d{6}$/.test(req.params.code) ? manager.get(req.params.code) : undefined;
    if (!room) throw notFound(ERRORS.gameNotFound);
    if (room.phase === 'ended') throw new HttpError(410, ERRORS.gameEnded);
    if (room.locked) throw new HttpError(423, ERRORS.gameLocked);
    res.json({ code: room.code, quizTitle: room.quizTitle });
  });

  router.use(requireTeacher);

  function ownedRoom(req: Request): GameRoom {
    const room = manager.getById(String(req.params.id));
    if (!room) throw notFound('Partie introuvable ou déjà fermée');
    if (room.hostUserId !== req.user!.id) throw forbidden();
    return room;
  }

  router.post('/', (req, res) => {
    const input = createGameSchema.parse(req.body);
    const quiz = loadOwnedQuiz(services, req, input.quizId);
    if (quiz.questions.length === 0) throw new HttpError(400, 'Ajoutez au moins une question avant de lancer une partie');
    const problems = quizProblems(quiz);
    if (problems.length > 0) throw new HttpError(400, `Corrigez le quiz avant de le lancer — ${problems[0]}`);
    const isTest = input.mode !== 'live';
    const room = manager.create({
      hostUserId: req.user!.id,
      quiz,
      isTest,
      settings: input.mode === 'test-player' ? { ...input.settings, autoAdvance: true } : input.settings,
      autoStartOnJoin: input.mode === 'test-player',
      allowBots: isTest || req.user!.isDemo,
      maxPlayers: services.config.maxPlayers,
    });
    res.status(201).json({ gameId: room.id, code: room.code });
  });

  router.get('/', (req, res) => {
    const active = manager
      .listByHost(req.user!.id)
      .filter((room) => room.phase !== 'ended' && !room.isTest)
      .map((room) => ({ id: room.id, code: room.code, quizTitle: room.quizTitle, phase: room.phase, playerCount: room.players.size }));
    res.json({ games: services.games.listByHost(req.user!.id), active });
  });

  router.get('/stats', (req, res) => {
    res.json({ stats: services.games.dashboardStats(req.user!.id, services.quizzes.countByOwner(req.user!.id)) });
  });

  router.get('/:id', (req, res) => {
    const room = manager.getById(req.params.id);
    if (room) {
      if (room.hostUserId !== req.user!.id) throw forbidden();
      return void res.json({ game: room.hostView() });
    }
    const ownerId = services.games.findOwner(req.params.id);
    if (ownerId === undefined) throw notFound('Partie introuvable');
    if (ownerId !== req.user!.id) throw forbidden();
    res.json({ results: services.games.results(req.params.id) });
  });

  router.get('/:id/results', (req, res) => {
    const ownerId = services.games.findOwner(req.params.id);
    if (ownerId === undefined) throw notFound('Partie introuvable');
    if (ownerId !== req.user!.id) throw forbidden();
    res.json({ results: services.games.results(req.params.id) });
  });

  router.post('/:id/start', (req, res) => {
    const room = ownedRoom(req);
    room.applyHostAction({ type: 'start' });
    res.json({ game: room.hostView() });
  });

  router.post('/:id/next', (req, res) => {
    const room = ownedRoom(req);
    room.applyHostAction(room.phase === 'ready' ? { type: 'startQuestion' } : room.phase === 'question' ? { type: 'endQuestion' } : { type: 'next' });
    res.json({ game: room.hostView() });
  });

  router.post('/:id/end', (req, res) => {
    const room = ownedRoom(req);
    room.applyHostAction({ type: 'end' });
    res.json({ game: room.hostView() });
  });

  router.delete('/:id', (req, res) => {
    const ownerId = services.games.findOwner(req.params.id);
    if (ownerId === undefined) throw notFound('Partie introuvable');
    if (ownerId !== req.user!.id) throw forbidden();
    const room = manager.getById(req.params.id);
    if (room) manager.remove(room);
    services.games.delete(req.params.id);
    res.json({ ok: true });
  });

  return router;
}
