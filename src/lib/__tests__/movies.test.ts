import { describe, it, expect } from 'vitest';
import {
  applyFilters, sortMovies, eligibleForTonight, pickRandom, findDuplicate, normalizeTitle,
  avgRating, missingRatings, nextRating, isUniqueViolation, type Movie, type MovieFilters,
} from '../movies';

let n = 0;
const mv = (title: string, over: Partial<Movie> = {}): Movie => ({
  id: `id-${++n}`, title, kind: 'film', mustM: false, mustL: false, watchedAt: null,
  ratingM: null, ratingL: null, note: null, addedBy: null,
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', ...over,
});
const F = (over: Partial<MovieFilters> = {}): MovieFilters => ({ tab: 'want', must: 'all', kind: 'all', query: '', ...over });
const titles = (l: Movie[]) => l.map(m => m.title);

const both = mv('Begge', { mustM: true, mustL: true });
const onlyM = mv('KunAndreas', { mustM: true });
const onlyL = mv('KunTaran', { mustL: true });
const none = mv('Ingen');
const seen = mv('Sett', { mustM: true, mustL: true, watchedAt: '2026-05-01' });
const serie = mv('Serien', { kind: 'serie', mustL: true });
const all = [both, onlyM, onlyL, none, seen, serie];

describe('normalizeTitle', () => {
  it('trimmer og slår sammen doble mellomrom', () => {
    expect(normalizeTitle('  The   Big \t Short  ')).toBe('The Big Short');
  });
});

describe('findDuplicate', () => {
  it('finner case-insensitivt og etter normalisering, med riktig plassering', () => {
    expect(findDuplicate(all, '  sett ', 'film')).toBe(seen);
    expect(findDuplicate(all, 'ingen', 'film')).toBe(none);
  });
  it('samme tittel med annen kind kolliderer ikke (følger den unike indeksen)', () => {
    expect(findDuplicate(all, 'serien', 'film')).toBeNull();
    expect(findDuplicate(all, 'serien', 'serie')).toBe(serie);
  });
  it('ignorerer tom tittel og exceptId', () => {
    expect(findDuplicate(all, '   ', 'film')).toBeNull();
    expect(findDuplicate(all, 'Ingen', 'film', none.id)).toBeNull();
  });
});

describe('applyFilters', () => {
  it('skiller faner på watched_at', () => {
    expect(titles(applyFilters(all, F({ tab: 'want' })))).toEqual(['Begge', 'KunAndreas', 'KunTaran', 'Ingen', 'Serien']);
    expect(titles(applyFilters(all, F({ tab: 'seen' })))).toEqual(['Sett']);
  });
  it('obligatorisk-filtrene', () => {
    expect(titles(applyFilters(all, F({ must: 'both' })))).toEqual(['Begge']);
    expect(titles(applyFilters(all, F({ must: 'onlyM' })))).toEqual(['KunAndreas']);
    expect(titles(applyFilters(all, F({ must: 'onlyL' })))).toEqual(['KunTaran', 'Serien']);
    expect(titles(applyFilters(all, F({ must: 'none' })))).toEqual(['Ingen']);
  });
  it('kombinerer fane, tag, filter og søk', () => {
    expect(titles(applyFilters(all, F({ kind: 'serie' })))).toEqual(['Serien']);
    expect(titles(applyFilters(all, F({ kind: 'serie', must: 'onlyM' })))).toEqual([]);
    expect(titles(applyFilters(all, F({ query: ' kun ' })))).toEqual(['KunAndreas', 'KunTaran']);
    expect(titles(applyFilters(all, F({ query: 'finnesikke' })))).toEqual([]);
    expect(titles(applyFilters(all, F({ query: 'KUN', must: 'onlyL' })))).toEqual(['KunTaran']);
  });
});

