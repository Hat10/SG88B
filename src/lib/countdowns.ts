// Rene hjelpere for Nedtelling-kortet på Gangskjerm (src/pages/skjerm/NedtellingCard.tsx).
// useCountdowns() sorterer stigende på dato men filtrerer ikke — Dashboard bruker den til
// CRUD og trenger alle — så «kun kommende» gjøres her, i visningslaget.

/** Dagens dato i Oslo (yyyy-mm-dd), uavhengig av enhetens tidssone. */
export function osloToday(d: Date = new Date()): string {
  return d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Oslo' });
}

/** Kun nedtellinger med dato >= i dag (dagens vises ut dagen), nærmest først. Stabil ved lik dato. */
export function upcomingCountdowns<T extends { date: string }>(items: T[], todayIso: string): T[] {
  return items.filter(c => c.date >= todayIso).sort((a, b) => a.date.localeCompare(b.date));
}

/** Gyldig indeks i en liste med `n` elementer (0 for tom liste). */
export function clampIndex(i: number, n: number): number {
  return Math.min(Math.max(0, n - 1), Math.max(0, i));
}

/** Hele dager fra `fromIso` til `toIso` (yyyy-mm-dd). UTC-regning, så sommertid ikke kan skyve svaret. */
export function daysBetween(fromIso: string, toIso: string): number {
  const [fy, fm, fd] = fromIso.split('-').map(Number);
  const [ty, tm, td] = toIso.split('-').map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86400000);
}
