import { describe, it, expect } from 'vitest';
import { dayLabel } from '../dayLabel';

describe('dayLabel', () => {
  it('i dag / i morgen', () => {
    expect(dayLabel(0, '2026-10-19')).toBe('i dag');
    expect(dayLabel(1, '2026-10-20')).toBe('i morgen');
  });
  it('ellers ukedag, dato og måned uten punktum etter ukedag/måned', () => {
    expect(dayLabel(2, '2026-10-21')).toBe('ons 21. okt');
    expect(dayLabel(13, '2026-11-01')).toBe('søn 1. nov');
  });
});
