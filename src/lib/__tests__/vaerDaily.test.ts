import { describe, it, expect } from 'vitest';
import {
  addDaysIso, osloParts, selectPeriods, dominantCategory, buildDay, buildDaily, symbolCategory,
  type YrEntry, type NormEntry,
} from '../../../api/vaer';

const norm = (e: YrEntry): NormEntry => {
  // gjenbruker buildDaily sin normalisering via en 3-dagers kjøring er tungvint; speil den her
  const ms = new Date(e.time).getTime();
  const { date, hour } = osloParts(ms);
  const n1 = e.data.next_1_hours, n6 = e.data.next_6_hours;
  return {
    ms, date, hour, temp: e.data.instant.details.air_temperature, wind: e.data.instant.details.wind_speed,
    has1: !!n1, p1: n1?.details?.precipitation_amount ?? 0, sym1: n1?.summary?.symbol_code,
    has6: !!n6, p6: n6?.details?.precipitation_amount ?? 0, sym6: n6?.summary?.symbol_code,
    max6: n6?.details?.air_temperature_max, min6: n6?.details?.air_temperature_min,
  };
};

interface Opts { n1?: { p: number; sym?: string }; n6?: { p: number; sym?: string; max?: number; min?: number }; wind?: number }
const entry = (time: string, temp: number, o: Opts = {}): YrEntry => ({
  time,
  data: {
    instant: { details: { air_temperature: temp, wind_speed: o.wind ?? 2 } },
    ...(o.n1 ? { next_1_hours: { summary: { symbol_code: o.n1.sym ?? 'cloudy' }, details: { precipitation_amount: o.n1.p } } } : {}),
    ...(o.n6 ? { next_6_hours: { summary: { symbol_code: o.n6.sym ?? 'cloudy' }, details: { precipitation_amount: o.n6.p, air_temperature_max: o.n6.max, air_temperature_min: o.n6.min } } } : {}),
  },
});
const cat = symbolCategory;
const text = (s: string) => `T:${s}`;
const noSun = { sunrise: '', sunset: '' };

describe('addDaysIso / osloParts', () => {
  it('datoregning og Oslo-dato over midnatt (sommertid)', () => {
    expect(addDaysIso('2026-10-31', 1)).toBe('2026-11-01');
    expect(osloParts(new Date('2026-10-19T22:30:00Z').getTime())).toEqual({ date: '2026-10-20', hour: 0 });
  });
});

describe('selectPeriods — nedbør uten dobbelttelling', () => {
  it('timesdata-sonen: next_1_hours brukes, overlappende next_6_hours hoppes over', () => {
    const es = ['T10', 'T11', 'T12'].map((h, i) => norm(entry(`2026-10-20T${h.slice(1)}:00:00Z`, 5, { n1: { p: 1 }, n6: { p: 6 + i } })));
    const ps = selectPeriods(es);
    expect(ps.map(p => [p.step, p.precip])).toEqual([[1, 1], [1, 1], [1, 1]]);
  });
  it('grov sone: 6-timers perioder telles når ingen timesperiode dekker dem', () => {
    const es = [
      norm(entry('2026-10-22T10:00:00Z', 5, { n1: { p: 0.5 }, n6: { p: 3 } })),
      norm(entry('2026-10-22T12:00:00Z', 5, { n6: { p: 4 } })),   // 12:00 >= 11:00 → ny 6-timers periode
      norm(entry('2026-10-22T14:00:00Z', 5, { n6: { p: 9 } })),   // ligger inni 12–18 → hoppes over
      norm(entry('2026-10-22T18:00:00Z', 5, { n6: { p: 2 } })),   // 18:00 >= 18:00 → ny
    ];
    const ps = selectPeriods(es);
    expect(ps.map(p => [p.step, p.precip])).toEqual([[1, 0.5], [6, 4], [6, 2]]);
  });
  it('oppføring uten noen periode bidrar ikke', () => {
    expect(selectPeriods([norm(entry('2026-10-22T10:00:00Z', 5))])).toEqual([]);
  });
});

