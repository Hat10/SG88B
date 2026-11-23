import { describe, it, expect } from 'vitest';
import {
  matchTmdb, matchKey, hasSequelNumber, findTmdbDuplicate, applyFilters, DOMINANCE,
  type Movie, type MovieFilters,
} from '../movies';
import {
  fmtRuntime, fmtSeries, isStale, metaLine, tmdbImg, tmdbKindOf, fieldsFromDetails, fieldsFromCandidate,
  type TmdbCandidate, type TmdbDetails,
} from '../tmdb';

let n = 0;
const c = (title: string, over: Partial<TmdbCandidate> = {}): TmdbCandidate => ({
  id: ++n, kind: 'movie', title, originalTitle: title, year: 2000, posterPath: null, popularity: 10, ...over,
});
const mv = (title: string, over: Partial<Movie> = {}): Movie => ({
  id: `m-${++n}`, title, kind: 'film', mustM: false, mustL: false, watchedAt: null,
  ratingM: null, ratingL: null, note: null, addedBy: null,
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
  tmdbId: null, tmdbKind: null, posterPath: null, releaseYear: null, runtimeMin: null,
  genres: [], overview: null, tmdbSyncedAt: null, ...over,
});

describe('matchKey', () => {
  it('fjerner tegnsetting, aksenter og store bokstaver', () => {
    expect(matchKey('Mamma Mia!')).toBe('mamma mia');
    expect(matchKey("The King's Speech")).toBe('the king s speech');
    expect(matchKey('Amélie')).toBe('amelie');
    expect(matchKey('Weird: The Al Yankovic Story')).toBe('weird the al yankovic story');
    expect(matchKey('mother!')).toBe('mother');
  });
});

describe('hasSequelNumber', () => {
  it('kjenner igjen løpenummer på slutten', () => {
    for (const t of ['IT 1', 'IT 2', 'Mamma Mia 2', 'Avatar 3', 'Spy Kids 5', 'Bridget Jones 4', 'Now You See Me 3']) {
      expect(hasSequelNumber(t)).toBe(true);
    }
  });
  it('tall som ER tittelen er ikke løpenummer', () => {
    for (const t of ['1917', 'F1', '100 Meters', 'Interstellar']) expect(hasSequelNumber(t)).toBe(false);
  });
});

describe('matchTmdb', () => {
  it('ett eksakt treff er sikkert', () => {
    const hit = c('Interstellar', { year: 2014, popularity: 120 });
    const r = matchTmdb('Interstellar', [hit, c('Interstellar Wars'), c('The Science of Interstellar')], 'movie');
    expect(r).toEqual({ status: 'sure', candidate: hit });
  });

  it('matcher mot originaltittel (norsk tittel i appen, eller omvendt)', () => {
    const hit = c('Schindlers liste', { originalTitle: "Schindler's List" });
    expect(matchTmdb('Schindlers liste', [hit], 'movie').status).toBe('sure');
    expect(matchTmdb("Schindler's List", [hit], 'movie').status).toBe('sure');
  });

  it('oppfølgere med tall hoppes alltid over, med kandidater å velge mellom', () => {
    const a = c('Avatar', { popularity: 100 });
    const b = c('Avatar: The Way of Water', { popularity: 90 });
    const r = matchTmdb('Avatar 1', [a, b], 'movie');
    expect(r.status).toBe('unsure');
    if (r.status === 'unsure') {
      expect(r.reason).toBe('sequel');
      expect(r.candidates).toEqual([a, b]);
    }
    // Selv om TMDB har en eksakt tittel «IT» betyr ikke «IT 1» sikkert den.
    expect(matchTmdb('IT 1', [c('IT')], 'movie').status).toBe('unsure');
    expect(matchTmdb('Spy Kids 5', [c('Spy Kids 5')], 'movie').status).toBe('unsure');
  });

  it('flere eksakte treff med lik popularitet er tvetydige (Nosferatu, Mother)', () => {
    const n1 = c('Nosferatu', { year: 2024, popularity: 60 });
    const n2 = c('Nosferatu', { year: 1922, popularity: 15 });
    const n3 = c('Nosferatu the Vampyre', { originalTitle: 'Nosferatu: Phantom der Nacht', year: 1979, popularity: 12 });
    const r = matchTmdb('Nosferatu', [n2, n3, n1], 'movie');
    expect(r.status).toBe('unsure');
    if (r.status === 'unsure') {
      expect(r.reason).toBe('ambiguous');
      expect(r.candidates.slice(0, 2)).toEqual([n1, n2]); // eksakte først, mest populære først
    }

    const m1 = c('Mother', { originalTitle: '마더', year: 2009, popularity: 18 });
    const m2 = c('mother!', { year: 2017, popularity: 30 });
    expect(matchTmdb('Mother', [m1, m2], 'movie').status).toBe('unsure');
  });

  it('flere eksakte treff: sikkert bare når det beste dominerer klart', () => {
    const big = c('The Truman Show', { popularity: 10 * DOMINANCE });
    const tiny = c('The Truman Show', { popularity: 10 });
    expect(matchTmdb('The Truman Show', [tiny, big], 'movie')).toEqual({ status: 'sure', candidate: big });
    const almost = c('The Truman Show', { popularity: 10 * DOMINANCE - 1 });
    expect(matchTmdb('The Truman Show', [tiny, almost], 'movie').status).toBe('unsure');
  });

  it('ingen eksakte treff er usikkert, ingen treff gir tom liste', () => {
    const r = matchTmdb('Frihetens regn', [c('Frihetens rike')], 'movie');
    expect(r.status).toBe('unsure');
    if (r.status === 'unsure') { expect(r.reason).toBe('none'); expect(r.candidates).toHaveLength(1); }
    expect(matchTmdb('Ukjent', [], 'movie')).toEqual({ status: 'unsure', reason: 'none', candidates: [] });
  });

  it('år avgrenser eksakte treff (±1)', () => {
    const old = c('Foreldrefellen', { year: 1961 });
    const nu = c('Foreldrefellen', { year: 1998 });
    expect(matchTmdb('Foreldrefellen', [old, nu], 'movie').status).toBe('unsure');
    expect(matchTmdb('Foreldrefellen', [old, nu], 'movie', 1999)).toEqual({ status: 'sure', candidate: nu });
  });

  it('ignorerer treff av feil type (film vs serie)', () => {
    const show = c('The Bear', { kind: 'tv' });
    const film = c('The Bear', { kind: 'movie', year: 1988 });
    expect(matchTmdb('The Bear', [show, film], 'tv')).toEqual({ status: 'sure', candidate: show });
  });
});

