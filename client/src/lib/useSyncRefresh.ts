import { useEffect, useRef } from 'react';

/** Événement envoyé quand des données arrivent d'un autre appareil du même compte (mode sans serveur). */
export const SYNC_EVENT = 'whatquiz-sync';

/** Recharge l'écran quand la synchronisation apporte des changements faits sur un autre appareil. */
export function useSyncRefresh(reload: () => unknown): void {
  const ref = useRef(reload);
  ref.current = reload;
  useEffect(() => {
    const onSync = () => void ref.current();
    window.addEventListener(SYNC_EVENT, onSync);
    return () => window.removeEventListener(SYNC_EVENT, onSync);
  }, []);
}
