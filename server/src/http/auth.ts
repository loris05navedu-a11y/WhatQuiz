import type { RequestHandler, Response } from 'express';
import { ERRORS } from '../../../shared/constants';
import type { PublicUser } from '../../../shared/types';
import type { Services } from '../services';
import { toPublicUser } from '../db/users';
import { HttpError } from './errors';

export const SESSION_COOKIE = 'wq_session';

declare module 'express-serve-static-core' {
  interface Request {
    user?: PublicUser;
    sessionToken?: string;
  }
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  for (const part of header?.split(';') ?? []) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    const name = part.slice(0, index).trim();
    try {
      cookies[name] = decodeURIComponent(part.slice(index + 1).trim());
    } catch {
      // Cookie mal formé : ignoré.
    }
  }
  return cookies;
}

/** Retrouve l'utilisateur associé au cookie de session (ou undefined). */
export function userFromCookieHeader(services: Services, header: string | undefined): { user: PublicUser; token: string } | undefined {
  const token = parseCookies(header)[SESSION_COOKIE];
  if (!token) return undefined;
  const userId = services.sessions.findUserId(token);
  const user = userId === null ? undefined : services.users.findById(userId);
  return user ? { user: toPublicUser(user), token } : undefined;
}

export function loadUser(services: Services): RequestHandler {
  return (req, _res, next) => {
    const found = userFromCookieHeader(services, req.headers.cookie);
    if (found) {
      req.user = found.user;
      req.sessionToken = found.token;
    }
    next();
  };
}

export const requireAuth: RequestHandler = (req, _res, next) => {
  next(req.user ? undefined : new HttpError(401, ERRORS.unauthenticated));
};

export const requireTeacher: RequestHandler = (req, _res, next) => {
  if (!req.user) return next(new HttpError(401, ERRORS.unauthenticated));
  next(req.user.role === 'teacher' ? undefined : new HttpError(403, 'Réservé aux comptes professeur'));
};

export const requireAdmin: RequestHandler = (req, _res, next) => {
  if (!req.user) return next(new HttpError(401, ERRORS.unauthenticated));
  next(req.user.isAdmin ? undefined : new HttpError(403, ERRORS.forbidden));
};

export function setSessionCookie(services: Services, res: Response, token: string, expiresAt: number): void {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: services.config.cookieSecure,
    expires: new Date(expiresAt),
    path: '/',
  });
}

export function clearSessionCookie(services: Services, res: Response): void {
  res.clearCookie(SESSION_COOKIE, { httpOnly: true, sameSite: 'lax', secure: services.config.cookieSecure, path: '/' });
}

/**
 * Protection CSRF (en plus du cookie SameSite=Lax) : une requête qui modifie des données et porte un corps
 * doit être en JSON — un formulaire d'un autre site ne peut pas envoyer ce type sans pré-vérification CORS.
 */
export const requireJsonForMutations: RequestHandler = (req, _res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const hasBody = Number(req.headers['content-length'] ?? 0) > 0 || req.headers['transfer-encoding'] !== undefined;
  if (!hasBody || req.is('application/json')) return next();
  next(new HttpError(415, 'Format de requête non supporté'));
};
