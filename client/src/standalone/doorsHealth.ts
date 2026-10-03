/** État des liaisons de la dernière partie ouverte sur cet appareil (affiché sur l'écran du professeur). */
export interface DoorsHealth {
  /** Relais en ligne ouvert (null : pas encore de partie). */
  relay: boolean | null;
  /** Raison de l'absence de relais (règles Firestore non publiées, hors ligne…). */
  relayProblem: string | null;
  direct: boolean | null;
}

let health: DoorsHealth = { relay: null, relayProblem: null, direct: null };
const listeners = new Set<(value: DoorsHealth) => void>();

export const doorsHealth = (): DoorsHealth => health;

export function onDoorsHealth(listener: (value: DoorsHealth) => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

export function setDoorsHealth(next: Partial<DoorsHealth>): void {
  health = { ...health, ...next };
  for (const listener of listeners) listener(health);
}
