/** Normalise une réponse libre : casse, accents, espaces et ponctuation finale ignorés. */
export function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.!?;,]+$/, '')
    .trim();
}
