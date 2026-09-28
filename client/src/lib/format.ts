const dateFormatter = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
const dateTimeFormatter = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const numberFormatter = new Intl.NumberFormat('fr-FR');

export const formatDate = (iso: string) => dateFormatter.format(new Date(iso));
export const formatDateTime = (iso: string) => dateTimeFormatter.format(new Date(iso));
export const formatNumber = (value: number) => numberFormatter.format(value);
export const formatPercent = (ratio: number | null) => (ratio === null ? '—' : `${Math.round(ratio * 100)} %`);
export const formatSeconds = (ms: number | null) => (ms === null ? '—' : `${(ms / 1000).toFixed(1).replace('.', ',')} s`);

export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${formatNumber(count)} ${count > 1 ? pluralForm : singular}`;
}

/** « il y a 3 min », « hier »… pour les dates récentes. */
export function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(diff / 60_000);
  if (minutes < 1) return "à l'instant";
  if (minutes < 60) return `il y a ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `il y a ${hours} h`;
  const days = Math.round(hours / 24);
  if (days === 1) return 'hier';
  if (days < 7) return `il y a ${days} jours`;
  return formatDate(iso);
}

/** Rang en toutes lettres : « 1er », « 2e »… */
export const formatRank = (rank: number) => (rank === 1 ? '1er' : `${rank}e`);
