export const config = { maxDuration: 10 };

// Bodø sentrum — samme koordinater som api/vaer.ts.
const LAT = 67.2827;
const LON = 14.3742;

// ─── Kp-kildene — LES DETTE FØR DU RØRER «Kp nå» ───────────────────────────
//
// Kontrollert mot live-data 2026-11-24 (se PR). Tre NOAA-feeder, tre ulike ting:
//
// 1) noaa-planetary-k-index.json — OBSERVERT Kp, 3-timers bolker (00/03/…/21 UTC).
//    En rad finnes først når bolken er FERDIG, så siste rad er alltid en bolk
//    bak: «Kp nå» er aldri bolken som pågår. Det er det vi viser, ærlig merket
//    «observert HH–HH» (+ «utdatert» når bolken sluttet for mer enn 6 t siden).
//
// 2) noaa-planetary-k-index-forecast.json — observert + prognose i én liste.
//    Feltet `observed` er 'observed' for ferdige bolker, men 'estimated'/
//    'predicted' for resten. OBS: 'estimated' er IKKE en måling. Bolkene 15/18/21
//    samme dag er også 'estimated' og kan umulig være målt ennå, og bolken som
//    pågår lå på 2,0 mens 1-minutts-målingene så langt var ≤ 0,67. Behandle
//    ALT som ikke er 'observed' som PROGNOSE. Brukes til grafen, aldri til «nå».
//
// 3) json/planetary_k_index_1m.json — 1-minutts estimert Kp (`estimated_kp`),
//    dekker bare ~6 timer. Snittet per bolk ligger systematisk LAVT (offisiell
//    Kp er et variasjonsspenn over 3 t, ikke et snitt), men MAKS per bolk traff
//    offisiell observert Kp nøyaktig i begge bolkene vi kunne sammenligne
//    (1,67 og 1,00). Maks kan derfor bare stige gjennom bolken, og brukes som
//    et MINIMUM for bolken som pågår («pågår: ≥ x så langt») — aldri som «nå»,
//    og aldri snittet.
//
// Rådataformat: arrays av objekter, eldste først, ingen header-rad (eldre
// versjoner var arrays av arrays MED header — parserne under tåler begge).
// Tidsstempler er UTC uten «Z».
const NOAA_KP_URL = 'https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json';
const NOAA_KP_FORECAST_URL = 'https://services.swpc.noaa.gov/products/noaa-planetary-k-index-forecast.json';
const NOAA_KP_1M_URL = 'https://services.swpc.noaa.gov/json/planetary_k_index_1m.json';

const HOURS_AHEAD = 20;

export const KP_SLOT_MS = 3 * 3600_000;
/** Observert bolk som sluttet for mer enn dette siden regnes som utdatert. */
export const KP_STALE_MS = 6 * 3600_000;

/** observed = målt (ferdig bolk). forecast = alt annet NOAA har («estimated» + «predicted»). */
export type KpKind = 'observed' | 'forecast';

export interface KpRow { ms: number; kp: number; kind: KpKind }

/** Én felles avrunding for alt Kp som sendes ut: én desimal (Kp er tredjedeler: 0,33 → 0,3 · 1,67 → 1,7). */
export function roundKp(kp: number): number {
  return Math.round(kp * 10) / 10;
}

export type AuroraChance = 'lav' | 'middels' | 'høy';

