import { describe, it, expect } from 'vitest';
import {
  clampOffset, resolveAxis, rubberBand, dragTranslate, settleTarget, idleRemaining,
  RUBBER_BAND_LIMIT_PX,
} from '../swipePager';

describe('clampOffset', () => {
  it('klemmer til [min, max]', () => {
    expect(clampOffset(-1, 0, 13)).toBe(0);
    expect(clampOffset(5, 0, 13)).toBe(5);
    expect(clampOffset(14, 0, 13)).toBe(13);
  });
});

describe('resolveAxis', () => {
  it('venter til bevegelsen er over terskelen', () => {
    expect(resolveAxis(4, 3)).toBeNull();
    expect(resolveAxis(-9, 9)).toBeNull();
  });
  it('horisontal over terskel = x, begge retninger', () => {
    expect(resolveAxis(12, 2)).toBe('x');
    expect(resolveAxis(-12, 5)).toBe('x');
  });
  it('vertikal dominerer = y (vanlig scroll)', () => {
    expect(resolveAxis(3, 14)).toBe('y');
    expect(resolveAxis(11, 30)).toBe('y');
  });
  it('diagonalt uavgjort går til scroll', () => {
    expect(resolveAxis(12, 12)).toBe('y');
  });
});

describe('rubberBand', () => {
  it('er 0 ved 0, bevarer fortegn og holder seg under limit', () => {
    expect(rubberBand(0)).toBe(0);
    expect(rubberBand(50)).toBeGreaterThan(0);
    expect(rubberBand(-50)).toBeLessThan(0);
    expect(Math.abs(rubberBand(5000))).toBeLessThan(RUBBER_BAND_LIMIT_PX);
  });
  it('gir mindre enn 1:1 og er monotont økende', () => {
    expect(rubberBand(100)).toBeLessThan(100);
    expect(rubberBand(200)).toBeGreaterThan(rubberBand(100));
  });
});

describe('dragTranslate', () => {
  it('følger fingeren mot en eksisterende dag', () => {
    expect(dragTranslate(-80, 3, 0, 13, 300)).toBe(-80);
    expect(dragTranslate(80, 3, 0, 13, 300)).toBe(80);
  });
  it('klemmer til ±width', () => {
    expect(dragTranslate(-900, 3, 0, 13, 300)).toBe(-300);
  });
  it('gummistrikk før første dag (drag høyre på offset 0)', () => {
    const v = dragTranslate(100, 0, 0, 13, 300);
    expect(v).toBeGreaterThan(0);
    expect(v).toBeLessThan(100);
  });
  it('gummistrikk etter siste dag (drag venstre på max)', () => {
    const v = dragTranslate(-100, 13, 0, 13, 300);
    expect(v).toBeLessThan(0);
    expect(v).toBeGreaterThan(-100);
  });
  it('drag mot gyldig side ved kanten følger fingeren 1:1', () => {
    expect(dragTranslate(-60, 0, 0, 13, 300)).toBe(-60);
    expect(dragTranslate(60, 13, 0, 13, 300)).toBe(60);
  });
});

describe('settleTarget', () => {
  const base = { width: 300, min: 0, max: 13 };
  it('langt drag venstre = neste dag, høyre = forrige', () => {
    expect(settleTarget({ ...base, dx: -100, velocity: 0, offset: 3 })).toBe(4);
    expect(settleTarget({ ...base, dx: 100, velocity: 0, offset: 3 })).toBe(2);
  });
  it('kort, sakte drag glir tilbake', () => {
    expect(settleTarget({ ...base, dx: -40, velocity: -0.1, offset: 3 })).toBe(3);
  });
  it('flikk blar selv om draget er kort', () => {
    expect(settleTarget({ ...base, dx: -40, velocity: -0.8, offset: 3 })).toBe(4);
  });
  it('flikk i motsatt retning av draget teller ikke', () => {
    expect(settleTarget({ ...base, dx: -40, velocity: 0.8, offset: 3 })).toBe(3);
  });
  it('for kort flikk (under minimum px) blar ikke', () => {
    expect(settleTarget({ ...base, dx: -10, velocity: -2, offset: 3 })).toBe(3);
  });
  it('klemmer ved kantene', () => {
    expect(settleTarget({ ...base, dx: 200, velocity: 0, offset: 0 })).toBe(0);
    expect(settleTarget({ ...base, dx: -200, velocity: 0, offset: 13 })).toBe(13);
  });
});

describe('idleRemaining', () => {
  it('teller ned fra siste aktivitet', () => {
    expect(idleRemaining(1000, 1000, 10000)).toBe(10000);
    expect(idleRemaining(6000, 1000, 10000)).toBe(5000);
    expect(idleRemaining(11000, 1000, 10000)).toBe(0);
    expect(idleRemaining(12000, 1000, 10000)).toBeLessThan(0);
  });
});
