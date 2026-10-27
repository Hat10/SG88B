import { describe, it, expect } from 'vitest';
import { matchesWhoView, openCountsByWho, WHO_TAB_ORDER } from '../whoView';
import type { Who } from '../../data';

describe('matchesWhoView', () => {
  const all: Who[] = ['f', 'M', 'L'];

  it('Felles-fanen uten «kun felles» viser alle', () => {
    expect(all.map(w => matchesWhoView(w, 'f', false))).toEqual([true, true, true]);
  });

  it('Felles-fanen med «kun felles» viser bare felles', () => {
    expect(all.map(w => matchesWhoView(w, 'f', true))).toEqual([true, false, false]);
  });

  it('Andreas-fanen viser bare Andreas, uavhengig av «kun felles»', () => {
    for (const kun of [true, false]) {
      expect(all.map(w => matchesWhoView(w, 'M', kun))).toEqual([false, true, false]);
    }
  });

  it('Taran-fanen viser bare Taran, uavhengig av «kun felles»', () => {
    for (const kun of [true, false]) {
      expect(all.map(w => matchesWhoView(w, 'L', kun))).toEqual([false, false, true]);
    }
  });
});

describe('openCountsByWho', () => {
  it('teller bare ikke-fullførte per person', () => {
    const items: { who: Who; done: boolean }[] = [
      { who: 'f', done: false }, { who: 'f', done: false }, { who: 'f', done: true },
      { who: 'M', done: false }, { who: 'M', done: true }, { who: 'M', done: true },
      { who: 'L', done: false }, { who: 'L', done: false }, { who: 'L', done: false },
    ];
    expect(openCountsByWho(items)).toEqual({ f: 2, M: 1, L: 3 });
  });

  it('gir null for alle på tom liste', () => {
    expect(openCountsByWho([])).toEqual({ f: 0, M: 0, L: 0 });
  });

  it('gir null når alt er fullført', () => {
    expect(openCountsByWho([{ who: 'M', done: true }, { who: 'f', done: true }]))
      .toEqual({ f: 0, M: 0, L: 0 });
  });

  it('felles-tallet er bare felles-elementer', () => {
    const items: { who: Who; done: boolean }[] = [
      { who: 'f', done: false }, { who: 'M', done: false }, { who: 'L', done: false },
    ];
    expect(openCountsByWho(items).f).toBe(1);
  });
});

describe('WHO_TAB_ORDER', () => {
  it('er Felles, Andreas, Taran', () => {
    expect(WHO_TAB_ORDER).toEqual(['f', 'M', 'L']);
  });
});
