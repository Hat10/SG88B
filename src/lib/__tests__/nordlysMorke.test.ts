import { describe, it, expect, vi, afterEach } from 'vitest';
import handler, {
  parseSunProperties, isDaylightAt, solarAltitudeDeg, auroraScore, assessNow, buildHourlyEntry,
} from '../../../api/nordlys';

const utc = (iso: string) => new Date(iso).getTime();

// ─── Ekte met.no sunrise 3.0-poster for Bodø (hentet 2026-11-24), kun feltene vi leser ──
// Hver post dekker «solarmidnight → neste solarmidnight», ikke Oslo-døgnet.

const NOV_24 = { sunrise: { time: '2026-11-24T08:44+00:00' }, sunset: { time: '2026-11-24T12:52+00:00' }, solarnoon: { time: '2026-11-24T10:49+00:00', disc_centre_elevation: 2.12, visible: true }, solarmidnight: { time: '2026-11-23T22:49+00:00', disc_centre_elevation: -43.21, visible: false } };
/** Vintersolverv: sola står så vidt opp (10:36–11:24 UTC) — Bodø har i praksis ikke mørketid. */
const DEC_21 = { sunrise: { time: '2026-12-21T10:36+00:00' }, sunset: { time: '2026-12-21T11:24+00:00' }, solarnoon: { time: '2026-12-21T11:00+00:00', disc_centre_elevation: -0.72, visible: true }, solarmidnight: { time: '2026-12-20T23:00+00:00', disc_centre_elevation: -46.15, visible: false } };
/** Midnattssol: sunrise/sunset har time: null. */
const JUN_21 = { sunrise: { time: null }, sunset: { time: null }, solarnoon: { time: '2026-06-21T11:04+00:00', disc_centre_elevation: 46.15, visible: true }, solarmidnight: { time: '2026-06-20T23:04+00:00', disc_centre_elevation: 0.72, visible: true } };
const MAY_29 = { sunrise: { time: '2026-05-28T23:39+00:00' }, sunset: { time: '2026-05-29T22:31+00:00' }, solarnoon: { time: '2026-05-29T10:59+00:00', disc_centre_elevation: 44.37, visible: true }, solarmidnight: { time: '2026-05-28T22:59+00:00', disc_centre_elevation: -1.14, visible: false } };
const MAY_30 = { sunrise: { time: '2026-05-29T23:27+00:00' }, sunset: { time: '2026-05-30T22:54+00:00' }, solarnoon: { time: '2026-05-30T11:00+00:00', disc_centre_elevation: 44.52, visible: true }, solarmidnight: { time: '2026-05-29T23:00+00:00', disc_centre_elevation: -0.99, visible: false } };
/** Første dag med midnattssol: soloppgang men ingen solnedgang. */
const MAY_31 = { sunrise: { time: '2026-05-30T23:05+00:00' }, sunset: { time: null }, solarnoon: { time: '2026-05-31T11:00+00:00', disc_centre_elevation: 44.67, visible: true }, solarmidnight: { time: '2026-05-30T23:00+00:00', disc_centre_elevation: -0.84, visible: false } };
const JUN_01 = { sunrise: { time: null }, sunset: { time: null }, solarnoon: { time: '2026-06-01T11:00+00:00', disc_centre_elevation: 44.8, visible: true }, solarmidnight: { time: '2026-05-31T23:00+00:00', disc_centre_elevation: -0.7, visible: true } };
const JUL_11 = { sunrise: { time: null }, sunset: { time: null }, solarnoon: { time: '2026-07-11T11:08+00:00', disc_centre_elevation: 44.78, visible: true }, solarmidnight: { time: '2026-07-10T23:07+00:00', disc_centre_elevation: -0.59, visible: true } };
/** Siste dag med midnattssol: solnedgang men ingen soloppgang. */
const JUL_12 = { sunrise: { time: null }, sunset: { time: '2026-07-12T22:56+00:00' }, solarnoon: { time: '2026-07-12T11:08+00:00', disc_centre_elevation: 44.64, visible: true }, solarmidnight: { time: '2026-07-11T23:08+00:00', disc_centre_elevation: -0.72, visible: true } };
/**
 * SYNTETISK: ekte mørketid (sola kommer aldri opp). Bodø får aldri dette — 21. des. står sola
 * så vidt opp — så formen er lånt fra en post som Longyearbyen ville gitt: ingen tider,
 * sola ikke synlig verken ved solnoon eller solarmidnight. Datoen er Bodøs vintersolverv
 * med vilje: solhøyde-beregningen sier «lyst» (-0,72° > -0,833°) der posten sier «mørkt»,
 * så testen viser at posten vinner når den dekker tidspunktet.
 */
