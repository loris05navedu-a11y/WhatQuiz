import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

/**
 * Glisser-déposer tactile d'une liste (pointer events : doigt, stylet et souris).
 * La poignée lance le déplacement ; la position cible est calculée d'après le milieu des éléments,
 * à la verticale ou à l'horizontale selon la disposition de la liste (bande horizontale sur tablette en portrait).
 */
export function useReorder(onMove: (from: number, to: number) => void) {
  const [drag, setDrag] = useState<{ from: number; to: number } | null>(null);
  const items = useRef(new Map<number, HTMLElement>());
  const state = useRef<{ from: number; to: number } | null>(null);

  const register = useCallback((index: number) => (element: HTMLElement | null) => {
    if (element) items.current.set(index, element);
    else items.current.delete(index);
  }, []);

  const targetAt = (x: number, y: number) => {
    const entries = [...items.current.entries()].sort((a, b) => a[0] - b[0]);
    const parent = entries[0]?.[1].parentElement;
    const horizontal = parent ? getComputedStyle(parent).flexDirection.startsWith('row') : false;
    let target = 0;
    for (const [index, element] of entries) {
      const box = element.getBoundingClientRect();
      if (horizontal ? x > box.left + box.width / 2 : y > box.top + box.height / 2) target = index + 1;
    }
    return target;
  };

  const handleProps = (index: number) => ({
    onPointerDown(event: ReactPointerEvent<HTMLElement>) {
      if (event.button !== 0) return;
      event.preventDefault();
      (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
      state.current = { from: index, to: index };
      setDrag(state.current);
    },
    onPointerMove(event: ReactPointerEvent<HTMLElement>) {
      if (!state.current) return;
      const raw = targetAt(event.clientX, event.clientY);
      const to = raw > state.current.from ? raw - 1 : raw;
      if (to !== state.current.to) {
        state.current = { ...state.current, to };
        setDrag(state.current);
      }
    },
    onPointerUp() {
      const current = state.current;
      state.current = null;
      setDrag(null);
      if (current && current.to !== current.from) onMove(current.from, current.to);
    },
    onPointerCancel() {
      state.current = null;
      setDrag(null);
    },
    style: { touchAction: 'none' as const, cursor: 'grab' },
  });

  return { drag, register, handleProps };
}

export function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list;
  const copy = [...list];
  const [item] = copy.splice(from, 1);
  copy.splice(to, 0, item);
  return copy;
}
