/** État de la sauvegarde en ligne (mode sans serveur), partagé entre le moteur de synchronisation et l'affichage. */

export type CloudState = 'off' | 'connecting' | 'syncing' | 'synced' | 'offline' | 'error';

export interface CloudStatus {
  state: CloudState;
  message?: string;
  /** Heure de la dernière synchronisation complète réussie. */
  syncedAt?: string;
  /** La session en ligne a expiré (mot de passe changé ailleurs…) : il faut se reconnecter. */
  reconnect?: boolean;
}

let status: CloudStatus = { state: 'off' };
const listeners = new Set<(status: CloudStatus) => void>();

export const cloudStatus = () => status;

export function onCloudStatus(listener: (status: CloudStatus) => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

export function setCloudStatus(next: CloudStatus): void {
  status = { syncedAt: status.syncedAt, ...next };
  for (const listener of listeners) listener(status);
}

/** Problème constaté hors du moteur (ex. : adresse déjà prise par un autre compte en ligne). */
export function reportCloudProblem(message: string): void {
  setCloudStatus({ state: 'error', message });
}

