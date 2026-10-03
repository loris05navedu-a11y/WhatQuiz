/**
 * Surveillance de présence des élèves pendant une partie (façon « mode focus » de PIX).
 *
 * Trois sources, de la plus rapide à la plus sûre :
 *  1. le navigateur signale qu'il passe en arrière-plan (onglet changé, page fermée, autre fenêtre…) ;
 *  2. l'application Android (APK) signale ce que voit le système : bouton Accueil, applis récentes,
 *     volet de notifications, écran partagé, écran éteint ;
 *  3. l'hôte de la partie (serveur ou appareil du professeur) attend un signe de vie toutes les 2 s :
 *     sans nouvelles, l'élève est déclaré « injoignable » même si son appareil n'a rien pu envoyer
 *     (application tuée, téléphone verrouillé, réseau coupé, page gelée).
 * Les heures et les durées sont toujours mesurées par l'hôte, jamais par l'appareil de l'élève.
 */

export type PresenceState = 'present' | 'away' | 'unfocused' | 'lost';

export const AWAY_REASONS = [
  'hidden',
  'pagehide',
  'blur',
  'app-pause',
  'app-leave',
  'app-unfocus',
  'split-screen',
  'screen-off',
  'unpinned',
  'silent',
  'disconnected',
] as const;
export type AwayReason = (typeof AWAY_REASONS)[number];

/** Raisons qu'un appareil d'élève peut signaler (les autres sont constatées par l'hôte). */
export const REPORTABLE_REASONS = AWAY_REASONS.filter((r) => r !== 'silent' && r !== 'disconnected');

export const PRESENCE_REASON_LABELS: Record<AwayReason, string> = {
  hidden: 'a quitté l’onglet ou l’application',
  pagehide: 'a fermé ou rechargé la page',
  blur: 'n’est plus sur la fenêtre de la partie',
  'app-pause': 'a quitté l’application',
  'app-leave': 'a quitté l’application (bouton Accueil ou applis récentes)',
  'app-unfocus': 'a ouvert un autre élément par-dessus l’application',
  'split-screen': 'utilise l’écran partagé avec une autre application',
  'screen-off': 'a éteint l’écran',
  unpinned: 'a désépinglé l’application',
  silent: 'ne répond plus (application fermée, écran verrouillé ou réseau coupé)',
  disconnected: 'a perdu la connexion',
};

/** État associé à une raison : sortie franche, perte de premier plan, ou absence constatée par l'hôte. */
export function stateForReason(reason: AwayReason): Exclude<PresenceState, 'present'> {
  if (reason === 'blur' || reason === 'app-unfocus' || reason === 'split-screen') return 'unfocused';
  if (reason === 'silent' || reason === 'disconnected') return 'lost';
  return 'away';
}

/** Gravité pour l'affichage (une sortie franche l'emporte sur une perte de premier plan). */
export const PRESENCE_SEVERITY: Record<PresenceState, number> = { present: 0, unfocused: 1, lost: 2, away: 3 };

export const PRESENCE_STATE_LABELS: Record<PresenceState, string> = {
  present: 'Dans la partie',
  unfocused: 'Hors premier plan',
  away: 'Sorti de la partie',
  lost: 'Injoignable',
};

/** Un signe de vie est attendu toutes les 2 s ; au-delà de 6 s sans nouvelles, l'élève est injoignable. */
export const PRESENCE_BEAT_MS = 2_000;
export const PRESENCE_SILENT_MS = 6_000;
/**
 * Élève relié par le relais en ligne (appareils qui ne peuvent pas se joindre directement) : chaque message coûte une
 * écriture en ligne, le signe de vie part donc toutes les 15 s (tout changement d'état part aussitôt).
 */
export const RELAY_BEAT_MS = 15_000;
export const PRESENCE_SILENT_RELAY_MS = 45_000;
/** Une perte de focus plus courte est ignorée (menus, claviers, boîtes de dialogue du système). */
export const PRESENCE_BLUR_GRACE_MS = 1_200;
/** Taille maximale du journal conservé par partie. */
export const PRESENCE_LOG_LIMIT = 300;

/** Signal envoyé par l'appareil de l'élève. `v` : la page est visible et au premier plan. */
export type PresenceReport =
  | { s: 'beat'; v: boolean; app?: boolean; pinned?: boolean }
  | { s: 'away'; r: AwayReason; app?: boolean }
  | { s: 'back'; app?: boolean };

export interface PresenceInfo {
  state: PresenceState;
  reason: AwayReason | null;
  /** Début de l'absence en cours (horloge de l'hôte), sinon null. */
  since: number | null;
  /** Nombre de sorties pendant la partie. */
  exits: number;
  /** Temps total passé hors de la partie (absences terminées). */
  awayMs: number;
  /** L'élève joue dans l'application Android (signaux du système disponibles). */
  app: boolean;
  /** Application épinglée à l'écran (Android). */
  pinned: boolean;
}

export interface PresenceEvent {
  id: number;
  playerId: string;
  nickname: string;
  kind: 'away' | 'back';
  state: PresenceState;
  reason: AwayReason | null;
  /** Heure de l'hôte (ms). */
  at: number;
  /** Durée de l'absence (événement « back »). */
  durationMs?: number;
  /** Numéro de la question en cours (0 = avant la première). */
  question: number;
}

/** Bilan par élève, enregistré avec les résultats. */
export interface PresenceSummary {
  exits: number;
  awayMs: number;
}

export function formatAwayDuration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes} min ${String(seconds % 60).padStart(2, '0')} s`;
}
