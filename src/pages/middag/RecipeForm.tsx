import { useState, useEffect, useRef, type KeyboardEvent } from 'react';
import { useMatplan, type Recipe, type Ingredient } from '../../contexts/MatplanContext';
import { tagSuggestions, applyTagSuggestion } from '../../lib/middagVelger';
import { formatIngredientAmount } from '../../lib/dagensMiddag';
import SortableList from '../../SortableList';
import UnitSelect from './UnitSelect';

// Skjema for ny/redigert oppskrift — flyttet ut av OppskrifterTab.tsx da
// skjemaet gikk fra alltid synlig til å åpnes ved «+ Ny» / «Rediger».

// Ingredienser lagres som en JSON-array (recipes.ingredients) — rekkefølgen i
// arrayen ER rekkefølgen, så omsortering er bare å endre rekkefølgen i
// draften; den lagres med «Lagre endring» som alt annet i skjemaet.
//
// _key er en stabil, rent lokal id per linje (strippes før lagring). Den
// trengs av dra-og-slipp, og som React-key så IngredientRow sin lokale
// amountText-state følger med linjen når den flyttes (key={index} ville latt
// teksten bli stående igjen på gammel plass).
type DraftIngredient = Ingredient & { _key: string };

let ingredientKeySeq = 0;
const withKey = (ing: Ingredient): DraftIngredient => ({ ...ing, _key: `ing-${++ingredientKeySeq}` });
const emptyIngredient = (): DraftIngredient => withKey({ name: '', amount: null, unit: null, amountRange: null });

// Tolker det som faktisk står i Mengde-feltet: en bindestrek ⇒ intervall
// (f.eks. "0,5-1" for salt i teskjeer, normalisert til "0.5-1"), ellers et
// vanlig tall. Delt mellom onChange og synk-effekten under så de to aldri
// kan tolke samme tekst ulikt.
function deriveAmount(text: string): Pick<Ingredient, 'amount' | 'amountRange'> {
  const normalized = text.trim().replace(/,/g, '.');
  if (normalized.includes('-')) return { amount: null, amountRange: normalized || null };
  const parsed = normalized ? Number(normalized) : null;
  return { amount: parsed != null && Number.isFinite(parsed) ? parsed : null, amountRange: null };
}

