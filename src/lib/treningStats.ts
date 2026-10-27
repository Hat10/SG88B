// Rene funksjoner bak typefilteret i Trening → Statistikk («Når trener …?»).
// Ingen React og ingen Supabase, så logikken kan testes uten å dra med siden.
//
// Filteret lagrer de typene som er valgt (`selected`): tomt sett = ingen
// filtrering (alle typer vises), og et trykk på en type viser bare de valgte.

import type { WorkoutCategory, WorkoutSession } from '../contexts/TreningContext';

/** Navnet økter uten kategori vises og filtreres under. */
export const NO_CATEGORY = 'Uten kategori';

/** Kategorinavnet til en økt — `'Uten kategori'` når det er tomt. */
export const categoryName = (s: Pick<WorkoutSession, 'category'>): string => s.category || NO_CATEGORY;

/**
 * Typene filteret tilbyr: ikke-arkiverte kategorier i sortOrder, deretter —
 * samlet og alfabetisk — arkiverte kategorier som minst én økt bruker og navn
 * som bare finnes på øktene (omdøpte/slettede kategorier), og til slutt
 * `'Uten kategori'` hvis noen økter mangler kategori. Arkiverte kategorier
 * uten økter utelates. Gi inn øktene til begge personer, så listen er lik i
 * begge fanene. Ingen duplikater.
 */
export function availableCategories(
  categories: Pick<WorkoutCategory, 'name' | 'sortOrder' | 'archived'>[],
  sessions: Pick<WorkoutSession, 'category'>[],
): string[] {
  const known = new Set(categories.map(c => c.name));
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (name: string) => { if (!seen.has(name)) { seen.add(name); out.push(name); } };

  categories
    .filter(c => !c.archived)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .forEach(c => add(c.name));

  const archived = new Set(categories.filter(c => c.archived).map(c => c.name));
  const later = new Set<string>();
  let hasNone = false;
  for (const s of sessions) {
    if (!s.category) hasNone = true;
    else if (!known.has(s.category) || archived.has(s.category)) later.add(s.category);
  }

  [...later].sort((a, b) => a.localeCompare(b, 'nb')).forEach(add);
  if (hasNone) add(NO_CATEGORY);
  return out;
}

/** `selected` begrenset til typene som faktisk tilbys. Står ingen igjen, er resultatet tomt (= alle typer vises). */
export function effectiveSelected(selected: ReadonlySet<string>, available: readonly string[]): Set<string> {
  const avail = new Set(available);
  return new Set([...selected].filter(c => avail.has(c)));
}

/** Bare øktene med en valgt type. Tomt `selected` = ingen filtrering. Match på navn. */
export function filterByCategories<T extends Pick<WorkoutSession, 'category'>>(
  sessions: T[],
  selected: ReadonlySet<string>,
): T[] {
  if (selected.size === 0) return sessions;
  return sessions.filter(s => selected.has(categoryName(s)));
}

/** Veksler en type i `selected`. Blir settet tomt, er man tilbake til «Alle». */
export function toggleCategory(selected: ReadonlySet<string>, name: string): Set<string> {
  const next = new Set(selected);
  if (next.has(name)) next.delete(name); else next.add(name);
  return next;
}

/** Antall økter per ukedag, mandag først (indeks 0) til søndag (indeks 6). */
export function countByWeekday(sessions: Pick<WorkoutSession, 'startedAt'>[]): number[] {
  const counts = Array.from({ length: 7 }, () => 0);
  for (const s of sessions) counts[(new Date(s.startedAt).getDay() + 6) % 7] += 1;
  return counts;
}
