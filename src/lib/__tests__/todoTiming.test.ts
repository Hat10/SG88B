import { describe, it, expect } from 'vitest';
import { todoTiming, fmtUntil, relativeDays, dayDiff } from '../../pages/skjerm/todoTiming';

// Mandag 19. okt 2026 kl. 14:00 (lokal tid)
const MON = new Date(2026, 9, 19, 14, 0);
const SUN = new Date(2026, 9, 25, 10, 0);

describe('todoTiming — grupper', () => {
  it('uten frist → Uten frist', () => {
    expect(todoTiming({}, MON)).toEqual({ bucket: 'ingen', label: 'Ingen frist' });
  });

  it('forfalt (etter rollover) viser dager siden opprinnelig frist', () => {
    const t = todoTiming({ deadline: '2026-10-19', overdueSince: '2026-10-18' }, MON);
    expect(t.bucket).toBe('forfalt');
    expect(t.label).toBe('Forfalt 1 d');
    expect(t.sub).toBe('søn 18. okt');
    expect(t.sortKey).toBe('2026-10-18');
  });

  it('klokkeslett passert i dag → Forfalt i dag', () => {
    const t = todoTiming({ deadline: '2026-10-19', time: '09:00', overdueSince: '2026-10-19' }, MON);
    expect(t).toMatchObject({ bucket: 'forfalt', label: 'Forfalt i dag', sub: 'kl. 09:00' });
  });

  it('i dag med klokkeslett viser nedtelling', () => {
    expect(todoTiming({ deadline: '2026-10-19', time: '18:00' }, MON))
      .toEqual({ bucket: 'idag', label: 'I dag 18:00', sub: 'om 4 t' });
  });

  it('i dag uten klokkeslett', () => {
    expect(todoTiming({ deadline: '2026-10-19' }, MON)).toEqual({ bucket: 'idag', label: 'I dag' });
  });

  it('denne uken går til og med søndag (mandag-anker)', () => {
    expect(todoTiming({ deadline: '2026-10-20' }, MON)).toMatchObject({ bucket: 'uke', label: 'I morgen', sub: 'tir 20. okt' });
    expect(todoTiming({ deadline: '2026-10-25' }, MON)).toMatchObject({ bucket: 'uke', label: 'Om 6 dager' });
    expect(todoTiming({ deadline: '2026-10-26' }, MON)).toMatchObject({ bucket: 'senere', label: 'Om 7 dager' });
  });

  it('på søndag er i morgen allerede neste uke → Senere', () => {
    expect(todoTiming({ deadline: '2026-10-26' }, SUN)).toMatchObject({ bucket: 'senere', label: 'I morgen' });
  });

  it('klokkeslett tas med i datoteksten for fremtidige frister', () => {
    expect(todoTiming({ deadline: '2026-10-22', time: '07:30' }, MON).sub).toBe('tor 22. okt 07:30');
  });
});

describe('hjelpere', () => {
  it('relativeDays', () => {
    expect(relativeDays(1)).toBe('I morgen');
    expect(relativeDays(3)).toBe('Om 3 dager');
    expect(relativeDays(13)).toBe('Om 13 dager');
    expect(relativeDays(14)).toBe('Om 2 uker');
    expect(relativeDays(20)).toBe('Om 2 uker');
    expect(relativeDays(21)).toBe('Om 3 uker');
  });

  it('fmtUntil', () => {
    expect(fmtUntil(25 * 60_000)).toBe('om 25 min');
    expect(fmtUntil(90 * 60_000)).toBe('om 1 t 30 min');
    expect(fmtUntil(120 * 60_000)).toBe('om 2 t');
    expect(fmtUntil(4 * 3_600_000 + 20 * 60_000)).toBe('om 4 t');
    expect(fmtUntil(-5)).toBe('om 0 min');
  });

  it('dayDiff krysser sommertid-skifte uten feil', () => {
    expect(dayDiff('2026-10-24', '2026-10-26')).toBe(2);
    expect(dayDiff('2026-10-26', '2026-10-24')).toBe(-2);
  });
});
