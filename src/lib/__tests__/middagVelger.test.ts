import { describe, it, expect } from 'vitest';
import type { Recipe } from '../../contexts/MatplanContext';
import {
  searchRecipes, lastCookedByRecipe, recentRecipeIds, lastCookedLabel, isLeftoverDay,
  cookCountByRecipe, sortRecipes, tagSuggestions, applyTagSuggestion,
} from '../middagVelger';

const r = (id: string, name: string, ingredients: string[] = [], tags: string[] = []): Recipe => ({
  id, name, tags, cookTimeMinutes: null, instructions: null, source: 'egen',
  ingredients: ingredients.map(n => ({ name: n, amount: null, unit: null })),
});
const mp = (date: string, recipeId: string) => ({ id: date, date, recipeId });

const RECIPES = [
  r('a', 'Kylling tikka masala', ['kyllingfilet', 'ris'], ['prøvd']),
  r('b', 'Laksewok', ['laks', 'nudler']),
  r('c', 'Wok med kylling', ['kylling', 'nudler'], ['rask']),
  r('d', 'Lasagne', ['kjøttdeig'], ['prøvd']),
];

describe('searchRecipes', () => {
  it('tomt søk gir alle alfabetisk', () => {
    expect(searchRecipes(RECIPES, '  ').map(x => x.id)).toEqual(['a', 'b', 'd', 'c']);
  });
  it('treffer ingredienser, ikke bare navn', () => {
    expect(searchRecipes(RECIPES, 'laks').map(x => x.id)).toEqual(['b']);
    expect(searchRecipes(RECIPES, 'kjøttdeig').map(x => x.id)).toEqual(['d']);
  });
  it('treffer tags og er ufølsom for store bokstaver', () => {
    expect(searchRecipes(RECIPES, 'RASK').map(x => x.id)).toEqual(['c']);
  });
  it('krever at alle ord treffer', () => {
    expect(searchRecipes(RECIPES, 'kylling nudler').map(x => x.id)).toEqual(['c']);
  });
  it('rangerer navn som starter med søket først', () => {
    expect(searchRecipes(RECIPES, 'kylling').map(x => x.id)).toEqual(['a', 'c']);
    expect(searchRecipes(RECIPES, 'wok').map(x => x.id)).toEqual(['c', 'b']);
  });
});

describe('lastCookedByRecipe / recentRecipeIds', () => {
  const plan = [mp('2026-10-01', 'a'), mp('2026-10-10', 'b'), mp('2026-10-15', 'a'), mp('2026-10-25', 'c')];
  it('ignorerer fremtidige datoer og tar siste dato', () => {
    const m = lastCookedByRecipe(plan, '2026-10-20');
    expect(m.get('a')).toBe('2026-10-15');
    expect(m.has('c')).toBe(false);
  });
  it('sorterer nyeste først og begrenser', () => {
    expect(recentRecipeIds(plan, '2026-10-20')).toEqual(['a', 'b']);
    expect(recentRecipeIds(plan, '2026-10-20', 1)).toEqual(['a']);
  });
});

describe('lastCookedLabel', () => {
  it.each([
    [undefined, 'aldri laget'],
    ['2026-10-20', 'i dag'],
    ['2026-10-19', 'i går'],
    ['2026-10-15', '5 dager siden'],
    ['2026-09-29', '3 uker siden'],
    ['2026-07-01', '3 mnd siden'],
  ])('%s → %s', (date, label) => {
    expect(lastCookedLabel(date, '2026-10-20')).toBe(label);
  });
});

describe('isLeftoverDay', () => {
  const plan = [mp('2026-10-20', 'a'), mp('2026-10-21', 'a'), mp('2026-10-22', 'b')];
  it('samme oppskrift som dagen før ⇒ rester', () => {
    expect(isLeftoverDay(plan, '2026-10-21')).toBe(true);
  });
  it('første dag og ny oppskrift er ikke rester', () => {
    expect(isLeftoverDay(plan, '2026-10-20')).toBe(false);
    expect(isLeftoverDay(plan, '2026-10-22')).toBe(false);
    expect(isLeftoverDay(plan, '2026-10-23')).toBe(false);
  });
});

describe('cookCountByRecipe', () => {
  it('teller rester-dager som én gang, og ignorerer fremtiden', () => {
    const plan = [
      mp('2026-10-01', 'a'), mp('2026-10-02', 'a'), mp('2026-10-03', 'a'), // én gang + rester
      mp('2026-10-08', 'a'), mp('2026-10-09', 'b'), mp('2026-10-30', 'b'),
    ];
    const m = cookCountByRecipe(plan, '2026-10-20');
    expect(m.get('a')).toBe(2);
    expect(m.get('b')).toBe(1);
  });
});

describe('sortRecipes', () => {
  const last = new Map([['a', '2026-10-15'], ['b', '2026-10-18']]);
  const count = new Map([['a', 5], ['b', 1], ['d', 5]]);
  const withTime = RECIPES.map((x, i) => ({ ...x, cookTimeMinutes: [35, 20, null, 60][i] }));
  it('A–Å', () => {
    expect(sortRecipes(RECIPES, 'az', last, count).map(x => x.id)).toEqual(['a', 'b', 'd', 'c']);
  });
  it('sist laget: nyeste først, aldri laget sist alfabetisk', () => {
    expect(sortRecipes(RECIPES, 'sist', last, count).map(x => x.id)).toEqual(['b', 'a', 'd', 'c']);
  });
  it('mest laget: likt antall ⇒ alfabetisk', () => {
    expect(sortRecipes(RECIPES, 'mest', last, count).map(x => x.id)).toEqual(['a', 'd', 'b', 'c']);
  });
  it('koketid: korteste først, uten koketid sist', () => {
    expect(sortRecipes(withTime, 'tid', last, count).map(x => x.id)).toEqual(['b', 'a', 'd', 'c']);
  });
});

describe('tagSuggestions / applyTagSuggestion', () => {
  const tags = ['prøvd', 'rask', 'vegetar', 'fredag', 'barnevennlig'];
  it('foreslår tags som starter med, så som inneholder, det man skriver', () => {
    expect(tagSuggestions('veg', tags)).toEqual(['vegetar']);
    expect(tagSuggestions('prøvd, r', tags)).toEqual(['rask', 'vegetar', 'fredag', 'barnevennlig']);
  });
  it('utelater tags som allerede står i feltet', () => {
    expect(tagSuggestions('prøvd, rask, ', tags)).toEqual(['vegetar', 'fredag', 'barnevennlig']);
  });
  it('erstatter ordet man skriver på', () => {
    expect(applyTagSuggestion('veg', 'vegetar')).toBe('vegetar, ');
    expect(applyTagSuggestion('prøvd, r', 'rask')).toBe('prøvd, rask, ');
  });
});
