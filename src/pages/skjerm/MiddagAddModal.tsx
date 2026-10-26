import { useEffect, useMemo, useRef, useState } from 'react';
import type React from 'react';
import { useMatplan, type Recipe } from '../../contexts/MatplanContext';
import { useSnackbar } from '../../contexts/SnackbarContext';
import { dateLabel } from '../../lib/dayLabel';
import { lastCookedByRecipe, lastCookedLabel, recentRecipeIds, searchRecipes } from '../../lib/middagVelger';
import { longDayLabel, maxMealDays, mostUsedRecipeIds } from '../../lib/middagLeggTil';
import MissingDataTags from '../middag/MissingDataTags';
import { ScreenPopup } from './ScreenPopup';

// Antall treff som vises under søk, så listen ikke blir en lang rulleliste på iPad.
const MAX_RESULTS = 8;

// Gangskjermens popup-kort er alltid mørkt (.card.dark), uansett tema — derfor faste
// lys-på-mørk-farger her, som i oppskrift-modalen. Tekstfeltet bruker .input, som får
// riktig tekstfarge av .skjerm-popup (styles.css).
const MUTED = 'rgba(207,224,239,0.5)';
const pill: React.CSSProperties = {
  background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 999,
  color: '#E8EFF7', cursor: 'pointer', fontFamily: 'var(--font-sans)', fontSize: 14, padding: '8px 14px', minHeight: 40,
};

interface Props {
  /** Dagen kortet viste da det ble trykket på (aldri en dag med middag). */
  date: string;
  /** Samme «i dag» som resten av Gangskjerm. */
  today: string;
  isMobile: boolean;
  onClose: () => void;
}

