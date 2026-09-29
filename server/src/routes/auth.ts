import { randomBytes } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { hashPassword, verifyPassword } from '../auth/password';
import { DEMO_QUIZ } from '../demo/demoQuiz';
import { toPublicUser } from '../db/users';
import { clearSessionCookie, requireAuth, setSessionCookie, wantsToken } from '../http/auth';
import { HttpError } from '../http/errors';
import { rateLimit } from '../http/rateLimit';
import type { Services } from '../services';
import { loginSchema, passwordChangeSchema, profileSchema, registerSchema } from '../validation';

const DEMO_ACCOUNT_TTL_HOURS = 24;
/** Hash factice utilisé pour garder un temps de réponse constant si l'e-mail est inconnu. */
let dummyHash: Promise<string> | null = null;

export function authRoutes(services: Services): Router {
  const router = Router();
  const authLimiter = rateLimit(20, 15 * 60_000);

  /** Ouvre une session. En mode jeton, le jeton est renvoyé dans le corps (pas de cookie tiers). */
  function openSession(req: Request, res: Response, userId: number): { token?: string } {
    const { token, expiresAt } = services.sessions.create(userId);
    if (wantsToken(req)) return { token };
    setSessionCookie(services, res, token, expiresAt);
    return {};
  }

  router.post('/register', authLimiter, async (req, res) => {
    const input = registerSchema.parse(req.body);
    if (services.users.findByEmail(input.email)) throw new HttpError(409, 'Un compte existe déjà avec cette adresse');
    const user = services.users.create({ ...input, passwordHash: await hashPassword(input.password) });
    res.status(201).json({ user: toPublicUser(user), ...openSession(req, res, user.id) });
  });

  router.post('/login', authLimiter, async (req, res) => {
    const input = loginSchema.parse(req.body);
    const user = services.users.findByEmail(input.email);
    dummyHash ??= hashPassword(randomBytes(8).toString('hex'));
    const valid = await verifyPassword(input.password, user?.passwordHash ?? (await dummyHash));
    if (!user || !valid) throw new HttpError(401, 'E-mail ou mot de passe incorrect');
    res.json({ user: toPublicUser(user), ...openSession(req, res, user.id) });
  });

  router.post('/logout', (req, res) => {
    if (req.sessionToken) services.sessions.delete(req.sessionToken);
    clearSessionCookie(services, res);
    res.json({ ok: true });
  });

  router.get('/me', (req, res) => {
    res.json({ user: req.user ?? null });
  });

  /** Mode démo : compte professeur temporaire, prérempli avec le quiz de démonstration. */
  router.post('/demo', authLimiter, async (req, res) => {
    services.users.purgeDemoAccounts(DEMO_ACCOUNT_TTL_HOURS);
    const suffix = randomBytes(6).toString('hex');
    const user = services.users.create({
      email: `demo-${suffix}@demo.whatquiz.local`,
      passwordHash: await hashPassword(randomBytes(24).toString('hex')),
      displayName: 'Professeur démo',
      role: 'teacher',
      isDemo: true,
    });
    services.quizzes.create(user.id, DEMO_QUIZ);
    res.status(201).json({ user: toPublicUser(user), ...openSession(req, res, user.id) });
  });

  return router;
}

export function accountRoutes(services: Services): Router {
  const router = Router();
  router.use(requireAuth);

  router.put('/profile', (req, res) => {
    const input = profileSchema.parse(req.body);
    const user = req.user!;
    if (user.isDemo) throw new HttpError(403, 'Le profil du compte démo ne peut pas être modifié');
    const existing = services.users.findByEmail(input.email);
    if (existing && existing.id !== user.id) throw new HttpError(409, 'Un compte existe déjà avec cette adresse');
    services.users.updateProfile(user.id, input);
    res.json({ user: toPublicUser(services.users.findById(user.id)!) });
  });

  router.put('/password', async (req, res) => {
    const input = passwordChangeSchema.parse(req.body);
    const user = services.users.findById(req.user!.id)!;
    if (user.isDemo) throw new HttpError(403, 'Le mot de passe du compte démo ne peut pas être modifié');
    if (!(await verifyPassword(input.currentPassword, user.passwordHash))) {
      throw new HttpError(400, 'Mot de passe actuel incorrect');
    }
    services.users.updatePassword(user.id, await hashPassword(input.newPassword));
    services.sessions.deleteOthers(user.id, req.sessionToken!);
    res.json({ ok: true });
  });

  router.delete('/', (req, res) => {
    services.users.delete(req.user!.id);
    clearSessionCookie(services, res);
    res.json({ ok: true });
  });

  router.get('/history', (req, res) => {
    res.json({ history: services.games.studentHistory(req.user!.id) });
  });

  return router;
}
