import { networkInterfaces } from 'node:os';
import { Router } from 'express';
import type { Services } from '../services';

/** Adresses IPv4 du réseau local : ce sont elles que les élèves doivent ouvrir. */
export function lanAddresses(): string[] {
  return Object.values(networkInterfaces())
    .flatMap((entries) => entries ?? [])
    .filter((entry) => entry.family === 'IPv4' && !entry.internal)
    .map((entry) => entry.address);
}

export function metaRoutes(services: Services): Router {
  const router = Router();
  router.get('/', (_req, res) => {
    res.json({ lanUrls: lanAddresses().map((ip) => `http://${ip}:${services.config.port}`) });
  });
  return router;
}
