import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useSnackbar } from './SnackbarContext';
import { formatError } from '../lib/formatError';
import { isUniqueViolation, type Movie, type MovieKind, type MovieWho } from '../lib/movies';
import type { TmdbFields, TmdbKind } from '../lib/tmdb';

export type MoviePatch = Partial<Pick<Movie, 'title' | 'kind' | 'note' | 'mustM' | 'mustL'>>;

export interface NewMovie {
  title: string;
  kind: MovieKind;
  mustM: boolean;
  mustL: boolean;
  note: string | null;
  addedBy: MovieWho;
  /** Valgt TMDB-treff. Utelatt/null = lagres uten kobling, som før. */
  tmdb?: TmdbFields | null;
}

export type AddResult =
  | { status: 'ok'; id: string }
  | { status: 'duplicate' }
  | { status: 'tmdbDuplicate' }
  | { status: 'error' };

/**
 * ok = lagret; missing = migreringen er ikke kjørt (TMDB-kolonnene finnes ikke);
 * duplicate = TMDB-tittelen er allerede koblet til en annen rad; error = annen feil.
 */
export type TmdbResult = 'ok' | 'missing' | 'duplicate' | 'error';

interface MovieCtx {
  movies: Movie[];
  loading: boolean;
  add: (m: NewMovie) => Promise<AddResult>;
  update: (id: string, patch: MoviePatch) => Promise<boolean>;
  markWatched: (id: string, date: string) => void;
  unwatch: (id: string) => void;
  setRating: (id: string, who: MovieWho, rating: number | null) => void;
  remove: (movie: Movie) => void;
  /** Koble (fields) eller fjerne kobling (null). `silent` = stille oppfrisking uten snackbar ved feil. */
  setTmdb: (id: string, fields: TmdbFields | null, opts?: { silent?: boolean }) => Promise<TmdbResult>;
}

const noop = () => {};
const MovieContext = createContext<MovieCtx>({
  movies: [], loading: true,
  add: async () => ({ status: 'error' }), update: async () => false,
  markWatched: noop, unwatch: noop, setRating: noop, remove: noop,
  setTmdb: async () => 'error',
});

const fromRow = (r: Record<string, unknown>): Movie => ({
  id: r.id as string,
  title: r.title as string,
  kind: r.kind as MovieKind,
  mustM: r.must_m as boolean,
  mustL: r.must_l as boolean,
  watchedAt: (r.watched_at as string | null) ?? null,
  ratingM: (r.rating_m as number | null) ?? null,
  ratingL: (r.rating_l as number | null) ?? null,
  note: (r.note as string | null) ?? null,
  addedBy: (r.added_by as MovieWho | null) ?? null,
  createdAt: r.created_at as string,
  updatedAt: r.updated_at as string,
  // TMDB-kolonnene finnes ikke før movies-tmdb-migration.sql er kjørt ⇒ undefined ⇒ null.
  tmdbId: (r.tmdb_id as number | null | undefined) ?? null,
  tmdbKind: (r.tmdb_kind as TmdbKind | null | undefined) ?? null,
  posterPath: (r.poster_path as string | null | undefined) ?? null,
  releaseYear: (r.release_year as number | null | undefined) ?? null,
  runtimeMin: (r.runtime_min as number | null | undefined) ?? null,
  genres: Array.isArray(r.genres) ? (r.genres as string[]) : [],
  overview: (r.overview as string | null | undefined) ?? null,
  tmdbSyncedAt: (r.tmdb_synced_at as string | null | undefined) ?? null,
});

// PostgREST svarer PGRST204 («Could not find the 'tmdb_id' column …») og Postgres
// 42703 (undefined_column) når scripts/movies-tmdb-migration.sql ikke er kjørt.
const TMDB_COLUMN = /tmdb_|poster_path|release_year|runtime_min|genres|overview/;
const isMissingTmdbColumn = (error: { code?: string; message?: string } | null | undefined) =>
  !!error && (error.code === 'PGRST204' || error.code === '42703') && TMDB_COLUMN.test(error.message ?? '');

// Brudd på den delvise unike indeksen (tmdb_kind, tmdb_id).
const isTmdbUniqueViolation = (error: { code?: string; message?: string } | null | undefined) =>
  isUniqueViolation(error) && /movies_tmdb_uniq/.test(error?.message ?? '');

