import { useEffect, useState } from 'react';
import { useMatplan, type StapleItem, type GroceryItem } from '../../contexts/MatplanContext';
import { useConfirm } from '../../contexts/ConfirmContext';
import { Card, Check, SkeletonList } from '../../components';

function GroceryRow({ item, onToggle, onRemove }: { item: GroceryItem; onToggle: () => void; onRemove: () => void }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
      background: item.done ? 'var(--surface-2)' : 'var(--bg)', border: '1px solid var(--line)', borderRadius: 6,
      opacity: item.done ? 0.55 : 1,
    }}>
      <Check on={item.done} onClick={onToggle} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <span style={{ fontSize: 14, color: 'var(--ink)', textDecoration: item.done ? 'line-through' : 'none' }}>{item.name}</span>
        {(item.amount != null || item.unit) && (
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-4)', marginLeft: 8 }}>
            {item.amount ?? ''} {item.unit ?? ''}
          </span>
        )}
      </div>
      <button onClick={onRemove} aria-label="Fjern vare" style={{
        background: 'transparent', border: '1px solid var(--line)', borderRadius: 6,
        cursor: 'pointer', fontSize: 14, color: 'var(--ink-4)', flexShrink: 0,
        minWidth: 32, minHeight: 32, display: 'grid', placeItems: 'center',
      }}>×</button>
    </div>
  );
}

const emptyStapleDraft = () => ({ name: '', amount: '', unit: '', intervalWeeks: '1' });

function StapleManager() {
  const { stapleItems, addStaple, removeStaple, restoreStaple } = useMatplan();
  const { confirm } = useConfirm();
  const [draft, setDraft] = useState(emptyStapleDraft());
  const [open, setOpen] = useState(false);

  const submit = async () => {
    if (!draft.name.trim()) return;
    await addStaple({
      name: draft.name.trim(),
      amount: draft.amount.trim() ? Number(draft.amount.replace(',', '.')) : null,
      unit: draft.unit.trim() || null,
      intervalWeeks: Math.max(1, Number(draft.intervalWeeks) || 1),
      lastBoughtAt: null,
      postponedUntil: null,
    });
    setDraft(emptyStapleDraft());
  };

  const handleRemove = async (s: StapleItem) => {
    if (!await confirm({ title: 'Slett basisvare?', message: `«${s.name}»`, confirmLabel: 'Slett' })) return;
    await removeStaple(s.id);
  };

  return (
    <Card eyebrow="Basisvarer" title="Faste og sjeldne basisvarer" action={
      <button onClick={() => setOpen(o => !o)} className="btn ghost sm">{open ? 'Skjul' : 'Administrer'}</button>
    }>
      {!open && (
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-4)' }}>
          {stapleItems.length} basisvare{stapleItems.length === 1 ? '' : 'r'} definert
        </div>
      )}
      {open && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {stapleItems.map(s => (
            <div key={s.id} style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px',
              background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: 6,
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <span style={{ fontSize: 13, color: 'var(--ink)' }}>{s.name}</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--ink-4)', marginLeft: 8 }}>
                  hver {s.intervalWeeks}. uke{s.lastBoughtAt ? ` · sist kjøpt ${s.lastBoughtAt}` : ''}
                </span>
              </div>
              <button onClick={() => void handleRemove(s)} aria-label="Slett basisvare" style={{
                background: 'transparent', border: '1px solid var(--line)', borderRadius: 6,
                cursor: 'pointer', fontSize: 14, color: 'var(--ink-4)', flexShrink: 0,
                minWidth: 32, minHeight: 32, display: 'grid', placeItems: 'center',
              }}>×</button>
            </div>
          ))}

          <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
            <input className="input" placeholder="Navn (f.eks. Melk)" value={draft.name}
              onChange={e => setDraft(d => ({ ...d, name: e.target.value }))}
              onKeyDown={e => e.key === 'Enter' && void submit()}
              style={{ flex: 2, minWidth: 120 }} />
            <input className="input" placeholder="Mengde" inputMode="decimal" value={draft.amount}
              onChange={e => setDraft(d => ({ ...d, amount: e.target.value }))} style={{ flex: 1, minWidth: 70 }} />
            <input className="input" placeholder="Enhet" value={draft.unit}
              onChange={e => setDraft(d => ({ ...d, unit: e.target.value }))} style={{ flex: 1, minWidth: 70 }} />
            <input className="input" placeholder="Uker" inputMode="numeric" value={draft.intervalWeeks}
              onChange={e => setDraft(d => ({ ...d, intervalWeeks: e.target.value.replace(/\D/g, '') }))}
              style={{ flex: 1, minWidth: 60 }} />
            <button onClick={() => void submit()} className="btn primary sm" disabled={!draft.name.trim()}
              style={{ opacity: !draft.name.trim() ? 0.4 : 1 }}>+ Legg til</button>
          </div>
        </div>
      )}
    </Card>
  );
}

export default function DagligvarerTab() {
  const { groceryItems, loading, syncGroceryList, toggleGroceryItem, removeGroceryItem } = useMatplan();
  const [showDone, setShowDone] = useState(false);

  // Genererer manglende rader (planlagte middager denne uken + forfalte
  // basisvarer) én gang når dataene er klare — idempotent, rører aldri
  // eksisterende rader.
  useEffect(() => {
    if (!loading) void syncGroceryList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  const active = groceryItems.filter(g => !g.done);
  const done = groceryItems.filter(g => g.done);
  const fromMeals = active.filter(g => g.mealPlanId);
  const staples = active.filter(g => g.stapleItemId);

  return (
    <div className="grid grid-12">
      <div className="col-12">
        <Card eyebrow="Dagligvarer" title="Handleliste">
          {loading && <SkeletonList rows={5} />}
          {!loading && active.length === 0 && done.length === 0 && (
            <div style={{ padding: '24px 0', textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--ink-4)' }}>
              Ingenting på handlelisten — planlegg middager i Ukeplan eller legg til basisvarer under.
            </div>
          )}

          {!loading && fromMeals.length > 0 && (
            <div style={{ marginBottom: staples.length ? 16 : 0 }}>
              <div className="card-eyebrow" style={{ marginBottom: 8 }}>Fra ukens middager</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {fromMeals.map(g => (
                  <GroceryRow key={g.id} item={g} onToggle={() => void toggleGroceryItem(g.id)} onRemove={() => void removeGroceryItem(g.id)} />
                ))}
              </div>
            </div>
          )}

          {!loading && staples.length > 0 && (
            <div>
              <div className="card-eyebrow" style={{ marginBottom: 8 }}>Basisvarer</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {staples.map(g => (
                  <GroceryRow key={g.id} item={g} onToggle={() => void toggleGroceryItem(g.id)} onRemove={() => void removeGroceryItem(g.id)} />
                ))}
              </div>
            </div>
          )}

          {!loading && done.length > 0 && (
            <div style={{ marginTop: active.length ? 16 : 0 }}>
              <button onClick={() => setShowDone(s => !s)}
                style={{ width: '100%', padding: '8px 0', background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 6, cursor: 'pointer', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-3)' }}>
                {showDone ? '↑ Skjul handlet' : `↓ Vis handlet (${done.length})`}
              </button>
              {showDone && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
                  {done.map(g => (
                    <GroceryRow key={g.id} item={g} onToggle={() => void toggleGroceryItem(g.id)} onRemove={() => void removeGroceryItem(g.id)} />
                  ))}
                </div>
              )}
            </div>
          )}
        </Card>
      </div>

      <div className="col-12">
        <StapleManager />
      </div>
    </div>
  );
}
