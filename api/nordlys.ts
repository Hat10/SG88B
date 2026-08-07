export const config = { maxDuration: 10 };

// Bodø sentrum — samme koordinater som api/vaer.ts.
const LAT = 67.2827;
const LON = 14.3742;

// Nøkkelfritt NOAA-endepunkt for planetarisk Kp-indeks. Dette er observerte
// verdier hvert 3. time (siste rad ≈ nå), ikke en flerdags-prognose — «gjeldende»
// er derfor det presise ordet her, ikke «prognosert i morgen».
const NOAA_KP_URL = 'https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json';

export type AuroraChance = 'lav' | 'middels' | 'høy';

// Enkel poengmodell: Kp og skydekke gir hvert 0-2 poeng, summen (0-4) slås om
// til en av tre sjanse-nivåer. Bodø ligger langt nord i aurora-ovalen, så selv
// moderat Kp kan gi nordlys på klar himmel — terskelverdiene under er satt for
// akkurat den breddegraden, ikke for mellom-Europa.
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

export default async function handler(_req: any, res: any) {
  try {
    const [kpResp, wxResp] = await Promise.all([
      fetch(NOAA_KP_URL, { signal: AbortSignal.timeout(9000) }),
      fetch(
        `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${LAT}&lon=${LON}`,
        { headers: { 'User-Agent': 'Felles-App/1.0 div@ofrim.no' }, signal: AbortSignal.timeout(9000) }
      ),
    ]);
    if (!kpResp.ok) throw new Error(`NOAA svarte ${kpResp.status}`);
    if (!wxResp.ok) throw new Error(`Yr svarte ${wxResp.status}`);

    const kpRows: Array<{ time_tag: string; Kp: number }> = await kpResp.json();
    const latest = kpRows[kpRows.length - 1];
    if (!latest || !Number.isFinite(latest.Kp)) throw new Error('Fant ingen gyldig Kp-verdi');

    const wxData = await wxResp.json();
    const series: any[] = wxData.properties.timeseries;
    const nowIso = new Date().toISOString();
    const idx = series.findIndex((t: any) => t.time >= nowIso);
    const cur = series[idx >= 0 ? idx : 0];
    const cloudCover = cur.data.instant.details.cloud_area_fraction as number;
    if (!Number.isFinite(cloudCover)) throw new Error('Fant ingen gyldig skydekke-verdi');

    const score = kpScore(latest.Kp) + cloudScore(cloudCover);

    res.setHeader('Cache-Control', 's-maxage=900');
    res.status(200).json({
      kp: Math.round(latest.Kp * 100) / 100,
      kpTime: latest.time_tag,
      cloudCover: Math.round(cloudCover),
      probability: chanceFromScore(score) as AuroraChance,
      updatedAt: new Date().toISOString(),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message ?? 'Ukjent feil' });
  }
}