const tmdbColumns = (f: TmdbFields | null): DbPatch => f
  ? {
      tmdb_id: f.tmdbId, tmdb_kind: f.tmdbKind, poster_path: f.posterPath, release_year: f.releaseYear,
      runtime_min: f.runtimeMin, genres: f.genres, overview: f.overview, tmdb_synced_at: new Date().toISOString(),
    }
  : {
      tmdb_id: null, tmdb_kind: null, poster_path: null, release_year: null,
      runtime_min: null, genres: null, overview: null, tmdb_synced_at: null,
    };

const tmdbLocal = (f: TmdbFields | null): Partial<Movie> => f
  ? { ...f, tmdbSyncedAt: new Date().toISOString() }
  : {
      tmdbId: null, tmdbKind: null, posterPath: null, releaseYear: null,
      runtimeMin: null, genres: [], overview: null, tmdbSyncedAt: null,
    };

const MIGRATION_MSG = 'TMDB-data ble ikke lagret: kjør scripts/movies-tmdb-migration.sql i Supabase';

// Kolonnene som en kolonne-patch kan røre. updated_at settes fra klienten
// (ingen trigger i dette repoet).
type DbPatch = Record<string, unknown>;
const stamp = (db: DbPatch): DbPatch => ({ ...db, updated_at: new Date().toISOString() });

