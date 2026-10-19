export const config = { maxDuration: 10 };

// Bodø sentrum
const LAT = 67.2827;
const LON = 14.3742;

const SYMBOL_NO: Record<string, string> = {
  clearsky_day: 'Klarvær', clearsky_night: 'Klarvær',
  fair_day: 'Lettskyet', fair_night: 'Lettskyet',
  partlycloudy_day: 'Delvis skyet', partlycloudy_night: 'Delvis skyet',
  cloudy: 'Skyet', fog: 'Tåke',
  lightrain: 'Lett regn', rain: 'Regn', heavyrain: 'Kraftig regn',
  lightrainshowers_day: 'Lette regnbyger', lightrainshowers_night: 'Lette regnbyger',
  rainshowers_day: 'Regnbyger', rainshowers_night: 'Regnbyger',
  heavyrainshowers_day: 'Kraftige regnbyger',
  lightsleet: 'Lett sludd', sleet: 'Sludd',
  lightsnow: 'Lett snø', snow: 'Snø', heavysnow: 'Kraftig snø',
  lightssnowshowers_day: 'Lette snøbyger',
  thunder: 'Tordenvær', rainandthunder: 'Torden og regn',
  lightrainandthunder: 'Lyn og lett regn',
};

// Map symbol to simple category for the frontend to render an icon
export function symbolCategory(symbol: string): 'clear' | 'fair' | 'cloudy' | 'rain' | 'snow' | 'thunder' | 'fog' {
  if (symbol.startsWith('clearsky')) return 'clear';
  if (symbol.startsWith('fair')) return 'fair';
  if (symbol.includes('thunder')) return 'thunder';
  if (symbol.includes('snow') || symbol.includes('sleet')) return 'snow';
  if (symbol.includes('rain') || symbol.includes('shower') || symbol.includes('drizzle')) return 'rain';
  if (symbol.includes('fog')) return 'fog';
  return 'cloudy';
}

// Environment Canada-formelen forventer km/h; yr gir wind_speed i m/s.
export function windChill(temp: number, wind: number): number {
  if (temp > 10 || wind <= 1.5) return temp;
  const kmh = Math.pow(wind * 3.6, 0.16);
  return 13.12 + 0.6215 * temp - 11.37 * kmh + 0.3965 * temp * kmh;
}

// ─── Dag-for-dag-oppsummering (`daily`) ────────────────────────────────────
//
// Hele yr-serien er allerede hentet; her grupperes den på Oslo-dato. Rene
// funksjoner (ingen fetch) så aggregeringen kan enhetstestes.

export type WxCategory = 'clear' | 'fair' | 'cloudy' | 'rain' | 'snow' | 'thunder' | 'fog';

/** Dagtimer (Oslo-klokketime, begge inkludert) som styrer dagens symbol — et nattlig regnskyll skal ikke avgjøre hele dagen. */
export const DAY_START_HOUR = 6;
export const DAY_END_HOUR = 22;
export const DAILY_DAYS = 3;

const SEVERITY_ORDER: WxCategory[] = ['thunder', 'snow', 'rain', 'fog', 'cloudy', 'fair', 'clear'];
const HOUR_MS = 3600_000;

export interface DayHour {
  hour: number;       // Oslo-klokketime
  temp: number;
  precip: number;     // mm i perioden (1 time, eller 6 timer ved step 6)
  category: WxCategory;
  step: 1 | 6;        // 1 = timesdata, 6 = grovere 6-timers periode (Yr gir ikke timer langt frem)
}

export interface WeatherDay {
  date: string;       // Oslo-dato, yyyy-mm-dd
  min: number;
  max: number;
  windMax: number;    // m/s
  precip: number;     // mm, samlet (uten å telle samme periode to ganger)
  symbol: string;
  category: WxCategory;
  description: string;
  sunrise: string;    // «HH:MM», '' hvis ukjent
  sunset: string;
  hours: DayHour[];
}

/** Et utdrag av Yr sitt compact-format, kun feltene vi bruker. */
export interface YrEntry {
  time: string;
  data: {
    instant: { details: { air_temperature: number; wind_speed: number } };
    next_1_hours?: { summary?: { symbol_code?: string }; details?: { precipitation_amount?: number } };
    next_6_hours?: { summary?: { symbol_code?: string }; details?: { precipitation_amount?: number; air_temperature_max?: number; air_temperature_min?: number } };
  };
}

