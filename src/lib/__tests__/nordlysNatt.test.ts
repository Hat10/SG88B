import { describe, it, expect } from 'vitest';
import {
  addDaysIso, osloParts, nightDateOf, kpAtStrict, pickBestHour, evaluateNight, buildNights,
  NIGHT_MIN_COVERAGE, type NightHourInput,
} from '../../../api/nordlys';

const H = 3600_000;
const utc = (iso: string) => new Date(iso).getTime();
const hr = (iso: string, kp: number | null, cloud: number | null, dark = true): NightHourInput =>
  ({ ms: utc(iso), kp, cloud, dark });

describe('addDaysIso / osloParts', () => {
  it('regner på datoer uten tidssone-skift', () => {
    expect(addDaysIso('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDaysIso('2026-10-19', -1)).toBe('2026-10-18');
    expect(addDaysIso('2026-12-31', 3)).toBe('2027-01-03');
  });
  it('Oslo-dato og -time (vinter og sommertid)', () => {
    expect(osloParts(utc('2026-01-15T22:00:00Z'))).toEqual({ date: '2026-01-15', hour: 23 });
    expect(osloParts(utc('2026-07-15T22:30:00Z'))).toEqual({ date: '2026-07-16', hour: 0 });
  });
});

describe('nightDateOf — natten en time hører til', () => {
  it('kveld (≥ 12) hører til samme dato', () => {
    expect(nightDateOf(utc('2026-10-19T19:00:00Z'))).toBe('2026-10-19'); // 21 Oslo (sommertid)
  });
  it('tidlig morgen (< 12) hører til gårsdagens natt — over midnatt', () => {
    expect(nightDateOf(utc('2026-10-19T22:30:00Z'))).toBe('2026-10-19'); // 00:30 Oslo 20. okt
    expect(nightDateOf(utc('2026-10-20T03:00:00Z'))).toBe('2026-10-19'); // 05:00 Oslo
  });
  it('skillet er 12:00 Oslo-tid', () => {
    expect(nightDateOf(utc('2026-01-15T10:00:00Z'))).toBe('2026-01-14'); // 11:00 Oslo
    expect(nightDateOf(utc('2026-01-15T11:00:00Z'))).toBe('2026-01-15'); // 12:00 Oslo
  });
});

describe('kpAtStrict', () => {
  const rows = [{ ms: utc('2026-10-19T00:00:00Z'), kp: 2 }, { ms: utc('2026-10-19T03:00:00Z'), kp: 4 }];
  it('bolken gjelder i sine egne 3 timer', () => {
    expect(kpAtStrict(rows, utc('2026-10-19T01:00:00Z'))).toBe(2);
    expect(kpAtStrict(rows, utc('2026-10-19T03:00:00Z'))).toBe(4);
    expect(kpAtStrict(rows, utc('2026-10-19T05:59:00Z'))).toBe(4);
  });
  it('null før første og etter siste bolk (ikke gjenbruk)', () => {
    expect(kpAtStrict(rows, utc('2026-10-18T23:00:00Z'))).toBeNull();
    expect(kpAtStrict(rows, utc('2026-10-19T06:00:00Z'))).toBeNull();
    expect(kpAtStrict([], utc('2026-10-19T06:00:00Z'))).toBeNull();
  });
});

describe('pickBestHour', () => {
  it('høyest score vinner', () => {
    const best = pickBestHour([
      hr('2026-10-19T20:00:00Z', 5, 90),  // 2+0 = 2
      hr('2026-10-19T21:00:00Z', 3, 20),  // 1+2 = 3
      hr('2026-10-19T22:00:00Z', 1, 10),  // 0+2 = 2
    ]);
    expect(best).toMatchObject({ time: '2026-10-19T21:00:00.000Z', kp: 3, cloudCover: 20, score: 3, chance: 'høy' });
  });
  it('lik score: høyere Kp, så mindre skyer, så tidligst', () => {
    expect(pickBestHour([hr('2026-10-19T20:00:00Z', 3, 10), hr('2026-10-19T21:00:00Z', 4, 25)])?.time).toBe('2026-10-19T21:00:00.000Z');
    expect(pickBestHour([hr('2026-10-19T20:00:00Z', 3, 25), hr('2026-10-19T21:00:00Z', 3, 10)])?.time).toBe('2026-10-19T21:00:00.000Z');
    expect(pickBestHour([hr('2026-10-19T20:00:00Z', 3, 10), hr('2026-10-19T21:00:00Z', 3, 10)])?.time).toBe('2026-10-19T20:00:00.000Z');
  });
  it('hopper over timer uten Kp eller skydekke; null uten noen', () => {
    expect(pickBestHour([hr('2026-10-19T20:00:00Z', null, 10), hr('2026-10-19T21:00:00Z', 4, null)])).toBeNull();
    expect(pickBestHour([])).toBeNull();
    expect(pickBestHour([hr('2026-10-19T20:00:00Z', null, 10), hr('2026-10-19T21:00:00Z', 0, 90)])?.time).toBe('2026-10-19T21:00:00.000Z');
  });
});

describe('evaluateNight', () => {
  // Natt 19. okt (CEST): kveld 19:00Z–22:00Z (21–24 Oslo), morgen 02:00Z–04:00Z
  const full = [
    hr('2026-10-19T12:00:00Z', 3, 50, false), // lyst ettermiddag
    hr('2026-10-19T19:00:00Z', 2, 80), hr('2026-10-19T20:00:00Z', 4, 20), hr('2026-10-19T21:00:00Z', 4, 40),
    hr('2026-10-20T02:00:00Z', 5, 90), hr('2026-10-20T03:00:00Z', 5, 95),
  ];
  it('ok: beste mørke time, lyse timer teller ikke', () => {
    const n = evaluateNight('2026-10-19', full);
    expect(n.status).toBe('ok');
    expect(n.darkHours).toBe(5);
    expect(n.usableHours).toBe(5);
    expect(n.best).toMatchObject({ time: '2026-10-19T20:00:00.000Z', kp: 4, cloudCover: 20, score: 3, chance: 'høy' });
    expect(n.windowStart).toBe('2026-10-19T19:00:00.000Z');
    expect(n.windowEnd).toBe('2026-10-20T03:00:00.000Z');
    expect(n.hours).toHaveLength(5);
    expect(n.hours.every(h => h.dark)).toBe(true);
  });
  it('lyse timer med bedre score påvirker ikke valget', () => {
    const n = evaluateNight('2026-10-19', [hr('2026-10-19T12:00:00Z', 9, 0, false), hr('2026-10-19T20:00:00Z', 1, 90)]);
    expect(n.best?.time).toBe('2026-10-19T20:00:00.000Z');
  });
  it('incomplete når for få mørke timer har Kp', () => {
    const hours = [
      hr('2026-10-19T19:00:00Z', 4, 10), hr('2026-10-19T20:00:00Z', null, 10),
      hr('2026-10-19T21:00:00Z', null, 10), hr('2026-10-20T02:00:00Z', null, 10),
    ];
    const n = evaluateNight('2026-10-19', hours);
    expect(n.status).toBe('incomplete');
    expect(n.usableHours).toBe(1);
    expect(1 / 4).toBeLessThan(NIGHT_MIN_COVERAGE);
    expect(n.best?.kp).toBe(4); // delvis data oppgis, men natten er merket ufullstendig
  });
  it('incomplete uten noen brukbare timer — ingen gjetning', () => {
    const n = evaluateNight('2026-10-19', [hr('2026-10-19T19:00:00Z', null, 10), hr('2026-10-19T20:00:00Z', null, 10)]);
    expect(n.status).toBe('incomplete');
    expect(n.best).toBeNull();
    expect(n.hours).toEqual([]);
  });
  it('grensen: akkurat 75 % dekning er ok', () => {
    const hours = [hr('2026-10-19T19:00:00Z', 4, 10), hr('2026-10-19T20:00:00Z', 4, 10), hr('2026-10-19T21:00:00Z', 4, 10), hr('2026-10-20T02:00:00Z', null, 10)];
    expect(evaluateNight('2026-10-19', hours).status).toBe('ok');
  });
  it('tooLight: timer finnes, men ingen er mørke (lys sommernatt)', () => {
    const n = evaluateNight('2026-06-20', [
      hr('2026-06-20T14:00:00Z', 4, 10, false), hr('2026-06-20T22:00:00Z', 4, 10, false), hr('2026-06-21T01:00:00Z', 4, 10, false),
    ]);
    expect(n.status).toBe('tooLight');
    expect(n.best).toBeNull();
    expect(n.darkHours).toBe(0);
    expect(n.windowStart).toBeNull();
  });
  it('ingen timer i det hele tatt er incomplete, ikke tooLight', () => {
    const n = evaluateNight('2026-10-19', []);
    expect(n.status).toBe('incomplete');
    expect(n.best).toBeNull();
  });
});

describe('buildNights', () => {
  it('tre netter, timer fordelt etter natt; morgentimer går til forrige kveld', () => {
    const inputs = [
      hr('2026-10-19T03:00:00Z', 6, 0),                        // 05:00 19. okt = natt 18. (utenfor)
      hr('2026-10-19T20:00:00Z', 4, 10),                       // natt 19.
      hr('2026-10-20T02:00:00Z', 4, 10),                       // natt 19. (morgen 20.)
      hr('2026-10-20T20:00:00Z', 2, 10),                       // natt 20.
      hr('2026-10-21T20:00:00Z', 5, 10), hr('2026-10-21T21:00:00Z', 5, 10), // natt 21.
      hr('2026-10-22T20:00:00Z', 5, 10),                       // natt 22. (utenfor)
    ];
    const nights = buildNights('2026-10-19', inputs);
    expect(nights.map(n => n.date)).toEqual(['2026-10-19', '2026-10-20', '2026-10-21']);
    expect(nights.map(n => n.darkHours)).toEqual([2, 1, 2]);
  });
  it('natt uten data blir incomplete, ikke tooLight', () => {
    const nights = buildNights('2026-10-19', [hr('2026-10-19T20:00:00Z', 4, 10)]);
    expect(nights[2].status).toBe('incomplete');
  });
});