describe('sortMovies', () => {
  it('nylig lagt til først', () => {
    const a = mv('A', { createdAt: '2026-01-01T00:00:00Z' });
    const b = mv('B', { createdAt: '2026-03-01T00:00:00Z' });
    expect(titles(sortMovies([a, b], 'added'))).toEqual(['B', 'A']);
  });
  it('alfabetisk (norsk, uavhengig av store/små bokstaver)', () => {
    expect(titles(sortMovies([mv('banan'), mv('Ære'), mv('Appelsin')], 'alpha'))).toEqual(['Appelsin', 'banan', 'Ære']);
  });
  it('høyest rating, uratede sist, uavgjort alfabetisk', () => {
    const l = [
      mv('Uratet'),
      mv('Fire', { ratingM: 4, ratingL: 4 }),
      mv('Fem', { ratingM: 5, ratingL: 5 }),
      mv('EnFem', { ratingM: 5 }),
    ];
    expect(titles(sortMovies(l, 'rating'))).toEqual(['EnFem', 'Fem', 'Fire', 'Uratet']);
  });
  it('nylig sett', () => {
    const l = [mv('Gammel', { watchedAt: '2026-01-01' }), mv('Ny', { watchedAt: '2026-06-01' })];
    expect(titles(sortMovies(l, 'seen'))).toEqual(['Ny', 'Gammel']);
  });
  it('muterer ikke input', () => {
    const l = [mv('B'), mv('A')];
    sortMovies(l, 'alpha');
    expect(titles(l)).toEqual(['B', 'A']);
  });
});

describe('eligibleForTonight (hvem ser)', () => {
  it('begge til stede: alle usette, ingen utelukkes', () => {
    expect(titles(eligibleForTonight(all, 'both'))).toEqual(['Begge', 'KunAndreas', 'KunTaran', 'Ingen', 'Serien']);
  });
  it('bare Andreas: utelukker titler der Taran (fraværende) er obligatorisk', () => {
    const r = eligibleForTonight(all, 'M');
    expect(titles(r)).toEqual(['KunAndreas', 'Ingen']);
    expect(r.every(m => !m.mustL)).toBe(true);
  });
  it('bare Taran: utelukker titler der Andreas (fraværende) er obligatorisk', () => {
    const r = eligibleForTonight(all, 'L');
    expect(titles(r)).toEqual(['KunTaran', 'Ingen', 'Serien']);
    expect(r.every(m => !m.mustM)).toBe(true);
  });
  it('utelukker sette titler og respekterer film/serie', () => {
    expect(eligibleForTonight(all, 'both').includes(seen)).toBe(false);
    expect(titles(eligibleForTonight(all, 'both', 'serie'))).toEqual(['Serien']);
    expect(titles(eligibleForTonight(all, 'M', 'serie'))).toEqual([]);
  });
});

describe('pickRandom', () => {
  const pool = [mv('A'), mv('B'), mv('C')];
  it('velger etter rng og returnerer null for tom pulje', () => {
    expect(pickRandom(pool, () => 0)?.title).toBe('A');
    expect(pickRandom(pool, () => 0.99)?.title).toBe('C');
    expect(pickRandom(pool, () => 1)?.title).toBe('C');
    expect(pickRandom([])).toBeNull();
  });
  it('unngår forrige trekk når det finnes andre valg', () => {
    expect(pickRandom(pool, () => 0, pool[0].id)?.title).toBe('B');
    expect(pickRandom([pool[0]], () => 0, pool[0].id)?.title).toBe('A');
  });
});

describe('rating', () => {
  it('snitt kun når begge har ratet', () => {
    expect(avgRating(mv('x', { ratingM: 4, ratingL: 5 }))).toBe(4.5);
    expect(avgRating(mv('x', { ratingM: 4 }))).toBeNull();
  });
  it('mangler rating', () => {
    expect(missingRatings(mv('x'))).toEqual(['M', 'L']);
    expect(missingRatings(mv('x', { ratingM: 3 }))).toEqual(['L']);
    expect(missingRatings(mv('x', { ratingM: 3, ratingL: 2 }))).toEqual([]);
  });
  it('trykk på valgt stjerne fjerner ratingen', () => {
    expect(nextRating(3, 3)).toBeNull();
    expect(nextRating(3, 4)).toBe(4);
    expect(nextRating(null, 1)).toBe(1);
  });
});

describe('isUniqueViolation', () => {
  it('gjenkjenner 23505', () => {
    expect(isUniqueViolation({ code: '23505' })).toBe(true);
    expect(isUniqueViolation({ code: '42501' })).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
  });
});