function IngredientRow({ ing, stapleNames, onChange, onRemove, onEnter, autoFocus, onAutoFocused }: {
  ing: Ingredient; stapleNames: Set<string>; onChange: (patch: Partial<Ingredient>) => void; onRemove: () => void;
  /** Satt bare for siste linje: Enter der lager en ny, tom linje. */
  onEnter?: () => void;
  /** Sett fokus i navnefeltet ved montering (ny linje via Enter / «+ Legg til»). */
  autoFocus?: boolean;
  onAutoFocused?: () => void;
}) {
  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!autoFocus) return;
    nameRef.current?.focus();
    onAutoFocused?.();
  }, [autoFocus]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter' || !onEnter || e.nativeEvent.isComposing) return;
    e.preventDefault();
    onEnter();
  };

  // Matcher navnet en basisvare (Dagligvarer → Basisvarer)? Da er det trolig
  // noe man vanligvis har hjemme — vis avkrysning for å ta den med likevel,
  // i stedet for å anta den skal på handlelisten som alle andre ingredienser.
  const isStaple = stapleNames.has(ing.name.trim().toLowerCase());

  // Egen tekst-representasjon av Mengde, atskilt fra ing.amount/amountRange.
  // En rent kontrollert input bundet direkte til den tolkede verdien gjør
  // det umulig å skrive desimaltall eller intervaller: skriver man "1" og
  // så ".", blir "1." tolket som tallet 1 med det samme, det etterrenderte
  // input-feltet viser "1" igjen, og punktumet man nettopp skrev forsvinner
  // før man rekker å skrive sifferet etter (samme problem for "0.5" foran
  // en bindestrek i et intervall). Ved å holde det man faktisk skriver i
  // egen state, og bare synkronisere tilbake fra ing når verdien der har
  // endret seg av en ANNEN grunn enn vår egen onChange (f.eks. bytte til en
  // annen oppskrift, eller «Avbryt»), unngår vi at mellomstadier blir
  // overskrevet mens man skriver.
  const [amountText, setAmountText] = useState(() => ing.amountRange ?? (ing.amount == null ? '' : String(ing.amount)));
  useEffect(() => {
    const derived = deriveAmount(amountText);
    if (derived.amount !== ing.amount || derived.amountRange !== (ing.amountRange ?? null)) {
      setAmountText(ing.amountRange ?? (ing.amount == null ? '' : String(ing.amount)));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ing.amount, ing.amountRange]);

  const handleAmountChange = (text: string) => {
    setAmountText(text);
    onChange(deriveAmount(text));
  };

  return (
    <div style={{ marginBottom: 6 }}>
      <div style={{ display: 'flex', gap: 6 }}>
        <input ref={nameRef} className="input" placeholder="Ingrediens" value={ing.name}
          onChange={e => onChange({ name: e.target.value })} onKeyDown={handleKeyDown}
          enterKeyHint={onEnter ? 'next' : undefined} style={{ flex: 3, minWidth: 0 }} />
        <input className="input" placeholder="Mengde, f.eks. 0,5-1" inputMode="text" value={amountText}
          onChange={e => handleAmountChange(e.target.value)} onKeyDown={handleKeyDown}
          enterKeyHint={onEnter ? 'next' : undefined}
          style={{ flex: 1, fontVariantNumeric: 'tabular-nums' }} />
        <UnitSelect value={ing.unit ?? ''} onChange={unit => onChange({ unit: unit || null })} style={{ flex: 1 }} />
        <button onClick={onRemove} aria-label="Fjern ingrediens" style={{
          background: 'transparent', border: '1px solid var(--line)', borderRadius: 6,
          cursor: 'pointer', fontSize: 15, color: 'var(--ink-4)', flexShrink: 0,
          minWidth: 36, minHeight: 36, display: 'grid', placeItems: 'center',
        }}>×</button>
      </div>
      {isStaple && (
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4, fontSize: 12, color: 'var(--ink-4)', cursor: 'pointer' }}>
          <input type="checkbox" checked={ing.onGroceryList === true}
            onChange={e => onChange({ onGroceryList: e.target.checked })} />
          Ta med på handleliste <span style={{ opacity: 0.6 }}>(basisvare — utelates som standard)</span>
        </label>
      )}
    </div>
  );
}

/** Kompakt, skrivebeskyttet linje i «Endre rekkefølge»-modus — gir plass til ▲▼ på smale skjermer. */
function IngredientSummary({ ing }: { ing: Ingredient }) {
  const amount = formatIngredientAmount(ing);
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, minHeight: 36,
      padding: '0 4px', marginBottom: 6, fontSize: 13.5, color: ing.name.trim() ? 'var(--ink)' : 'var(--ink-4)',
    }}>
      <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {ing.name.trim() || '(tom linje)'}
      </span>
      {amount && <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--ink-3)', flexShrink: 0 }}>{amount}</span>}
    </div>
  );
}

interface Draft {
  name: string;
  ingredients: DraftIngredient[];
  cookTimeMinutes: string;
  instructions: string;
  tags: string;
}

const draftFromRecipe = (r: Recipe): Draft => ({
  name: r.name,
  ingredients: r.ingredients.length ? r.ingredients.map(withKey) : [emptyIngredient()],
  cookTimeMinutes: r.cookTimeMinutes == null ? '' : String(r.cookTimeMinutes),
  instructions: r.instructions ?? '',
  tags: r.tags.join(', '),
});

const emptyDraft = (): Draft => ({
  name: '', ingredients: [emptyIngredient()], cookTimeMinutes: '', instructions: '', tags: '',
});