export interface AuroraHourlyEntry {
  time: string;       // ISO, UTC
  kp: number;         // fra 3-timersbolken som dekker denne timen — IKKE interpolert (se merknad ved kpRowAt). Én desimal.
  kpKind?: KpKind;    // 'observed' hvis bolken er ferdig målt, ellers 'forecast'. Mangler = forecast (eldre svar).
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
  kind?: KpKind;          // mangler = forecast
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
 * Som kpRowAt, men returnerer null for tidspunkt utenfor varselets dekning: en
 * bolk dekker kun sine egne 3 timer, så timer etter siste bolk har INGEN
 * Kp-verdi (kpRowAt ville gjenbrukt siste bolk for alltid).
 */
export function kpAtStrict(rows: { ms: number; kp: number }[], t: number): number | null {
  return kpRowAtStrict(rows, t)?.kp ?? null;
}

/** Som kpAtStrict, men returnerer hele raden (så `kind` følger med). Radene må være sortert stigende. */
export function kpRowAtStrict<T extends { ms: number; kp: number }>(rows: T[], t: number): T | null {
  let hit: T | null = null;
  for (const r of rows) { if (r.ms <= t) hit = r; else break; }
  if (!hit || t >= hit.ms + KP_SLOT_MS) return null;
  return hit;
}

// ─── Parsing og utvalg av Kp (rene funksjoner — dekket av nordlysKp.test.ts) ──

/** NOAA-tid er UTC uten «Z» («2026-11-24T09:00:00» eller, eldre, «2026-11-24 09:00:00»). Uten «Z» ville Date lest den som lokal tid. NaN hvis ugyldig. */
export function parseKpTime(v: unknown): number {
  if (typeof v !== 'string') return NaN;
  const s = v.trim().replace(' ', 'T');
  return new Date(/(Z|[+-]\d\d:?\d\d)$/.test(s) ? s : s + 'Z').getTime();
}

/** Kp som tall (0.33, "1.67") eller NOAAs strengform ("3+" = 3⅓, "3-" = 2⅔, "3o"/"3Z" = 3). NaN hvis ikke tolkbar. */
export function parseKpValue(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v !== 'string') return NaN;
  const s = v.trim();
  if (s !== '' && Number.isFinite(Number(s))) return Number(s);
  const m = /^(\d)([+\-oOzZpPmM]?)$/.exec(s);
  if (!m) return NaN;
  const base = Number(m[1]);
  if (m[2] === '+' || m[2] === 'p' || m[2] === 'P') return base + 1 / 3;
  if (m[2] === '-' || m[2] === 'm' || m[2] === 'M') return base - 1 / 3;
  return base;
}

/**
 * Observert-feeden → rader (kind 'observed'), stigende på tid. Tåler både
 * array-av-objekter ({time_tag, Kp}) og array-av-arrays med header-rad først:
 * header-raden faller ut av seg selv, fordi «time_tag»/«Kp» ikke tolkes som tid/tall.
 */
export function parseObservedKpRows(raw: unknown): KpRow[] {
  if (!Array.isArray(raw)) return [];
  const out: KpRow[] = [];
  for (const r of raw) {
    const time = Array.isArray(r) ? r[0] : (r as any)?.time_tag;
    const val = Array.isArray(r) ? r[1] : ((r as any)?.Kp ?? (r as any)?.kp);
    const ms = parseKpTime(time);
    const kp = parseKpValue(val);
    if (Number.isFinite(ms) && Number.isFinite(kp)) out.push({ ms, kp, kind: 'observed' });
  }
  return out.sort((a, b) => a.ms - b.ms);
}

/** Forecast-feeden → rader. Bare `observed === 'observed'` er målt; 'estimated' og 'predicted' er begge PROGNOSE (se toppen av filen). */
export function parseForecastKpRows(raw: unknown): KpRow[] {
  if (!Array.isArray(raw)) return [];
  const out: KpRow[] = [];
  for (const r of raw) {
    const ms = parseKpTime((r as any)?.time_tag);
    const kp = parseKpValue((r as any)?.kp);
    if (Number.isFinite(ms) && Number.isFinite(kp)) {
      out.push({ ms, kp, kind: (r as any)?.observed === 'observed' ? 'observed' : 'forecast' });
    }
  }
  return out.sort((a, b) => a.ms - b.ms);
}

/**
 * Slår observert-feeden og forecast-feeden til én tidslinje. En bolk som er
 * målt i NOEN av feedene vises som observert (observert-feeden vinner ved
 * uenighet); resten er prognose. Gjør at grafen og «Kp nå» aldri motsier
 * hverandre om en bolk, og at forecast-feedens ferdige bolker fungerer som
 * reserve når observert-feeden mangler eller henger etter.
 */
