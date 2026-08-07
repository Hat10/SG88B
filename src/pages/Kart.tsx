import { useState, useEffect, useRef, useCallback } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useRatings } from '../contexts/RatingContext';
import { useBucket } from '../contexts/BucketContext';
import { useMapPins } from '../contexts/MapContext';
import type { Rating } from '../contexts/RatingContext';
import type { BucketEntry } from '../contexts/BucketContext';

// ─── Types ──────────────────────────────────────────────────────────────────

interface GeoResult {
  lat: number;
  lon: number;
  label: string;
  sublabel: string;
  type: string;
}

type PlacingFor = { type: 'rating' | 'bucket'; id: string; title: string } | null;
type ActiveItem =
  | { kind: 'rating';  item: Rating }
  | { kind: 'bucket'; item: BucketEntry }
  | null;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function avgScore(r: Rating): number | undefined {
  const scores = [r.score_m, r.score_l].filter((s): s is number => s != null);
  return scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : undefined;
}

function scoreColor(s: number): string {
  if (s >= 9) return '#3A7D44';
  if (s >= 7) return '#5FA37B';
  if (s >= 5) return '#C9963A';
  return '#D95F5F';
}

function makeIcon(color: string, label: string, pulse = false) {
  const size = 34;
  const shadow = pulse
    ? `box-shadow: 0 0 0 6px ${color}44, 0 2px 10px rgba(0,0,0,0.35);`
    : 'box-shadow: 0 2px 10px rgba(0,0,0,0.3);';
  return L.divIcon({
    html: `<div style="
      width:${size}px;height:${size}px;border-radius:50%;
      background:${color};color:#fff;
      font-family:var(--font-mono,monospace);font-size:11px;font-weight:800;
      display:flex;align-items:center;justify-content:center;
      border:2.5px solid rgba(255,255,255,0.85);
      ${shadow}
      user-select:none;
    ">${label}</div>`,
    className: '',
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -(size / 2 + 6)],
  });
}

function fmtScore(n: number): string {
  return n % 1 === 0 ? String(n) : n.toFixed(1);
}

// Map-filterable rating categories. User categories come in singular/plural
// spellings (sted/steder …), so canonCat folds each to one canonical key.
const RATING_CAT_FILTERS: Array<{ key: string; label: string; color: string }> = [
  { key: 'steder',       label: 'Steder',       color: '#3A7D44' },
  { key: 'opplevelser',  label: 'Opplevelser',  color: '#7C5CBF' },
  { key: 'gym',          label: 'Gym',          color: '#C9963A' },
  { key: 'restauranter', label: 'Restauranter', color: '#B5562F' },
];

function canonCat(cat: string): string {
  switch (cat) {
    case 'sted':         case 'steder':       return 'steder';
    case 'opplevelse':   case 'opplevelser':  return 'opplevelser';
    case 'gym':                               return 'gym';
    case 'restaurant':   case 'restauranter': return 'restauranter';
    default:                                  return cat;
  }
}

// Floating map controls always sit on the (always-light) map tiles, so they use
// a fixed light "glass" surface instead of the theme tokens — keeps them legible
// and consistent in both light and dark app themes.
const MAP_CONTROL: React.CSSProperties = {
  background: 'rgba(255,255,255,0.92)',
  backdropFilter: 'blur(8px)',
  WebkitBackdropFilter: 'blur(8px)',
  border: '1px solid rgba(0,0,0,0.07)',
  borderRadius: 12,
  boxShadow: '0 4px 18px rgba(0,0,0,0.14)',
};
const CTRL_INK = '#3d4250';
const CTRL_INK_DIM = '#8a8f9c';

