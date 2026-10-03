import { ApiError } from '../api/errors';
import { setDoorsHealth as setHealth } from './doorsHealth';
import { DoorTakenError, type Door, type Hub } from './hub';
import { NO_NETWORK } from './peer';

/**
 * Ouverture d'une partie aux élèves (mode sans serveur) : liaison directe (PeerJS/WebRTC) et relais en ligne
 * (Firestore), ensemble. La partie démarre dès qu'une des deux est prête ; il faut qu'aucune des deux ne trouve le
 * code déjà pris par une autre partie.
 */

/** Une fois le relais prêt, on laisse encore ce délai à la liaison directe avant d'ouvrir la partie sans elle. */
const DIRECT_GRACE_MS = 3_000;

type Outcome = { ok: true; door: Door } | { ok: false; error: unknown };

const settle = (promise: Promise<Door>): Promise<Outcome> =>
  promise.then(
    (door) => ({ ok: true as const, door }),
    (error: unknown) => ({ ok: false as const, error }),
  );

const later = (ms: number) => new Promise<null>((resolve) => setTimeout(() => resolve(null), ms));

export async function openDoors(code: string, hub: Hub): Promise<Door> {
  const directPromise = import('./peer').then((m) => m.openPeerDoor(code, hub));
  const relayPromise = import('./relay').then((m) => m.openRelayDoor(code, hub));
  const direct = settle(directPromise);
  const relay = await settle(relayPromise);

  if (!relay.ok && relay.error instanceof DoorTakenError) {
    void directPromise.then((door) => door.close(), () => undefined);
    throw relay.error;
  }
  const directNow = relay.ok ? await Promise.race([direct, later(DIRECT_GRACE_MS)]) : await direct;
  if (directNow && !directNow.ok && directNow.error instanceof DoorTakenError) {
    if (relay.ok) relay.door.close();
    throw directNow.error;
  }

  const doors: Door[] = [];
  let closed = false;
  if (relay.ok) doors.push(relay.door);
  if (directNow?.ok) doors.push(directNow.door);
  if (doors.length === 0) throw new ApiError(503, NO_NETWORK);

  const relayProblem = relay.ok ? null : relay.error instanceof Error ? relay.error.message : 'Relais en ligne indisponible';
  if (!relay.ok) console.warn('[whatquiz] Partie sans relais en ligne :', relayProblem);
  setHealth({ relay: relay.ok, relayProblem, direct: directNow ? directNow.ok : null });

  // Liaison directe encore en cours d'ouverture : elle rejoint la partie dès qu'elle est prête.
  if (directNow === null) {
    void direct.then((outcome) => {
      if (!outcome.ok) {
        setHealth({ direct: false });
        return;
      }
      if (closed) outcome.door.close();
      else {
        doors.push(outcome.door);
        setHealth({ direct: true });
      }
    });
  }

  return {
    close() {
      closed = true;
      for (const door of doors.splice(0)) door.close();
    },
  };
}
