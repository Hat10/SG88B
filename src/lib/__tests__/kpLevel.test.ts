import { describe, it, expect } from 'vitest';
import { kpLevel } from '../kpLevel';

describe('kpLevel', () => {
  it.each([
    [0, 'lav'],
    [1.67, 'lav'],
    [2, 'middels'],
    [3.67, 'middels'],
    [4, 'hoy'],
    [9, 'hoy'],
  ])('Kp %s → %s', (kp, expected) => {
    expect(kpLevel(kp)).toBe(expected);
  });
});
