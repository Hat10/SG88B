// Ren logikk for Filmoversikt (filter, sortering, «hva skal vi se i kveld?»,
// duplikatsjekk, rating). Ingen React/Supabase her, slik at alt kan testes.
//
// who-koder: 'M' = Andreas, 'L' = Taran (kolonnene must_m/must_l, rating_m/rating_l).

export type MovieKind = 'film' | 'serie';
export type MovieWho = 'M' | 'L';

export interface Movie {
  id: string;
  title: string;
  kind: MovieKind;
  mustM: boolean;            // Andreas må være med
  mustL: boolean;            // Taran må være med
  watchedAt: string | null;  // 'YYYY-MM-DD'; null = ikke sett
  ratingM: number | null;    // 1–5
  ratingL: number | null;    // 1–5
  note: string | null;
  addedBy: MovieWho | null;
  createdAt: string;
  updatedAt: string;
}

export type MovieTab = 'want' | 'seen';
export type MustFilter = 'all' | 'both' | 'onlyM' | 'onlyL' | 'none';
export type KindFilter = 'all' | MovieKind;
export type MovieSort = 'added' | 'alpha' | 'rating' | 'seen';
export type Presence = 'both' | MovieWho;

export const WHO_NAME: Record<MovieWho, string> = { M: 'Andreas', L: 'Taran' };

export const isWatched = (m: Movie) => m.watchedAt != null;

/** Trim og slå sammen doble (og andre) mellomrom. */
export const normalizeTitle = (raw: string): string => raw.trim().replace(/\s+/g, ' ');

const titleKey = (t: string) => normalizeTitle(t).toLowerCase();

/**
 * Finner en eksisterende tittel som kolliderer med den unike indeksen
 * (lower(title), kind). `exceptId` brukes ved redigering.
 */
export function findDuplicate(movies: Movie[], title: string, kind: MovieKind, exceptId?: string): Movie | null {
  const key = titleKey(title);
  if (!key) return null;
  return movies.find(m => m.id !== exceptId && m.kind === kind && titleKey(m.title) === key) ?? null;
}

export function matchesMust(m: Movie, f: MustFilter): boolean {
  switch (f) {
    case 'both':  return m.mustM && m.mustL;
    case 'onlyM': return m.mustM && !m.mustL;
    case 'onlyL': return m.mustL && !m.mustM;
    case 'none':  return !m.mustM && !m.mustL;
    default:      return true;
  }
}

export interface MovieFilters {
  tab: MovieTab;
  must: MustFilter;
  kind: KindFilter;
  query: string;
}

export function applyFilters(movies: Movie[], f: MovieFilters): Movie[] {
  const q = f.query.trim().toLowerCase();
  return movies.filter(m =>
    (f.tab === 'seen' ? isWatched(m) : !isWatched(m)) &&
    matchesMust(m, f.must) &&
    (f.kind === 'all' || m.kind === f.kind) &&
    (!q || m.title.toLowerCase().includes(q)),
  );
}

/** Snitt av ratingene, bare når begge har ratet. */
export function avgRating(m: Movie): number | null {
  return m.ratingM != null && m.ratingL != null ? (m.ratingM + m.ratingL) / 2 : null;
}

/** Hvem som mangler rating (for «Mangler rating fra …»). */
export function missingRatings(m: Movie): MovieWho[] {
  const out: MovieWho[] = [];
  if (m.ratingM == null) out.push('M');
  if (m.ratingL == null) out.push('L');
  return out;
}

// Rating for sortering: snitt av de ratingene som finnes (én rating teller også),
// uratede sist.
const sortRating = (m: Movie): number | null => {
  const r = [m.ratingM, m.ratingL].filter((x): x is number => x != null);
  return r.length ? r.reduce((a, b) => a + b, 0) / r.length : null;
};

const byAlpha = (a: Movie, b: Movie) => a.title.localeCompare(b.title, 'nb', { sensitivity: 'base' });
const byAdded = (a: Movie, b: Movie) => b.createdAt.localeCompare(a.createdAt);

export function sortMovies(movies: Movie[], sort: MovieSort): Movie[] {
  const list = [...movies];
  switch (sort) {
    case 'alpha':
      return list.sort(byAlpha);
    case 'rating':
      return list.sort((a, b) => {
        const ra = sortRating(a), rb = sortRating(b);
        if (ra == null && rb == null) return byAlpha(a, b);
        if (ra == null) return 1;
        if (rb == null) return -1;
        return rb - ra || byAlpha(a, b);
      });
    case 'seen':
      return list.sort((a, b) => (b.watchedAt ?? '').localeCompare(a.watchedAt ?? '') || byAdded(a, b));
    default:
      return list.sort(byAdded);
  }
}

/**
 * Titler fra «Vil se» som kan ses av de tilstedeværende: en fraværende person
 * som er obligatorisk utelukker tittelen. «Bare Andreas» ⇒ must_l = false.
 */
export function eligibleForTonight(movies: Movie[], presence: Presence, kind: KindFilter = 'all'): Movie[] {
  return movies.filter(m =>
    !isWatched(m) &&
    (kind === 'all' || m.kind === kind) &&
    (presence === 'both' || (presence === 'M' ? !m.mustL : !m.mustM)),
  );
}

/**
 * Trekker en tilfeldig tittel. `avoidId` (forrige trekk) unngås når det finnes
 * andre valg, slik at «Trekk på nytt» faktisk gir noe nytt.
 */
export function pickRandom(pool: Movie[], rng: () => number = Math.random, avoidId?: string): Movie | null {
  const options = pool.length > 1 && avoidId ? pool.filter(m => m.id !== avoidId) : pool;
  if (!options.length) return null;
  const i = Math.min(options.length - 1, Math.floor(rng() * options.length));
  return options[i];
}

/** Trykk på valgt stjerne igjen fjerner ratingen. */
export const nextRating = (current: number | null, tapped: number): number | null =>
  current === tapped ? null : tapped;

/** Postgres unique_violation. */
export const isUniqueViolation = (err: { code?: string } | null | undefined) => err?.code === '23505';
