// Ren logikk for Filmoversikt (filter, sortering, «hva skal vi se i kveld?»,
// duplikatsjekk, rating). Ingen React/Supabase her, slik at alt kan testes.
//
// who-koder: 'M' = Andreas, 'L' = Taran (kolonnene must_m/must_l, rating_m/rating_l).

import type { TmdbCandidate, TmdbKind } from './tmdb';

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
  // TMDB-kobling (scripts/movies-tmdb-migration.sql). Alle er null når filmen
  // ikke er koblet, eller når migreringen ikke er kjørt ennå.
  tmdbId: number | null;
  tmdbKind: TmdbKind | null;
  posterPath: string | null;
  releaseYear: number | null;
  runtimeMin: number | null;   // film: spilletid; serie: episodelengde
  genres: string[];
  overview: string | null;
  tmdbSyncedAt: string | null;
}

export const isLinked = (m: Movie) => m.tmdbId != null;

export type MovieTab = 'want' | 'seen';
export type MustFilter = 'all' | 'both' | 'onlyM' | 'onlyL' | 'none';
export type KindFilter = 'all' | MovieKind;
export type LinkFilter = 'all' | 'unlinked';
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
  /** 'unlinked' = bare titler som ikke er koblet til TMDB. Utelatt = alle. */
  link?: LinkFilter;
}

export function applyFilters(movies: Movie[], f: MovieFilters): Movie[] {
  const q = f.query.trim().toLowerCase();
  return movies.filter(m =>
    (f.tab === 'seen' ? isWatched(m) : !isWatched(m)) &&
    matchesMust(m, f.must) &&
    (f.kind === 'all' || m.kind === f.kind) &&
    (f.link !== 'unlinked' || !isLinked(m)) &&
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

const byTitle = (a: Movie, b: Movie) => a.title.localeCompare(b.title, 'nb', { sensitivity: 'base' });
// Deterministisk tie-breaker for alle sorteringer: tittel, deretter id. Uten den
// avhenger rekkefølgen av radrekkefølgen fra databasen (f.eks. seedede rader med
// identisk created_at), og rader kan hoppe etter en oppdatering.
const byTitleThenId = (a: Movie, b: Movie) => byTitle(a, b) || a.id.localeCompare(b.id);

export function sortMovies(movies: Movie[], sort: MovieSort): Movie[] {
  const primary = (a: Movie, b: Movie): number => {
    switch (sort) {
      case 'alpha':
        return 0;
      case 'rating': {
        const ra = sortRating(a), rb = sortRating(b);
        if (ra == null && rb == null) return 0;
        if (ra == null) return 1;
        if (rb == null) return -1;
        return rb - ra;
      }
      case 'seen':
        return (b.watchedAt ?? '').localeCompare(a.watchedAt ?? '');
      default:
        return b.createdAt.localeCompare(a.createdAt);
    }
  };
  return [...movies].sort((a, b) => primary(a, b) || byTitleThenId(a, b));
}

export interface VisibleMovie { movie: Movie; dimmed: boolean }

/**
 * Filtrert og sortert liste. Rader i `pinned` (id-er som falt ut av filteret
 * etter en lagret redigering) blir stående, dempet, så lenge de er i samme fane.
 * Plasseringen følger vanlig sortering, så en redigering flytter ikke raden
 * med mindre feltet den sorteres på er endret.
 */
export function visibleMovies(
  movies: Movie[], f: MovieFilters, sort: MovieSort, pinned: ReadonlySet<string> = new Set(),
): VisibleMovie[] {
  const matched = applyFilters(movies, f);
  const matchedIds = new Set(matched.map(m => m.id));
  const kept = pinned.size
    ? applyFilters(movies, { tab: f.tab, must: 'all', kind: 'all', query: '' })
        .filter(m => pinned.has(m.id) && !matchedIds.has(m.id))
    : [];
  return sortMovies([...matched, ...kept], sort).map(movie => ({ movie, dimmed: !matchedIds.has(movie.id) }));
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

// ─── TMDB-kobling ─────────────────────────────────────────────────────────

/** Annen rad som allerede er koblet til samme TMDB-tittel (delvis unik indeks). */
export function findTmdbDuplicate(movies: Movie[], kind: TmdbKind, id: number, exceptId?: string): Movie | null {
  return movies.find(m => m.id !== exceptId && m.tmdbKind === kind && m.tmdbId === id) ?? null;
}

/** Små bokstaver, uten aksenter og tegnsetting: «Mamma Mia!» → «mamma mia». */
export function matchKey(raw: string): string {
  return raw
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** «IT 1», «Avatar 3», «Bridget Jones 4»: vår nummerering stemmer sjelden med TMDB-tittelen. */
export const hasSequelNumber = (title: string) => /\S\s+\d{1,2}$/.test(normalizeTitle(title));

export type MatchReason = 'sequel' | 'ambiguous' | 'none';

export type TmdbMatch =
  | { status: 'sure'; candidate: TmdbCandidate }
  | { status: 'unsure'; reason: MatchReason; candidates: TmdbCandidate[] };

/** Hvor mye mer populært det beste eksakte treffet må være for å slå ut et annet eksakt treff. */
export const DOMINANCE = 10;
const MAX_CANDIDATES = 4;

/**
 * Streng automatisk matching av en tittel mot TMDB-søketreff. Gjetter aldri:
 * - Titler som slutter på et løpenummer («Spy Kids 3») er alltid usikre.
 * - Kun eksakt titteltreff (mot tittel eller originaltittel, etter matchKey) teller.
 *   Med år kreves i tillegg ±1 år.
 * - Ett eksakt treff ⇒ sikkert. Flere eksakte treff ⇒ sikkert bare hvis det mest
 *   populære er minst DOMINANCE ganger så populært som det neste.
 * Usikre treff returnerer de beste kandidatene (eksakte først) til manuelt valg.
 */
export function matchTmdb(title: string, candidates: TmdbCandidate[], kind: TmdbKind, year: number | null = null): TmdbMatch {
  const pool = candidates.filter(c => c.kind === kind);
  const key = matchKey(title);
  const isExact = (c: TmdbCandidate) =>
    !!key && (matchKey(c.title) === key || matchKey(c.originalTitle) === key) &&
    (year == null || (c.year != null && Math.abs(c.year - year) <= 1));
  const exact = pool.filter(isExact).sort((a, b) => b.popularity - a.popularity);
  const shortlist = [...exact, ...pool.filter(c => !exact.includes(c))].slice(0, MAX_CANDIDATES);

  if (!pool.length) return { status: 'unsure', reason: 'none', candidates: [] };
  if (hasSequelNumber(title)) return { status: 'unsure', reason: 'sequel', candidates: shortlist };
  if (exact.length === 1) return { status: 'sure', candidate: exact[0] };
  if (exact.length > 1) {
    const [a, b] = exact;
    if (a.popularity > 0 && a.popularity >= b.popularity * DOMINANCE) return { status: 'sure', candidate: a };
    return { status: 'unsure', reason: 'ambiguous', candidates: shortlist };
  }
  return { status: 'unsure', reason: 'none', candidates: shortlist };
}