const POLAR_NIGHT = { sunrise: { time: null }, sunset: { time: null }, solarnoon: { time: '2026-12-21T11:00+00:00', disc_centre_elevation: -3, visible: false }, solarmidnight: { time: '2026-12-20T23:00+00:00', disc_centre_elevation: -46, visible: false } };

const win = (props: unknown, date: string) => parseSunProperties(props, date)!;

describe('parseSunProperties', () => {
  it('vanlig dag: soloppgang/-nedgang og soldøgnets start', () => {
    expect(win(NOV_24, '2026-11-24')).toEqual({
      windowStartMs: utc('2026-11-23T22:49:00Z'), sunriseMs: utc('2026-11-24T08:44:00Z'), sunsetMs: utc('2026-11-24T12:52:00Z'),
      alwaysLight: false, alwaysDark: false,
    });
  });
  it('midnattssol (ingen tider, solarmidnight synlig) → alwaysLight', () => {
    expect(win(JUN_21, '2026-06-21')).toMatchObject({ sunriseMs: null, sunsetMs: null, alwaysLight: true, alwaysDark: false });
  });
  it('mørketid (ingen tider, sola ikke synlig ved solnoon) → alwaysDark', () => {
    expect(win(POLAR_NIGHT, '2026-12-21')).toMatchObject({ sunriseMs: null, sunsetMs: null, alwaysLight: false, alwaysDark: true });
  });
  it('ensidige poster er IKKE «alltid mørk»: bare soloppgang / bare solnedgang beholdes', () => {
    expect(win(MAY_31, '2026-05-31')).toMatchObject({ sunriseMs: utc('2026-05-30T23:05:00Z'), sunsetMs: null, alwaysLight: false, alwaysDark: false });
    expect(win(JUL_12, '2026-07-12')).toMatchObject({ sunriseMs: null, sunsetMs: utc('2026-07-12T22:56:00Z'), alwaysLight: false, alwaysDark: false });
  });
  it('manglende/ugyldige data → null (kalleren bruker solhøyde-beregningen)', () => {
    for (const bad of [null, undefined, {}, 'feil', 42, [],
      { sunrise: { time: null }, sunset: { time: null } }, // ingen tider og ingen synlighet å avgjøre ut fra
      { sunrise: { time: null }, sunset: { time: null }, solarnoon: { visible: true }, solarmidnight: { visible: false } }, // vanlig dag uten tider = selvmotsigende
      { sunrise: { time: '2026-11-24T08:44+00:00' }, sunset: { time: null } }, // ensidig uten solarmidnight å avgrense med
    ]) {
      expect(parseSunProperties(bad, '2026-11-24')).toBeNull();
    }
  });
  it('ødelagt tidsstreng forkastes (null) — leses ikke som «ingen solnedgang» = midnattssol', () => {
    expect(parseSunProperties({ ...NOV_24, sunset: { time: 'ikke-en-tid' } }, '2026-11-24')).toBeNull();
    expect(parseSunProperties({ ...NOV_24, sunrise: { time: '' } }, '2026-11-24')).toBeNull();
  });
});

