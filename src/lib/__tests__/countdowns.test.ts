import { describe, it, expect } from 'vitest';
import { upcomingCountdowns, clampIndex, daysBetween, osloToday } from '../countdowns';

const c = (id: string, date: string) => ({ id, label: id, date });

describe('upcomingCountdowns', () => {
  it('fjerner passerte, beholder dagens, sorterer nærmest først', () => {
    const list = [c('c', '2026-12-24'), c('old', '2026-10-01'), c('today', '2026-10-19'), c('b', '2026-11-05')];
    expect(upcomingCountdowns(list, '2026-10-19').map(x => x.id)).toEqual(['today', 'b', 'c']);
  });
  it('tom når alt er passert', () => {
    expect(upcomingCountdowns([c('a', '2026-10-18')], '2026-10-19')).toEqual([]);
  });
  it('lik dato beholder opprinnelig rekkefølge', () => {
    const list = [c('x', '2026-11-01'), c('y', '2026-11-01')];
    expect(upcomingCountdowns(list, '2026-10-19').map(i => i.id)).toEqual(['x', 'y']);
  });
  it('muterer ikke input', () => {
    const list = [c('b', '2026-11-05'), c('a', '2026-10-20')];
    upcomingCountdowns(list, '2026-10-19');
    expect(list.map(i => i.id)).toEqual(['b', 'a']);
  });
});

describe('clampIndex', () => {
  it('klemmer til [0, n-1]', () => {
    expect(clampIndex(5, 3)).toBe(2);
    expect(clampIndex(-1, 3)).toBe(0);
    expect(clampIndex(1, 3)).toBe(1);
  });
  it('0 for tom liste', () => {
    expect(clampIndex(4, 0)).toBe(0);
  });
});

describe('daysBetween', () => {
  it('0 / 1 / flere dager', () => {
    expect(daysBetween('2026-10-19', '2026-10-19')).toBe(0);
    expect(daysBetween('2026-10-19', '2026-10-20')).toBe(1);
    expect(daysBetween('2026-10-19', '2026-12-24')).toBe(66);
  });
  it('krysser sommertidsskifte og årsskifte', () => {
    expect(daysBetween('2026-10-24', '2026-10-26')).toBe(2);
    expect(daysBetween('2026-12-31', '2027-01-01')).toBe(1);
  });
});

describe('osloToday', () => {
  it('bruker Oslo-dato, ikke UTC', () => {
    expect(osloToday(new Date('2026-10-18T22:30:00Z'))).toBe('2026-10-19');
    expect(osloToday(new Date('2026-10-19T10:00:00Z'))).toBe('2026-10-19');
  });
});