export function addDaysIso(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Oslo-dato og -klokketime (samme metode som ellers i filen). */
export function osloParts(ms: number): { date: string; hour: number } {
  const s = new Date(ms).toLocaleString('sv-SE', { timeZone: 'Europe/Oslo' }); // «2026-10-19 22:00:00»
  return { date: s.slice(0, 10), hour: parseInt(s.slice(11, 13), 10) };
}

export interface NormEntry {
  ms: number; date: string; hour: number;
  temp: number; wind: number;
  has1: boolean; p1: number; sym1?: string;
  has6: boolean; p6: number; sym6?: string; max6?: number; min6?: number;
}

function normalize(e: YrEntry): NormEntry {
  const ms = new Date(e.time).getTime();
  const { date, hour } = osloParts(ms);
  const n1 = e.data.next_1_hours, n6 = e.data.next_6_hours;
  return {
    ms, date, hour,
    temp: e.data.instant.details.air_temperature,
    wind: e.data.instant.details.wind_speed,
    has1: !!n1, p1: n1?.details?.precipitation_amount ?? 0, sym1: n1?.summary?.symbol_code,
    has6: !!n6, p6: n6?.details?.precipitation_amount ?? 0, sym6: n6?.summary?.symbol_code,
    max6: n6?.details?.air_temperature_max, min6: n6?.details?.air_temperature_min,
  };
}

export interface Period { e: NormEntry; step: 1 | 6; precip: number; symbol: string }

/**
 * Velger hvilken periode hver oppføring bidrar med, uten å telle samme tid to ganger:
 * next_1_hours der det finnes; next_6_hours kun for oppføringer som ikke allerede
 * ligger inni en periode vi har tatt med (i timesdata-sonen har alle oppføringer både
 * next_1_hours og next_6_hours, og de overlappende 6-timersperiodene hoppes over).
 * Oppføringene må være sortert på tid.
 */
export function selectPeriods(entries: NormEntry[]): Period[] {
  const out: Period[] = [];
  let covered = -Infinity;
  for (const e of entries) {
    if (e.has1) {
      out.push({ e, step: 1, precip: e.p1, symbol: e.sym1 ?? e.sym6 ?? 'cloudy' });
      covered = Math.max(covered, e.ms + HOUR_MS);
    } else if (e.has6 && e.ms >= covered) {
      out.push({ e, step: 6, precip: e.p6, symbol: e.sym6 ?? 'cloudy' });
      covered = e.ms + 6 * HOUR_MS;
    }
  }
  return out;
}

/**
 * Dagens kategori: «verste vinner» (SEVERITY_ORDER, samme som todayCategory) blant
 * DAGTIMENE (06–22), ikke hele døgnet. Faller til alle timer, så 'cloudy', hvis dagen
 * ikke har noen dagtimer (f.eks. kun kveldstimer igjen).
 */
export function dominantCategory(cats: { hour: number; category: WxCategory }[]): WxCategory {
  const day = cats.filter(c => c.hour >= DAY_START_HOUR && c.hour <= DAY_END_HOUR);
  const pool = day.length ? day : cats;
  return SEVERITY_ORDER.find(c => pool.some(p => p.category === c)) ?? 'cloudy';
}

function round1(n: number): number { return Math.round(n * 10) / 10; }

/** Én dags oppsummering fra oppføringene som hører til datoen (+ periodene valgt over hele serien). */
export function buildDay(
  date: string,
  entries: NormEntry[],
  periods: Period[],
  sun: { sunrise: string; sunset: string },
  symbolCategory: (symbol: string) => WxCategory,
  symbolText: (symbol: string) => string,
): WeatherDay | null {
  if (!entries.length) return null;
  const dayPeriods = periods.filter(p => p.e.date === date);

  const temps = entries.map(e => e.temp);
  // Grove 6-timers perioder: bruk periodens egen min/maks, ellers ville ett punkt hver 6. time
  // undervurdert dagens ytterpunkter.
  for (const p of dayPeriods) {
    if (p.step === 6) {
      if (Number.isFinite(p.e.max6)) temps.push(p.e.max6 as number);
      if (Number.isFinite(p.e.min6)) temps.push(p.e.min6 as number);
    }
  }
  const wind = Math.max(...entries.map(e => e.wind));

  // Symbol/kategori per oppføring (som i todayCategory: next_1_hours ?? next_6_hours ?? 'cloudy')
  const cats = entries.map(e => {
    const sym = e.sym1 ?? e.sym6 ?? 'cloudy';
    return { e, sym, hour: e.hour, category: symbolCategory(sym) };
  });
  const category = dominantCategory(cats);
  // Beskrivelsen: symbolet til dagtimen i vinnerkategorien med mest nedbør (lik nedbør → tidligst),
  // så «regn» får «Kraftig regn» når det er det som faller, ikke tilfeldig første time.
  const precipAt = (ms: number) => dayPeriods.find(p => p.e.ms === ms)?.precip ?? 0;
  const inDay = cats.filter(c => c.hour >= DAY_START_HOUR && c.hour <= DAY_END_HOUR);
  const pool = (inDay.length ? inDay : cats).filter(c => c.category === category);
  let rep = pool[0];
  for (const c of pool) if (precipAt(c.e.ms) > precipAt(rep.e.ms)) rep = c;
  const symbol = rep ? rep.sym : 'cloudy';

  return {
    date,
    min: round1(Math.min(...temps)),
    max: round1(Math.max(...temps)),
    windMax: round1(wind),
    precip: round1(dayPeriods.reduce((sum, p) => sum + p.precip, 0)),
    symbol,
    category,
    description: symbolText(symbol),
    sunrise: sun.sunrise,
    sunset: sun.sunset,
    hours: dayPeriods.map(p => ({
      hour: p.e.hour,
      temp: round1(p.e.temp),
      precip: round1(p.precip),
      category: symbolCategory(p.symbol),
      step: p.step,
    })),
  };
}

/**
 * Tre dager (i dag, i morgen, overmorgen) fra Yr-serien. `fromMs`: tidligste tidspunkt
 * som regnes med (todayMin/Max bruker «fra nå»; samme her, så dagens tall stemmer overens).
 */
export function buildDaily(
  series: YrEntry[],
  todayIso: string,
  fromMs: number,
  sunByDate: Record<string, { sunrise: string; sunset: string }>,
  symbolCategory: (symbol: string) => WxCategory,
  symbolText: (symbol: string) => string,
): WeatherDay[] {
  const all = series.map(normalize).filter(e => e.ms >= fromMs).sort((a, b) => a.ms - b.ms);
  const periods = selectPeriods(all);
  const days: WeatherDay[] = [];
  for (let i = 0; i < DAILY_DAYS; i++) {
    const date = addDaysIso(todayIso, i);
    const d = buildDay(date, all.filter(e => e.date === date), periods, sunByDate[date] ?? { sunrise: '', sunset: '' }, symbolCategory, symbolText);
    if (d) days.push(d);
  }
  return days;
}

/** Soloppgang/-nedgang («HH:MM», Oslo) for en dato. Duplisert fra api/nordlys.ts (ingen import mellom api-filer). */
async function fetchSunTimes(dateStr: string): Promise<{ sunrise: string; sunset: string }> {
  const none = { sunrise: '', sunset: '' };
  try {
    const resp = await fetch(
      `https://api.met.no/weatherapi/sunrise/3.0/sun?lat=${LAT}&lon=${LON}&date=${dateStr}`,
      { headers: { 'User-Agent': 'Felles-App/1.0 div@ofrim.no' }, signal: AbortSignal.timeout(9000) },
    );
    if (!resp.ok) return none;
    const p = (await resp.json()).properties;
    const fmt = (iso?: string) => iso
      ? new Date(iso).toLocaleTimeString('nb-NO', { timeZone: 'Europe/Oslo', hour: '2-digit', minute: '2-digit' })
      : '';
    // Midnattssol/mørketid: sunrise/sunset mangler → tom streng (vises ikke), ikke et feil klokkeslett.
    return { sunrise: fmt(p?.sunrise?.time), sunset: fmt(p?.sunset?.time) };
  } catch {
    return none;
  }
}

export default async function handler(_req: any, res: any) {
  try {
    const todayOsloDate = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Oslo' });

    const day1Iso = addDaysIso(todayOsloDate, 1);
    const day2Iso = addDaysIso(todayOsloDate, 2);

    const [resp, sunResp, sunDay1, sunDay2] = await Promise.all([
      fetch(
        `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${LAT}&lon=${LON}`,
        { headers: { 'User-Agent': 'Felles-App/1.0 div@ofrim.no' }, signal: AbortSignal.timeout(10000) }
      ),
      fetch(
        `https://api.met.no/weatherapi/sunrise/3.0/sun?lat=${LAT}&lon=${LON}&date=${todayOsloDate}`,
        { headers: { 'User-Agent': 'Felles-App/1.0 div@ofrim.no' }, signal: AbortSignal.timeout(10000) }
      ),
      fetchSunTimes(day1Iso),
      fetchSunTimes(day2Iso),
    ]);
    if (!resp.ok) throw new Error(`Yr svarte ${resp.status}`);

    const data = await resp.json();
    const series: any[] = data.properties.timeseries;

    // Find the entry closest to now (first entry >= now)
    const nowIso = new Date().toISOString();
    const idx    = series.findIndex((t: any) => t.time >= nowIso);
    const cur    = series[idx >= 0 ? idx : 0];

    const temp   = cur.data.instant.details.air_temperature as number;
    const wind   = cur.data.instant.details.wind_speed as number;
    const symbol = (cur.data.next_1_hours?.summary?.symbol_code
                 ?? cur.data.next_6_hours?.summary?.symbol_code
                 ?? 'cloudy') as string;

    // Sunrise / sunset
    let sunrise = '', sunset = '';
    if (sunResp.ok) {
      const sunData = await sunResp.json();
      const fmt = (iso: string) => new Date(iso).toLocaleTimeString('nb-NO', { timeZone: 'Europe/Oslo', hour: '2-digit', minute: '2-digit' });
      sunrise = fmt(sunData.properties.sunrise.time);
      sunset  = fmt(sunData.properties.sunset.time);
    }

    // Today's remaining entries in Oslo timezone (from current forecast hour onwards)
    const todayOslo = todayOsloDate;
    const todayEntries = series.filter((t: any) =>
      new Date(t.time).toLocaleDateString('sv-SE', { timeZone: 'Europe/Oslo' }) === todayOslo
      && t.time >= cur.time
    );

    const todayTemps = todayEntries.map((t: any) => t.data.instant.details.air_temperature as number);
    const todayMin = todayTemps.length ? Math.round(Math.min(...todayTemps) * 10) / 10 : temp;
    const todayMax = todayTemps.length ? Math.round(Math.max(...todayTemps) * 10) / 10 : temp;
    const todayPrecip = Math.round(todayEntries.reduce((sum: number, t: any) =>
      sum + (t.data.next_1_hours?.details?.precipitation_amount ?? 0), 0) * 10) / 10;

    // Dominant daytime (06-20) category — worst wins
    const SEVERITY: Array<'clear' | 'fair' | 'cloudy' | 'rain' | 'snow' | 'thunder' | 'fog'> = ['thunder', 'snow', 'rain', 'fog', 'cloudy', 'fair', 'clear'];
    const daytimeCategories = todayEntries
      .filter((t: any) => {
        const h = new Date(t.time).toLocaleString('nb-NO', { timeZone: 'Europe/Oslo', hour: 'numeric', hour12: false });
        const hr = parseInt(h);
        return hr >= 6 && hr <= 20;
      })
      .map((t: any) => {
        const sym = (t.data.next_1_hours?.summary?.symbol_code ?? t.data.next_6_hours?.summary?.symbol_code ?? 'cloudy') as string;
        return symbolCategory(sym);
      });
    const todayCategory = SEVERITY.find(c => daytimeCategories.includes(c)) ?? symbolCategory(symbol as any);

    // Hourly entries for today (one per clock-hour)
    const hourly = todayEntries.slice(0, 24).map((t: any) => {
      const localStr = new Date(t.time).toLocaleString('sv-SE', { timeZone: 'Europe/Oslo' });
      const hour = parseInt(localStr.split(' ')[1].split(':')[0], 10);
      const sym = (t.data.next_1_hours?.summary?.symbol_code
                ?? t.data.next_6_hours?.summary?.symbol_code
                ?? 'cloudy') as string;
      return {
        hour,
        temp:     Math.round(t.data.instant.details.air_temperature * 10) / 10,
        precip:   Math.round((t.data.next_1_hours?.details?.precipitation_amount ?? 0) * 10) / 10,
        category: symbolCategory(sym),
      };
    });

    // ── Dag for dag (`daily`): i dag, i morgen, overmorgen ──
    // Degraderer til tom liste hvis noe feiler — de eksisterende feltene er uberørt.
    let daily: WeatherDay[] = [];
    try {
      daily = buildDaily(
        series as YrEntry[], todayOsloDate, new Date(cur.time).getTime(),
        { [todayOsloDate]: { sunrise, sunset }, [day1Iso]: sunDay1, [day2Iso]: sunDay2 },
        symbolCategory, sym => SYMBOL_NO[sym] ?? sym,
      );
    } catch {
      daily = [];
    }

    res.status(200).json({
      temp:        Math.round(temp * 10) / 10,
      feelsLike:   Math.round(windChill(temp, wind) * 10) / 10,
      wind:        Math.round(wind * 10) / 10,
      symbol,
      category:    symbolCategory(symbol),
      description: SYMBOL_NO[symbol] ?? symbol,
      todayMin,
      todayMax,
      todayPrecip,
      todayCategory,
      sunrise,
      sunset,
      hourly,
      daily,
      updatedAt:   new Date().toISOString(),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message ?? 'Ukjent feil' });
  }
}