export function MovieProvider({ children }: { children: React.ReactNode }) {
  const { notify } = useSnackbar();
  const [movies, setMovies] = useState<Movie[]>([]);
  const [loading, setLoading] = useState(true);

  // Optimistiske endringer vs. realtime-reload:
  // - pending = antall skrivinger som venter på svar fra databasen.
  // - epoch økes hver gang en skriving starter.
  // En load() som startet før en skriving, eller som ferdigstilles mens en
  //   skriving venter, forkastes (den kan inneholde gammel tilstand og ville
  //   latt chipen «hoppe tilbake»). Når siste skriving er ferdig, kjøres én
  //   load() som avstemmer med databasen (og ruller tilbake ved feil).
  const pending = useRef(0);
  const epoch = useRef(0);

  const load = async () => {
    const startEpoch = epoch.current;
    const { data } = await supabase.from('movies').select('*')
      .order('created_at', { ascending: false }).order('title').order('id');
    if (pending.current > 0 || epoch.current !== startEpoch) return;
    if (data) setMovies(data.map(fromRow));
    setLoading(false);
  };

  useEffect(() => {
    void load();
    // Krever movies i supabase_realtime (movies-migration.sql).
    const ch = supabase.channel('movies_realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'movies' }, () => { void load(); })
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /** Kjør en skriving beskyttet mot at reload overskriver den optimistiske tilstanden. */
  const write = async <T extends { error: { code?: string; message?: string } | null }>(
    run: () => PromiseLike<T>,
  ): Promise<T> => {
    pending.current++;
    epoch.current++;
    try {
      return await run();
    } finally {
      pending.current--;
      if (pending.current === 0) void load();
    }
  };

  const fail = (error: { message?: string } | null) =>
    notify(`Kunne ikke lagre${error?.message ? ': ' + formatError(error) : ''}`);

  // Én snackbar per økt om at migreringen mangler.
  const warnedMissing = useRef(false);
  const warnMissing = () => {
    if (warnedMissing.current) return;
    warnedMissing.current = true;
    notify(MIGRATION_MSG);
  };

  /** Optimistisk felt-patch lokalt + skriving; ved feil rydder write() opp via load(). */
  const patchLocal = (id: string, local: Partial<Movie>, db: DbPatch) => {
    setMovies(prev => prev.map(m => (m.id === id ? { ...m, ...local } : m)));
    void write(() => supabase.from('movies').update(stamp(db)).eq('id', id)).then(({ error }) => {
      if (error) fail(error);
    });
  };

  const add = async (m: NewMovie): Promise<AddResult> => {
    const base = {
      title: m.title, kind: m.kind, must_m: m.mustM, must_l: m.mustL,
      note: m.note, added_by: m.addedBy,
    };
    const insert = (row: DbPatch) => write(() => supabase.from('movies').insert(row).select('id').single());
    let { data, error } = await insert(m.tmdb ? { ...base, ...tmdbColumns(m.tmdb) } : base);
    // Migreringen ikke kjørt: lagre filmen uten TMDB-data.
    if (m.tmdb && isMissingTmdbColumn(error)) {
      warnMissing();
      ({ data, error } = await insert(base));
    }
    if (isTmdbUniqueViolation(error)) return { status: 'tmdbDuplicate' };
    if (isUniqueViolation(error)) return { status: 'duplicate' };
    if (error || !data) { fail(error); return { status: 'error' }; }
    return { status: 'ok', id: data.id as string };
  };

  const setTmdb = async (id: string, fields: TmdbFields | null, opts: { silent?: boolean } = {}): Promise<TmdbResult> => {
    const before = movies.find(m => m.id === id);
    const local = tmdbLocal(fields);
    setMovies(prev => prev.map(m => (m.id === id ? { ...m, ...local } : m)));
    const { error } = await write(() => supabase.from('movies').update(stamp(tmdbColumns(fields))).eq('id', id));
    if (!error) return 'ok';
    // write() laster på nytt fra databasen og ruller dermed tilbake; dette er bare
    // for å unngå at raden står feil i mellomtiden.
    if (before) setMovies(prev => prev.map(m => (m.id === id ? before : m)));
    if (isMissingTmdbColumn(error)) { if (!opts.silent) warnMissing(); return 'missing'; }
    if (isTmdbUniqueViolation(error)) {
      if (!opts.silent) notify('Denne TMDB-tittelen er allerede koblet til en annen film');
      return 'duplicate';
    }
    if (!opts.silent) fail(error);
    return 'error';
  };

  const update = async (id: string, patch: MoviePatch): Promise<boolean> => {
    const db: DbPatch = {};
    if ('title' in patch) db.title = patch.title;
    if ('kind' in patch) db.kind = patch.kind;
    if ('note' in patch) db.note = patch.note ?? null;
    if ('mustM' in patch) db.must_m = patch.mustM;
    if ('mustL' in patch) db.must_l = patch.mustL;
    setMovies(prev => prev.map(m => (m.id === id ? { ...m, ...patch } as Movie : m)));
    const { error } = await write(() => supabase.from('movies').update(stamp(db)).eq('id', id));
    if (isUniqueViolation(error)) { notify('Finnes allerede med samme tittel og type'); return false; }
    if (error) { fail(error); return false; }
    return true;
  };

  const markWatched = (id: string, date: string) => patchLocal(id, { watchedAt: date }, { watched_at: date });
  const unwatch = (id: string) => patchLocal(id, { watchedAt: null }, { watched_at: null });

  const setRating = (id: string, who: MovieWho, rating: number | null) => {
    if (who === 'M') patchLocal(id, { ratingM: rating }, { rating_m: rating });
    else patchLocal(id, { ratingL: rating }, { rating_l: rating });
  };

  const restore = async (m: Movie) => {
    const { error } = await write(() => supabase.from('movies').insert({
      id: m.id, title: m.title, kind: m.kind, must_m: m.mustM, must_l: m.mustL,
      watched_at: m.watchedAt, rating_m: m.ratingM, rating_l: m.ratingL, note: m.note,
      added_by: m.addedBy, created_at: m.createdAt, updated_at: new Date().toISOString(),
      // TMDB-kolonnene tas bare med når raden var koblet (da finnes de i databasen).
      ...(m.tmdbId != null && m.tmdbKind ? {
        tmdb_id: m.tmdbId, tmdb_kind: m.tmdbKind, poster_path: m.posterPath, release_year: m.releaseYear,
        runtime_min: m.runtimeMin, genres: m.genres, overview: m.overview, tmdb_synced_at: m.tmdbSyncedAt,
      } : {}),
    }));
    if (isUniqueViolation(error)) notify('Kunne ikke angre: tittelen finnes allerede');
    else if (error) fail(error);
  };

  const remove = (movie: Movie) => {
    setMovies(prev => prev.filter(m => m.id !== movie.id));
    void write(() => supabase.from('movies').delete().eq('id', movie.id)).then(({ error }) => {
      if (error) { fail(error); return; }
      notify(`«${movie.title}» slettet`, { actionLabel: 'Angre', onAction: () => void restore(movie) });
    });
  };

  return (
    <MovieContext.Provider value={{ movies, loading, add, update, markWatched, unwatch, setRating, remove, setTmdb }}>
      {children}
    </MovieContext.Provider>
  );
}

export const useMovies = () => useContext(MovieContext);