const TYPE_LABELS: Record<string, string> = {
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

function ratingIcon(r: Rating, pulse = false) {
  const avg = avgScore(r);
  const color = avg != null ? scoreColor(avg) : '#888';
  const label = avg != null ? fmtScore(avg) : '?';
  return makeIcon(color, label, pulse);
}

function bucketIcon(done = false, pulse = false) {
  return makeIcon(done ? '#4A7C3F' : '#3B6FBC', done ? '✓' : '★', pulse);
}

// ─── Geocoder ────────────────────────────────────────────────────────────────

function useGeoSearch(initialQuery: string) {
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

function InlineGeoSearch({
  initialQuery, onPick, onClose,
}: {
  initialQuery: string;
  onPick: (lat: number, lng: number) => void;
  onClose: () => void;
}) {
  const { query, setQuery, results, loading } = useGeoSearch(initialQuery);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div style={{ padding: '12px 12px 8px', borderBottom: '1px solid var(--line)', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <button
            onClick={onClose}
            style={{ background: 'transparent', border: 0, padding: '2px 4px', color: 'var(--ink-3)', fontSize: 13, cursor: 'pointer' }}
          >← Tilbake</button>
        </div>
        <input
          ref={inputRef}
          className="input"
          placeholder="Søk etter sted, adresse, landemerke…"
          value={query}
          onChange={e => setQuery(e.target.value)}
          style={{ width: '100%', fontSize: 14 }}
        />
      </div>

      {/* Results */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 12px 20px' }}>
        {loading && (
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-4)', padding: '10px 0' }}>Søker…</div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {results.map((r, i) => (
            <button
              key={i}
              onClick={() => onPick(r.lat, r.lon)}
              style={{
                background: 'var(--bg)', border: '1px solid var(--line)',
                borderRadius: 8, padding: '10px 12px', textAlign: 'left',
                cursor: 'pointer', color: 'var(--ink)', fontSize: 13,
              }}
            >
              <div style={{ fontWeight: 600, lineHeight: 1.3, display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between' }}>
                <span>{r.label}</span>
                <span style={{ fontSize: 10, fontWeight: 500, fontFamily: 'var(--font-mono)', color: 'var(--ink-4)', background: 'var(--chip)', padding: '2px 6px', borderRadius: 3, whiteSpace: 'nowrap', flexShrink: 0 }}>
                  {TYPE_LABELS[r.type] || r.type}
                </span>
              </div>
              {r.sublabel && <div style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 4 }}>{r.sublabel}</div>}
            </button>
          ))}
          {!loading && results.length === 0 && query.trim().length >= 2 && (
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-4)', padding: '10px 0' }}>
              Ingen treff — prøv et annet søkeord
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Map click handler ───────────────────────────────────────────────────────

function MapClickCapture({ onClick }: { onClick: (lat: number, lng: number) => void }) {
  useMapEvents({ click: e => onClick(e.latlng.lat, e.latlng.lng) });
  return null;
}

// ─── Item list ───────────────────────────────────────────────────────────────

function RatingRow({
  r, pinned, onPlace, onSelect,
}: { r: Rating; pinned: boolean; onPlace: () => void; onSelect: () => void }) {
  const avg = avgScore(r);
  const color = avg != null ? scoreColor(avg) : '#888';
  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '9px 12px', borderRadius: 8,
        background: 'var(--bg)', border: '1px solid var(--line)',
        cursor: pinned ? 'default' : 'default',
      }}
    >
      <div
        style={{
          width: 28, height: 28, borderRadius: '50%',
          background: color, color: '#fff',
          fontSize: 11, fontWeight: 800, fontFamily: 'var(--font-mono)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0, border: '2px solid rgba(255,255,255,0.5)',
        }}
      >
        {avg != null ? Math.round(avg) : '?'}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {r.title}
        </div>
      </div>
      {pinned ? (
        <button onClick={onSelect} style={pillStyle('var(--good)', true)}>Se på kart</button>
      ) : (
        <button onClick={onPlace} style={pillStyle('var(--accent)')}>+ Plasser</button>
      )}
    </div>
  );
}

function BucketRow({
  b, pinned, onPlace, onSelect, onDismiss,
}: { b: BucketEntry; pinned: boolean; onPlace: () => void; onSelect: () => void; onDismiss?: () => void }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '9px 12px', borderRadius: 8,
      background: 'var(--bg)', border: '1px solid var(--line)',
    }}>
      <div style={{
        width: 28, height: 28, borderRadius: '50%',
        background: '#3B6FBC', color: '#fff',
        fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0, border: '2px solid rgba(255,255,255,0.5)',
      }}>★</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {b.title}
        </div>
        {b.category && (
          <div style={{ fontSize: 11, color: 'var(--ink-4)', fontFamily: 'var(--font-mono)' }}>{b.category}</div>
        )}
      </div>
      {pinned ? (
        <button onClick={onSelect} style={pillStyle('var(--good)', true)}>Se på kart</button>
      ) : (
        <button onClick={onPlace} style={pillStyle('var(--accent)')}>+ Plasser</button>
      )}
      {onDismiss && (
        <button
          onClick={onDismiss}
          title="Skjul fra listen"
          style={{
            background: 'transparent', border: 0, padding: '2px 4px',
            color: 'var(--ink-4)', fontSize: 16, cursor: 'pointer', lineHeight: 1, flexShrink: 0,
          }}
        >×</button>
      )}
    </div>
  );
}

