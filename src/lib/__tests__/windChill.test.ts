import { describe, it, expect } from 'vitest';
import { windChill } from '../../../api/vaer';

describe('windChill', () => {
  it('konverterer m/s til km/h i formelen', () => {
    expect(windChill(5, 10)).toBeCloseTo(-0.4, 1);
    expect(windChill(9.9, 10.3)).toBeCloseTo(6.0, 1);
  });

  it('returnerer temperaturen uendret over 10 °C eller ved svak vind', () => {
    expect(windChill(12, 8)).toBe(12);
    expect(windChill(0, 1.5)).toBe(0);
  });
});