export function mergeKpRows(forecast: KpRow[], observed: KpRow[]): KpRow[] {
  const byMs = new Map<number, KpRow>();
  for (const r of forecast) byMs.set(r.ms, r);
  for (const r of observed) byMs.set(r.ms, { ...r, kind: 'observed' });
  return [...byMs.values()].sort((a, b) => a.ms - b.ms);
}

export interface KpNow {
  kp: number;
  kind: 'observed';
  /** Bolken verdien gjelder, ISO UTC. */
  slot: { start: string; end: string };
  /** Bolken sluttet for mer enn KP_STALE_MS siden. */
  stale: boolean;
}

/** «Kp nå» = siste OBSERVERTE bolk som har startet (prognoser og fremtidige rader hoppes over). null hvis ingen. */
export function pickKpNow(rows: KpRow[], nowMs: number): KpNow | null {
  let hit: KpRow | null = null;
  for (const r of rows) if (r.kind === 'observed' && r.ms <= nowMs && (!hit || r.ms > hit.ms)) hit = r;
  if (!hit) return null;
  const endMs = hit.ms + KP_SLOT_MS;
  return {
    kp: hit.kp,
    kind: 'observed',
    slot: { start: new Date(hit.ms).toISOString(), end: new Date(endMs).toISOString() },
    stale: nowMs - endMs > KP_STALE_MS,
  };
}

export interface KpOngoing {
  /** Bolken som pågår, ISO UTC. */
  slotStart: string;
  /** Høyeste 1-minutts estimert Kp så langt i bolken — et MINIMUM for bolkens endelige Kp (se toppen av filen). */
  kpMin: number;
  /** Antall 1-minutts-målinger bak tallet. */
  minutes: number;
}

/**
 * Minimum for bolken som pågår, fra 1-minutts-feeden. null (→ UI skjuler
 * teksten, ingen feil) hvis feeden mangler/er ugyldig, bolken har 0 minutter
 * data (rett etter bolkeskifte), eller bolken allerede finnes som observert
 * (`observedLatestStartMs` ≥ starten på bolken som pågår).
 */