// «Legg til middag» på en ledig dag. Kun tillegg: dager med middag kan aldri velges
// eller overskrives herfra (maks-antallet stopper før første opptatte dag, og
// addMealDays bruker INSERT mot unik dato).
export function MiddagAddModal({ date, today, isMobile, onClose }: Props) {
  const { recipes, mealPlan, addMealDays } = useMatplan();
  const { notify } = useSnackbar();
  const [days, setDays] = useState(1);
  const [query, setQuery] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Ikke autofokus på touch — tastaturet ville dekket «Nylig brukt» før man har sett den
  // (samme mønster som RecipePicker).
  useEffect(() => {
    if (window.matchMedia('(pointer: fine)').matches) inputRef.current?.focus();
  }, []);

  const limit = useMemo(() => maxMealDays(mealPlan, date, today), [mealPlan, date, today]);
  // mealPlan oppdateres live (realtime): krymper rekken, klemmes valget med den.
  const effDays = Math.max(1, Math.min(days, limit.max));
  const blocked = limit.max === 0;

  const byId = useMemo(() => new Map(recipes.map(r => [r.id, r])), [recipes]);
  const recent = useMemo(() => recentRecipeIds(mealPlan, today), [mealPlan, today]);
  const most = useMemo(() => mostUsedRecipeIds(mealPlan, today, 6, recent), [mealPlan, today, recent]);
  const lastCooked = useMemo(() => lastCookedByRecipe(mealPlan, today), [mealPlan, today]);
  const results = useMemo(() => searchRecipes(recipes, query), [recipes, query]);
  const shown = showAll ? results : results.slice(0, MAX_RESULTS);
  const toRecipes = (ids: string[]) => ids.map(id => byId.get(id)).filter((r): r is Recipe => !!r);

  const pick = async (recipeId: string) => {
    if (saving || blocked) return;
    setSaving(true);
    setNotice(null);
    try {
      const res = await addMealDays(date, recipeId, effDays);
      if (res.ok) {
        const name = byId.get(recipeId)?.name ?? 'Middag';
        notify(`«${name}» lagt til ${effDays > 1 ? `i ${effDays} dager fra ` : ''}${dateLabel(date)}`);
        onClose();
      } else if (res.reason === 'taken') {
        setNotice('Noen rakk det først — en av dagene har fått middag. Velg på nytt.');
      } else {
        setNotice('Kunne ikke lagre middagen. Prøv igjen.');
      }
    } finally { setSaving(false); }
  };

  const section = (label: string, list: Recipe[]) => list.length > 0 && (
    <div>
      <div className="card-eyebrow" style={{ marginBottom: 8 }}>{label}</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {list.map(r => (
          <button key={r.id} onClick={() => void pick(r.id)} disabled={saving || blocked} style={{ ...pill, opacity: saving ? 0.5 : 1 }}>
            {r.name}
            <MissingDataTags recipe={r} only={['ingredients']} compact />
          </button>
        ))}
      </div>
    </div>
  );

  const stepBtn = (label: string, aria: string, disabled: boolean, onClick: () => void) => (
    <button onClick={onClick} disabled={disabled} aria-label={aria}
      style={{ ...pill, width: 44, minHeight: 44, padding: 0, fontSize: 20, opacity: disabled ? 0.35 : 1, cursor: disabled ? 'default' : 'pointer' }}>
      {label}
    </button>
  );

  return (
    <ScreenPopup eyebrowText="Middag" title={`Middag · ${longDayLabel(date)}`} onClose={onClose} width={520} isMobile={isMobile}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18, marginTop: 20 }}>
        {blocked ? (
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: MUTED }}>
            Denne dagen har allerede middag.
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <div className="card-eyebrow">Antall dager</div>
            {stepBtn('−', 'Færre dager', effDays <= 1 || saving, () => setDays(Math.max(1, effDays - 1)))}
            <div style={{ minWidth: 24, textAlign: 'center', fontSize: 18, color: '#E8EFF7' }}>{effDays}</div>
            {stepBtn('+', 'Flere dager', effDays >= limit.max || saving, () => setDays(effDays + 1))}
            {effDays >= limit.max && (
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: MUTED }}>
                maks {limit.max} {limit.max === 1 ? 'dag' : 'dager'}
                {limit.blockedBy && ` (${dateLabel(limit.blockedBy)} er opptatt)`}
              </div>
            )}
          </div>
        )}

        {notice && <div role="status" style={{ fontSize: 13, color: '#C9963A' }}>{notice}</div>}

        {!blocked && (
          <>
            <input ref={inputRef} className="input" value={query}
              onChange={e => { setQuery(e.target.value); setShowAll(false); }}
              onKeyDown={e => { if (e.key === 'Enter' && shown[0]) { e.preventDefault(); void pick(shown[0].id); } }}
              placeholder="Søk på navn, ingrediens eller tag"
              style={{ fontSize: 16, padding: '12px 14px' }} />

            {!query ? (
              <>
                {section('Nylig brukt', toRecipes(recent))}
                {section('Mest brukt', toRecipes(most))}
                {recipes.length === 0 && (
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: MUTED }}>
                    Ingen oppskrifter ennå — legg dem til under Middag → Oppskrifter.
                  </div>
                )}
                {recipes.length > 0 && recent.length === 0 && (
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: MUTED }}>Søk etter en oppskrift for å velge.</div>
                )}
              </>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {shown.map(r => (
                  <button key={r.id} onClick={() => void pick(r.id)} disabled={saving} style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
                    padding: '10px 8px', minHeight: 44, textAlign: 'left', cursor: 'pointer',
                    background: 'transparent', border: 'none', borderBottom: '1px solid rgba(255,255,255,0.06)',
                    color: '#E8EFF7', fontFamily: 'var(--font-sans)', fontSize: 15, opacity: saving ? 0.5 : 1,
                  }}>
                    <span style={{ minWidth: 0 }}>
                      {r.name}
                      <MissingDataTags recipe={r} only={['ingredients']} compact />
                    </span>
                    <span style={{ flexShrink: 0, fontFamily: 'var(--font-mono)', fontSize: 11, color: MUTED }}>
                      {lastCookedLabel(lastCooked.get(r.id), today)}
                    </span>
                  </button>
                ))}
                {shown.length === 0 && (
                  <div style={{ padding: '10px 8px', fontFamily: 'var(--font-mono)', fontSize: 12, color: MUTED }}>
                    Ingen oppskrifter matcher «{query}»
                  </div>
                )}
                {results.length > MAX_RESULTS && (
                  <button onClick={() => setShowAll(s => !s)} style={{ ...pill, alignSelf: 'flex-start', marginTop: 8, fontSize: 13 }}>
                    {showAll ? 'Vis færre' : `Se alle (${results.length})`}
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </ScreenPopup>
  );
}
