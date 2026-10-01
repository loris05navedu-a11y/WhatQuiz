import { createServer, type Server as HttpServer } from 'node:http';
import express, { type Express } from 'express';
import type { AppConfig } from './config';
import type { GameManager } from './game/GameManager';
import { loadUser, requireJsonForMutations } from './http/auth';
import { cors } from './http/cors';
import { errorHandler, notFound } from './http/errors';
import { securityHeaders } from './http/security';
import { adminRoutes } from './routes/admin';
import { accountRoutes, authRoutes } from './routes/auth';
import { gameRoutes } from './routes/games';
import { metaRoutes } from './routes/meta';
import { quizRoutes } from './routes/quizzes';
import { sharedRoutes } from './routes/shared';
import { uploadRoutes } from './routes/uploads';
import { createServices, type Services } from './services';
import { createRealtime } from './socket';

export interface WhatQuizApp {
  app: Express;
  httpServer: HttpServer;
  services: Services;
  manager: GameManager;
  close(): Promise<void>;
}

/** Assemble l'API REST, le temps réel et la base de données (sans servir le frontend). */
export function createApp(config: AppConfig): WhatQuizApp {
  const services = createServices(config);
  services.games.abortUnfinished();
  services.sessions.purgeExpired();

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);
  app.use(securityHeaders(config.isProduction));
  app.use(cors(config.corsOrigins));

  const httpServer = createServer(app);
  const { io, manager } = createRealtime(httpServer, services);

  const api = express.Router();
  api.use(express.json({ limit: '3mb' }));
  api.use(requireJsonForMutations);
  api.use(loadUser(services));
  api.use('/auth', authRoutes(services));
  api.use('/account', accountRoutes(services));
  api.use('/admin', adminRoutes(services));
  api.use('/quizzes', quizRoutes(services));
  api.use('/games', gameRoutes(services, manager));
  api.use('/uploads', uploadRoutes(services));
  api.use('/meta', metaRoutes(services));
  api.use(sharedRoutes(services));
  api.use((_req, _res, next) => next(notFound()));
  api.use(errorHandler);

  app.use('/api', api);
  app.use('/uploads', express.static(config.uploadDir, { maxAge: '30d', immutable: true, fallthrough: false }));

  return {
    app,
    httpServer,
    services,
    manager,
    async close() {
      manager.shutdown();
      await new Promise<void>((resolve) => io.close(() => resolve()));
      services.db.close();
    },
  };
}
