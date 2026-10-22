import { describe, it, expect } from 'vitest';
import { anyTaken, datesInHandleuke, longDayLabel, maxMealDays, mealDates, mostUsedRecipeIds } from '../middagLeggTil';

const mp = (date: string, recipeId: string) => ({ id: date, date, recipeId });
const TODAY = '2026-10-22';

describe('maxMealDays', () => {
  it('tom plan: begrenses av taket', () => {
    expect(maxMealDays([], TODAY, TODAY)).toEqual({ max: 7, blockedBy: null });
  });
  it('stopper før første opptatte dag', () => {
    const r = maxMealDays([mp('2026-10-25', 'a')], '2026-10-22', TODAY);
    expect(r).toEqual({ max: 3, blockedBy: '2026-10-25' });
  });
  it('opptatt startdag gir 0', () => {
    expect(maxMealDays([mp(TODAY, 'a')], TODAY, TODAY)).toEqual({ max: 0, blockedBy: TODAY });
  });
  it('stopper ved horisonten (i dag + 13)', () => {
    // 2026-11-04 = i dag + 13 ⇒ kun den dagen er igjen
    expect(maxMealDays([], '2026-11-04', TODAY)).toEqual({ max: 1, blockedBy: null });
  });
  it('dag utenfor horisonten gir 0 uten blokkerende dag', () => {
    expect(maxMealDays([], '2026-11-05', TODAY)).toEqual({ max: 0, blockedBy: null });
  });
  it('respekterer eget tak', () => {
    expect(maxMealDays([], TODAY, TODAY, { cap: 3 }).max).toBe(3);
  });
  it('ignorerer opptatte dager før startdagen', () => {
    expect(maxMealDays([mp('2026-10-21', 'a')], TODAY, TODAY).max).toBe(7);
  });
});

describe('mealDates / anyTaken', () => {
  it('lager påfølgende datoer over månedsskifte', () => {
    expect(mealDates('2026-10-30', 3)).toEqual(['2026-10-30', '2026-10-31', '2026-11-01']);
  });
  it('0 dager gir tom liste', () => {
    expect(mealDates(TODAY, 0)).toEqual([]);
  });
  it('anyTaken', () => {
    expect(anyTaken([mp('2026-10-23', 'a')], ['2026-10-22', '2026-10-23'])).toBe(true);
    expect(anyTaken([mp('2026-10-24', 'a')], ['2026-10-22', '2026-10-23'])).toBe(false);
  });
});

describe('datesInHandleuke', () => {
  // Handleuke lørdag 2026-10-17 – fredag 2026-10-23
  it('beholder kun dager i inneværende handleuke', () => {
    const dates = mealDates('2026-10-22', 4); // tor, fre, lør, søn
    expect(datesInHandleuke(dates, '2026-10-17')).toEqual(['2026-10-22', '2026-10-23']);
  });
  it('×N over lørdagen: ingen dager i neste uke', () => {
    expect(datesInHandleuke(['2026-10-24', '2026-10-25'], '2026-10-17')).toEqual([]);
  });
  it('lørdag er første, fredag siste dag', () => {
    expect(datesInHandleuke(['2026-10-16', '2026-10-17', '2026-10-23', '2026-10-24'], '2026-10-17'))
      .toEqual(['2026-10-17', '2026-10-23']);
  });
});

describe('mostUsedRecipeIds', () => {
  it('flest ganger laget først, rester teller ikke', () => {
    const plan = [
      mp('2026-10-01', 'a'), mp('2026-10-02', 'a'), // a: 1 gang (rester)
      mp('2026-10-05', 'b'), mp('2026-10-08', 'b'), // b: 2
      mp('2026-10-10', 'a'),                       // a: 2
    ];
    expect(mostUsedRecipeIds(plan, TODAY)).toEqual(['a', 'b']); // likt ⇒ sist laget først
  });
  it('ekskluderer og begrenser', () => {
    const plan = [mp('2026-10-01', 'a'), mp('2026-10-03', 'b'), mp('2026-10-05', 'c')];
    expect(mostUsedRecipeIds(plan, TODAY, 1, ['c'])).toEqual(['b']);
  });
  it('teller ikke fremtidige middager', () => {
    expect(mostUsedRecipeIds([mp('2026-10-30', 'a')], TODAY)).toEqual([]);
  });
});

describe('longDayLabel', () => {
  it('lang ukedag, dato og måned', () => {
    expect(longDayLabel('2026-10-28')).toBe('onsdag 28. okt');
  });
});
