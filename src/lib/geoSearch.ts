import { useState, useEffect } from 'react';

export interface GeoResult {
  lat: number;
  lon: number;
  label: string;
  sublabel: string;
  type: string;
}

export const TYPE_LABELS: Record<string, string> = {
  // Steder & administrative
  'administrative': 'Område',
  'city': 'By',
  'town': 'By',
  'village': 'Landsby',
  'municipality': 'Kommune',
  'county': 'Fylke',
  'state': 'Fylke',
  'country': 'Land',
  'continent': 'Kontinent',
  'region': 'Region',
  'suburb': 'Bydel',
  'neighbourhood': 'Område',
  'quarter': 'Bydel',
  'district': 'Distrikt',

  // Bygninger & adresser
  'house': 'Hus',
  'building': 'Bygning',
  'construction': 'Byggeprosjekt',

  // Kultur & underholdning
  'theatre': 'Teater',
  'cinema': 'Kino',
  'museum': 'Museum',
  'opera': 'Opera',
  'concert_hall': 'Konserthall',
  'place_of_worship': 'Helligdom',
  'monument': 'Monumentet',
  'archaeological_site': 'Arkeologisk område',
  'castle': 'Slott',
  'ruin': 'Ruin',
  'historic': 'Historisk sted',
  'historic_site': 'Historisk sted',

  // Sport & fritid
  'fitness_centre': 'Treningssenter',
  'sports_centre': 'Idrettshall',
  'stadium': 'Stadion',
  'swimming_pool': 'Svømmehall',
  'park': 'Park',
  'playground': 'Lekeplass',
  'viewpoint': 'Utsiktspunkt',
  'beach': 'Strand',

  // Utdanning
  'university': 'Universitet',
  'college': 'Høgskole',
  'school': 'Skole',
  'kindergarten': 'Barnehage',

  // Helse
  'hospital': 'Sykehus',
  'pharmacy': 'Apotek',
  'nursing_home': 'Eldrehjem',
  'dentist': 'Tannlege',
  'doctors': 'Lege',

  // Transport & infrastruktur
  'train_station': 'Togstasjon',
  'bus_stop': 'Bussholdeplass',
  'parking': 'Parkering',
  'airport': 'Flyplass',
  'port': 'Havn',

  // Mat & drikke
  'restaurant': 'Restaurant',
  'cafe': 'Kafé',
  'bar': 'Bar',
  'pub': 'Pub',
  'hotel': 'Hotell',
  'supermarket': 'Supermarked',
  'shop': 'Butikk',
  'market': 'Marked',

  // Bank & offentlig
  'bank': 'Bank',
  'post_office': 'Postkonto',
  'police': 'Politistasjon',
  'fire_station': 'Brannstasjon',
  'courthouse': 'Domstol',
  'town_hall': 'Rådhus',
  'government_office': 'Offentlig kontor',

  // Natur
  'forest': 'Skog',
  'lake': 'Innsjø',
  'river': 'Elv',
  'mountain': 'Fjell',
  'peak': 'Topp',
  'valley': 'Dal',
  'island': 'Øy',
  'strait': 'Sund',
  'bay': 'Bukt',
  'spring': 'Kilde',
  'waterfall': 'Foss',
  'fountain': 'Fontene',

  // Fallback
  'amenity': 'Pålitelig',
  'sted': 'Sted',
};

export function useGeoSearch(initialQuery: string) {
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<GeoResult[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (query.trim().length < 2) { setResults([]); return; }
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
        if (!res.ok) throw new Error(`Search failed: ${res.status}`);
        const data = await res.json() as GeoResult[];
        setResults(data);
      } catch (err) {
        console.error('Search error:', err);
        setResults([]);
      }
      finally { setLoading(false); }
    }, 350);
    return () => clearTimeout(t);
  }, [query]);

  return { query, setQuery, results, loading };
}