describe('dominantCategory', () => {
  it('nattlig regn styrer ikke dagen', () => {
    expect(dominantCategory([{ hour: 2, category: 'rain' }, { hour: 3, category: 'rain' }, { hour: 12, category: 'clear' }, { hour: 15, category: 'fair' }])).toBe('fair');
  });
  it('regn i dagtimene vinner; verste vinner (torden > regn)', () => {
    expect(dominantCategory([{ hour: 9, category: 'clear' }, { hour: 14, category: 'rain' }])).toBe('rain');
    expect(dominantCategory([{ hour: 9, category: 'rain' }, { hour: 14, category: 'thunder' }])).toBe('thunder');
  });
  it('dagtimene er 06–22 begge inkludert', () => {
    expect(dominantCategory([{ hour: 22, category: 'rain' }, { hour: 12, category: 'clear' }])).toBe('rain');
    expect(dominantCategory([{ hour: 23, category: 'rain' }, { hour: 12, category: 'clear' }])).toBe('clear');
    expect(dominantCategory([{ hour: 5, category: 'rain' }, { hour: 12, category: 'clear' }])).toBe('clear');
  });
  it('uten dagtimer: faller til alle timer; tom → cloudy', () => {
    expect(dominantCategory([{ hour: 23, category: 'snow' }, { hour: 1, category: 'clear' }])).toBe('snow');
    expect(dominantCategory([])).toBe('cloudy');
  });
});

describe('buildDay', () => {
  const date = '2026-10-21';
  const es = [
    entry(`${date}T04:00:00Z`, 3, { wind: 4, n1: { p: 0, sym: 'clearsky_night' }, n6: { p: 0 } }),   // 06 Oslo
    entry(`${date}T05:00:00Z`, 5, { wind: 9, n1: { p: 1.5, sym: 'lightrain' }, n6: { p: 5 } }),      // 07
    entry(`${date}T06:00:00Z`, 7, { wind: 6, n1: { p: 3, sym: 'heavyrain' }, n6: { p: 5 } }),        // 08
    entry(`${date}T12:00:00Z`, 9, { wind: 3, n6: { p: 2, sym: 'rain', max: 11, min: 4 } }),          // 14 — grov
  ].map(norm);
  const periods = selectPeriods(es);
  const day = buildDay(date, es, periods, { sunrise: '07:41', sunset: '17:12' }, cat, text)!;

  it('min/maks inkl. 6-timers ytterpunkter, høyeste vind, samlet nedbør', () => {
    expect(day.min).toBe(3);        // 6h-min 4 > punktet 3
    expect(day.max).toBe(11);       // 6h-maks 11
    expect(day.windMax).toBe(9);
    expect(day.precip).toBe(6.5);   // 0 + 1.5 + 3 + 2 (6h-perioden 12:00 ligger etter timesdekningen)
  });
  it('kategori = verste i dagtimene; symbol = time med mest nedbør i den kategorien', () => {
    expect(day.category).toBe('rain');
    expect(day.symbol).toBe('heavyrain');
    expect(day.description).toBe('T:heavyrain');
  });
  it('sol og timer (med step)', () => {
    expect(day.sunrise).toBe('07:41');
    expect(day.hours.map(h => [h.hour, h.step])).toEqual([[6, 1], [7, 1], [8, 1], [14, 6]]);
    expect(day.hours[3]).toMatchObject({ precip: 2, temp: 9, category: 'rain' });
  });
  it('ingen oppføringer → null', () => {
    expect(buildDay(date, [], [], noSun, cat, text)).toBeNull();
  });
});

describe('buildDaily', () => {
  const series: YrEntry[] = [];
  // 2026-10-19 10:00Z → 2026-10-22 hver time (1 mm per time første døgn, ellers 0)
  for (let h = 0; h < 72; h++) {
    const t = new Date(Date.UTC(2026, 9, 19, 10) + h * 3600_000).toISOString();
    series.push(entry(t, 5 + (h % 5), { wind: 1 + (h % 7), n1: { p: h < 24 ? 1 : 0, sym: 'cloudy' }, n6: { p: 99 } }));
  }
  const from = new Date('2026-10-19T10:00:00Z').getTime();
  const days = buildDaily(series, '2026-10-19', from, { '2026-10-19': { sunrise: '07:30', sunset: '17:30' } }, cat, text);

  it('tre dager med påfølgende Oslo-datoer', () => {
    expect(days.map(d => d.date)).toEqual(['2026-10-19', '2026-10-20', '2026-10-21']);
  });
  it('nedbør telles fra timesdata, aldri fra de overlappende 6-timers verdiene (99)', () => {
    expect(days[0].precip + days[1].precip).toBe(24);
    expect(days[2].precip).toBe(0);
  });
  it('sol per dato (tom når ukjent)', () => {
    expect(days[0].sunrise).toBe('07:30');
    expect(days[1].sunrise).toBe('');
  });
  it('dagens tall regnes fra «nå» (fromMs): tidligere oppføringer teller ikke', () => {
    const later = buildDaily(series, '2026-10-19', new Date('2026-10-19T20:00:00Z').getTime(), {}, cat, text);
    expect(later[0].hours[0].hour).toBe(22); // 20:00Z = 22:00 Oslo
  });
  it('mangler en dag i serien: kortere liste', () => {
    expect(buildDaily(series.slice(0, 10), '2026-10-19', from, {}, cat, text)).toHaveLength(1);
  });
});
