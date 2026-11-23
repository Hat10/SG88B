// Plakat, kreditering og koble/bytt/fjern-kobling mot TMDB.
import { useState } from 'react';
import { useMovies } from '../../contexts/MovieContext';
import { useSnackbar } from '../../contexts/SnackbarContext';
import { findTmdbDuplicate, isLinked, type Movie } from '../../lib/movies';
import {
  fieldsFromCandidate, fieldsFromDetails, tmdbImg, tmdbKindOf,
  type TmdbCandidate, type TmdbFields, type TmdbImgSize,
} from '../../lib/tmdb';
import { getTmdbDetails } from '../../lib/tmdbClient';
import { TmdbPicker } from './TmdbPicker';

/** Plakat, eller grå 🎬-plassholder når filmen ikke er koblet (eller bildet ikke laster). */
export function Poster({ path, size, width, height, radius = 6 }: {
  path: string | null; size: TmdbImgSize; width: number; height: number; radius?: number;
}) {
  const [broken, setBroken] = useState(false);
  const src = broken ? null : tmdbImg(path, size);
  const box: React.CSSProperties = { width, height, borderRadius: radius, flexShrink: 0, background: 'var(--chip)' };
  return src
    ? <img src={src} alt="" loading="lazy" width={width} height={height} onError={() => setBroken(true)} style={{ ...box, objectFit: 'cover', display: 'block' }} />
    : <div aria-hidden style={{ ...box, display: 'grid', placeItems: 'center', fontSize: Math.min(36, Math.round(width * 0.4)), opacity: 0.7 }}>🎬</div>;
}

// Offisiell TMDB-logo (kort variant), brukt uendret fra themoviedb.org/about/logos-attribution.
const TMDB_LOGO = 'https://www.themoviedb.org/assets/2/v4/logos/v2/blue_short-8e7b30f73a4020692ccca9c88bafe5dcb6f8a62a4c6bc55cd9ba82bb2cd95f6c.svg';

/** Kreditering nederst på Filmer-siden (krav i TMDBs API-vilkår). */
export function TmdbCredit() {
  const [logoOk, setLogoOk] = useState(true);
  return (
    <footer style={{
      marginTop: 28, padding: '14px 4px 4px', borderTop: '1px solid var(--line)',
      display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
      fontSize: 10, lineHeight: 1.5, color: 'var(--ink-4)',
    }}>
      <a href="https://www.themoviedb.org/" target="_blank" rel="noopener noreferrer" aria-label="The Movie Database (TMDB)" style={{ display: 'inline-flex', color: 'inherit', textDecoration: 'none' }}>
        {logoOk
          ? <img src={TMDB_LOGO} alt="TMDB" height={10} style={{ height: 10, width: 'auto', display: 'block' }} onError={() => setLogoOk(false)} />
          : <span style={{ fontWeight: 700 }}>TMDB</span>}
      </a>
      <span style={{ flex: '1 1 220px' }}>
        This product uses the TMDB API but is not endorsed or certified by TMDB.
        {' '}Strømmedata fra JustWatch.
      </span>
    </footer>
  );
}

/** Henter details for et valgt treff; faller tilbake til det vi vet fra søket. */
export async function fieldsFor(c: TmdbCandidate): Promise<TmdbFields> {
  try { return fieldsFromDetails(await getTmdbDetails(c.kind, c.id)); }
  catch { return fieldsFromCandidate(c); }
}

const snapshot = (m: Movie): TmdbFields | null => m.tmdbId != null && m.tmdbKind
  ? {
      tmdbId: m.tmdbId, tmdbKind: m.tmdbKind, posterPath: m.posterPath, releaseYear: m.releaseYear,
      runtimeMin: m.runtimeMin, genres: m.genres, overview: m.overview,
    }
  : null;

/**
 * Koble til TMDB / bytt / fjern kobling. Brukes i popupen og i Rediger.
 * Endringen lagres med en gang (uavhengig av «Lagre» i Rediger).
 */
export function TmdbLinkSection({ movie, prominent = false }: { movie: Movie; prominent?: boolean }) {
  const { movies, setTmdb } = useMovies();
  const { notify } = useSnackbar();
  const [picking, setPicking] = useState(false);
  const [text, setText] = useState(movie.title);
  const [busy, setBusy] = useState(false);
  const linked = isLinked(movie);

  const choose = async (c: TmdbCandidate) => {
    const dup = findTmdbDuplicate(movies, c.kind, c.id, movie.id);
    if (dup) { notify(`«${c.title}» er allerede koblet til «${dup.title}»`); return; }
    setBusy(true);
    const before = snapshot(movie);
    const r = await setTmdb(movie.id, await fieldsFor(c));
    setBusy(false);
    if (r === 'ok') {
      setPicking(false);
      notify(`Koblet til TMDB: ${c.title}${c.year ? ` (${c.year})` : ''}`, before
        ? { actionLabel: 'Angre', onAction: () => void setTmdb(movie.id, before) }
        : { actionLabel: 'Angre', onAction: () => void setTmdb(movie.id, null) });
    }
  };

  const unlink = async () => {
    const before = snapshot(movie);
    setBusy(true);
    const r = await setTmdb(movie.id, null);
    setBusy(false);
    if (r === 'ok') notify('TMDB-kobling fjernet', before ? { actionLabel: 'Angre', onAction: () => void setTmdb(movie.id, before) } : undefined);
  };

  if (picking) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div className="card-eyebrow">{linked ? 'Bytt TMDB-kobling' : 'Koble til TMDB'}</div>
        <TmdbPicker value={text} onChange={setText} kind={tmdbKindOf(movie.kind)} onPick={c => void choose(c)}
          autoFocus placeholder="Søk etter tittel på TMDB" ariaLabel="Søk på TMDB" />
        <div style={{ fontSize: 11, color: 'var(--ink-4)' }}>
          {busy ? 'Kobler…' : 'Tittelen i appen endres ikke.'}
        </div>
        <button type="button" className="btn ghost" style={{ minHeight: 44, justifyContent: 'center' }}
          onClick={() => { setPicking(false); setText(movie.title); }}>Avbryt</button>
      </div>
    );
  }

  if (!linked) {
    return (
      <button type="button" className={'btn' + (prominent ? ' primary' : '')} disabled={busy}
        style={{ minHeight: 44, justifyContent: 'center' }} onClick={() => setPicking(true)}>
        🔗 Koble til TMDB
      </button>
    );
  }

  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      <span style={{ fontSize: 12, color: 'var(--ink-3)', flex: '1 1 auto' }}>🔗 Koblet til TMDB</span>
      <button type="button" className="btn ghost" disabled={busy} style={{ minHeight: 44 }} onClick={() => setPicking(true)}>Bytt</button>
      <button type="button" className="btn ghost" disabled={busy} style={{ minHeight: 44 }} onClick={() => void unlink()}>Fjern kobling</button>
    </div>
  );
}
