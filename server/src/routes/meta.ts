import { networkInterfaces } from 'node:os';
import { Router } from 'express';
import type { AppConfig } from '../config';
import type { Services } from '../services';

/**
 * Adresses IPv4 du réseau local : ce sont elles que les élèves doivent ouvrir.
 * Sur Android récent (Termux), la lecture des interfaces réseau peut être refusée : on renvoie alors une liste vide.
 */
export function lanAddresses(): string[] {
  try {
    return Object.values(networkInterfaces())
      .flatMap((entries) => entries ?? [])
      .filter((entry) => entry.family === 'IPv4' && !entry.internal)
      .map((entry) => entry.address);
  } catch {
    return [];
  }
}

export function joinBaseUrls(config: AppConfig): string[] {
  if (config.publicUrl) return [config.publicUrl];
  return lanAddresses().map((ip) => `http://${ip}:${config.port}`);
}

export function metaRoutes(services: Services): Router {
  const router = Router();
  router.get('/', (_req, res) => {
    res.json({ lanUrls: joinBaseUrls(services.config) });
  });
  return router;
}
