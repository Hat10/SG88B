// Typer og rene hjelpere for TMDB-data (themoviedb.org) i Filmoversikten.
// Ingen React/Supabase/fetch her, slik at alt kan testes. Nettverk ligger i
// tmdbClient.ts; selve API-nøkkelen finnes bare i api/tmdb.ts (server).

import type { MovieKind } from './movies';

export type TmdbKind = 'movie' | 'tv';

export const tmdbKindOf = (k: MovieKind): TmdbKind => (k === 'serie' ? 'tv' : 'movie');

/** Ett treff fra /api/tmdb?action=search. */
export interface TmdbCandidate {
  id: number;
  kind: TmdbKind;
  title: string;          // nb-NO der TMDB har det
  originalTitle: string;
  year: number | null;
  posterPath: string | null;
  popularity: number;
}

export interface TmdbProvider { id: number; name: string; logoPath: string | null }

export interface TmdbProviders {
  link: string | null;    // JustWatch-side via TMDB
  flatrate: TmdbProvider[];
  free: TmdbProvider[];
  ads: TmdbProvider[];
  rent: TmdbProvider[];
  buy: TmdbProvider[];
}

export interface TmdbCast { name: string; character: string; profilePath: string | null }

/** Svar fra /api/tmdb?action=details. */
export interface TmdbDetails {
  id: number;
  kind: TmdbKind;
  title: string;
  originalTitle: string;
  year: number | null;
  posterPath: string | null;
  runtimeMin: number | null;  // film: spilletid; serie: episodelengde
  seasons: number | null;
  episodes: number | null;
  genres: string[];
  overview: string | null;
  cast: TmdbCast[];
  providers: TmdbProviders | null;  // null = ingen data for Norge
}

/** Feltene som lagres i movies (se scripts/movies-tmdb-migration.sql). */
export interface TmdbFields {
  tmdbId: number;
  tmdbKind: TmdbKind;
  posterPath: string | null;
  releaseYear: number | null;
  runtimeMin: number | null;
  genres: string[];
  overview: string | null;
}

export const fieldsFromDetails = (d: TmdbDetails): TmdbFields => ({
  tmdbId: d.id,
  tmdbKind: d.kind,
  posterPath: d.posterPath,
  releaseYear: d.year,
  runtimeMin: d.runtimeMin,
  genres: d.genres,
  overview: d.overview,
});

/** Reserve når details ikke kunne hentes: det vi vet fra søketreffet. */
export const fieldsFromCandidate = (c: TmdbCandidate): TmdbFields => ({
  tmdbId: c.id,
  tmdbKind: c.kind,
  posterPath: c.posterPath,
  releaseYear: c.year,
  runtimeMin: null,
  genres: [],
  overview: null,
});

const IMG = 'https://image.tmdb.org/t/p/';
export type TmdbImgSize = 'w45' | 'w92' | 'w154' | 'w185' | 'w342' | 'w500';

export const tmdbImg = (path: string | null | undefined, size: TmdbImgSize): string | null =>
  path ? `${IMG}${size}${path.startsWith('/') ? '' : '/'}${path}` : null;

/** 169 → «2 t 49 min», 45 → «45 min». */
export function fmtRuntime(min: number | null | undefined): string | null {
  if (min == null || !Number.isFinite(min) || min <= 0) return null;
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  if (!h) return `${m} min`;
  return m ? `${h} t ${m} min` : `${h} t`;
}

/** Serie: «3 sesonger · ca. 50 min per episode» (deler som mangler utelates). */
export function fmtSeries(seasons: number | null | undefined, episodeMin: number | null | undefined): string | null {
  const parts: string[] = [];
  if (seasons) parts.push(seasons === 1 ? '1 sesong' : `${seasons} sesonger`);
  if (episodeMin) parts.push(`ca. ${episodeMin} min per episode`);
  return parts.length ? parts.join(' · ') : null;
}

const DAY = 24 * 60 * 60 * 1000;

/** Om lagrede TMDB-data er eldre enn `maxAgeDays` (eller mangler tidsstempel). */
export function isStale(syncedAt: string | null | undefined, maxAgeDays: number, now: number = Date.now()): boolean {
  if (!syncedAt) return true;
  const t = Date.parse(syncedAt);
  return !Number.isFinite(t) || now - t > maxAgeDays * DAY;
}

/** Popupen frisker opp i stillhet etter 30 dager. */
export const POPUP_REFRESH_DAYS = 30;
/** «Koble filmer til TMDB» frisker opp etter 5 måneder (TMDB tillater maks 6). */
export const BULK_REFRESH_DAYS = 150;

/** Én linje for listen: «2014 · 2 t 49 min» eller «2019 · ca. 50 min per episode». */
export function metaLine(kind: MovieKind, year: number | null, runtimeMin: number | null): string | null {
  const parts: string[] = [];
  if (year) parts.push(String(year));
  const len = kind === 'serie'
    ? (runtimeMin ? `ca. ${runtimeMin} min per episode` : null)
    : fmtRuntime(runtimeMin);
  if (len) parts.push(len);
  return parts.length ? parts.join(' · ') : null;
}