function pillStyle(color: string, filled = false): React.CSSProperties {
  return {
    padding: '3px 9px', borderRadius: 20,
    fontSize: 11, fontWeight: 700, fontFamily: 'var(--font-mono)',
    cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
    border: filled ? 'none' : `1.5px solid ${color}`,
    background: filled ? color + '22' : 'transparent',
    color: color,
  };
}

// ─── Popup content ───────────────────────────────────────────────────────────

function RatingPopup({ r, onRemove }: { r: Rating; onRemove: () => void }) {
  const avg = avgScore(r);
  return (
    <div style={{ minWidth: 180, maxWidth: 240 }}>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--ink-4)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 3 }}>
        {{ sted: 'Besøkt sted', steder: 'Besøkt sted', opplevelse: 'Opplevelse', opplevelser: 'Opplevelse', gym: 'Gym', restaurant: 'Restaurant', restauranter: 'Restaurant' }[r.cat] ?? r.cat}
      </div>
      <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 6 }}>{r.title}</div>
      {avg != null && (
        <div style={{ fontSize: 20, fontWeight: 300, color: scoreColor(avg), marginBottom: 4 }}>
          {avg % 1 === 0 ? avg : avg.toFixed(1)}
          <span style={{ fontSize: 10, color: 'var(--ink-4)', marginLeft: 3 }}>/ 10</span>
        </div>
      )}
      {r.score_m != null && (
        <div style={{ fontSize: 12, color: 'var(--ink-3)', marginBottom: 2 }}>
          Mikkel: <strong>{r.score_m}</strong>
          {r.comment_m && <span style={{ fontStyle: 'italic' }}> — «{r.comment_m}»</span>}
        </div>
      )}
      {r.score_l != null && (
        <div style={{ fontSize: 12, color: 'var(--ink-3)', marginBottom: 6 }}>
          Leah: <strong>{r.score_l}</strong>
          {r.comment_l && <span style={{ fontStyle: 'italic' }}> — «{r.comment_l}»</span>}
        </div>
      )}
      <button
        onClick={onRemove}
        style={{ fontSize: 11, color: 'var(--muted)', background: 'transparent', border: 0, padding: 0, cursor: 'pointer', marginTop: 2 }}
      >
        Fjern fra kart
      </button>
    </div>
  );
}

