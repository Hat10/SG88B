import { describe, it, expect } from 'vitest';
import { windChill } from '../../../api/vaer';

describe('windChill', () => {
  it('konverterer m/s til km/h: 5 °C og 10 m/s ≈ -0.4 °C', () => {
    expect(windChill(5, 10)).toBeCloseTo(-0.4, 1);
  });
  it('gir temperaturen uendret ved temp > 10', () => {
    expect(windChill(12, 10)).toBe(12);
  });
  it('gir temperaturen uendret ved svak vind', () => {
    expect(windChill(0, 1.5)).toBe(0);
  });
});
