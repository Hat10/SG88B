export const config = { maxDuration: 10 };

// Bodø sentrum — samme koordinater som api/vaer.ts.
const LAT = 67.2827;
const LON = 14.3742;

// Nøkkelfritt NOAA-endepunkt for planetarisk Kp-indeks. Dette er observerte
// verdier hvert 3. time (siste rad ≈ nå), ikke en flerdags-prognose — «gjeldende»
// er derfor det presise ordet her, ikke «prognosert i morgen».
const NOAA_KP_URL = 'https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json';

// 3-døgns Kp-prognose, samme 3-timers bolker (00/03/06…21 UTC), men fremover i
// tid — «observed»/«estimated»/«predicted» avhengig av hvor langt fram bolken
// er. Brukes kun til den utvidede time-for-time-grafen, ikke til «nå»-tallet
// over (som fortsatt leser NOAA_KP_URL — et observert tall er mer presist for
// akkurat dette øyeblikket enn den siste prognosebolken ville vært).
const NOAA_KP_FORECAST_URL = 'https://services.swpc.noaa.gov/products/noaa-planetary-k-index-forecast.json';

const HOURS_AHEAD = 20;

export type AuroraChance = 'lav' | 'middels' | 'høy';

export interface AuroraHourlyEntry {
  time: string;       // ISO, UTC
  kp: number;         // fra 3-timers prognosebolken som dekker denne timen — IKKE interpolert (se merknad ved kpAt)
  cloudCover: number; // 0-100, ekte time-for-time-verdi fra Yr
  dark: boolean;       // false ⇒ dagslys, nordlys uansett ikke synlig
  score: number;       // 0-4, samme kpScore+cloudScore-sum som «nå»-tallet — rå tallet, for et jevnere søylediagram enn de 3 bøttene alene gir
  chance: AuroraChance;
}

// Enkel poengmodell: Kp og skydekke gir hvert 0-2 poeng, summen (0-4) slås om
// til en av tre sjanse-nivåer. Bodø ligger langt nord i aurora-ovalen, så selv
// moderat Kp kan gi nordlys på klar himmel — terskelverdiene under er satt for
// akkurat den breddegraden, ikke for mellom-Europa.
//
// Delt mellom «nå»-tallet og time-for-time-grafen med vilje: samme modell
// begge steder, så den valgte timen i grafen aldri kan vise en annen sjanse
// enn boksens eget «nå»-tall for akkurat det tidspunktet.
function kpScore(kp: number): number {
  if (kp >= 5) return 2;
  if (kp >= 3) return 1;
  return 0;
}
function cloudScore(cloudPct: number): number {
  if (cloudPct <= 30) return 2;
  if (cloudPct <= 60) return 1;
  return 0;
}
function chanceFromScore(score: number): AuroraChance {
  if (score >= 3) return 'høy';
  if (score >= 2) return 'middels';
  return 'lav';
}

// ─── Natt-for-natt-oppsummering (`daily`) ──────────────────────────────────
//
// En «dag» for nordlys er NATTEN som starter den kvelden: fra mørket faller på
// (Oslo-kveld) til det blir lyst neste morgen — altså over midnatt. En time
// hører til natten med dato D hvis den er kl. 12:00 eller senere på Oslo-dato D,
// eller før kl. 12:00 på Oslo-dato D+1. Vinduet er dermed de MØRKE timene
// (samme isDaylight-definisjon som `hourly`) innenfor dette døgnskillet.
// Per natt velges den beste mørke timen: høyest score i poengmodellen over.

export const NIGHTS_AHEAD = 3;
/** Kveld/morgen-skillet i Oslo-tid som avgjør hvilken natt en time hører til. */
export const NIGHT_SPLIT_HOUR = 12;
/** Andel av nattens mørke timer som må ha Kp OG skydekke for at natten regnes som komplett. */
export const NIGHT_MIN_COVERAGE = 0.75;

