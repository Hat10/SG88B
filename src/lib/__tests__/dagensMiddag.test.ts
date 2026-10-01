import { describe, it, expect } from 'vitest';
import { addDaysLocal, consecutiveDays, formatIngredientAmount } from '../dagensMiddag';

const mp = (date: string, recipeId: string) => ({ id: date, date, recipeId });

describe('consecutiveDays', () => {
  it('0 uten middag i dag', () => {
    expect(consecutiveDays([mp('2026-10-02', 'a')], '2026-10-01')).toBe(0);
  });
  it('teller sammenhengende dager med samme oppskrift', () => {
    const plan = [mp('2026-10-01', 'a'), mp('2026-10-02', 'a'), mp('2026-10-03', 'a'), mp('2026-10-04', 'b')];
    expect(consecutiveDays(plan, '2026-10-01')).toBe(3);
  });
  it('stopper ved hull', () => {
    const plan = [mp('2026-10-01', 'a'), mp('2026-10-03', 'a')];
    expect(consecutiveDays(plan, '2026-10-01')).toBe(1);
  });
  it('teller ikke bakover', () => {
    const plan = [mp('2026-09-30', 'a'), mp('2026-10-01', 'a')];
    expect(consecutiveDays(plan, '2026-10-01')).toBe(1);
  });
  it('krysser sommertidsskifte og månedsskifte', () => {
    expect(addDaysLocal('2026-10-25', 1)).toBe('2026-10-26');
    expect(addDaysLocal('2026-03-28', 1)).toBe('2026-03-29');
    expect(addDaysLocal('2026-10-31', 1)).toBe('2026-11-01');
  });
});

describe('formatIngredientAmount', () => {
  it('multipliserer amount og bruker norsk komma', () => {
    expect(formatIngredientAmount({ amount: 2, unit: 'dl', amountRange: null }, 1)).toBe('2 dl');
    expect(formatIngredientAmount({ amount: 2, unit: 'dl', amountRange: null }, 3)).toBe('6 dl');
    expect(formatIngredientAmount({ amount: 0.5, unit: 'ts', amountRange: null }, 3)).toBe('1,5 ts');
    expect(formatIngredientAmount({ amount: 1 / 3, unit: 'dl', amountRange: null }, 1)).toBe('0,33 dl');
  });
  it('viser intervall uendret med ×N', () => {
    expect(formatIngredientAmount({ amount: null, unit: 'ts', amountRange: '0.5-1' }, 1)).toBe('0,5-1 ts');
    expect(formatIngredientAmount({ amount: null, unit: 'ts', amountRange: '0.5-1' }, 3)).toBe('0,5-1 ts ×3');
  });
  it('kun enhet og ingenting', () => {
    expect(formatIngredientAmount({ amount: null, unit: 'klype', amountRange: null }, 3)).toBe('klype');
    expect(formatIngredientAmount({ amount: null, unit: null, amountRange: null }, 3)).toBe('');
  });
});