describe('isDaylightAt — vanlig dag og vintersol', () => {
  const nov = [win(NOV_24, '2026-11-24')];
  it('lyst mellom soloppgang og solnedgang, mørkt rundt', () => {
    expect(isDaylightAt(utc('2026-11-24T08:43:00Z'), nov)).toBe(false);
    expect(isDaylightAt(utc('2026-11-24T08:45:00Z'), nov)).toBe(true);
    expect(isDaylightAt(utc('2026-11-24T12:51:00Z'), nov)).toBe(true);
    expect(isDaylightAt(utc('2026-11-24T12:53:00Z'), nov)).toBe(false);
    expect(isDaylightAt(utc('2026-11-24T13:35:00Z'), nov)).toBe(false);
  });
  it('21. des.: sola står opp 10:36–11:24 UTC, ellers mørkt', () => {
    const dec = [win(DEC_21, '2026-12-21')];
    expect(isDaylightAt(utc('2026-12-21T11:00:00Z'), dec)).toBe(true);
    expect(isDaylightAt(utc('2026-12-21T10:00:00Z'), dec)).toBe(false);
    expect(isDaylightAt(utc('2026-12-21T12:00:00Z'), dec)).toBe(false);
  });
});

describe('mørketid (sola kommer ikke opp)', () => {
  const polar = [win(POLAR_NIGHT, '2026-12-21')];
  it('mørkt hele soldøgnet, også midt på dagen — posten vinner over solhøyde-beregningen', () => {
    expect(solarAltitudeDeg(utc('2026-12-21T11:00:00Z'))).toBeGreaterThan(-0.833); // beregningen alene ville sagt «lyst»
    for (const t of ['2026-12-20T23:30:00Z', '2026-12-21T06:00:00Z', '2026-12-21T11:00:00Z', '2026-12-21T22:59:00Z']) {
      expect(isDaylightAt(utc(t), polar)).toBe(false);
    }
  });
  it('«nå» i mørketid: ikke «for lyst», vurderes som vanlig natt', () => {
    expect(assessNow(3, 10, !isDaylightAt(utc('2026-12-21T11:00:00Z'), polar))).toMatchObject({ status: 'ok', probability: 'høy' });
  });
});

describe('midnattssol (sola går ikke ned)', () => {
  const jun = [win(JUN_21, '2026-06-21')];
  it('lyst hele soldøgnet, også ved midnatt', () => {
    for (const t of ['2026-06-20T23:30:00Z', '2026-06-21T00:00:00Z', '2026-06-21T11:04:00Z', '2026-06-21T22:00:00Z', '2026-06-21T23:03:00Z']) {
      expect(isDaylightAt(utc(t), jun)).toBe(true);
    }
  });
  it('«nå» ved midnatt i midnattssolen er «for lyst», aldri høy', () => {
    const a = assessNow(5, 0, !isDaylightAt(utc('2026-06-21T22:00:00Z'), jun));
    expect(a).toEqual({ status: 'tooLight', score: 0, probability: 'lav' });
  });
  it('start på midnattssol (bare soloppgang): lyst fra soloppgang og ut, mørkt i gapet før', () => {
    const w = [win(MAY_30, '2026-05-30'), win(MAY_31, '2026-05-31'), win(JUN_01, '2026-06-01')];
    expect(isDaylightAt(utc('2026-05-30T23:02:00Z'), w)).toBe(false); // etter solnedgang 22:54, før soloppgang 23:05
    expect(isDaylightAt(utc('2026-05-31T03:00:00Z'), w)).toBe(true);  // tidligere: hele døgnet «mørkt»
    expect(isDaylightAt(utc('2026-05-31T12:00:00Z'), w)).toBe(true);
    expect(isDaylightAt(utc('2026-05-31T22:30:00Z'), w)).toBe(true);
    expect(isDaylightAt(utc('2026-05-31T23:30:00Z'), w)).toBe(true);  // JUN_01: alwaysLight
  });
  it('slutt på midnattssol (bare solnedgang): lyst frem til solnedgang, mørkt etter', () => {
    const w = [win(JUL_11, '2026-07-11'), win(JUL_12, '2026-07-12')];
    expect(isDaylightAt(utc('2026-07-12T00:30:00Z'), w)).toBe(true);
    expect(isDaylightAt(utc('2026-07-12T10:00:00Z'), w)).toBe(true);  // tidligere: «mørkt»
    expect(isDaylightAt(utc('2026-07-12T22:50:00Z'), w)).toBe(true);
    expect(isDaylightAt(utc('2026-07-12T22:57:00Z'), w)).toBe(false);
  });
});