function BucketPopup({ b, onRemove }: { b: BucketEntry; onRemove: () => void }) {
  return (
    <div style={{ minWidth: 180, maxWidth: 240 }}>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--ink-4)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 3 }}>
        {b.done ? 'Gjort!' : 'Vil gjøre'}
      </div>
      <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>{b.title}</div>
      {b.description && (
        <div style={{ fontSize: 12, color: 'var(--ink-3)', marginBottom: 6 }}>{b.description}</div>
      )}
      {b.category && (
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--ink-4)', marginBottom: 6 }}>{b.category}</div>
      )}
      <button
        onClick={onRemove}
        style={{ fontSize: 11, color: 'var(--muted)', background: 'transparent', border: 0, padding: 0, cursor: 'pointer', marginTop: 2 }}
      >
        Fjern fra kart
      </button>
    </div>
  );
}

// ─── Legend ──────────────────────────────────────────────────────────────────

function Legend() {
  return (
    <div style={{
      ...MAP_CONTROL,
      position: 'absolute', bottom: 12, left: 12, zIndex: 1000,
      padding: '11px 14px',
      display: 'flex', flexDirection: 'column', gap: 7,
    }}>
      <div style={{
        fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 700,
        letterSpacing: '0.08em', textTransform: 'uppercase',
        color: CTRL_INK_DIM, marginBottom: 1,
      }}>
        Tegnforklaring
      </div>
      <LegendRow color="#3A7D44" label="Vurdert 9–10" />
      <LegendRow color="#5FA37B" label="Vurdert 7–8" />
      <LegendRow color="#C9963A" label="Vurdert 5–6" />
      <LegendRow color="#D95F5F" label="Vurdert under 5" />
      <LegendRow color="#3B6FBC" label="Vil besøke" marker="★" />
    </div>
  );
}

function LegendRow({ color, label, marker }: { color: string; label: string; marker?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{
        width: 16, height: 16, borderRadius: '50%', background: color, color: '#fff',
        fontSize: 8, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center',
        border: '2px solid rgba(255,255,255,0.7)', flexShrink: 0,
      }}>
        {marker ?? ''}
      </div>
      <span style={{ fontSize: 11, color: CTRL_INK, whiteSpace: 'nowrap' }}>{label}</span>
    </div>
  );
}

function LayerToggle({ active, color, label, count, marker, onClick }: {
  active: boolean; color: string; label: string; count: number; marker?: string; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 7,
        padding: '7px 13px', borderRadius: 20, fontSize: 11, fontWeight: 700,
        fontFamily: 'var(--font-mono)', letterSpacing: '0.04em',
        cursor: 'pointer', transition: 'all 0.15s',
        backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)',
        boxShadow: '0 4px 18px rgba(0,0,0,0.14)',
        background: active ? color : 'rgba(255,255,255,0.92)',
        color: active ? '#fff' : CTRL_INK_DIM,
        border: active ? `1px solid ${color}` : '1px solid rgba(0,0,0,0.07)',
      }}
    >
      <span style={{
        width: 16, height: 16, borderRadius: '50%', flexShrink: 0,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 9, fontWeight: 800,
        background: active ? 'rgba(255,255,255,0.25)' : color,
        color: '#fff',
        border: active ? '1.5px solid rgba(255,255,255,0.7)' : 'none',
      }}>{marker ?? ''}</span>
      {label}
      <span style={{ opacity: active ? 0.85 : 0.6, fontWeight: 800 }}>{count}</span>
    </button>
  );
}

// ─── Main page ───────────────────────────────────────────────────────────────

type TabKey = 'besøkt' | 'vil-besøke' | 'ikke-plassert';

