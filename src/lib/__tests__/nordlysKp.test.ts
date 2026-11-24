import { describe, it, expect } from 'vitest';
import {
  parseKpTime, parseKpValue, parseObservedKpRows, parseForecastKpRows, mergeKpRows,
  pickKpNow, ongoingKpMinimum, kpRowAt, kpRowAtStrict, roundKp, evaluateNight,
  KP_SLOT_MS, KP_STALE_MS, type KpRow,
} from '../../../api/nordlys';

const utc = (iso: string) => new Date(iso).getTime();
const H = 3600_000;

// ─── Fast rådata ─────────────────────────────────────────────────────────────
// Verdiene er hentet fra live NOAA-feedene 2026-11-24 ca. 13:40 UTC (tidsstempler
// er UTC uten «Z», som hos NOAA).

/** noaa-planetary-k-index.json — nåværende format: objekter, eldste først, INGEN header-rad. Siste rad = 09:00-bolken (ferdig kl. 12:00). */
const OBSERVED_13_35 = [
  { time_tag: '2026-11-24T00:00:00', Kp: 1.0, a_running: 4, station_count: 8 },
  { time_tag: '2026-11-24T03:00:00', Kp: 0.33, a_running: 2, station_count: 8 },
  { time_tag: '2026-11-24T06:00:00', Kp: 1.67, a_running: 6, station_count: 8 },
  { time_tag: '2026-11-24T09:00:00', Kp: 1.0, a_running: 4, station_count: 8 },
];

/** Eldre format: array av arrays MED header-rad først. */
const OBSERVED_LEGACY_WITH_HEADER = [
  ['time_tag', 'Kp', 'a_running', 'station_count'],
  ['2026-11-24 00:00:00', '1.00', '4', '8'],
  ['2026-11-24 03:00:00', '0.33', '2', '8'],
  ['2026-11-24 06:00:00', '1.67', '6', '8'],
];

/** noaa-planetary-k-index-forecast.json — blanding av observed / estimated / predicted. */
const FORECAST = [
  { time_tag: '2026-11-24T00:00:00', kp: 1.0, observed: 'observed', noaa_scale: null },
  { time_tag: '2026-11-24T03:00:00', kp: 0.33, observed: 'observed', noaa_scale: null },
  { time_tag: '2026-11-24T06:00:00', kp: 1.67, observed: 'observed', noaa_scale: null },
  { time_tag: '2026-11-24T09:00:00', kp: 1.0, observed: 'observed', noaa_scale: null },
  // «estimated» er PROGNOSE (15/18/21 kan umulig være målt ennå) — ikke «Kp nå».
  { time_tag: '2026-11-24T12:00:00', kp: 2.0, observed: 'estimated', noaa_scale: null },
  { time_tag: '2026-11-24T15:00:00', kp: 2.0, observed: 'estimated', noaa_scale: null },
  { time_tag: '2026-11-24T18:00:00', kp: 2.67, observed: 'estimated', noaa_scale: null },
  { time_tag: '2026-11-24T21:00:00', kp: 3.0, observed: 'estimated', noaa_scale: null },
  { time_tag: '2026-11-25T00:00:00', kp: 1.67, observed: 'predicted', noaa_scale: null },
  { time_tag: '2026-11-25T03:00:00', kp: 1.67, observed: 'predicted', noaa_scale: null },
];

/** planetary_k_index_1m.json — én rad per minutt fra `from`, med de gitte estimated_kp-verdiene. */
const minuteFeed = (from: string, values: number[]) =>
  values.map((v, i) => ({
    time_tag: new Date(utc(from + 'Z') + i * 60_000).toISOString().slice(0, 19),
    kp_index: Math.round(v), estimated_kp: v, kp: 'x',
  }));

const rowsAt = (observed: unknown, forecast: unknown) =>
  mergeKpRows(parseForecastKpRows(forecast), parseObservedKpRows(observed));

