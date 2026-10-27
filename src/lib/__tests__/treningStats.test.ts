import { describe, it, expect } from 'vitest';
import {
  categoryName, availableCategories, effectiveExcluded, filterByCategories, toggleCategory,
  countByWeekday, NO_CATEGORY,
} from '../treningStats';

const cat = (name: string, sortOrder: number, archived = false) => ({ name, sortOrder, archived });
const ses = (category: string) => ({ category });
// Klokka 12 lokal tid, så ukedagen er den samme uansett tidssone.
const on = (y: number, m: number, d: number) => ({ startedAt: new Date(y, m - 1, d, 12).toISOString() });

describe('categoryName', () => {
  it('gir navnet, og «Uten kategori» for tom streng', () => {
    expect(categoryName(ses('Push'))).toBe('Push');
    expect(categoryName(ses(''))).toBe(NO_CATEGORY);
  });
});

describe('filterByCategories', () => {
  const all = [ses('Push'), ses('Pull'), ses(''), ses('Push')];

  it('tomt excluded = alle økter', () => {
    expect(filterByCategories(all, new Set())).toEqual(all);
  });

  it('filtrerer bort bortvalgte typer på navn', () => {
    expect(filterByCategories(all, new Set(['Push']))).toEqual([ses('Pull'), ses('')]);
  });

  it('«Uten kategori» kan filtreres bort', () => {
    expect(filterByCategories(all, new Set([NO_CATEGORY]))).toEqual([ses('Push'), ses('Pull'), ses('Push')]);
  });

  it('ukjente navn i excluded påvirker ingenting', () => {
    expect(filterByCategories(all, new Set(['Yoga']))).toEqual(all);
  });
});

describe('availableCategories', () => {
  it('ikke-arkiverte kategorier i sortOrder', () => {
    const cats = [cat('Pull', 2), cat('Push', 1), cat('Gammel', 0, true)];
    expect(availableCategories(cats, [])).toEqual(['Push', 'Pull']);
  });

  it('arkiverte utelates, også når øktene bruker dem', () => {
    expect(availableCategories([cat('Push', 0), cat('Gammel', 1, true)], [ses('Gammel')])).toEqual(['Push']);
  });

  it('tar med foreldreløse navn fra øktene etter tabellens kategorier', () => {
    const out = availableCategories([cat('Push', 0), cat('Pull', 1)], [ses('Yoga'), ses('Push'), ses('Boksing')]);
    expect(out).toEqual(['Push', 'Pull', 'Boksing', 'Yoga']);
  });

  it('«Uten kategori» bare når noen økter mangler kategori, og sist', () => {
    const cats = [cat('Push', 0)];
    expect(availableCategories(cats, [ses('Push')])).toEqual(['Push']);
    expect(availableCategories(cats, [ses(''), ses('Yoga')])).toEqual(['Push', 'Yoga', NO_CATEGORY]);
  });

  it('har ingen duplikater', () => {
    const cats = [cat('Push', 0), cat('Push', 1), cat(NO_CATEGORY, 2)];
    const out = availableCategories(cats, [ses('Yoga'), ses('Yoga'), ses(''), ses('')]);
    expect(out).toEqual(['Push', NO_CATEGORY, 'Yoga']);
    expect(new Set(out).size).toBe(out.length);
  });

  it('muterer ikke inputlisten', () => {
    const cats = [cat('B', 2), cat('A', 1)];
    availableCategories(cats, []);
    expect(cats.map(c => c.name)).toEqual(['B', 'A']);
  });
});

describe('toggleCategory', () => {
  const avail = ['Push', 'Pull', 'Legs'];

  it('veksler en type inn og ut av excluded', () => {
    const a = toggleCategory(new Set(), 'Push', avail);
    expect([...a]).toEqual(['Push']);
    expect([...toggleCategory(a, 'Push', avail)]).toEqual([]);
  });

  it('tømmer excluded i stedet for å velge bort den siste valgte typen', () => {
    expect([...toggleCategory(new Set(['Push', 'Pull']), 'Legs', avail)]).toEqual([]);
  });

  it('muterer ikke inputsettet', () => {
    const before = new Set(['Push']);
    toggleCategory(before, 'Pull', avail);
    expect([...before]).toEqual(['Push']);
  });
});

describe('effectiveExcluded', () => {
  it('beholder bare navn som faktisk tilbys', () => {
    expect([...effectiveExcluded(new Set(['Push', 'Slettet']), ['Push', 'Pull'])]).toEqual(['Push']);
  });
});

describe('countByWeekday', () => {
  it('gir 7 tall med mandag på indeks 0 og søndag på indeks 6', () => {
    // 5.–11. januar 2026 er mandag–søndag.
    const week = [5, 6, 7, 8, 9, 10, 11].map(d => on(2026, 1, d));
    expect(countByWeekday(week)).toEqual([1, 1, 1, 1, 1, 1, 1]);
    expect(countByWeekday([on(2026, 1, 5)])).toEqual([1, 0, 0, 0, 0, 0, 0]);
    expect(countByWeekday([on(2026, 1, 11)])).toEqual([0, 0, 0, 0, 0, 0, 1]);
  });

  it('summerer flere økter samme ukedag, og tom liste gir nuller', () => {
    expect(countByWeekday([on(2026, 1, 7), on(2026, 1, 14)])).toEqual([0, 0, 2, 0, 0, 0, 0]);
    expect(countByWeekday([])).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });
});