describe('Oslo-døgnskiftet: timer etter Oslo-midnatt hører til forrige soldøgn', () => {
  it('00:00 Oslo 30. mai (= 22:00 UTC) er lyst — sola går ned først 22:31 UTC (MAY_29), selv om MAY_30 starter 23:00', () => {
    const w = [win(MAY_29, '2026-05-29'), win(MAY_30, '2026-05-30')];
    expect(isDaylightAt(utc('2026-05-29T22:00:00Z'), w)).toBe(true);
    expect(isDaylightAt(utc('2026-05-29T22:45:00Z'), w)).toBe(false); // mellom solnedgang 22:31 og soloppgang 23:27
  });
});

describe('manglende sunrise-data → solhøyde-fallback, aldri «mørk» på blindt grunnlag', () => {
  it('solhøyde-formelen stemmer med met.nos disc_centre_elevation ved solnoon (±0,15°)', () => {
    for (const [p, date] of [[NOV_24, '2026-11-24'], [DEC_21, '2026-12-21'], [JUN_21, '2026-06-21'], [MAY_31, '2026-05-31'], [JUL_12, '2026-07-12']] as const) {
      const noon = utc((p.solarnoon.time as string).replace('+00:00', ':00Z'));
      expect(Math.abs(solarAltitudeDeg(noon) - p.solarnoon.disc_centre_elevation)).toBeLessThan(0.15);
      expect(date).toBeTruthy();
    }
  });
  it('ingen poster i det hele tatt (alle fetch feilet): lyst midt på dagen, mørkt om natten', () => {
    expect(isDaylightAt(utc('2026-07-15T10:00:00Z'), [])).toBe(true);
    expect(isDaylightAt(utc('2026-11-24T10:49:00Z'), [])).toBe(true);   // vinter, solnoon, 2,1° opp
    expect(isDaylightAt(utc('2026-11-24T13:35:00Z'), [])).toBe(false);  // etter solnedgang
    expect(isDaylightAt(utc('2026-12-21T00:00:00Z'), [])).toBe(false);
    expect(isDaylightAt(utc('2026-06-21T23:04:00Z'), [])).toBe(true);   // midnattssol: solarmidnight er 0,72° over horisonten
  });
  it('tidspunkt utenfor postene som er hentet bruker fallback, ikke nabopostens svar', () => {
    const nov = [win(NOV_24, '2026-11-24')];
    expect(isDaylightAt(utc('2026-11-26T10:49:00Z'), nov)).toBe(true); // 2 dager senere: ingen post dekker → solhøyde (lyst midt på dagen)
    expect(isDaylightAt(utc('2026-11-26T20:00:00Z'), nov)).toBe(false);
  });
  it('«nå» uten sunrise-data midt på sommerdagen: «for lyst», ikke «høy»', () => {
    const dark = !isDaylightAt(utc('2026-07-15T10:00:00Z'), []);
    expect(assessNow(3, 0, dark)).toEqual({ status: 'tooLight', score: 0, probability: 'lav' });
  });
});