describe('parseKpTime — NOAA er UTC uten «Z»', () => {
  it('tolkes som UTC, ikke lokal tid', () => {
    expect(parseKpTime('2026-11-24T09:00:00')).toBe(utc('2026-11-24T09:00:00Z'));
    expect(parseKpTime('2026-11-24 09:00:00')).toBe(utc('2026-11-24T09:00:00Z')); // eldre format med mellomrom
    expect(parseKpTime('2026-11-24T09:00:00Z')).toBe(utc('2026-11-24T09:00:00Z'));
    expect(parseKpTime('2026-11-24T10:00:00+01:00')).toBe(utc('2026-11-24T09:00:00Z'));
  });
  it('NaN for ikke-tid', () => {
    expect(parseKpTime('time_tag')).toBeNaN();
    expect(parseKpTime(null)).toBeNaN();
    expect(parseKpTime(123)).toBeNaN();
  });
});

describe('parseKpValue', () => {
  it('tall og tallstrenger', () => {
    expect(parseKpValue(0.33)).toBe(0.33);
    expect(parseKpValue('1.67')).toBe(1.67);
    expect(parseKpValue('2')).toBe(2);
  });
  it('NOAAs strengform: 3+ / 3- / 3o', () => {
    expect(parseKpValue('3+')).toBeCloseTo(3.333, 3);
    expect(parseKpValue('3-')).toBeCloseTo(2.667, 3);
    expect(parseKpValue('3o')).toBe(3);
  });
  it('NaN for søppel (og tom streng er ikke 0)', () => {
    expect(parseKpValue('Kp')).toBeNaN();
    expect(parseKpValue('')).toBeNaN();
    expect(parseKpValue(null)).toBeNaN();
  });
});

describe('parseObservedKpRows', () => {
  it('objekt-format uten header: alle fire radene med, sortert', () => {
    const rows = parseObservedKpRows(OBSERVED_13_35);
    expect(rows).toHaveLength(4);
    expect(rows.map(r => r.kp)).toEqual([1.0, 0.33, 1.67, 1.0]);
    expect(rows[3].ms).toBe(utc('2026-11-24T09:00:00Z'));
    expect(rows.every(r => r.kind === 'observed')).toBe(true);
  });
  it('array-format: header-raden telles ikke med, «siste rad» er riktig', () => {
    const rows = parseObservedKpRows(OBSERVED_LEGACY_WITH_HEADER);
    expect(rows).toHaveLength(3);
    expect(rows[0].ms).toBe(utc('2026-11-24T00:00:00Z'));
    expect(rows[2].kp).toBe(1.67);
  });
  it('usortert input sorteres; ugyldige rader og ikke-arrays gir tomt/filtrert', () => {
    const rows = parseObservedKpRows([
      { time_tag: '2026-11-24T06:00:00', Kp: 1.67 },
      { time_tag: 'garbage', Kp: 5 },
      { time_tag: '2026-11-24T03:00:00', Kp: null },
      { time_tag: '2026-11-24T00:00:00', Kp: 1 },
    ]);
    expect(rows.map(r => r.kp)).toEqual([1, 1.67]);
    expect(parseObservedKpRows(null)).toEqual([]);
    expect(parseObservedKpRows({ error: 'x' })).toEqual([]);
  });
});

describe('parseForecastKpRows — kun «observed» er målt', () => {
  it('estimated og predicted er begge prognose', () => {
    const rows = parseForecastKpRows(FORECAST);
    expect(rows.filter(r => r.kind === 'observed').map(r => r.kp)).toEqual([1.0, 0.33, 1.67, 1.0]);
    expect(rows.filter(r => r.kind === 'forecast').map(r => r.kp)).toEqual([2.0, 2.0, 2.67, 3.0, 1.67, 1.67]);
  });
});

describe('mergeKpRows', () => {
  it('observert-feeden vinner ved uenighet; forecast-rader beholdes som prognose', () => {
    const merged = rowsAt([{ time_tag: '2026-11-24T12:00:00', Kp: 0.67 }], FORECAST);
    const at12 = merged.find(r => r.ms === utc('2026-11-24T12:00:00Z'))!;
    expect(at12).toEqual({ ms: utc('2026-11-24T12:00:00Z'), kp: 0.67, kind: 'observed' });
    expect(merged.find(r => r.ms === utc('2026-11-24T15:00:00Z'))!.kind).toBe('forecast');
    expect(merged).toHaveLength(FORECAST.length);
  });
});

