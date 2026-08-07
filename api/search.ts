export const config = { maxDuration: 10 };

// In-memory cache for search results (resets on redeploy)
const cache = new Map<string, { data: any; timestamp: number }>();
const CACHE_TTL = 3600000; // 1 hour

export default async function handler(req: any, res: any) {
  try {
    const { q } = req.query;

    if (!q || typeof q !== 'string' || q.trim().length < 2) {
      return res.status(400).json({ error: 'Query must be at least 2 characters' });
    }

    const query = q.trim();
    const cacheKey = query.toLowerCase();

    // Check cache
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return res.status(200).json(cached.data);
    }

    // Fetch from Nominatim
    const url = `https://nominatim.openstreetmap.org/search`
      + `?q=${encodeURIComponent(query)}`
      + `&format=json&limit=6&addressdetails=1&accept-language=no`;

    const nominatimRes = await fetch(url, {
      headers: { 'User-Agent': 'Felles-App/1.0 div@ofrim.no' },
      signal: AbortSignal.timeout(8000),
    });

    if (!nominatimRes.ok) {
      throw new Error(`Nominatim returned ${nominatimRes.status}`);
    }

    const data = await nominatimRes.json() as Array<{
      lat: string;
      lon: string;
      display_name: string;
      name?: string;
      type?: string;
      address?: Record<string, string>;
    }>;

    // Transform to GeoResult format
    const results = data.map(r => {
      const addr = r.address ?? {};

      // Prioritize POI names over street names
      const poiLabel = addr.amenity || addr.shop || addr.restaurant || addr.cafe ||
                      addr.bar || addr.pub || addr.hotel || addr.museum || addr.theatre ||
                      addr.cinema || addr.library || addr.pharmacy || addr.bank || '';

      const road = addr.road ?? addr.pedestrian ?? addr.path ?? '';
      const houseNo = addr.house_number ?? '';
      const addressLabel = road ? (houseNo ? `${road} ${houseNo}` : road) : '';

      const label = poiLabel || r.name || addressLabel || r.display_name.split(',')[0];

      const suburb = addr.suburb ?? addr.neighbourhood ?? addr.quarter ?? '';
      const city = addr.city ?? addr.town ?? addr.village ?? addr.municipality ?? '';
      const country = addr.country ?? '';
      const sub = [suburb, city, country]
        .filter(Boolean)
        .filter((v, i, a) => a.indexOf(v) === i)
        .join(', ');

      const type = r.type ?? 'sted';

      return { lat: parseFloat(r.lat), lon: parseFloat(r.lon), label, sublabel: sub, type };
    });

    // Cache the result
    cache.set(cacheKey, { data: results, timestamp: Date.now() });

    res.status(200).json(results);
  } catch (err: any) {
    console.error('Search error:', err);
    res.status(500).json({ error: err.message ?? 'Search failed' });
  }
}