describe('assessNow / auroraScore — dagslys gir «for lyst», mørke gir dagens resultat', () => {
  it('dagslys + Kp 0 + klar himmel → for lyst (lav, 0 poeng)', () => {
    expect(assessNow(0, 0, false)).toEqual({ status: 'tooLight', score: 0, probability: 'lav' });
  });
  it('dagslys uansett hvor bra Kp/skydekke er → aldri middels/høy', () => {
    for (const [kp, cloud] of [[0, 0], [3, 0], [5, 0], [9, 10], [4.67, 30]]) {
      expect(assessNow(kp, cloud, false)).toEqual({ status: 'tooLight', score: 0, probability: 'lav' });
    }
  });
  it('mørk time med samme verdier gir dagens resultat (terskler uendret)', () => {
    expect(assessNow(0, 0, true)).toEqual({ status: 'ok', score: 2, probability: 'middels' });   // Kp 0 + klar himmel i mørke: urørt
    expect(assessNow(3, 0, true)).toEqual({ status: 'ok', score: 3, probability: 'høy' });
    expect(assessNow(5, 0, true)).toEqual({ status: 'ok', score: 4, probability: 'høy' });
    expect(assessNow(2.67, 30, true)).toMatchObject({ score: 2, probability: 'middels' });       // 2,67 < 3
    expect(assessNow(3, 31, true)).toMatchObject({ score: 2, probability: 'middels' });          // 31 % > 30 %
    expect(assessNow(3, 61, true)).toMatchObject({ score: 1, probability: 'lav' });
    expect(assessNow(1, 100, true)).toMatchObject({ score: 0, probability: 'lav' });
  });
  it('auroraScore er samme tall som «nå» og timene bruker', () => {
    expect(auroraScore(3, 20, true)).toBe(3);
    expect(auroraScore(3, 20, false)).toBe(0);
  });
});

describe('buildHourlyEntry — timescorene tar hensyn til mørke', () => {
  it('dagslystime med Kp 3 og klar himmel: 0 poeng/«lav», men Kp og skydekke beholdes', () => {
    expect(buildHourlyEntry('2026-07-15T10:00:00Z', 3, 'forecast', 10, false)).toEqual({
      time: '2026-07-15T10:00:00Z', kp: 3, kpKind: 'forecast', cloudCover: 10, dark: false, score: 0, chance: 'lav',
    });
  });
  it('mørk time med samme verdier: dagens poeng', () => {
    expect(buildHourlyEntry('2026-11-24T20:00:00Z', 3, 'forecast', 10, true)).toMatchObject({ dark: true, score: 3, chance: 'høy' });
  });
  it('rundet Kp, kpKind følger med, mangler → prognose; ukjent Kp → 0', () => {
    expect(buildHourlyEntry('t', 1.67, 'observed', 20, true)).toMatchObject({ kp: 1.7, kpKind: 'observed' });
    expect(buildHourlyEntry('t', 1.67, undefined, 20, true).kpKind).toBe('forecast');
    expect(buildHourlyEntry('t', null, undefined, 20, true)).toMatchObject({ kp: 0, score: 2 });
  });
});

// ─── Hele handleren, med mocket nett ─────────────────────────────────────────

