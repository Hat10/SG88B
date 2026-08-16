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

    const [kpResp, kpForecastResp, wxResp, sunToday, sunTomorrow] = await Promise.all([
      fetch(NOAA_KP_URL, { signal: AbortSignal.timeout(9000) }),
      fetch(NOAA_KP_FORECAST_URL, { signal: AbortSignal.timeout(9000) }),
      fetch(
        `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${LAT}&lon=${LON}`,
        { headers: { 'User-Agent': 'Felles-App/1.0 div@ofrim.no' }, signal: AbortSignal.timeout(9000) }
      ),
      fetchSun(todayStr),
      fetchSun(tomorrowStr),
    ]);
    if (!kpResp.ok) throw new Error(`NOAA svarte ${kpResp.status}`);
    if (!wxResp.ok) throw new Error(`Yr svarte ${wxResp.status}`);
    const sunByDate: Record<string, SunWindow> = { [todayStr]: sunToday, [tomorrowStr]: sunTomorrow };

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
    if (kpForecastResp.ok) {
      try {
        const kpForecastRaw: Array<{ time_tag: string; kp: number }> = await kpForecastResp.json();
        const kpForecastRows = kpForecastRaw
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

    res.setHeader('Cache-Control', 's-maxage=900');
    res.status(200).json({
      kp: Math.round(latest.Kp * 100) / 100,
      kpTime: latest.time_tag,
      cloudCover: Math.round(cloudCover),
      probability: chanceFromScore(score) as AuroraChance,
      hourly,
      updatedAt: new Date().toISOString(),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message ?? 'Ukjent feil' });
  }
}
