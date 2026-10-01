import { useCallback, useRef, useState } from 'react';

const MAX_STEPS = 100;
/** Les modifications rapprochées (frappe au clavier) forment une seule étape d'annulation. */
const MERGE_WINDOW_MS = 800;

interface History<T> {
  past: T[];
  present: T;
  future: T[];
}

/** État avec annulation / rétablissement. `set` accepte une valeur ou une fonction de mise à jour. */
export function useHistory<T>(initial: T) {
  const [history, setHistory] = useState<History<T>>({ past: [], present: initial, future: [] });
  const lastEdit = useRef(0);

  const set = useCallback((change: T | ((current: T) => T), options: { merge?: boolean } = {}) => {
    setHistory((h) => {
      const next = typeof change === 'function' ? (change as (current: T) => T)(h.present) : change;
      if (Object.is(next, h.present)) return h;
      const now = Date.now();
      const merge = options.merge !== false && now - lastEdit.current < MERGE_WINDOW_MS && h.past.length > 0;
      lastEdit.current = now;
      return { past: merge ? h.past : [...h.past, h.present].slice(-MAX_STEPS), present: next, future: [] };
    });
  }, []);

  /** Remplace l'état sans créer d'étape (chargement initial, état enregistré). */
  const reset = useCallback((value: T) => {
    lastEdit.current = 0;
    setHistory({ past: [], present: value, future: [] });
  }, []);

  const undo = useCallback(() => {
    lastEdit.current = 0;
    setHistory((h) => (h.past.length ? { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future] } : h));
  }, []);

  const redo = useCallback(() => {
    lastEdit.current = 0;
    setHistory((h) => (h.future.length ? { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) } : h));
  }, []);

  /** Termine l'étape en cours : la prochaine modification ne sera pas fusionnée. */
  const checkpoint = useCallback(() => {
    lastEdit.current = 0;
  }, []);

  return { value: history.present, set, reset, undo, redo, checkpoint, canUndo: history.past.length > 0, canRedo: history.future.length > 0 };
}