export function ongoingKpMinimum(raw: unknown, nowMs: number, observedLatestStartMs: number | null): KpOngoing | null {
  if (!Array.isArray(raw)) return null;
  const slotStartMs = Math.floor(nowMs / KP_SLOT_MS) * KP_SLOT_MS; // 3 t deler døgnet: samme rutenett som NOAAs 00/03/…/21 UTC
  if (observedLatestStartMs !== null && observedLatestStartMs >= slotStartMs) return null;
  let max = -Infinity;
  let minutes = 0;
  for (const r of raw) {
    const ms = parseKpTime((r as any)?.time_tag);
    const kp = parseKpValue((r as any)?.estimated_kp);
    if (!Number.isFinite(ms) || !Number.isFinite(kp) || ms < slotStartMs || ms > nowMs) continue;
    minutes++;
    if (kp > max) max = kp;
  }
  if (minutes === 0) return null;
  return { slotStart: new Date(slotStartMs).toISOString(), kpMin: roundKp(max), minutes };
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
    kp: roundKp(best.h.kp),
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
      return { time: iso(h.ms), kp: roundKp(h.kp as number), kpKind: h.kind ?? 'forecast', cloudCover: Math.round(h.cloud as number), dark: true, score: sc, chance: chanceFromScore(sc) };
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
export function kpRowAt(rows: KpRow[], t: number): KpRow | null {
  let val: KpRow | null = null;
  for (const r of rows) {
    if (r.ms <= t) val = r; else break;
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

    // NOAA-feedene er hver for seg valgfrie: en feil (nett, HTTP, ugyldig JSON)
    // gir null i stedet for å felle svaret. Mangler ALLE Kp-kilder, kaster vi under.
    const getJson = (url: string): Promise<unknown> =>
      fetch(url, { signal: AbortSignal.timeout(9000) })
        .then(r => (r.ok ? r.json() : null))
        .catch(() => null);

    const [kpRaw, kpForecastRaw, kp1mRaw, wxResp, sunToday, sunTomorrow, sunDay2, sunDay3] = await Promise.all([
      getJson(NOAA_KP_URL),
      getJson(NOAA_KP_FORECAST_URL),
      getJson(NOAA_KP_1M_URL),
      fetch(
        `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${LAT}&lon=${LON}`,
        { headers: { 'User-Agent': 'Felles-App/1.0 div@ofrim.no' }, signal: AbortSignal.timeout(9000) }
      ),
      fetchSun(todayStr),
      fetchSun(tomorrowStr),
      fetchSun(day2Str),
      fetchSun(day3Str),
    ]);
    if (!wxResp.ok) throw new Error(`Yr svarte ${wxResp.status}`);
    const sunByDate: Record<string, SunWindow> = { [todayStr]: sunToday, [tomorrowStr]: sunTomorrow, [day2Str]: sunDay2, [day3Str]: sunDay3 };

    // ── Kp nå = siste OBSERVERTE bolk (se toppen av filen) ──
    // `kpRows` er observert + forecast på én tidslinje; forecast-feedens ferdige
    // bolker er reserve hvis observert-feeden mangler eller henger etter.
    const nowMs = now.getTime();
    const kpForecastRows = parseForecastKpRows(kpForecastRaw);
    const kpRows = mergeKpRows(kpForecastRows, parseObservedKpRows(kpRaw));
    const kpNow = pickKpNow(kpRows, nowMs);
    if (!kpNow || !Number.isFinite(kpNow.kp)) throw new Error('Fant ingen gyldig Kp-verdi');
    const kpOngoing = ongoingKpMinimum(kp1mRaw, nowMs, new Date(kpNow.slot.start).getTime());

    const wxData = await wxResp.json();
    const series: any[] = wxData.properties.timeseries;
    const nowIso = now.toISOString();
    const idx = series.findIndex((t: any) => t.time >= nowIso);
    const cur = series[idx >= 0 ? idx : 0];
    const cloudCover = cur.data.instant.details.cloud_area_fraction as number;
    if (!Number.isFinite(cloudCover)) throw new Error('Fant ingen gyldig skydekke-verdi');

    const score = kpScore(kpNow.kp) + cloudScore(cloudCover);

    // ── Time-for-time-prognose (neste ~20 timer), for den utvidede grafen ──
    // Feiler prognose-kallet av en eller annen grunn, degraderer vi til bare
    // «nå»-tallet over i stedet for å felle hele svaret — grafen er et pluss,
    // ikke selve poenget med boksen.
    let hourly: AuroraHourlyEntry[] = [];
    if (kpForecastRows.length > 0) {
      try {
        const endMs = now.getTime() + HOURS_AHEAD * 3600_000;
        hourly = series
          .filter((t: any) => {
            const ms = new Date(t.time).getTime();
            return ms >= now.getTime() && ms <= endMs;
          })
          .map((t: any) => {
            const ms = new Date(t.time).getTime();
            const cloud = t.data.instant.details.cloud_area_fraction as number;
            const kpRow = kpRowAt(kpRows, ms);
            const kp = kpRow ? kpRow.kp : null;
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
              kp: kp !== null ? roundKp(kp) : 0,
              kpKind: kpRow?.kind ?? 'forecast',
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
          const kpRow = kpRowAtStrict(kpRows, ms);
          return {
            ms,
            kp: kpRow ? kpRow.kp : null,
            kind: kpRow?.kind,
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

    // Kort edge-cache med stale-while-revalidate: «Kp nå» skifter bare hver 3. time,
    // men skydekket og «utdatert»-flagget skal ikke henge i kvarter.
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    res.status(200).json({
      kp: roundKp(kpNow.kp),
      kpKind: kpNow.kind,
      kpSlot: kpNow.slot,
      kpStale: kpNow.stale,
      kpOngoing, // null = skjul «pågår»-teksten (1m-feed mangler, 0 minutter data, eller bolken er allerede observert)
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
