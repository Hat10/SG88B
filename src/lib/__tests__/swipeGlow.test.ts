import { describe, it, expect } from 'vitest';
import { layoutGap, glowParams, glowBleed, swipeGlow, BLUR_REACH } from '../../pages/skjerm/swipeGlow';

describe('layoutGap', () => {
  it('tilsvarer Gangskjermens gap per layout', () => {
    expect(layoutGap('mobile')).toBe(10);
    expect(layoutGap('tablet')).toBe(8);
    expect(layoutGap('desktop')).toBe(24);
  });
});

describe('glowParams — utstrekning = halve gapet', () => {
  for (const gap of [8, 10, 24]) {
    it(`gap ${gap}: spread + 1,5·blur = gap/2, og aldri mer`, () => {
      const g = glowParams(gap);
      expect(g.extent).toBe(gap / 2);
      expect(g.spread + BLUR_REACH * g.blur).toBeCloseTo(gap / 2, 10);
      expect(g.spread + BLUR_REACH * g.blur).toBeLessThanOrEqual(gap / 2 + 1e-9);
      expect(g.spread).toBeGreaterThan(0);
      expect(g.blur).toBeGreaterThan(0);
    });
  }
  it('konkrete verdier per layout', () => {
    expect(glowParams(8)).toEqual({ extent: 4, spread: 1.6, blur: 1.6 });
    expect(glowParams(10).extent).toBe(5);
    expect(glowParams(24).extent).toBe(12);
  });
});

describe('glowBleed', () => {
  it('er glødens utstrekning for layouten', () => {
    expect(glowBleed('tablet')).toBe(4);
    expect(glowBleed('mobile')).toBe(5);
    expect(glowBleed('desktop')).toBe(12);
  });
});

describe('swipeGlow', () => {
  it('aktiv: én box-shadow i --danger med spread og blur; ingen layout-egenskaper', () => {
    const s = swipeGlow(true, 'tablet', false);
    expect(s.boxShadow).toBe('0 0 1.6px 1.6px color-mix(in srgb, var(--danger) 85%, transparent)');
    expect(Object.keys(s).sort()).toEqual(['boxShadow', 'transition']);
  });
  it('inaktiv: ingen synlig skygge, men samme egenskap så overgangen kan animeres', () => {
    expect(swipeGlow(false, 'tablet', false).boxShadow).toBe('0 0 0 0 transparent');
  });
  it('myk overgang, av ved prefers-reduced-motion', () => {
    expect(swipeGlow(true, 'mobile', false).transition).toContain('box-shadow');
    expect(swipeGlow(true, 'mobile', true).transition).toBe('none');
  });
});
