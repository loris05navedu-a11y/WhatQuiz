import type { RequestHandler } from 'express';

/** En-têtes de sécurité essentiels (équivalent minimal de helmet, sans dépendance). */
export function securityHeaders(strictCsp: boolean): RequestHandler {
  const csp = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "connect-src 'self' ws: wss:",
    "font-src 'self'",
    "manifest-src 'self'",
    "worker-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
  return (_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    // En développement, Vite injecte des scripts en ligne : la CSP stricte n'est appliquée qu'en production.
    if (strictCsp) res.setHeader('Content-Security-Policy', csp);
    next();
  };
}
