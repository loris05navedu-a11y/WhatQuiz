import type { RequestHandler } from 'express';

/**
 * CORS pour un frontend hébergé ailleurs (GitHub Pages). Seules les origines listées dans CORS_ORIGINS sont
 * autorisées ; l'authentification passe par un en-tête Authorization (jamais par cookie), donc pas de « credentials ».
 */
export function cors(allowedOrigins: string[]): RequestHandler {
  const allowed = new Set(allowedOrigins);
  return (req, res, next) => {
    const origin = req.headers.origin;
    if (origin && allowed.has(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.vary('Origin');
      if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Auth-Mode');
        res.setHeader('Access-Control-Max-Age', '86400');
        return void res.status(204).end();
      }
    }
    next();
  };
}
