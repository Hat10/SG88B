import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useSnackbar } from './SnackbarContext';
import { formatError } from '../lib/formatError';
import { isUniqueViolation, type Movie, type MovieKind, type MovieWho } from '../lib/movies';

export type MoviePatch = Partial<Pick<Movie, 'title' | 'kind' | 'note'>>;

export interface NewMovie {
  title: string;
  kind: MovieKind;
  mustM: boolean;
  mustL: boolean;
  note: string | null;
  addedBy: MovieWho;
}

export type AddResult = { status: 'ok'; id: string } | { status: 'duplicate' } | { status: 'error' };

interface MovieCtx {
  movies: Movie[];
  loading: boolean;
  add: (m: NewMovie) => Promise<AddResult>;
  update: (id: string, patch: MoviePatch) => Promise<boolean>;
  toggleMust: (id: string, who: MovieWho) => void;
  markWatched: (id: string, date: string) => void;
  unwatch: (id: string) => void;
  setRating: (id: string, who: MovieWho, rating: number | null) => void;
  remove: (movie: Movie) => void;
}

const noop = () => {};
const MovieContext = createContext<MovieCtx>({
  movies: [], loading: true,
  add: async () => ({ status: 'error' }), update: async () => false,
  toggleMust: noop, markWatched: noop, unwatch: noop, setRating: noop, remove: noop,
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
});

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
    const { data } = await supabase.from('movies').select('*').order('created_at', { ascending: false });
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

  /** Optimistisk felt-patch lokalt + skriving; ved feil rydder write() opp via load(). */
  const patchLocal = (id: string, local: Partial<Movie>, db: DbPatch) => {
    setMovies(prev => prev.map(m => (m.id === id ? { ...m, ...local } : m)));
    void write(() => supabase.from('movies').update(stamp(db)).eq('id', id)).then(({ error }) => {
      if (error) fail(error);
    });
  };

  const add = async (m: NewMovie): Promise<AddResult> => {
    const { data, error } = await write(() => supabase.from('movies').insert({
      title: m.title, kind: m.kind, must_m: m.mustM, must_l: m.mustL,
      note: m.note, added_by: m.addedBy,
    }).select('id').single());
    if (isUniqueViolation(error)) return { status: 'duplicate' };
    if (error || !data) { fail(error); return { status: 'error' }; }
    return { status: 'ok', id: data.id as string };
  };

  const update = async (id: string, patch: MoviePatch): Promise<boolean> => {
    const db: DbPatch = {};
    if ('title' in patch) db.title = patch.title;
    if ('kind' in patch) db.kind = patch.kind;
    if ('note' in patch) db.note = patch.note ?? null;
    setMovies(prev => prev.map(m => (m.id === id ? { ...m, ...patch } as Movie : m)));
    const { error } = await write(() => supabase.from('movies').update(stamp(db)).eq('id', id));
    if (isUniqueViolation(error)) { notify('Finnes allerede med samme tittel og type'); return false; }
    if (error) { fail(error); return false; }
    return true;
  };

  const toggleMust = (id: string, who: MovieWho) => {
    const m = movies.find(x => x.id === id);
    if (!m) return;
    if (who === 'M') patchLocal(id, { mustM: !m.mustM }, { must_m: !m.mustM });
    else patchLocal(id, { mustL: !m.mustL }, { must_l: !m.mustL });
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
    <MovieContext.Provider value={{ movies, loading, add, update, toggleMust, markWatched, unwatch, setRating, remove }}>
      {children}
    </MovieContext.Provider>
  );
}

export const useMovies = () => useContext(MovieContext);
