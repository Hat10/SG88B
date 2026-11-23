// Popup-kort for én tittel: plakat, fakta, sammendrag, roller og strømmetjenester
// i Norge. Roller og strømmetjenester hentes ferskt fra TMDB hver gang og lagres
// ikke. Titler uten kobling viser det som finnes, og «Koble til TMDB».
import { useEffect, useRef, useState } from 'react';
import { useMovies } from '../../contexts/MovieContext';
import { Skeleton, Tag } from '../../components';
import { WHO_NAME, avgRating, isLinked, isWatched, type Movie } from '../../lib/movies';
import {
  POPUP_REFRESH_DAYS, fieldsFromDetails, fmtRuntime, fmtSeries, isStale, tmdbImg,
  type TmdbCast, type TmdbProvider, type TmdbProviders,
} from '../../lib/tmdb';
import { useTmdbDetails } from '../../lib/tmdbClient';
import { Sheet, useIsMobile } from './Sheet';
import { KIND_LABEL, MustBadge, Stars, WHOS, fmtAvg, fmtDate } from './controls';
import { Poster, TmdbLinkSection } from './tmdbParts';

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
    <div className="card-eyebrow">{title}</div>
    {children}
  </section>
);

export function MoviePopup({ movie, onClose, onEdit, onWatched }: {
  movie: Movie; onClose: () => void; onEdit: () => void; onWatched: () => void;
}) {
  const { setTmdb, setRating, unwatch } = useMovies();
  const isMobile = useIsMobile();
  const [reload, setReload] = useState(0);
  const details = useTmdbDetails(movie.tmdbKind, movie.tmdbId, reload);
  const d = details.status === 'ok' && details.data.id === movie.tmdbId ? details.data : null;

  // Stille oppfrisking av lagrede felt når de er eldre enn 30 dager (TMDB: maks 6 mnd).
  const refreshed = useRef<number | null>(null);
  useEffect(() => {
    if (!d || refreshed.current === d.id) return;
    if (!isStale(movie.tmdbSyncedAt, POPUP_REFRESH_DAYS)) return;
    refreshed.current = d.id;
    void setTmdb(movie.id, fieldsFromDetails(d), { silent: true });
  }, [d, movie.id, movie.tmdbSyncedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  const linked = isLinked(movie);
  const watched = isWatched(movie);
  const posterPath = d?.posterPath ?? movie.posterPath;
  const year = d?.year ?? movie.releaseYear;
  const runtime = d?.runtimeMin ?? movie.runtimeMin;
  const genres = d?.genres.length ? d.genres : movie.genres;
  const overview = d?.overview ?? movie.overview;
  const length = movie.kind === 'serie' ? fmtSeries(d?.seasons, runtime) : fmtRuntime(runtime);
  const tmdbTitle = d && d.title && d.title.toLowerCase() !== movie.title.toLowerCase() ? d.title : null;
  const avg = avgRating(movie);

  // Uten kobling: liten plassholder, så popupen ikke domineres av en tom flate.
  const pw = !linked ? 64 : isMobile ? 100 : 140;
  return (
    <Sheet eyebrow={KIND_LABEL[movie.kind]} title={movie.title} onClose={onClose} width={560}>
      {/* Toppdel: plakat + fakta */}
      <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
        <Poster path={posterPath} size={isMobile ? 'w185' : 'w342'} width={pw} height={Math.round(pw * 1.5)} />
        <div style={{ minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {tmdbTitle && <div style={{ fontSize: 13, color: 'var(--ink-3)', overflowWrap: 'anywhere' }}>{tmdbTitle}</div>}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <Tag kind="outline">{KIND_LABEL[movie.kind]}</Tag>
            {year && <span style={{ fontSize: 13, fontWeight: 500 }}>{year}</span>}
          </div>
          {length && <div style={{ fontSize: 13 }}>{length}</div>}
          {details.status === 'loading' && !length && linked && <Skeleton h={12} w="60%" />}
          {genres.length > 0 && <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>{genres.join(' · ')}</div>}
          {watched && <div className="mv-meta">Sett {fmtDate(movie.watchedAt!)}</div>}
          {avg != null && <div style={{ fontSize: 13, fontWeight: 600 }}>★ {fmtAvg(avg)} snitt</div>}
        </div>
      </div>

      {overview
        ? <Overview text={overview} />
        : linked && details.status === 'loading' && <div style={{ display: 'grid', gap: 6 }}><Skeleton h={12} /><Skeleton h={12} /><Skeleton h={12} w="70%" /></div>}

      {/* Ferske TMDB-data */}
      {linked && details.status === 'loading' && <LoadingFresh />}
      {linked && details.status === 'error' && (
        <div className="mv-stop" role="alert">
          <div>Kunne ikke hente roller og strømmetjenester fra TMDB. {details.message}</div>
          <button type="button" className="btn" style={{ minHeight: 44, justifyContent: 'center' }} onClick={() => setReload(r => r + 1)}>Prøv igjen</button>
        </div>
      )}
      {d && d.cast.length > 0 && <Section title="Roller"><Cast cast={d.cast} /></Section>}
      {d && <Section title="Se i Norge"><Providers providers={d.providers} /></Section>}

      {/* Våre egne data */}
      {movie.note && (
        <Section title="Notat"><div style={{ fontSize: 13, color: 'var(--ink-2)', overflowWrap: 'anywhere' }}>{movie.note}</div></Section>
      )}
      <div role="group" aria-label="Hvem må være med" style={{ display: 'flex', gap: 8 }}>
        {WHOS.map(w => <MustBadge key={w} who={w} on={w === 'M' ? movie.mustM : movie.mustL} />)}
      </div>
      {watched && (
        <div>
          {WHOS.map(w => (
            <div key={w} className="mv-rate">
              <span className="who">{WHO_NAME[w]}</span>
              <Stars who={w} value={w === 'M' ? movie.ratingM : movie.ratingL} onChange={v => setRating(movie.id, w, v)} />
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" className="btn" style={{ minHeight: 44, justifyContent: 'center' }} onClick={onEdit}>✎ Rediger</button>
        {watched
          ? <button type="button" className="btn ghost" style={{ flex: 1, minHeight: 44, justifyContent: 'center' }} onClick={() => unwatch(movie.id)}>↩ Angre sett</button>
          : <button type="button" className="btn primary" style={{ flex: 1, minHeight: 44, justifyContent: 'center' }} onClick={onWatched}>✓ Merk som sett</button>}
      </div>

      <TmdbLinkSection key={`${movie.id}-${movie.tmdbId ?? 'x'}`} movie={movie} prominent={!linked} />

      {linked && (
        <div style={{ fontSize: 10, color: 'var(--ink-4)', borderTop: '1px solid var(--line)', paddingTop: 10 }}>
          Data fra{' '}
          <a href={`https://www.themoviedb.org/${movie.tmdbKind}/${movie.tmdbId}`} target="_blank" rel="noopener noreferrer" style={{ color: 'inherit' }}>TMDB</a>
        </div>
      )}
    </Sheet>
  );
}

function Overview({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const long = text.length > 260;
  return (
    <div>
      <p style={{
        margin: 0, fontSize: 14, lineHeight: 1.5, color: 'var(--ink-2)',
        ...(long && !open ? { display: '-webkit-box', WebkitLineClamp: 4, WebkitBoxOrient: 'vertical', overflow: 'hidden' } : null),
      }}>{text}</p>
      {long && (
        <button type="button" onClick={() => setOpen(o => !o)}
          style={{ background: 'none', border: 0, padding: '6px 0', minHeight: 32, color: 'var(--accent)', fontSize: 13, fontWeight: 500 }}>
          {open ? 'Vis mindre' : 'Les mer'}
        </button>
      )}
    </div>
  );
}

function LoadingFresh() {
  return (
    <div aria-busy="true" aria-label="Henter roller og strømmetjenester" style={{ display: 'grid', gap: 10 }}>
      <Skeleton h={10} w={60} />
      <div style={{ display: 'flex', gap: 12 }}>
        {[0, 1, 2, 3].map(i => <Skeleton key={i} h={48} w={48} radius={24} />)}
      </div>
      <Skeleton h={10} w={80} />
      <div style={{ display: 'flex', gap: 8 }}>
        {[0, 1, 2].map(i => <Skeleton key={i} h={36} w={36} radius={8} />)}
      </div>
    </div>
  );
}

function Cast({ cast }: { cast: TmdbCast[] }) {
  return (
    <div style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 4, scrollSnapType: 'x proximity' }}>
      {cast.map((c, i) => {
        const src = tmdbImg(c.profilePath, 'w185');
        return (
          <div key={`${c.name}-${i}`} style={{ width: 84, flexShrink: 0, textAlign: 'center', scrollSnapAlign: 'start' }}>
            {src
              ? <img src={src} alt="" loading="lazy" width={56} height={56} style={{ width: 56, height: 56, borderRadius: '50%', objectFit: 'cover', background: 'var(--chip)', display: 'block', margin: '0 auto' }} />
              : <div aria-hidden style={{ width: 56, height: 56, borderRadius: '50%', background: 'var(--chip)', margin: '0 auto', display: 'grid', placeItems: 'center', fontSize: 18, color: 'var(--ink-4)' }}>{c.name.charAt(0)}</div>}
            <div style={{ fontSize: 12, fontWeight: 500, marginTop: 4, lineHeight: 1.25 }}>{c.name}</div>
            {c.character && <div style={{ fontSize: 11, color: 'var(--ink-4)', lineHeight: 1.25 }}>{c.character}</div>}
          </div>
        );
      })}
    </div>
  );
}

function ProviderRow({ label, list }: { label: string; list: TmdbProvider[] }) {
  if (!list.length) return null;
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
      <div style={{ width: 74, flexShrink: 0, fontSize: 12, color: 'var(--ink-3)', paddingTop: 9 }}>{label}</div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {list.map(p => {
          const src = tmdbImg(p.logoPath, 'w92');
          return (
            <span key={p.id} title={p.name} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, border: '1px solid var(--line)', borderRadius: 8, padding: '3px 8px 3px 3px', fontSize: 12 }}>
              {src
                ? <img src={src} alt="" loading="lazy" width={28} height={28} style={{ width: 28, height: 28, borderRadius: 6, display: 'block' }} />
                : <span aria-hidden style={{ width: 28, height: 28, borderRadius: 6, background: 'var(--chip)' }} />}
              {p.name}
            </span>
          );
        })}
      </div>
    </div>
  );
}

function Providers({ providers }: { providers: TmdbProviders | null }) {
  const p = providers;
  const free = p ? [...p.free, ...p.ads.filter(a => !p.free.some(f => f.id === a.id))] : [];
  const any = !!p && (p.flatrate.length + free.length + p.rent.length + p.buy.length) > 0;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {any && p
        ? <>
            <ProviderRow label="Strømming" list={p.flatrate} />
            <ProviderRow label="Gratis" list={free} />
            <ProviderRow label="Lei" list={p.rent} />
            <ProviderRow label="Kjøp" list={p.buy} />
          </>
        : <div style={{ fontSize: 13, color: 'var(--ink-3)' }}>Ikke tilgjengelig for strømming, leie eller kjøp i Norge akkurat nå.</div>}
      <div style={{ fontSize: 10, color: 'var(--ink-4)' }}>
        Strømmedata fra{' '}
        <a href={p?.link ?? 'https://www.justwatch.com/no'} target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', fontWeight: 600 }}>JustWatch</a>
      </div>
    </div>
  );
}
