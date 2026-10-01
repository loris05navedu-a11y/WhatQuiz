import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import { ERRORS } from '../../../shared/constants';
import { ServiceError } from '../../../shared/documents';
import { GameError } from '../game/errors';
import { firstIssue } from '../validation';

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export const notFound = (message: string = ERRORS.notFound) => new HttpError(404, message);
export const forbidden = () => new HttpError(403, ERRORS.forbidden);

/** Toutes les erreurs deviennent un message JSON lisible ; les détails techniques restent dans les logs. */
export const errorHandler: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
  if (error instanceof HttpError || error instanceof ServiceError) return void res.status(error.status).json({ error: error.message });
  if (error instanceof ZodError) return void res.status(400).json({ error: firstIssue(error) });
  if (error instanceof GameError) return void res.status(409).json({ error: error.message });
  const status = (error as { status?: number }).status;
  if (status === 413) return void res.status(413).json({ error: 'Fichier ou requête trop volumineux' });
  if (status === 400) return void res.status(400).json({ error: ERRORS.invalidInput });
  console.error('[whatquiz] Erreur inattendue :', error);
  res.status(500).json({ error: ERRORS.generic });
};
