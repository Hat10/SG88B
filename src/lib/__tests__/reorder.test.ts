import { describe, it, expect } from 'vitest';
import { moveItem, canMoveUp, canMoveDown, moveByStep } from '../reorder';

const abc = ['a', 'b', 'c', 'd'];

describe('moveItem', () => {
  it('flytter nedover', () => {
    expect(moveItem(abc, 0, 2)).toEqual(['b', 'c', 'a', 'd']);
  });
  it('flytter oppover', () => {
    expect(moveItem(abc, 3, 1)).toEqual(['a', 'd', 'b', 'c']);
  });
  it('flytter første til sist og sist til først', () => {
    expect(moveItem(abc, 0, 3)).toEqual(['b', 'c', 'd', 'a']);
    expect(moveItem(abc, 3, 0)).toEqual(['d', 'a', 'b', 'c']);
  });
  it('samme indeks gir uendret liste', () => {
    expect(moveItem(abc, 2, 2)).toEqual(abc);
  });
  it('ugyldige indekser gir uendret liste', () => {
    expect(moveItem(abc, -1, 2)).toEqual(abc);
    expect(moveItem(abc, 1, 4)).toEqual(abc);
    expect(moveItem([], 0, 0)).toEqual([]);
  });
  it('muterer ikke input og returnerer ny array', () => {
    const input = [...abc];
    const out = moveItem(input, 0, 1);
    expect(input).toEqual(abc);
    expect(out).not.toBe(input);
  });
  it('beholder objektreferanser (bare rekkefølgen endres)', () => {
    const items = [{ id: 1 }, { id: 2 }, { id: 3 }];
    const out = moveItem(items, 2, 0);
    expect(out.map(i => i.id)).toEqual([3, 1, 2]);
    expect(out[0]).toBe(items[2]);
  });
});

describe('canMoveUp / canMoveDown', () => {
  it('første element: ▲ av, ▼ på', () => {
    expect(canMoveUp(0, 4)).toBe(false);
    expect(canMoveDown(0, 4)).toBe(true);
  });
  it('siste element: ▲ på, ▼ av', () => {
    expect(canMoveUp(3, 4)).toBe(true);
    expect(canMoveDown(3, 4)).toBe(false);
  });
  it('midterste element: begge på', () => {
    expect(canMoveUp(1, 4)).toBe(true);
    expect(canMoveDown(1, 4)).toBe(true);
  });
  it('ett element: begge av', () => {
    expect(canMoveUp(0, 1)).toBe(false);
    expect(canMoveDown(0, 1)).toBe(false);
  });
  it('ugyldige indekser: begge av', () => {
    expect(canMoveUp(4, 4)).toBe(false);
    expect(canMoveDown(-1, 4)).toBe(false);
  });
});

describe('moveByStep', () => {
  it('▲ flytter ett hakk opp', () => {
    expect(moveByStep(abc, 2, 'up')).toEqual(['a', 'c', 'b', 'd']);
  });
  it('▼ flytter ett hakk ned', () => {
    expect(moveByStep(abc, 1, 'down')).toEqual(['a', 'c', 'b', 'd']);
  });
  it('▲ på første element gjør ingenting', () => {
    expect(moveByStep(abc, 0, 'up')).toEqual(abc);
  });
  it('▼ på siste element gjør ingenting', () => {
    expect(moveByStep(abc, 3, 'down')).toEqual(abc);
  });
});