describe('handler: «nå»-overskriften og hourly følger mørke (mocket fetch)', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

  /** Observert Kp t.o.m. bolken før `now`; forecast frem i tid. Kp 3 hele veien: høyt nok til å gi «høy» på klar himmel i mørke. */
  const noaaFeeds = (nowIso: string) => {
    const slot0 = Math.floor(utc(nowIso) / (3 * 3600_000)) * 3 * 3600_000;
    const tag = (ms: number) => new Date(ms).toISOString().slice(0, 19);
    const observed = [-2, -1].map(i => ({ time_tag: tag(slot0 + i * 3 * 3600_000), Kp: 3, a_running: 15, station_count: 8 }));
    const forecast = [-2, -1].map(i => ({ time_tag: tag(slot0 + i * 3 * 3600_000), kp: 3, observed: 'observed', noaa_scale: null }))
      .concat(Array.from({ length: 24 }, (_, i) => ({ time_tag: tag(slot0 + i * 3 * 3600_000), kp: 3, observed: i === 0 ? 'estimated' : 'predicted', noaa_scale: null })));
    return { observed, forecast };
  };

  const run = async (nowIso: string, sun: (date: string) => unknown | null) => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(nowIso));
    const { observed, forecast } = noaaFeeds(nowIso);
    const start = Math.floor(utc(nowIso) / 3600_000) * 3600_000;
    const timeseries = Array.from({ length: 72 }, (_, i) => ({ time: new Date(start + i * 3600_000).toISOString().replace('.000', ''), data: { instant: { details: { cloud_area_fraction: 0 } } } }));
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const json = (body: unknown, ok = true) => ({ ok, status: ok ? 200 : 404, json: async () => body });
      if (url.includes('noaa-planetary-k-index-forecast')) return json(forecast);
      if (url.includes('noaa-planetary-k-index.json')) return json(observed);
      if (url.includes('planetary_k_index_1m')) return json([]);
      if (url.includes('locationforecast')) return json({ properties: { timeseries } });
      if (url.includes('/sunrise/')) {
        const props = sun(new URL(url).searchParams.get('date')!);
        return props === null ? json({}, false) : json({ properties: props });
      }
      throw new Error('uventet url ' + url);
    }));
    let out: any; let code = 0;
    await handler({}, { setHeader() {}, status(c: number) { code = c; return this; }, json(b: unknown) { out = b; } });
    expect(code).toBe(200);
    return out;
  };

  it('sunrise-API-et nede, midt på sommerdagen, Kp 3 + klar himmel: «for lyst», ikke «høy»; hourly dagslys = 0 poeng', async () => {
    const out = await run('2026-07-15T10:30:00Z', () => null);
    expect(out.nowStatus).toBe('tooLight');
    expect(out.probability).toBe('lav');
    expect(out.kp).toBe(3);
    expect(out.hourly[0]).toMatchObject({ dark: false, score: 0, chance: 'lav' });
  });

  it('sunrise-API-et nede, november-natt, Kp 3 + klar himmel: dagens resultat («høy»)', async () => {
    const out = await run('2026-11-24T20:30:00Z', () => null);
    expect(out.nowStatus).toBe('ok');
    expect(out.probability).toBe('høy');
    expect(out.hourly[0]).toMatchObject({ dark: true, score: 3, chance: 'høy' });
  });

  it('ekte soldata, midnattssol (21. juni kl. 23): «for lyst»', async () => {
    const out = await run('2026-06-21T21:30:00Z', d => (d === '2026-06-21' || d === '2026-06-22' || d === '2026-06-20' || d === '2026-06-23' || d === '2026-06-24' ? JUN_21 : null));
    expect(out.nowStatus).toBe('tooLight');
    expect(out.probability).toBe('lav');
  });

  it('ekte soldata, november like etter solnedgang (13:35 UTC): mørkt → «ok»', async () => {
    const out = await run('2026-11-24T13:35:00Z', d => (d === '2026-11-24' ? NOV_24 : null));
    expect(out.nowStatus).toBe('ok');
    expect(out.probability).toBe('høy');
  });

  it('ekte soldata, november midt på dagen (11:00 UTC): sola er oppe → «for lyst»', async () => {
    const out = await run('2026-11-24T11:00:00Z', d => (d === '2026-11-24' ? NOV_24 : null));
    expect(out.nowStatus).toBe('tooLight');
    expect(out.probability).toBe('lav');
  });

  it('natt-«beste time» og «nå» er konsistente: ingen natt kan ha en dagslystime som beste time', async () => {
    const out = await run('2026-11-24T11:00:00Z', d => (d === '2026-11-24' ? NOV_24 : null));
    for (const n of out.daily) for (const h of n.hours) expect(h.dark).toBe(true);
  });
});
