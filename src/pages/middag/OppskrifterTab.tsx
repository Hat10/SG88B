import { useState, useEffect } from 'react';
import { useMatplan, type Recipe, type Ingredient } from '../../contexts/MatplanContext';
import { useSnackbar } from '../../contexts/SnackbarContext';
import { useConfirm } from '../../contexts/ConfirmContext';
import { Card, Tag, SkeletonList } from '../../components';
import UnitSelect from './UnitSelect';

const emptyIngredient = (): Ingredient => ({ name: '', amount: null, unit: null, amountRange: null });

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

function IngredientRow({ ing, stapleNames, onChange, onRemove }: {
  ing: Ingredient; stapleNames: Set<string>; onChange: (patch: Partial<Ingredient>) => void; onRemove: () => void;
}) {
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
        <input className="input" placeholder="Ingrediens" value={ing.name}
          onChange={e => onChange({ name: e.target.value })} style={{ flex: 3 }} />
        <input className="input" placeholder="Mengde, f.eks. 0,5-1" inputMode="text" value={amountText}
          onChange={e => handleAmountChange(e.target.value)}
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

interface Draft {
  name: string;
  ingredients: Ingredient[];
  cookTimeMinutes: string;
  instructions: string;
  tags: string;
}

const draftFromRecipe = (r: Recipe): Draft => ({
  name: r.name,
  ingredients: r.ingredients.length ? r.ingredients : [emptyIngredient()],
  cookTimeMinutes: r.cookTimeMinutes == null ? '' : String(r.cookTimeMinutes),
  instructions: r.instructions ?? '',
  tags: r.tags.join(', '),
});

const emptyDraft = (): Draft => ({
  name: '', ingredients: [emptyIngredient()], cookTimeMinutes: '', instructions: '', tags: '',
});

export default function OppskrifterTab() {
  const { recipes, stapleItems, loading, addRecipe, updateRecipe, removeRecipe, restoreRecipe } = useMatplan();
  const { notify } = useSnackbar();
  const { confirm } = useConfirm();

  const [editId, setEditId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  const [saving, setSaving] = useState(false);

  const stapleNames = new Set(stapleItems.map(s => s.name.trim().toLowerCase()));

  const startEdit = (r: Recipe) => { setEditId(r.id); setDraft(draftFromRecipe(r)); };
  const cancelEdit = () => { setEditId(null); setDraft(emptyDraft()); };

  const patchIngredient = (i: number, patch: Partial<Ingredient>) => {
    setDraft(d => ({ ...d, ingredients: d.ingredients.map((ing, idx) => idx === i ? { ...ing, ...patch } : ing) }));
  };
  const removeIngredient = (i: number) => {
    setDraft(d => ({ ...d, ingredients: d.ingredients.filter((_, idx) => idx !== i) }));
  };
  const addIngredient = () => setDraft(d => ({ ...d, ingredients: [...d.ingredients, emptyIngredient()] }));

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
        return { ...i, name, onGroceryList };
      }),
      cookTimeMinutes: draft.cookTimeMinutes.trim() ? Number(draft.cookTimeMinutes) : null,
      instructions: draft.instructions.trim() || null,
      tags: draft.tags.split(',').map(t => t.trim()).filter(Boolean),
    };
    try {
      // Ingen «source» i patchen ved redigering — feltet er borte fra skjemaet,
      // men en eksisterende oppskrift (f.eks. en fremtidig spoonacular-importert
      // en) skal ikke få kilden sin stille overskrevet til «egen» bare fordi den
      // redigeres. Nye, manuelt opprettede oppskrifter er alltid «egen».
      if (editId) { await updateRecipe(editId, payload); cancelEdit(); }
      else { await addRecipe({ ...payload, source: 'egen' }); setDraft(emptyDraft()); }
    } finally { setSaving(false); }
  };

  const handleRemove = async (r: Recipe) => {
    if (!await confirm({ title: 'Slett oppskrift?', message: `«${r.name}»`, confirmLabel: 'Slett' })) return;
    if (editId === r.id) cancelEdit();
    await removeRecipe(r.id);
    notify('Oppskrift slettet', { actionLabel: 'Angre', onAction: () => void restoreRecipe(r) });
  };

  return (
    <div className="grid grid-12">
      <div className="col-7">
        <Card eyebrow="Oppskrifter" title={`Alle oppskrifter (${recipes.length})`}>
          {loading && <SkeletonList rows={4} />}
          {!loading && recipes.length === 0 && (
            <div style={{ padding: '24px 0', textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--ink-4)' }}>
              Ingen oppskrifter ennå
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {recipes.map(r => (
              <div key={r.id} style={{
                display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8,
                padding: '12px 14px', background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: 6,
              }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--ink)' }}>{r.name}</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                    {r.cookTimeMinutes != null && <Tag>{r.cookTimeMinutes} min</Tag>}
                    {r.source === 'spoonacular' && <Tag>spoonacular</Tag>}
                    {r.tags.map(t => <Tag key={t}>{t}</Tag>)}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                  <button onClick={() => startEdit(r)} style={{
                    background: 'transparent', border: '1px solid var(--line)', borderRadius: 6,
                    padding: '6px 9px', cursor: 'pointer', fontSize: 13, color: 'var(--ink-4)',
                    minWidth: 36, minHeight: 36, display: 'grid', placeItems: 'center',
                  }}>✎</button>
                  <button onClick={() => void handleRemove(r)} aria-label="Slett oppskrift" style={{
                    background: 'transparent', border: '1px solid var(--line)', borderRadius: 6,
                    padding: '6px 9px', cursor: 'pointer', fontSize: 15, color: 'var(--ink-4)',
                    minWidth: 36, minHeight: 36, display: 'grid', placeItems: 'center',
                  }}>×</button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div className="col-5">
        <Card eyebrow={editId ? 'Rediger' : 'Legg til'} title={editId ? draft.name : 'Ny oppskrift'}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <div className="card-eyebrow" style={{ marginBottom: 4 }}>Navn</div>
              <input className="input" placeholder="F.eks. Kylling-tikka masala" value={draft.name}
                onChange={e => setDraft(d => ({ ...d, name: e.target.value }))} style={{ width: '100%' }} />
            </div>

            <div>
              <div className="card-eyebrow" style={{ marginBottom: 4 }}>Ingredienser</div>
              {draft.ingredients.map((ing, i) => (
                <IngredientRow key={i} ing={ing} stapleNames={stapleNames}
                  onChange={patch => patchIngredient(i, patch)}
                  onRemove={() => removeIngredient(i)} />
              ))}
              <button onClick={addIngredient} className="btn ghost sm" style={{ marginTop: 2 }}>+ Legg til ingrediens</button>
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
                onChange={e => setDraft(d => ({ ...d, tags: e.target.value }))} style={{ width: '100%' }} />
            </div>

            <div>
              <div className="card-eyebrow" style={{ marginBottom: 4 }}>Fremgangsmåte <span style={{ opacity: 0.5 }}>(valgfri)</span></div>
              <textarea className="input" placeholder="Steg for steg…" value={draft.instructions}
                onChange={e => setDraft(d => ({ ...d, instructions: e.target.value }))} rows={4}
                style={{ width: '100%', resize: 'vertical' }} />
            </div>

            <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
              {editId && <button onClick={cancelEdit} className="btn ghost" style={{ flex: 1, justifyContent: 'center' }}>Avbryt</button>}
              <button onClick={() => void submit()} className="btn primary"
                style={{ flex: 1, justifyContent: 'center', opacity: (!draft.name.trim() || saving) ? 0.4 : 1 }}>
                {saving ? 'Lagrer…' : editId ? 'Lagre endring' : 'Legg til oppskrift'}
              </button>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