export default function Kart() {
  const { ratings, loading: ratingsLoading } = useRatings();
  const { items: bucketItems, loading: bucketsLoading } = useBucket();
  const { pins, loading: pinsLoading, setPin, removePin, getPin, dismissedBuckets, dismissBucket, restoreBucket } = useMapPins();

  const [tab, setTab] = useState<TabKey>('ikke-plassert');
  const [placingFor, setPlacingFor] = useState<PlacingFor>(null);
  const placingForRef = useRef<PlacingFor>(null);
  placingForRef.current = placingFor;
  const [activeItem, setActiveItem] = useState<ActiveItem>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768);
  const [activeCats, setActiveCats]           = useState<Set<string>>(() => new Set(RATING_CAT_FILTERS.map(c => c.key)));
  const [showWantToVisit, setShowWantToVisit] = useState(true);
  const mapRef = useRef<L.Map | null>(null);

  useEffect(() => {
    const update = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  // Ratings with location-relevant categories
  // Rating categories that represent physical places you can pin on the map.
  // Both singular and plural spellings are accepted so user-created categories match.
  const MAP_CATS = new Set(['sted', 'steder', 'opplevelse', 'opplevelser', 'gym', 'restaurant', 'restauranter']);
  const stedRatings = ratings.filter(r => MAP_CATS.has(r.cat));

  // Build lookup sets for fast orphan detection
  const ratingIds = new Set(stedRatings.map(r => r.id));

  // Auto-clean orphaned pins — only after ALL data sources have finished loading.
  // Also removes pins for bucket items that have been checked off (done = true).
  useEffect(() => {
    if (pinsLoading || ratingsLoading || bucketsLoading) return;
    for (const pin of pins) {
      if (pin.sourceType === 'rating' && !ratingIds.has(pin.sourceId)) {
        void removePin('rating', pin.sourceId);
      }
      if (pin.sourceType === 'bucket') {
        const bucket = bucketItems.find(b => b.id === pin.sourceId);
        if (!bucket || bucket.done) void removePin('bucket', pin.sourceId);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pins, ratings, bucketItems, pinsLoading, ratingsLoading, bucketsLoading]);

  const pinnedRatings       = stedRatings.filter(r => getPin('rating', r.id));
  const pinnedActiveBuckets = bucketItems.filter(b => !b.done && getPin('bucket', b.id));
  const unpinnedRatings     = stedRatings.filter(r => !getPin('rating', r.id));
  const unpinnedBuckets     = bucketItems.filter(b => !b.done && !getPin('bucket', b.id) && !dismissedBuckets.has(b.id));
  const hiddenBuckets       = bucketItems.filter(b => !b.done && !getPin('bucket', b.id) && dismissedBuckets.has(b.id));

  // Pinned-rating counts per canonical category — drives which filter pills show
  const catCounts: Record<string, number> = {};
  for (const r of pinnedRatings) { const c = canonCat(r.cat); catCounts[c] = (catCounts[c] ?? 0) + 1; }

  const handlePick = useCallback(async (lat: number, lng: number) => {
    const pf = placingForRef.current;
    if (!pf) return;
    setPlacingFor(null);
    setTab(pf.type === 'rating' ? 'besøkt' : 'vil-besøke');
    await setPin(pf.type, pf.id, lat, lng);
  }, [setPin]);

  const flyTo = useCallback((lat: number, lng: number) => {
    mapRef.current?.flyTo([lat, lng], 12, { duration: 1.2 });
    if (isMobile) setSheetOpen(false);
  }, [isMobile]);

  const handleSelectRating = (r: Rating) => {
    const pin = getPin('rating', r.id);
    if (pin) { flyTo(pin.lat, pin.lng); setActiveItem({ kind: 'rating', item: r }); }
  };
  const handleSelectBucket = (b: BucketEntry) => {
    const pin = getPin('bucket', b.id);
    if (pin) { flyTo(pin.lat, pin.lng); setActiveItem({ kind: 'bucket', item: b }); }
  };

  const tabCounts: Record<TabKey, number> = {
    'besøkt': pinnedRatings.length,
    'vil-besøke': pinnedActiveBuckets.length,
    'ikke-plassert': unpinnedRatings.length + unpinnedBuckets.length,
  };

  const tabLabels: Record<TabKey, string> = {
    'besøkt': 'Besøkt',
    'vil-besøke': 'Vil besøke',
    'ikke-plassert': 'Ikke plassert',
  };

  // ── Panel content ──
  const PanelContent = placingFor ? (
    <InlineGeoSearch
      initialQuery={placingFor.title}
      onPick={handlePick}
      onClose={() => setPlacingFor(null)}
    />
  ) : (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--line)', flexShrink: 0 }}>
        {(['besøkt', 'vil-besøke', 'ikke-plassert'] as TabKey[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              flex: 1, padding: '11px 4px', fontSize: 11, fontWeight: 700,
              fontFamily: 'var(--font-mono)', letterSpacing: '0.04em',
              background: 'transparent', border: 0, cursor: 'pointer',
              color: tab === t ? 'var(--accent)' : 'var(--ink-4)',
              borderBottom: tab === t ? '2px solid var(--accent)' : '2px solid transparent',
              marginBottom: -1, position: 'relative',
            }}
          >
            {tabLabels[t]}
            {tabCounts[t] > 0 && (
              <span style={{
                marginLeft: 4, background: tab === t ? 'var(--accent)' : 'var(--line-2)',
                color: tab === t ? '#fff' : 'var(--ink-3)',
                borderRadius: 10, fontSize: 9, padding: '1px 5px', fontWeight: 800,
              }}>
                {tabCounts[t]}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* List */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 12px 20px' }}>
        {tab === 'besøkt' && (
          pinnedRatings.length === 0
            ? <Empty text="Ingen besøkte steder på kartet ennå." sub="Plasser steder fra Ratinger via «Ikke plassert»." />
            : <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {pinnedRatings.map(r => (
                  <RatingRow key={r.id} r={r} pinned onPlace={() => {}} onSelect={() => handleSelectRating(r)} />
                ))}
              </div>
        )}

        {tab === 'vil-besøke' && (
          pinnedActiveBuckets.length === 0
            ? <Empty text="Ingen steder markert ennå." sub="Plasser bucket list-punkter på kartet fra «Ikke plassert»." />
            : <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {pinnedActiveBuckets.map(b => (
                  <BucketRow key={b.id} b={b} pinned onPlace={() => {}} onSelect={() => handleSelectBucket(b)} />
                ))}
              </div>
        )}

        {tab === 'ikke-plassert' && (
          unpinnedRatings.length === 0 && unpinnedBuckets.length === 0
            ? <Empty text="Alle steder er plassert på kartet! 🗺️" />
            : <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {unpinnedRatings.length > 0 && (
                  <>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--ink-4)', textTransform: 'uppercase', letterSpacing: '0.06em', padding: '4px 0 2px' }}>
                      Vurderte steder
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {unpinnedRatings.map(r => (
                        <RatingRow
                          key={r.id} r={r} pinned={false}
                          onPlace={() => { setPlacingFor({ type: 'rating', id: r.id, title: r.title }); if (isMobile) setSheetOpen(true); }}
                          onSelect={() => {}}
                        />
                      ))}
                    </div>
                  </>
                )}
                {unpinnedBuckets.length > 0 && (
                  <>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--ink-4)', textTransform: 'uppercase', letterSpacing: '0.06em', padding: '4px 0 2px' }}>
                      Vil gjøre
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {unpinnedBuckets.map(b => (
                        <BucketRow
                          key={b.id} b={b} pinned={false}
                          onPlace={() => { setPlacingFor({ type: 'bucket', id: b.id, title: b.title }); if (isMobile) setSheetOpen(true); }}
                          onSelect={() => {}}
                          onDismiss={() => dismissBucket(b.id)}
                        />
                      ))}
                    </div>
                    {hiddenBuckets.length > 0 && (
                      <details style={{ marginTop: 8 }}>
                        <summary style={{
                          fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--ink-4)',
                          textTransform: 'uppercase', letterSpacing: '0.06em',
                          cursor: 'pointer', padding: '4px 0', listStyle: 'none',
                        }}>
                          {hiddenBuckets.length} skjult{hiddenBuckets.length !== 1 ? 'e' : ''}
                        </summary>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
                          {hiddenBuckets.map(b => (
                            <div key={b.id} style={{
                              display: 'flex', alignItems: 'center', gap: 10,
                              padding: '8px 12px', borderRadius: 8,
                              background: 'var(--bg)', border: '1px solid var(--line)',
                              opacity: 0.6,
                            }}>
                              <div style={{ flex: 1, fontSize: 13, color: 'var(--ink-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {b.title}
                              </div>
                              <button
                                onClick={() => restoreBucket(b.id)}
                                style={pillStyle('var(--ink-3)')}
                              >Gjenopprett</button>
                            </div>
                          ))}
                        </div>
                      </details>
                    )}
                  </>
                )}
              </div>
        )}
      </div>
    </div>
  );

  const placedCount    = pinnedRatings.length + pinnedActiveBuckets.length;
  const remainingCount = unpinnedRatings.length + unpinnedBuckets.length;

  return (
    <div style={{ position: 'relative', height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

        {/* Desktop sidebar */}
        {!isMobile && (
          <div style={{
            width: 312, flexShrink: 0,
            borderRight: '1px solid var(--line)',
            background: 'var(--surface)',
            display: 'flex', flexDirection: 'column',
            overflow: 'hidden',
          }}>
            {!placingFor && (
              <div style={{ padding: '16px 16px 14px', borderBottom: '1px solid var(--line)', flexShrink: 0 }}>
                <div className="page-sub" style={{ marginTop: 0 }}>Oversikt</div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 6 }}>
                  <span style={{ fontSize: 24, fontWeight: 600, letterSpacing: '-0.02em', lineHeight: 1 }}>{placedCount}</span>
                  <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>på kartet</span>
                  {remainingCount > 0 && (
                    <span style={{ fontSize: 12, color: 'var(--ink-4)', marginLeft: 'auto', fontFamily: 'var(--font-mono)' }}>
                      {remainingCount} gjenstår
                    </span>
                  )}
                </div>
              </div>
            )}
            {PanelContent}
          </div>
        )}

        {/* Map */}
        <div style={{ flex: 1, position: 'relative' }}>
          <MapContainer
            center={[65.0, 15.0]}
            zoom={5}
            style={{ width: '100%', height: '100%' }}
            zoomControl={false}
            ref={mapRef}
          >
            <TileLayer
              url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/">CARTO</a>'
              maxZoom={19}
            />

            {placingFor && (
              <MapClickCapture onClick={handlePick} />
            )}

            {/* Rating markers */}
            {pinnedRatings.filter(r => activeCats.has(canonCat(r.cat))).map(r => {
              const pin = getPin('rating', r.id)!;
              const isActive = activeItem?.kind === 'rating' && activeItem.item.id === r.id;
              return (
                <Marker key={r.id} position={[pin.lat, pin.lng]} icon={ratingIcon(r, isActive)}>
                  <Popup eventHandlers={{ remove: () => setActiveItem(null) }}>
                    <RatingPopup r={r} onRemove={async () => { await removePin('rating', r.id); setActiveItem(null); }} />
                  </Popup>
                </Marker>
              );
            })}

            {/* Bucket markers — want to visit */}
            {showWantToVisit && pinnedActiveBuckets.map(b => {
              const pin = getPin('bucket', b.id)!;
              const isActive = activeItem?.kind === 'bucket' && activeItem.item.id === b.id;
              return (
                <Marker key={b.id} position={[pin.lat, pin.lng]} icon={bucketIcon(false, isActive)}>
                  <Popup eventHandlers={{ remove: () => setActiveItem(null) }}>
                    <BucketPopup b={b} onRemove={async () => { await removePin('bucket', b.id); setActiveItem(null); }} />
                  </Popup>
                </Marker>
              );
            })}
          </MapContainer>

          {/* Layer filter toggles — keep clear of the zoom control (top-right) so pills never overlap it */}
          <div style={{
            position: 'absolute', top: 12, left: 12, right: 60, zIndex: 1000,
            display: 'flex', gap: 8, flexWrap: 'wrap',
          }}>
            {RATING_CAT_FILTERS.filter(c => (catCounts[c.key] ?? 0) > 0).map(c => (
              <LayerToggle
                key={c.key}
                active={activeCats.has(c.key)} color={c.color} label={c.label}
                count={catCounts[c.key]}
                onClick={() => setActiveCats(prev => {
                  const next = new Set(prev);
                  next.has(c.key) ? next.delete(c.key) : next.add(c.key);
                  return next;
                })}
              />
            ))}
            <LayerToggle
              active={showWantToVisit} color="#3B6FBC" label="Vil besøke" marker="★"
              count={pinnedActiveBuckets.length} onClick={() => setShowWantToVisit(v => !v)}
            />
          </div>

          {/* Zoom control */}
          <div style={{
            ...MAP_CONTROL,
            position: 'absolute', top: 12, right: 12, zIndex: 1000,
            display: 'flex', flexDirection: 'column', overflow: 'hidden', padding: 0,
          }}>
            {([['+', () => mapRef.current?.zoomIn()], ['−', () => mapRef.current?.zoomOut()]] as const).map(([sym, fn], i) => (
              <button
                key={sym}
                onClick={fn}
                aria-label={sym === '+' ? 'Zoom inn' : 'Zoom ut'}
                style={{
                  width: 36, height: 36, border: 0, background: 'transparent',
                  cursor: 'pointer', fontSize: 18, lineHeight: 1, color: CTRL_INK,
                  borderTop: i === 1 ? '1px solid rgba(0,0,0,0.08)' : 'none',
                  display: 'grid', placeItems: 'center', fontWeight: 600,
                }}
              >{sym}</button>
            ))}
          </div>

          {!isMobile && <Legend />}
        </div>
      </div>

      {/* Mobile bottom sheet */}
      {isMobile && (
        <div style={{
          position: 'absolute', bottom: 0, left: 0, right: 0,
          zIndex: 900,
          background: 'var(--surface)',
          borderRadius: '16px 16px 0 0',
          boxShadow: '0 -4px 24px rgba(0,0,0,0.15)',
          maxHeight: sheetOpen ? '70vh' : 52,
          transition: 'max-height 0.28s cubic-bezier(0.4,0,0.2,1)',
          overflow: 'hidden',
          display: 'flex', flexDirection: 'column',
        }}>
          {/* Handle */}
          <div
            style={{ padding: '10px 0 6px', display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0, cursor: 'pointer' }}
            onClick={() => setSheetOpen(o => !o)}
          >
            <div style={{ width: 36, height: 4, borderRadius: 2, background: 'var(--line-2)' }} />
            {!sheetOpen && (
              <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 4, fontFamily: 'var(--font-mono)' }}>
                {unpinnedRatings.length + unpinnedBuckets.length > 0
                  ? `${pinnedRatings.length + pinnedActiveBuckets.length} plassert · ${unpinnedRatings.length + unpinnedBuckets.length} gjenstår`
                  : `${pinnedRatings.length + pinnedActiveBuckets.length} steder på kartet`
                }
              </div>
            )}
          </div>
          <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            {PanelContent}
          </div>
        </div>
      )}

    </div>
  );
}

function Empty({ text, sub }: { text: string; sub?: string }) {
  return (
    <div style={{ padding: '24px 8px', textAlign: 'center' }}>
      <div style={{ fontSize: 13, color: 'var(--ink-3)' }}>{text}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 6 }}>{sub}</div>}
    </div>
  );
}