describe('pickKpNow — «Kp nå» er siste OBSERVERTE bolk', () => {
  it('regresjon 2026-11-24 13:35 UTC: 1,0 (09–12 UTC), IKKE forecast-feedens «estimated» 2,0', () => {
    const now = pickKpNow(rowsAt(OBSERVED_13_35, FORECAST), utc('2026-11-24T13:35:00Z'))!;
    expect(now.kp).toBe(1.0);
    expect(now.kind).toBe('observed');
    expect(now.slot).toEqual({ start: '2026-11-24T09:00:00.000Z', end: '2026-11-24T12:00:00.000Z' });
    expect(now.stale).toBe(false);
  });

  it('rett FØR 12:00 UTC (09-bolken ikke publisert ennå): forrige bolk, 06–09 = 1,67', () => {
    const published = OBSERVED_13_35.slice(0, 3); // NOAA publiserer 09:00-raden først når bolken er ferdig
    const forecastPublished = FORECAST.map(r => (r.time_tag === '2026-11-24T09:00:00' ? { ...r, observed: 'estimated' } : r));
    const now = pickKpNow(rowsAt(published, forecastPublished), utc('2026-11-24T11:59:30Z'))!;
    expect(now.kp).toBe(1.67);
    expect(now.slot.start).toBe('2026-11-24T06:00:00.000Z');
  });

  it('rett ETTER 12:00 UTC (09-bolken publisert): bolken som nettopp ble ferdig, 09–12 = 1,0', () => {
    const now = pickKpNow(rowsAt(OBSERVED_13_35, FORECAST), utc('2026-11-24T12:00:30Z'))!;
    expect(now.kp).toBe(1.0);
    expect(now.slot.start).toBe('2026-11-24T09:00:00.000Z');
  });

  it('ignorerer estimated/predicted og fremtidige rader selv om de ligger sist i lista', () => {
    const rows: KpRow[] = [
      { ms: utc('2026-11-24T06:00:00Z'), kp: 1.67, kind: 'observed' },
      { ms: utc('2026-11-24T09:00:00Z'), kp: 4, kind: 'forecast' },
      { ms: utc('2026-11-24T15:00:00Z'), kp: 5, kind: 'observed' }, // fremtid (skal ikke finnes, men må ikke velges)
    ];
    expect(pickKpNow(rows, utc('2026-11-24T10:00:00Z'))!.kp).toBe(1.67);
  });

  it('header-raden i arrayformatet velges aldri (siste rad er en datarad)', () => {
    const now = pickKpNow(rowsAt(OBSERVED_LEGACY_WITH_HEADER, []), utc('2026-11-24T13:35:00Z'))!;
    expect(now.kp).toBe(1.67);
  });

  it('reserve: observert-feeden mangler → forecast-feedens ferdige bolk, ikke «estimated»', () => {
    for (const missing of [null, [], { error: 'nede' }]) {
      const now = pickKpNow(rowsAt(missing, FORECAST), utc('2026-11-24T13:35:00Z'))!;
      expect(now.kp).toBe(1.0);
      expect(now.slot.start).toBe('2026-11-24T09:00:00.000Z');
    }
  });

  it('reserve: observert-feeden henger en bolk etter forecast-feeden → den nyeste målte vinner', () => {
    const lagging = OBSERVED_13_35.slice(0, 3); // slutter på 06:00
    const now = pickKpNow(rowsAt(lagging, FORECAST), utc('2026-11-24T13:35:00Z'))!;
    expect(now.slot.start).toBe('2026-11-24T09:00:00.000Z');
  });

  it('ingen målt bolk i noen feed → null (handleren kaster «ingen gyldig Kp-verdi»)', () => {
    expect(pickKpNow(rowsAt(null, null), utc('2026-11-24T13:35:00Z'))).toBeNull();
    expect(pickKpNow(rowsAt(null, FORECAST.slice(4)), utc('2026-11-24T13:35:00Z'))).toBeNull(); // bare estimated/predicted
  });

  describe('foreldet data — bolken sluttet for mer enn 6 timer siden', () => {
    const rows = rowsAt(OBSERVED_13_35, FORECAST); // siste bolk 09–12 UTC, slutt 12:00
    const end = utc('2026-11-24T12:00:00Z');
    it('akkurat 6 timer etter slutt: ikke utdatert; ett sekund senere: utdatert', () => {
      expect(pickKpNow(rows, end + KP_STALE_MS)!.stale).toBe(false);
      expect(pickKpNow(rows, end + KP_STALE_MS + 1000)!.stale).toBe(true);
    });
    it('normal drift (opptil ~3 t forsinkelse etter at neste bolk er i gang) er aldri utdatert', () => {
      expect(pickKpNow(rows, end + 3 * H)!.stale).toBe(false);
    });
    it('et døgn gammelt (NOAA har sluttet å oppdatere): utdatert, og verdien beholdes så UI kan merke den', () => {
      const old = pickKpNow(rows, utc('2026-11-25T13:35:00Z'))!;
      expect(old.stale).toBe(true);
      expect(old.kp).toBe(1.0);
    });
  });
});

