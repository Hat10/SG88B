import { useEffect, useMemo, useRef, useState } from 'react';
import type { Recipe } from '../../contexts/MatplanContext';
import { searchRecipes, lastCookedLabel } from '../../lib/middagVelger';

// Antall treff som vises før «Se alle oppskrifter» — så panelet ikke starter
// som en ny lang alfabetisk liste, men hele listen er ett trykk unna.
const MAX_RESULTS = 8;

interface Props {
  recipes: Recipe[];
  selectedId: string | null;
  recentIds: string[];
  lastCooked: Map<string, string>;
  today: string;
  /** Vises kun når dagen har en middag og det finnes en dag etter. */
  canRepeat: boolean;
  onPick: (recipeId: string) => void;
  onRepeat: () => void;
  onClear: () => void;
  onClose: () => void;
}

export default function RecipePicker({
  recipes, selectedId, recentIds, lastCooked, today, canRepeat, onPick, onRepeat, onClear, onClose,
}: Props) {
  const [query, setQuery] = useState('');
  const [showAll, setShowAll] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Fokus kun på enheter med ekte pekere — på mobil ville autofokus åpne
  // tastaturet før man i det hele tatt har sett «Nylig brukt».
  useEffect(() => {
    if (window.matchMedia('(pointer: fine)').matches) inputRef.current?.focus();
  }, []);

  const results = useMemo(() => searchRecipes(recipes, query), [recipes, query]);
  const shown = showAll ? results : results.slice(0, MAX_RESULTS);
  const byId = useMemo(() => new Map(recipes.map(r => [r.id, r])), [recipes]);
  const recent = recentIds.map(id => byId.get(id)).filter((r): r is Recipe => !!r);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && shown[0]) { e.preventDefault(); onPick(shown[0].id); }
    else if (e.key === 'Escape') onClose();
  };

  return (
    <div style={{
      marginTop: -2, padding: 12, display: 'flex', flexDirection: 'column', gap: 10,
      background: 'var(--surface-2)', border: '1px solid var(--ink)', borderTop: 'none',
      borderRadius: '0 0 6px 6px',
    }}>
      <input ref={inputRef} className="input" value={query} onChange={e => setQuery(e.target.value)}
        onKeyDown={onKeyDown} placeholder="Søk på navn, ingrediens eller tag"
        style={{ width: '100%' }} />

      {!query && recent.length > 0 && (
        <div>
          <div className="card-eyebrow" style={{ marginBottom: 6 }}>Nylig brukt</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {recent.map(r => (
              <button key={r.id} onClick={() => onPick(r.id)} className="btn sm"
                style={{ borderRadius: 999, fontWeight: r.id === selectedId ? 600 : undefined }}>
                {r.name}
              </button>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {!query && <div className="card-eyebrow" style={{ marginBottom: 4 }}>Alle oppskrifter</div>}
        {shown.map(r => (
          <button key={r.id} onClick={() => onPick(r.id)} style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
            padding: '9px 8px', minHeight: 40, textAlign: 'left', cursor: 'pointer',
            background: r.id === selectedId ? 'var(--chip)' : 'transparent',
            border: 'none', borderRadius: 5, color: 'var(--ink)', fontFamily: 'var(--font-sans)', fontSize: 13.5,
          }}>
            <span style={{ minWidth: 0 }}>
              {r.name}
              {r.cookTimeMinutes != null && <span style={{ color: 'var(--ink-4)', fontSize: 12 }}> · {r.cookTimeMinutes} min</span>}
            </span>
            <span style={{ flexShrink: 0, fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--ink-4)' }}>
              {lastCookedLabel(lastCooked.get(r.id), today)}
            </span>
          </button>
        ))}
        {shown.length === 0 && (
          <div style={{ padding: '10px 8px', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-4)' }}>
            Ingen oppskrifter matcher «{query}»
          </div>
        )}
        {results.length > MAX_RESULTS && (
          <button onClick={() => setShowAll(s => !s)} className="btn ghost sm" style={{ alignSelf: 'flex-start', marginTop: 4 }}>
            {showAll ? 'Vis færre' : `Se alle oppskrifter (${results.length})`}
          </button>
        )}
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', borderTop: '1px solid var(--line)', paddingTop: 10 }}>
        {canRepeat && (
          <button onClick={onRepeat} className="btn sm" title="Samme middag dagen etter (rester). Handlelisten teller begge dagene.">
            + 1 dag til (rester)
          </button>
        )}
        {selectedId && <button onClick={onClear} className="btn danger sm">Fjern middag</button>}
        <button onClick={onClose} className="btn ghost sm" style={{ marginLeft: 'auto' }}>Lukk</button>
      </div>
    </div>
  );
}
