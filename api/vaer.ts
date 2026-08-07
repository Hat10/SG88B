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
function symbolCategory(symbol: string): 'clear' | 'fair' | 'cloudy' | 'rain' | 'snow' | 'thunder' | 'fog' {
  if (symbol.startsWith('clearsky')) return 'clear';
  if (symbol.startsWith('fair')) return 'fair';
  if (symbol.includes('thunder')) return 'thunder';
  if (symbol.includes('snow') || symbol.includes('sleet')) return 'snow';
  if (symbol.includes('rain') || symbol.includes('shower') || symbol.includes('drizzle')) return 'rain';
  if (symbol.includes('fog')) return 'fog';
  return 'cloudy';
}

function windChill(temp: number, wind: number): number {
  if (temp > 10 || wind <= 1.5) return temp;
  return 13.12 + 0.6215 * temp - 11.37 * Math.pow(wind, 0.16) + 0.3965 * temp * Math.pow(wind, 0.16);
}

export default async function handler(_req: any, res: any) {
  try {
    const todayOsloDate = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Oslo' });

    const [resp, sunResp] = await Promise.all([
      fetch(
        `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${LAT}&lon=${LON}`,
        { headers: { 'User-Agent': 'Felles-App/1.0 div@ofrim.no' }, signal: AbortSignal.timeout(10000) }
      ),
      fetch(
        `https://api.met.no/weatherapi/sunrise/3.0/sun?lat=${LAT}&lon=${LON}&date=${todayOsloDate}`,
        { headers: { 'User-Agent': 'Felles-App/1.0 div@ofrim.no' }, signal: AbortSignal.timeout(10000) }
      ),
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
      updatedAt:   new Date().toISOString(),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message ?? 'Ukjent feil' });
  }
}