describe('ongoingKpMinimum — minimum for bolken som pågår (1m-feeden)', () => {
  const now = utc('2026-11-24T13:35:00Z'); // bolk 12:00–15:00 pågår
  const observedStart = utc('2026-11-24T09:00:00Z'); // siste målte bolk
  // 12:00–12:39: 40 minutter; maks 0,67 (som i live-data), i tillegg 3 rader fra FORRIGE bolk med høyere verdi som skal ignoreres.
  const feed = [
    ...minuteFeed('2026-11-24T11:57:00', [1.67, 1.67, 1.67]),
    ...minuteFeed('2026-11-24T12:00:00', [0.0, 0.33, 0.67, ...Array(37).fill(0.33)]),
  ];

  it('maks så langt i bolken, avrundet til én desimal, med antall minutter', () => {
    expect(ongoingKpMinimum(feed, now, observedStart)).toEqual({
      slotStart: '2026-11-24T12:00:00.000Z', kpMin: 0.7, minutes: 40,
    });
  });
  it('rader fra forrige bolk og fra fremtiden (etter nå) telles ikke', () => {
    const withFuture = [...feed, ...minuteFeed('2026-11-24T14:00:00', [3, 3])];
    const r = ongoingKpMinimum(withFuture, now, observedStart)!;
    expect(r.kpMin).toBe(0.7);
    expect(r.minutes).toBe(40);
  });
  it('maksen kan bare stige: ny høyere verdi senere i bolken løfter minimum', () => {
    const later = [...feed, ...minuteFeed('2026-11-24T12:40:00', [1.33])];
    expect(ongoingKpMinimum(later, now, observedStart)!.kpMin).toBe(1.3);
  });

  it('1m-feeden mangler eller er ugyldig → null, uten å kaste', () => {
    for (const bad of [null, undefined, {}, 'feil', 42, [], [{ foo: 1 }], [{ time_tag: 'x', estimated_kp: 'y' }]]) {
      expect(ongoingKpMinimum(bad, now, observedStart)).toBeNull();
    }
  });
  it('bolkeskifte: ny bolk har 0 minutter data (siste minutt er fra forrige bolk) → null', () => {
    const justSwitched = utc('2026-11-24T12:00:00Z'); // nøyaktig på skiftet
    const prevSlotOnly = minuteFeed('2026-11-24T11:57:00', [1.67, 1.67, 1.67]); // 11:57–11:59
    expect(ongoingKpMinimum(prevSlotOnly, justSwitched - 1, utc('2026-11-24T06:00:00Z'))!.slotStart).toBe('2026-11-24T09:00:00.000Z');
    expect(ongoingKpMinimum(prevSlotOnly, justSwitched, utc('2026-11-24T09:00:00Z'))).toBeNull();
  });
  it('første minutt i ny bolk (12:00) er nok til å vise tekst', () => {
    const r = ongoingKpMinimum(minuteFeed('2026-11-24T12:00:00', [0.33]), utc('2026-11-24T12:00:20Z'), observedStart)!;
    expect(r).toMatchObject({ slotStart: '2026-11-24T12:00:00.000Z', kpMin: 0.3, minutes: 1 });
  });
  it('bolken som pågår er allerede observert (NOAA publiserte tidlig) → null, så vi ikke dobbeltviser', () => {
    expect(ongoingKpMinimum(feed, now, utc('2026-11-24T12:00:00Z'))).toBeNull();
  });
  it('ingen observert bolk i det hele tatt (observedLatestStartMs null) → viser likevel minimum', () => {
    expect(ongoingKpMinimum(feed, now, null)!.kpMin).toBe(0.7);
  });
});

