/** Aléatoire cryptographique disponible à la fois dans Node et dans le navigateur (y compris hors HTTPS). */
function randomBytes(length: number): Uint8Array {
  return globalThis.crypto.getRandomValues(new Uint8Array(length));
}

export function randomUuid(): string {
  const b = randomBytes(16);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hex = [...b].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function randomToken(length = 18): string {
  return btoa(String.fromCharCode(...randomBytes(length)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** Entier dans [min, max[. */
export function randomIntBetween(min: number, max: number): number {
  const [value] = globalThis.crypto.getRandomValues(new Uint32Array(1));
  return min + (value % (max - min));
}