describe('findTmdbDuplicate', () => {
  const a = mv('A', { tmdbId: 1, tmdbKind: 'movie' });
  const b = mv('B', { kind: 'serie', tmdbId: 1, tmdbKind: 'tv' });
  it('finner samme id og type, og respekterer exceptId', () => {
    expect(findTmdbDuplicate([a, b], 'movie', 1)).toBe(a);
    expect(findTmdbDuplicate([a, b], 'tv', 1)).toBe(b);
    expect(findTmdbDuplicate([a, b], 'movie', 1, a.id)).toBeNull();
    expect(findTmdbDuplicate([a, b], 'movie', 2)).toBeNull();
  });
});

describe('applyFilters: ukoblede', () => {
  const linked = mv('Koblet', { tmdbId: 5, tmdbKind: 'movie' });
  const loose = mv('Løs');
  const F: MovieFilters = { tab: 'want', must: 'all', kind: 'all', query: '' };
  it('link=unlinked viser bare ukoblede; utelatt viser alle', () => {
    expect(applyFilters([linked, loose], F)).toEqual([linked, loose]);
    expect(applyFilters([linked, loose], { ...F, link: 'unlinked' })).toEqual([loose]);
  });
});

describe('tmdb-hjelpere', () => {
  it('fmtRuntime', () => {
    expect(fmtRuntime(169)).toBe('2 t 49 min');
    expect(fmtRuntime(120)).toBe('2 t');
    expect(fmtRuntime(45)).toBe('45 min');
    expect(fmtRuntime(null)).toBeNull();
    expect(fmtRuntime(0)).toBeNull();
  });
  it('fmtSeries', () => {
    expect(fmtSeries(3, 50)).toBe('3 sesonger · ca. 50 min per episode');
    expect(fmtSeries(1, null)).toBe('1 sesong');
    expect(fmtSeries(null, null)).toBeNull();
  });
  it('metaLine skjuler det som mangler', () => {
    expect(metaLine('film', 2014, 169)).toBe('2014 · 2 t 49 min');
    expect(metaLine('serie', 2019, 50)).toBe('2019 · ca. 50 min per episode');
    expect(metaLine('film', null, null)).toBeNull();
    expect(metaLine('film', 2014, null)).toBe('2014');
  });
  it('isStale', () => {
    const now = Date.parse('2026-06-01T00:00:00Z');
    expect(isStale(null, 30, now)).toBe(true);
    expect(isStale('2026-05-20T00:00:00Z', 30, now)).toBe(false);
    expect(isStale('2026-04-01T00:00:00Z', 30, now)).toBe(true);
    expect(isStale('2025-12-15T00:00:00Z', 150, now)).toBe(true);
    expect(isStale('2026-02-01T00:00:00Z', 150, now)).toBe(false);
  });
  it('tmdbImg og tmdbKindOf', () => {
    expect(tmdbImg('/abc.jpg', 'w154')).toBe('https://image.tmdb.org/t/p/w154/abc.jpg');
    expect(tmdbImg(null, 'w154')).toBeNull();
    expect(tmdbKindOf('serie')).toBe('tv');
    expect(tmdbKindOf('film')).toBe('movie');
  });
  it('fieldsFromDetails / fieldsFromCandidate', () => {
    const d: TmdbDetails = {
      id: 9, kind: 'movie', title: 'X', originalTitle: 'X', year: 2001, posterPath: '/p.jpg', runtimeMin: 99,
      seasons: null, episodes: null, genres: ['Drama'], overview: 'Om', cast: [], providers: null,
    };
    expect(fieldsFromDetails(d)).toEqual({
      tmdbId: 9, tmdbKind: 'movie', posterPath: '/p.jpg', releaseYear: 2001, runtimeMin: 99, genres: ['Drama'], overview: 'Om',
    });
    expect(fieldsFromCandidate(c('Y', { id: 3, year: 1990, posterPath: '/y.jpg' }))).toEqual({
      tmdbId: 3, tmdbKind: 'movie', posterPath: '/y.jpg', releaseYear: 1990, runtimeMin: null, genres: [], overview: null,
    });
  });
});
