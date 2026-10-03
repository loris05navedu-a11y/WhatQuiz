/**
 * Mise à jour automatique : le site et l'application Android affichent toujours la dernière version publiée.
 * Au lancement et au retour sur l'appli, on compare la version publiée (version.json, jamais en cache) à celle chargée ;
 * si elle a changé, on vide les caches et on recharge. Jamais pendant une partie ni dans l'éditeur.
 */
const BUSY = /\/(host|play|quizzes\/(new|\d+))(\/|$|\?)/;

async function purge(): Promise<void> {
  try {
    const registrations = await navigator.serviceWorker?.getRegistrations();
    await Promise.all((registrations ?? []).map((r) => r.unregister()));
    await Promise.all((await caches.keys()).map((key) => caches.delete(key)));
  } catch {
    // Sans cache à vider, le rechargement suffit.
  }
}

async function check(): Promise<void> {
  if (BUSY.test(location.pathname.slice(import.meta.env.BASE_URL.length - 1))) return;
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) return;
    const { id } = (await response.json()) as { id?: string };
    if (!id || id === __BUILD_ID__ || sessionStorage.getItem('whatquiz-updated') === id) return;
    sessionStorage.setItem('whatquiz-updated', id);
    await purge();
    location.reload();
  } catch {
    // Hors ligne : on garde la version actuelle.
  }
}

export function startAutoUpdate(): void {
  if (!import.meta.env.PROD) return;
  void check();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void check();
  });
  window.addEventListener('focus', () => void check());
}