export interface AuroraBestHour {
  time: string;        // ISO, UTC
  kp: number;
  cloudCover: number;  // 0-100
  score: number;       // 0-4
  chance: AuroraChance;
}

/** ok = nok data; incomplete = for lite Kp/skydekke-data til å love noe; tooLight = ingen mørke timer (lys sommernatt). */
export type AuroraNightStatus = 'ok' | 'incomplete' | 'tooLight';

export interface AuroraNight {
  /** Oslo-dato (yyyy-mm-dd) for KVELDEN natten starter. daily[0] = i kveld. */
  date: string;
  status: AuroraNightStatus;
  /** Beste mørke time (høyest score), blant timer med data. null ved tooLight eller uten noen timer med data. */
  best: AuroraBestHour | null;
  /** Mørke timer i natten fra og med inneværende time. */
  darkHours: number;
  /** Av dem: timer med både Kp og skydekke. */
  usableHours: number;
  /** Første/siste mørke time (ISO UTC); null ved tooLight. */
  windowStart: string | null;
  windowEnd: string | null;
  /** De brukbare mørke timene, til timegrafen for akkurat denne natten (samme form som `hourly`). */
  hours: AuroraHourlyEntry[];
}

export interface NightHourInput {
  ms: number;
  kp: number | null;      // null = utenfor Kp-varselets dekning
  cloud: number | null;
  dark: boolean;
}