describe('graf og «Kp nå» motsier ikke hverandre', () => {
  const rows = rowsAt(OBSERVED_13_35, FORECAST);
  it('timer i målte bolker er observert; timer i resten er prognose', () => {
    expect(kpRowAt(rows, utc('2026-11-24T10:30:00Z'))).toMatchObject({ kp: 1.0, kind: 'observed' });
    expect(kpRowAt(rows, utc('2026-11-24T14:00:00Z'))).toMatchObject({ kp: 2.0, kind: 'forecast' });
    expect(kpRowAt(rows, utc('2026-11-24T21:00:00Z'))).toMatchObject({ kp: 3.0, kind: 'forecast' });
  });
  it('overskriftsverdien er samme rad som grafen viser for den bolken', () => {
    const now = pickKpNow(rows, utc('2026-11-24T13:35:00Z'))!;
    expect(kpRowAt(rows, utc(now.slot.start))!.kp).toBe(now.kp);
  });
  it('kpRowAtStrict: utenfor dekning (etter siste bolk + 3 t) er null; innenfor følger `kind` med', () => {
    expect(kpRowAtStrict(rows, utc('2026-11-25T03:00:00Z') + KP_SLOT_MS)).toBeNull();
    expect(kpRowAtStrict(rows, utc('2026-11-25T04:00:00Z'))).toMatchObject({ kp: 1.67, kind: 'forecast' });
  });
});

describe('roundKp — felles avrunding, én desimal', () => {
  it('tredjedeler', () => {
    expect([0.33, 0.67, 1.0, 1.33, 1.67, 2.0, 2.33, 2.67].map(roundKp)).toEqual([0.3, 0.7, 1, 1.3, 1.7, 2, 2.3, 2.7]);
  });
});

describe('poengsummen krever mørke (sunrise-data), ikke bare klar himmel', () => {
  it('Kp 0 + klar himmel i dagslys gir ingen «beste time» — natten er tooLight', () => {
    const n = evaluateNight('2026-06-20', [
      { ms: utc('2026-06-20T22:00:00Z'), kp: 0, cloud: 0, dark: false },
      { ms: utc('2026-06-20T23:00:00Z'), kp: 0, cloud: 0, dark: false },
    ]);
    expect(n.status).toBe('tooLight');
    expect(n.best).toBeNull();
    expect(n.hours).toEqual([]);
  });
  it('samme Kp/skydekke i mørke teller (uendret terskel: Kp 0 + klar himmel = score 2 = middels)', () => {
    const n = evaluateNight('2026-11-24', [
      { ms: utc('2026-11-24T22:00:00Z'), kp: 0, cloud: 0, dark: true },
      { ms: utc('2026-11-24T23:00:00Z'), kp: 0, cloud: 0, dark: true },
    ]);
    expect(n.status).toBe('ok');
    expect(n.best).toMatchObject({ score: 2, chance: 'middels' });
  });
  it('kind følger med fra input til timene i natten (default prognose)', () => {
    const n = evaluateNight('2026-11-24', [
      { ms: utc('2026-11-24T22:00:00Z'), kp: 2, cloud: 10, dark: true },
      { ms: utc('2026-11-24T23:00:00Z'), kp: 2, cloud: 10, dark: true, kind: 'observed' },
    ]);
    expect(n.hours.map(h => h.kpKind)).toEqual(['forecast', 'observed']);
  });
});
