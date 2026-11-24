import { describe, it, expect } from 'vitest';
import { formatKp, kpSlotLabel, kpNowText, kpOngoingText } from '../kpFormat';

describe('formatKp — én desimal, norsk komma, samme overalt', () => {
  it('tredjedeler og heltall', () => {
    expect(formatKp(0.33)).toBe('0,3');
    expect(formatKp(1.67)).toBe('1,7');
    expect(formatKp(1)).toBe('1,0');
    expect(formatKp(2.67)).toBe('2,7');
    expect(formatKp(0)).toBe('0,0');
  });
  it('API-verdi (allerede rundet) og rå verdi gir samme tekst', () => {
    expect(formatKp(1.7)).toBe(formatKp(1.67));
  });
});

describe('kpSlotLabel — Oslo-tid fra Europe/Oslo, ikke hardkodet +1', () => {
  it('vinter (UTC+1): 09–12 UTC → 10–13', () => {
    expect(kpSlotLabel({ start: '2026-11-24T09:00:00.000Z', end: '2026-11-24T12:00:00.000Z' })).toBe('10–13');
  });
  it('sommer (UTC+2): 09–12 UTC → 11–14', () => {
    expect(kpSlotLabel({ start: '2026-07-15T09:00:00.000Z', end: '2026-07-15T12:00:00.000Z' })).toBe('11–14');
  });
  it('over midnatt Oslo-tid: 20–23 UTC (vinter) → 21–00', () => {
    expect(kpSlotLabel({ start: '2026-11-24T20:00:00.000Z', end: '2026-11-24T23:00:00.000Z' })).toBe('21–00');
  });
  it('overgang til sommertid (2026-03-29): bolk 00–03 UTC → 01–05 ville vært feil; hver ende tolkes for seg', () => {
    // 01:00 UTC er første sommertid-time (02:00 → 03:00 Oslo). 00:00 UTC = 01:00 CET, 03:00 UTC = 05:00 CEST.
    expect(kpSlotLabel({ start: '2026-03-29T00:00:00.000Z', end: '2026-03-29T03:00:00.000Z' })).toBe('01–05');
  });
});

describe('kpNowText', () => {
  const slot = { start: '2026-11-24T09:00:00.000Z', end: '2026-11-24T12:00:00.000Z' };
  it('observert + klokkeslett', () => {
    expect(kpNowText(slot, false)).toBe('observert 10–13');
  });
  it('utdatert merkes', () => {
    expect(kpNowText(slot, true)).toBe('observert 10–13 · utdatert');
  });
  it('eldre svar uten bolk: tom tekst (UI faller tilbake)', () => {
    expect(kpNowText(undefined, undefined)).toBe('');
  });
});

describe('kpOngoingText — minimum, ikke «nå»-verdi', () => {
  it('«pågår: ≥ x så langt»', () => {
    expect(kpOngoingText({ kpMin: 0.7 })).toBe('pågår: ≥ 0,7 så langt');
    expect(kpOngoingText({ kpMin: 2 })).toBe('pågår: ≥ 2,0 så langt');
  });
  it('mangler/null/ugyldig → null, ingen tekst', () => {
    expect(kpOngoingText(null)).toBeNull();
    expect(kpOngoingText(undefined)).toBeNull();
    expect(kpOngoingText({ kpMin: NaN })).toBeNull();
  });
});
