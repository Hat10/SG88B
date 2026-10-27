// Rene funksjoner bak typefilteret i Trening → Statistikk («Når trener …?»).
// Ingen React og ingen Supabase, så logikken kan testes uten å dra med siden.
//
// Filteret lagrer de typene som er valgt BORT (`excluded`), ikke de valgte:
// tomt sett = alle typer med, og en ny kategori er automatisk med.

import type { WorkoutCategory, WorkoutSession } from '../contexts/TreningContext';

/** Navnet økter uten kategori vises og filtreres under. */
export const NO_CATEGORY = 'Uten kategori';

/** Kategorinavnet til en økt — `'Uten kategori'` når det er tomt. */
export const categoryName = (s: Pick<WorkoutSession, 'category'>): string => s.category || NO_CATEGORY;

/**
 * Typene filteret tilbyr: ikke-arkiverte kategorier i sortOrder, deretter navn
 * som bare finnes på øktene (omdøpte/slettede kategorier, alfabetisk), og til
 * slutt `'Uten kategori'` hvis noen økter mangler kategori. Gi inn øktene til
 * begge personer, så listen er lik i begge fanene. Ingen duplikater.
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

  const orphans = new Set<string>();
  let hasNone = false;
  for (const s of sessions) {
    if (!s.category) hasNone = true;
    else if (!known.has(s.category)) orphans.add(s.category);
  }

  [...orphans].sort((a, b) => a.localeCompare(b, 'nb')).forEach(add);
  if (hasNone) add(NO_CATEGORY);
  return out;
}

/** `excluded` begrenset til typene som faktisk tilbys — foreldreløse navn i settet er harmløse, men skal ikke telle. */
export function effectiveExcluded(excluded: ReadonlySet<string>, available: readonly string[]): Set<string> {
  const avail = new Set(available);
  return new Set([...excluded].filter(c => avail.has(c)));
}

/** Øktene som ikke har en bortvalgt type. Tomt `excluded` = ingen filtrering. Match på navn. */
export function filterByCategories<T extends Pick<WorkoutSession, 'category'>>(
  sessions: T[],
  excluded: ReadonlySet<string>,
): T[] {
  if (excluded.size === 0) return sessions;
  return sessions.filter(s => !excluded.has(categoryName(s)));
}

/**
 * Veksler en type i `excluded`. Ville klikket valgt bort den siste valgte
 * typen, tømmes settet i stedet — «ingen valgt» er aldri en tilstand.
 */
export function toggleCategory(
  excluded: ReadonlySet<string>,
  name: string,
  available: readonly string[],
): Set<string> {
  const next = new Set(excluded);
  if (next.has(name)) next.delete(name); else next.add(name);
  if (available.length > 0 && available.every(c => next.has(c))) return new Set();
  return next;
}

/** Antall økter per ukedag, mandag først (indeks 0) til søndag (indeks 6). */
export function countByWeekday(sessions: Pick<WorkoutSession, 'startedAt'>[]): number[] {
  const counts = Array.from({ length: 7 }, () => 0);
  for (const s of sessions) counts[(new Date(s.startedAt).getDay() + 6) % 7] += 1;
  return counts;
}
