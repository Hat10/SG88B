import { describe, it, expect, vi } from 'vitest';

// MatplanContext oppretter supabase-klienten ved import — uten miljøvariabler
// kaster createClient, så den byttes ut med en tom stub (testene her rører
// aldri databasen).
vi.mock('../../lib/supabase', () => ({ supabase: {} }));

import { isStapleDue, isStapleDueNextWeek, type StapleItem } from '../MatplanContext';

const staple = (over: Partial<StapleItem>): StapleItem => ({
  id: 's1', name: 'Melk', amount: null, unit: null,
  intervalWeeks: 1, lastBoughtAt: null, postponedUntil: null, ...over,
});

// Handleuker går lørdag–fredag. 2026-10-03 er en lørdag (syklusstart),
// 2026-09-26 lørdagen en syklus før, 2026-10-10 lørdagen en syklus etter.
const SAT = '2026-10-03';

describe('isStapleDueNextWeek', () => {
  it('ikke forfalt verken nå eller neste uke', () => {
    // Kjøpt denne syklusen, intervall 3 ⇒ først forfalt om 3 sykluser.
    const s = staple({ intervalWeeks: 3, lastBoughtAt: '2026-10-03' });
    expect(isStapleDue(s, SAT)).toBe(false);
    expect(isStapleDueNextWeek(s, SAT)).toBe(false);
  });

  it('forfalt nå ⇒ ikke «forfaller neste uke» (gjelder bare de som ennå ikke er forfalt)', () => {
    const s = staple({ intervalWeeks: 1, lastBoughtAt: '2026-09-26' });
    expect(isStapleDue(s, SAT)).toBe(true);
    expect(isStapleDueNextWeek(s, SAT)).toBe(false);
  });

  it('ikke forfalt nå, men forfalt neste uke', () => {
    // Kjøpt forrige syklus, intervall 2 ⇒ 1 syklus passert nå, 2 neste uke.
    const s = staple({ intervalWeeks: 2, lastBoughtAt: '2026-09-26' });
    expect(isStapleDue(s, SAT)).toBe(false);
    expect(isStapleDueNextWeek(s, SAT)).toBe(true);
  });

  it('regner i sykluser, ikke dager: kjøpt en tirsdag, sjekket en fredag', () => {
    // Tirsdag 2026-09-29 og fredag 2026-10-02 ligger i samme syklus (start 09-26),
    // så intervall 1 er ikke forfalt fredag, men er det fra lørdag av.
    const s = staple({ intervalWeeks: 1, lastBoughtAt: '2026-09-29' });
    expect(isStapleDue(s, '2026-10-02')).toBe(false);
    expect(isStapleDueNextWeek(s, '2026-10-02')).toBe(true);
  });

  it('utsatt-dato midt i neste uke regnes likevel som forfalt neste uke', () => {
    const s = staple({ intervalWeeks: 2, lastBoughtAt: '2026-09-26', postponedUntil: '2026-10-07' });
    expect(isStapleDueNextWeek(s, SAT)).toBe(true);
  });

  it('utsatt forbi neste uke ⇒ ikke forfalt neste uke', () => {
    const s = staple({ intervalWeeks: 2, lastBoughtAt: '2026-09-26', postponedUntil: '2026-10-20' });
    expect(isStapleDueNextWeek(s, SAT)).toBe(false);
  });

  it('intervalWeeks === null forfaller aldri — verken nå eller neste uke', () => {
    for (const lastBoughtAt of [null, '2020-01-01', '2026-09-26']) {
      const s = staple({ intervalWeeks: null, lastBoughtAt });
      expect(isStapleDue(s, SAT)).toBe(false);
      expect(isStapleDueNextWeek(s, SAT)).toBe(false);
    }
  });

  it('endrer ikke varen (ren utregning)', () => {
    const s = staple({ intervalWeeks: 2, lastBoughtAt: '2026-09-26' });
    const before = JSON.stringify(s);
    isStapleDueNextWeek(s, SAT);
    expect(JSON.stringify(s)).toBe(before);
  });
});
