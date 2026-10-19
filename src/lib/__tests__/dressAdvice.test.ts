import { describe, it, expect } from 'vitest';
import { dressAdvice } from '../dressAdvice';

describe('dressAdvice', () => {
  it('snø eller frost', () => {
    expect(dressAdvice(5, -2, 'snow', 0).text).toContain('Vinterklær');
    expect(dressAdvice(-1, -6, 'cloudy', 0).text).toContain('Vinterklær');
  });
  it('kaldt, uavhengig av regn', () => {
    expect(dressAdvice(7, 3, 'rain', 5).text).toContain('vinterjakke');
  });
  it('regn = kategori regn/torden eller > 1 mm', () => {
    expect(dressAdvice(12, 8, 'rain', 0).text).toContain('regnjakke');
    expect(dressAdvice(12, 8, 'thunder', 0).text).toContain('regnjakke');
    expect(dressAdvice(12, 8, 'cloudy', 1.1).text).toContain('regnjakke');
    expect(dressAdvice(12, 8, 'cloudy', 1).text).toContain('genser');
  });
  it('varmt', () => {
    expect(dressAdvice(22, 14, 'clear', 0).text).toContain('SOMMERKLÆR');
    expect(dressAdvice(22, 14, 'rain', 3).text).toContain('holde deg tørr');
    expect(dressAdvice(17, 10, 'fair', 0).text).toContain('tynn jakke');
  });
  it('varmere-til-morgen-og-kveld-varsel', () => {
    expect(dressAdvice(12, 6, 'cloudy', 0).spreadWarning).toBe(true);
    expect(dressAdvice(12, 8, 'cloudy', 0).spreadWarning).toBe(false); // spenn < 5
    expect(dressAdvice(7, 1, 'cloudy', 0).spreadWarning).toBe(false);  // max < 8
    expect(dressAdvice(20, 16, 'cloudy', 0).spreadWarning).toBe(false); // min ≥ 15
  });
});
