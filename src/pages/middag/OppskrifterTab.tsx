import { useState } from 'react';
import { useMatplan, type Recipe, type Ingredient, type RecipeSource } from '../../contexts/MatplanContext';
import { useSnackbar } from '../../contexts/SnackbarContext';
import { useConfirm } from '../../contexts/ConfirmContext';
import { Card, Tag, SkeletonList } from '../../components';

const emptyIngredient = (): Ingredient => ({ name: '', amount: null, unit: null });

function IngredientRow({ ing, onChange, onRemove }: {
  ing: Ingredient; onChange: (patch: Partial<Ingredient>) => void; onRemove: () => void;
}) {
  return (
    <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
      <input className="input" placeholder="Ingrediens" value={ing.name}
        onChange={e => onChange({ name: e.target.value })} style={{ flex: 3 }} />
      <input className="input" placeholder="Mengde" inputMode="decimal" value={ing.amount ?? ''}
        onChange={e => onChange({ amount: e.target.value === '' ? null : Number(e.target.value.replace(',', '.')) })}
        style={{ flex: 1, fontVariantNumeric: 'tabular-nums' }} />
      <input className="input" placeholder="Enhet" value={ing.unit ?? ''}
        onChange={e => onChange({ unit: e.target.value || null })} style={{ flex: 1 }} />
      <button onClick={onRemove} aria-label="Fjern ingrediens" style={{
        background: 'transparent', border: '1px solid var(--line)', borderRadius: 6,
        cursor: 'pointer', fontSize: 15, color: 'var(--ink-4)', flexShrink: 0,
        minWidth: 36, minHeight: 36, display: 'grid', placeItems: 'center',
      }}>×</button>
    </div>
  );
}

interface Draft {
  name: string;
  ingredients: Ingredient[];
  cookTimeMinutes: string;
  instructions: string;
  tags: string;
  source: RecipeSource;
}

const draftFromRecipe = (r: Recipe): Draft => ({
  name: r.name,
  ingredients: r.ingredients.length ? r.ingredients : [emptyIngredient()],
  cookTimeMinutes: r.cookTimeMinutes == null ? '' : String(r.cookTimeMinutes),
  instructions: r.instructions ?? '',
  tags: r.tags.join(', '),
  source: r.source,
});

const emptyDraft = (): Draft => ({
  name: '', ingredients: [emptyIngredient()], cookTimeMinutes: '', instructions: '', tags: '', source: 'egen',
});

export default function OppskrifterTab() {
  const { recipes, loading, addRecipe, updateRecipe, removeRecipe, restoreRecipe } = useMatplan();
  const { notify } = useSnackbar();
  const { confirm } = useConfirm();

  const [editId, setEditId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  const [saving, setSaving] = useState(false);

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
      ingredients: draft.ingredients.filter(i => i.name.trim()).map(i => ({ ...i, name: i.name.trim() })),
      cookTimeMinutes: draft.cookTimeMinutes.trim() ? Number(draft.cookTimeMinutes) : null,
      instructions: draft.instructions.trim() || null,
      tags: draft.tags.split(',').map(t => t.trim()).filter(Boolean),
      source: draft.source,
    };
    try {
      if (editId) { await updateRecipe(editId, payload); cancelEdit(); }
      else { await addRecipe(payload); setDraft(emptyDraft()); }
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
                <IngredientRow key={i} ing={ing}
                  onChange={patch => patchIngredient(i, patch)}
                  onRemove={() => removeIngredient(i)} />
              ))}
              <button onClick={addIngredient} className="btn ghost sm" style={{ marginTop: 2 }}>+ Legg til ingrediens</button>
            </div>

            <div style={{ display: 'flex', gap: 12 }}>
              <div style={{ flex: 1 }}>
                <div className="card-eyebrow" style={{ marginBottom: 4 }}>Koketid <span style={{ opacity: 0.5 }}>(min)</span></div>
                <input className="input" placeholder="30" inputMode="numeric" value={draft.cookTimeMinutes}
                  onChange={e => setDraft(d => ({ ...d, cookTimeMinutes: e.target.value.replace(/\D/g, '') }))}
                  style={{ width: '100%', fontVariantNumeric: 'tabular-nums' }} />
              </div>
              <div style={{ flex: 2 }}>
                <div className="card-eyebrow" style={{ marginBottom: 4 }}>Kilde</div>
                <div style={{ display: 'flex', gap: 6 }}>
                  {(['egen', 'spoonacular'] as RecipeSource[]).map(s => (
                    <button key={s} onClick={() => setDraft(d => ({ ...d, source: s }))}
                      style={{
                        flex: 1, padding: '7px 0', borderRadius: 6, cursor: 'pointer',
                        border: `1px solid ${draft.source === s ? 'var(--ink)' : 'var(--line-2)'}`,
                        background: draft.source === s ? 'var(--ink)' : 'transparent',
                        color: draft.source === s ? 'var(--surface)' : 'var(--ink-4)',
                        fontFamily: 'var(--font-mono)', fontSize: 11, textTransform: 'capitalize',
                      }}>{s}</button>
                  ))}
                </div>
              </div>
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