export function addDaysIso(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Oslo-dato (yyyy-mm-dd) og -klokketime for et tidspunkt. */
export function osloParts(ms: number): { date: string; hour: number } {
  const s = new Date(ms).toLocaleString('sv-SE', { timeZone: 'Europe/Oslo', hour12: false }); // «2026-10-19 22:00:00»
  return { date: s.slice(0, 10), hour: parseInt(s.slice(11, 13), 10) };
}

/** Datoen (kvelden) til natten en time hører til. */
export function nightDateOf(ms: number): string {
  const { date, hour } = osloParts(ms);
  return hour >= NIGHT_SPLIT_HOUR ? date : addDaysIso(date, -1);
}

/**
 * Som kpAt, men returnerer null for tidspunkt utenfor varselets dekning: en
 * bolk dekker kun sine egne 3 timer, så timer etter siste bolk har INGEN
 * Kp-verdi (kpAt ville gjenbrukt siste bolk for alltid).
 */
export function kpAtStrict(rows: { ms: number; kp: number }[], t: number): number | null {
  let hit: { ms: number; kp: number } | null = null;
  for (const r of rows) { if (r.ms <= t) hit = r; else break; }
  if (!hit || t >= hit.ms + 3 * 3600_000) return null;
  return hit.kp;
}

function hourScore(kp: number, cloud: number): number {
  return kpScore(kp) + cloudScore(cloud);
}

/**
 * Beste time: høyest score. Lik score → høyere Kp, deretter mindre skydekke,
 * deretter tidligst. Kun timer med både Kp og skydekke vurderes.
 */
export function pickBestHour(hours: NightHourInput[]): AuroraBestHour | null {
  let best: { h: NightHourInput & { kp: number; cloud: number }; score: number } | null = null;
  for (const h of hours) {
    if (h.kp === null || h.cloud === null) continue;
    const cand = { h: h as NightHourInput & { kp: number; cloud: number }, score: hourScore(h.kp, h.cloud) };
    if (!best
      || cand.score > best.score
      || (cand.score === best.score && (cand.h.kp > best.h.kp
        || (cand.h.kp === best.h.kp && (cand.h.cloud < best.h.cloud
          || (cand.h.cloud === best.h.cloud && cand.h.ms < best.h.ms)))))) best = cand;
  }
  if (!best) return null;
  return {
    time: new Date(best.h.ms).toISOString(),
    kp: Math.round(best.h.kp * 100) / 100,
    cloudCover: Math.round(best.h.cloud),
    score: best.score,
    chance: chanceFromScore(best.score),
  };
}

/** `inputs`: ALLE timer (lyse og mørke) som hører til natten `date` (se nightDateOf). */
export function evaluateNight(date: string, inputs: NightHourInput[]): AuroraNight {
  const sorted = [...inputs].sort((a, b) => a.ms - b.ms);
  const dark = sorted.filter(h => h.dark);
  const usable = dark.filter(h => h.kp !== null && h.cloud !== null);
  const iso = (ms: number) => new Date(ms).toISOString();

  // Ingen timer i det hele tatt (utenfor værvarselets rekkevidde) er IKKE «for lyst».
  if (sorted.length > 0 && dark.length === 0) {
    return { date, status: 'tooLight', best: null, darkHours: 0, usableHours: 0, windowStart: null, windowEnd: null, hours: [] };
  }
  const enough = dark.length > 0 && usable.length / dark.length >= NIGHT_MIN_COVERAGE;
  return {
    date,
    status: enough ? 'ok' : 'incomplete',
    best: pickBestHour(usable),
    darkHours: dark.length,
    usableHours: usable.length,
    windowStart: dark.length ? iso(dark[0].ms) : null,
    windowEnd: dark.length ? iso(dark[dark.length - 1].ms) : null,
    hours: usable.map(h => {
      const sc = hourScore(h.kp as number, h.cloud as number);
      return { time: iso(h.ms), kp: Math.round((h.kp as number) * 100) / 100, cloudCover: Math.round(h.cloud as number), dark: true, score: sc, chance: chanceFromScore(sc) };
    }),
  };
}

/** De neste `NIGHTS_AHEAD` nettene fra Oslo-dato `todayIso` (i kveld, i morgen kveld, …). */
export function buildNights(todayIso: string, inputs: NightHourInput[]): AuroraNight[] {
  return Array.from({ length: NIGHTS_AHEAD }, (_, i) => {
    const date = addDaysIso(todayIso, i);
    return evaluateNight(date, inputs.filter(h => nightDateOf(h.ms) === date));
  });
}

/**
 * Kp-verdien for et gitt tidspunkt, hentet fra 3-timersbolken som dekker det —
 * ALDRI interpolert mellom bolker. Kp er per definisjon en 3-timers måling,
 * ikke en kontinuerlig størrelse; en jevn linje mellom bolkene ville vist en
 * presisjon (og en jevn overgang) dataene rett og slett ikke har — Kp kan
 * hoppe brått rundt en substorm, ikke gli. Bolkene i NOAA-svaret kommer
 * kronologisk sortert, så «siste bolk med starttid ≤ t» er alt som trengs.
 */
function kpAt(rows: { ms: number; kp: number }[], t: number): number | null {
  let val: number | null = null;
  for (const r of rows) {
    if (r.ms <= t) val = r.kp; else break;
  }
  return val;
}

interface SunWindow { sunriseMs: number | null; sunsetMs: number | null; alwaysLight: boolean; alwaysDark: boolean }

/**
 * Soloppgang/-nedgang for ett døgn (Oslo-lokal dato). Brukes i stedet for Yr
 * sitt _day/_night-symbolsuffiks: det suffikset finnes bare på en delmengde av
 * værsymbolene (clearsky/fair/partlycloudy/…) — «cloudy», «rain», «fog» osv.
 * har ALDRI noe suffiks uansett klokkeslett, så en formiddag med regn ville
 * blitt lest som «mørk» med den metoden. Håndterer midnattssol/mørketid via
 * solarmidnight/solarnoon sin «visible»-status når sunrise/sunset er null.
 */
async function fetchSun(dateStr: string): Promise<SunWindow> {
  const fallback: SunWindow = { sunriseMs: null, sunsetMs: null, alwaysLight: false, alwaysDark: false };
  try {
    const resp = await fetch(
      `https://api.met.no/weatherapi/sunrise/3.0/sun?lat=${LAT}&lon=${LON}&date=${dateStr}`,
      { headers: { 'User-Agent': 'Felles-App/1.0 div@ofrim.no' }, signal: AbortSignal.timeout(9000) }
    );
    if (!resp.ok) return fallback;
    const p = (await resp.json()).properties;
    const sunriseMs = p.sunrise?.time ? new Date(p.sunrise.time).getTime() : null;
    const sunsetMs  = p.sunset?.time  ? new Date(p.sunset.time).getTime()  : null;
    if (sunriseMs === null && sunsetMs === null) {
      // Sola går aldri ned (midnattssol) eller aldri opp (mørketid) denne
      // dagen — solarmidnight/solarnoon sin «visible» forteller hvilket.
      return { sunriseMs: null, sunsetMs: null, alwaysLight: p.solarmidnight?.visible === true, alwaysDark: p.solarnoon?.visible === false };
    }
    return { sunriseMs, sunsetMs, alwaysLight: false, alwaysDark: false };
  } catch {
    return fallback;
  }
}

/** true ⇒ dagslys (nordlys uansett ikke synlig). Ukjent tilstand (fetch feilet) faller til «mørk» — heller vise en time for mye enn å skjule en reell mulighet. */
function isDaylight(ms: number, sun: SunWindow): boolean {
  if (sun.alwaysLight) return true;
  if (sun.alwaysDark) return false;
  if (sun.sunriseMs === null || sun.sunsetMs === null) return false;
  return ms >= sun.sunriseMs && ms <= sun.sunsetMs;
}

export default async function handler(_req: any, res: any) {
  try {
    const now = new Date();
    // Oslo-lokal dato, siden det er soloppgang/-nedgang i Bodø vi trenger —
    // ikke UTC-datoen, som rundt midnatt lokalt kan peke på feil døgn.
    const todayStr = now.toLocaleDateString('sv-SE', { timeZone: 'Europe/Oslo' });
    const tomorrowStr = new Date(now.getTime() + 24 * 3600_000).toLocaleDateString('sv-SE', { timeZone: 'Europe/Oslo' });

    // Netter fra i kveld t.o.m. overmorgen kveld slutter neste morgen, så solen trengs for 4 datoer.
    const day2Str = addDaysIso(todayStr, 2);
    const day3Str = addDaysIso(todayStr, 3);

    const [kpResp, kpForecastResp, wxResp, sunToday, sunTomorrow, sunDay2, sunDay3] = await Promise.all([
      fetch(NOAA_KP_URL, { signal: AbortSignal.timeout(9000) }),
      fetch(NOAA_KP_FORECAST_URL, { signal: AbortSignal.timeout(9000) }),
      fetch(
        `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${LAT}&lon=${LON}`,
        { headers: { 'User-Agent': 'Felles-App/1.0 div@ofrim.no' }, signal: AbortSignal.timeout(9000) }
      ),
      fetchSun(todayStr),
      fetchSun(tomorrowStr),
      fetchSun(day2Str),
      fetchSun(day3Str),
    ]);
    if (!kpResp.ok) throw new Error(`NOAA svarte ${kpResp.status}`);
    if (!wxResp.ok) throw new Error(`Yr svarte ${wxResp.status}`);
    const sunByDate: Record<string, SunWindow> = { [todayStr]: sunToday, [tomorrowStr]: sunTomorrow, [day2Str]: sunDay2, [day3Str]: sunDay3 };

    const kpRows: Array<{ time_tag: string; Kp: number }> = await kpResp.json();
    const latest = kpRows[kpRows.length - 1];
    if (!latest || !Number.isFinite(latest.Kp)) throw new Error('Fant ingen gyldig Kp-verdi');

    const wxData = await wxResp.json();
    const series: any[] = wxData.properties.timeseries;
    const nowIso = now.toISOString();
    const idx = series.findIndex((t: any) => t.time >= nowIso);
    const cur = series[idx >= 0 ? idx : 0];
    const cloudCover = cur.data.instant.details.cloud_area_fraction as number;
    if (!Number.isFinite(cloudCover)) throw new Error('Fant ingen gyldig skydekke-verdi');

    const score = kpScore(latest.Kp) + cloudScore(cloudCover);

    // ── Time-for-time-prognose (neste ~20 timer), for den utvidede grafen ──
    // Feiler prognose-kallet av en eller annen grunn, degraderer vi til bare
    // «nå»-tallet over i stedet for å felle hele svaret — grafen er et pluss,
    // ikke selve poenget med boksen.
    let hourly: AuroraHourlyEntry[] = [];
    let kpForecastRows: { ms: number; kp: number }[] = [];
    if (kpForecastResp.ok) {
      try {
        const kpForecastRaw: Array<{ time_tag: string; kp: number }> = await kpForecastResp.json();
        kpForecastRows = kpForecastRaw
          .map(r => ({ ms: new Date(r.time_tag + 'Z').getTime(), kp: r.kp }))
          .filter(r => Number.isFinite(r.ms) && Number.isFinite(r.kp))
          .sort((a, b) => a.ms - b.ms);

        const endMs = now.getTime() + HOURS_AHEAD * 3600_000;
        hourly = series
          .filter((t: any) => {
            const ms = new Date(t.time).getTime();
            return ms >= now.getTime() && ms <= endMs;
          })
          .map((t: any) => {
            const ms = new Date(t.time).getTime();
            const cloud = t.data.instant.details.cloud_area_fraction as number;
            const kp = kpAt(kpForecastRows, ms);
            // Soloppgang/-nedgang for akkurat den Oslo-lokale dagen denne
            // timen faller på (vinduet kan strekke seg over midnatt inn i
            // morgendagen) — se fetchSun/isDaylight for hvorfor dette
            // erstatter et tidligere forsøk med Yr sitt symbol-suffiks.
            const dateStr = new Date(ms).toLocaleDateString('sv-SE', { timeZone: 'Europe/Oslo' });
            const sun = sunByDate[dateStr] ?? sunToday;
            const dark = !isDaylight(ms, sun);
            const hourScore = kpScore(kp ?? 0) + cloudScore(cloud);
            return {
              time: t.time,
              kp: kp !== null ? Math.round(kp * 100) / 100 : 0,
              cloudCover: Math.round(cloud),
              dark,
              score: hourScore,
              chance: chanceFromScore(hourScore),
            };
          });
      } catch {
        hourly = []; // se kommentaren over — grafen er et pluss, ikke kritisk
      }
    }

    // ── Natt-for-natt (`daily`): i kveld, i morgen kveld, overmorgen kveld ──
    // Samme degradering som `hourly`: feiler noe her, mangler bare feltet.
    let daily: AuroraNight[] = [];
    try {
      const fromMs = Math.floor(now.getTime() / 3600_000) * 3600_000; // inneværende time
      const inputs: NightHourInput[] = series
        .map((t: any) => {
          const ms = new Date(t.time).getTime();
          const sun = sunByDate[osloParts(ms).date];
          const cloud = t.data?.instant?.details?.cloud_area_fraction;
          return {
            ms,
            kp: kpAtStrict(kpForecastRows, ms),
            cloud: Number.isFinite(cloud) ? (cloud as number) : null,
            // Ukjent sol (fetch feilet) faller til «mørk», som for `hourly`.
            dark: sun ? !isDaylight(ms, sun) : true,
          };
        })
        .filter((h: NightHourInput) => h.ms >= fromMs);
      daily = buildNights(todayStr, inputs);
    } catch {
      daily = [];
    }

    res.setHeader('Cache-Control', 's-maxage=900');
    res.status(200).json({
      kp: Math.round(latest.Kp * 100) / 100,
      kpTime: latest.time_tag,
      cloudCover: Math.round(cloudCover),
      probability: chanceFromScore(score) as AuroraChance,
      hourly,
      daily,
      updatedAt: new Date().toISOString(),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message ?? 'Ukjent feil' });
  }
}
