import { Router } from 'express';
import { requireAdmin } from '../http/auth';
import { HttpError, notFound } from '../http/errors';
import type { Services } from '../services';

/** Administration : lister et supprimer des comptes (les quiz et parties de ce compte sont supprimés avec lui). */
export function adminRoutes(services: Services): Router {
  const router = Router();
  router.use(requireAdmin);

  router.get('/users', (_req, res) => {
    res.json({ users: services.users.listWithCounts() });
  });

  router.delete('/users/:id', (req, res) => {
    const target = services.users.findById(Number(req.params.id));
    if (!target) throw notFound('Compte introuvable');
    if (target.id === req.user!.id) throw new HttpError(400, 'Vous ne pouvez pas supprimer votre propre compte ici');
    if (target.isAdmin) throw new HttpError(400, 'Un compte administrateur ne peut pas être supprimé');
    services.users.delete(target.id);
    res.json({ ok: true });
  });

  return router;
}
