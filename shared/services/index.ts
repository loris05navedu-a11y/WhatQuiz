import { bankRoutes } from './bank';
import type { SharedRoute } from './context';
import { versionRoutes } from './versions';

/** Routes communes au serveur et au mode sans serveur (chemins relatifs à /api). */
export const SHARED_ROUTES: SharedRoute[] = [...versionRoutes, ...bankRoutes];

export function matchSharedRoute(method: string, path: string): { route: SharedRoute; params: string[] } | null {
  for (const route of SHARED_ROUTES) {
    if (route.method !== method) continue;
    const match = route.pattern.exec(path);
    if (match) return { route, params: match.slice(1) };
  }
  return null;
}