export default function RecipeForm({ recipe, allTags, onSaved, onCancel, onDelete }: {
  /** null ⇒ ny oppskrift. */
  recipe: Recipe | null;
  allTags: string[];
  onSaved: () => void;
  onCancel: () => void;
  /** Kun ved redigering. Slett ligger her i stedet for i listen, så den ikke trykkes ved et uhell. */
  onDelete?: () => void;
}) {
  const { stapleItems, addRecipe, updateRecipe } = useMatplan();
  const [draft, setDraft] = useState<Draft>(() => recipe ? draftFromRecipe(recipe) : emptyDraft());
  const [saving, setSaving] = useState(false);
  const [tagsFocused, setTagsFocused] = useState(false);
  // «Endre rekkefølge»: ▲▼ per linje som alternativ til å dra i grepet.
  const [reordering, setReordering] = useState(false);
  // _key til en nylig lagt til linje som skal få fokus når den monteres.
  const [focusKey, setFocusKey] = useState<string | null>(null);

  // Bytter man oppskrift mens skjemaet er åpent, start på nytt fra den.
  useEffect(() => {
    setDraft(recipe ? draftFromRecipe(recipe) : emptyDraft());
    setReordering(false);
  }, [recipe?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const stapleNames = new Set(stapleItems.map(s => s.name.trim().toLowerCase()));
  const suggestions = tagsFocused ? tagSuggestions(draft.tags, allTags) : [];

  const patchIngredient = (i: number, patch: Partial<Ingredient>) => {
    setDraft(d => ({ ...d, ingredients: d.ingredients.map((ing, idx) => idx === i ? { ...ing, ...patch } : ing) }));
  };
  const removeIngredient = (i: number) => {
    setDraft(d => ({ ...d, ingredients: d.ingredients.filter((_, idx) => idx !== i) }));
  };
  // Ny ingrediens havner alltid nederst, og får fokus.
  const addIngredient = () => {
    const next = emptyIngredient();
    setFocusKey(next._key);
    setDraft(d => ({ ...d, ingredients: [...d.ingredients, next] }));
  };

  const submit = async () => {
    if (!draft.name.trim() || saving) return;
    setSaving(true);
    const payload = {
      name: draft.name.trim(),
      ingredients: draft.ingredients.filter(i => i.name.trim()).map(i => {
        const name = i.name.trim();
        // Besluttes og lagres for godt her — ikke basisvare ⇒ alltid med
        // (uansett hva som måtte stå i draften); basisvare ⇒ kun med hvis
        // brukeren aktivt har krysset av (se IngredientRow).
        const onGroceryList = stapleNames.has(name.toLowerCase()) ? i.onGroceryList === true : true;
        const { _key, ...ing } = i; // eslint-disable-line @typescript-eslint/no-unused-vars
        return { ...ing, name, onGroceryList };
      }),
      cookTimeMinutes: draft.cookTimeMinutes.trim() ? Number(draft.cookTimeMinutes) : null,
      instructions: draft.instructions.trim() || null,
      tags: Array.from(new Set(draft.tags.split(',').map(t => t.trim()).filter(Boolean))),
    };
    try {
      // Ingen «source» i patchen ved redigering — feltet er borte fra skjemaet,
      // men en eksisterende oppskrift (f.eks. en fremtidig spoonacular-importert
      // en) skal ikke få kilden sin stille overskrevet til «egen» bare fordi den
      // redigeres. Nye, manuelt opprettede oppskrifter er alltid «egen».
      if (recipe) await updateRecipe(recipe.id, payload);
      else await addRecipe({ ...payload, source: 'egen' });
      onSaved();
    } finally { setSaving(false); }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div>
        <div className="card-eyebrow" style={{ marginBottom: 4 }}>Navn</div>
        <input className="input" placeholder="F.eks. Kylling-tikka masala" value={draft.name}
          onChange={e => setDraft(d => ({ ...d, name: e.target.value }))} style={{ width: '100%' }} />
      </div>

      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <div className="card-eyebrow">Ingredienser</div>
          {(draft.ingredients.length > 1 || reordering) && (
            <button type="button" onClick={() => setReordering(r => !r)} className="btn ghost sm" aria-pressed={reordering}>
              {reordering ? '✓ Ferdig' : '↕ Endre rekkefølge'}
            </button>
          )}
        </div>
        <SortableList
          items={draft.ingredients}
          getId={ing => ing._key}
          getLabel={ing => ing.name}
          noun="ingrediens"
          stepMode={reordering}
          onReorder={ingredients => setDraft(d => ({ ...d, ingredients }))}
          renderItem={(ing, i) => reordering
            ? <IngredientSummary ing={ing} />
            : <IngredientRow ing={ing} stapleNames={stapleNames}
                onChange={patch => patchIngredient(i, patch)}
                onRemove={() => removeIngredient(i)}
                onEnter={i === draft.ingredients.length - 1 ? addIngredient : undefined}
                autoFocus={ing._key === focusKey}
                onAutoFocused={() => setFocusKey(null)} />}
        />
        {!reordering && (
          <button onClick={addIngredient} className="btn ghost sm" style={{ marginTop: 2 }}>+ Legg til ingrediens</button>
        )}
      </div>

      <div>
        <div className="card-eyebrow" style={{ marginBottom: 4 }}>Koketid <span style={{ opacity: 0.5 }}>(min)</span></div>
        <input className="input" placeholder="30" inputMode="numeric" value={draft.cookTimeMinutes}
          onChange={e => setDraft(d => ({ ...d, cookTimeMinutes: e.target.value.replace(/\D/g, '') }))}
          style={{ width: '100%', fontVariantNumeric: 'tabular-nums' }} />
      </div>

      <div>
        <div className="card-eyebrow" style={{ marginBottom: 4 }}>Tags <span style={{ opacity: 0.5 }}>(kommaseparert, f.eks. «prøvd»)</span></div>
        <input className="input" placeholder="prøvd, rask, vegetar" value={draft.tags}
          onChange={e => setDraft(d => ({ ...d, tags: e.target.value }))}
          onFocus={() => setTagsFocused(true)}
          // Forsinket så et trykk på et forslag rekker å registreres før listen forsvinner.
          onBlur={() => setTimeout(() => setTagsFocused(false), 150)}
          style={{ width: '100%' }} />
        {suggestions.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
            {suggestions.map(t => (
              <button key={t} className="btn sm" style={{ borderRadius: 999 }}
                onMouseDown={e => e.preventDefault()}
                onClick={() => setDraft(d => ({ ...d, tags: applyTagSuggestion(d.tags, t) }))}>
                + {t}
              </button>
            ))}
          </div>
        )}
      </div>

      <div>
        <div className="card-eyebrow" style={{ marginBottom: 4 }}>Fremgangsmåte <span style={{ opacity: 0.5 }}>(valgfri)</span></div>
        <textarea className="input" placeholder="Steg for steg…" value={draft.instructions}
          onChange={e => setDraft(d => ({ ...d, instructions: e.target.value }))} rows={5}
          style={{ width: '100%', resize: 'vertical' }} />
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
        <button onClick={onCancel} className="btn ghost" style={{ flex: 1, justifyContent: 'center' }}>Avbryt</button>
        <button onClick={() => void submit()} className="btn primary"
          style={{ flex: 1, justifyContent: 'center', opacity: (!draft.name.trim() || saving) ? 0.4 : 1 }}>
          {saving ? 'Lagrer…' : recipe ? 'Lagre endring' : 'Legg til oppskrift'}
        </button>
      </div>
      {onDelete && (
        <button onClick={onDelete} className="btn danger sm" style={{ alignSelf: 'flex-start', marginTop: 8 }}>
          Slett oppskrift
        </button>
      )}
    </div>
  );
}
