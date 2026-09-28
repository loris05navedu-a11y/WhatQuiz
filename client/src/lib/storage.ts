/** Accès au stockage navigateur tolérant aux erreurs (navigation privée, stockage bloqué). */
export function readStorage(storage: 'local' | 'session', key: string): string | null {
  try {
    return (storage === 'local' ? localStorage : sessionStorage).getItem(key);
  } catch {
    return null;
  }
}

export function writeStorage(storage: 'local' | 'session', key: string, value: string | null): void {
  try {
    const target = storage === 'local' ? localStorage : sessionStorage;
    if (value === null) target.removeItem(key);
    else target.setItem(key, value);
  } catch {
    // Stockage indisponible : la fonctionnalité reste utilisable sans persistance.
  }
}
