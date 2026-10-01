import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import express, { Router } from 'express';
import { detectMedia, MEDIA_RULES, mediaProblem } from '../../../shared/media';
import { requireTeacher } from '../http/auth';
import { HttpError } from '../http/errors';
import type { Services } from '../services';
import { uploadSchema } from '../validation';

const MAX_BYTES = 2 * 1024 * 1024;

/** Détecte le format réel du fichier à partir de ses premiers octets (on ne fait pas confiance au type annoncé). */
function detectImage(buffer: Buffer): 'png' | 'jpg' | 'gif' | 'webp' | null {
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpg';
  if (buffer.subarray(0, 4).toString('ascii') === 'GIF8') return 'gif';
  if (buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'webp';
  return null;
}

export function uploadRoutes(services: Services): Router {
  const router = Router();
  mkdirSync(services.config.uploadDir, { recursive: true });

  router.post('/', requireTeacher, (req, res) => {
    const { dataUrl } = uploadSchema.parse(req.body);
    const match = /^data:image\/[\w+.-]+;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
    if (!match) throw new HttpError(400, 'Image invalide');
    const buffer = Buffer.from(match[1], 'base64');
    if (buffer.length > MAX_BYTES) throw new HttpError(413, 'Image trop lourde (2 Mo maximum)');
    const extension = detectImage(buffer);
    if (!extension) throw new HttpError(400, 'Format d’image non supporté (PNG, JPEG, GIF ou WebP)');
    const fileName = `${randomUUID()}.${extension}`;
    writeFileSync(path.join(services.config.uploadDir, fileName), buffer);
    res.status(201).json({ url: `/uploads/${fileName}` });
  });

  /**
   * Envoi direct d'un fichier (image, GIF, son, vidéo), sans conversion en base64. Le format est reconnu
   * d'après le contenu réel du fichier, jamais d'après le type annoncé ; chaque type a sa taille maximale.
   */
  const maxBytes = Math.max(...Object.values(MEDIA_RULES).map((rule) => rule.maxBytes));
  router.post('/file', requireTeacher, express.raw({ type: ['image/*', 'audio/*', 'video/*', 'application/octet-stream'], limit: maxBytes }), (req, res) => {
    const buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const detected = detectMedia(new Uint8Array(buffer.subarray(0, 32)));
    const problem = mediaProblem(detected, buffer.length, false);
    if (problem || !detected) throw new HttpError(buffer.length > maxBytes ? 413 : 400, problem ?? 'Fichier invalide');
    const fileName = `${randomUUID()}.${detected.extension}`;
    writeFileSync(path.join(services.config.uploadDir, fileName), buffer);
    res.status(201).json({ url: `/uploads/${fileName}`, kind: detected.kind, size: buffer.length });
  });

  return router;
}
