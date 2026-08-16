import { useEffect, useState } from 'react';
import { useMatplan, weekDates, type GroceryItem } from '../../contexts/MatplanContext';
import { handleukeStart } from '../../hooks/useWeeklyBucket';
import { Card, Check, SkeletonList } from '../../components';

// Delt mellom src/pages/Handleliste.tsx (eget menypunkt) og
// src/pages/middag/DagligvarerTab.tsx (fane på Middag-siden) — begge viser
// nøyaktig samme handleliste, samme komponent, samme sanntidsdata via
// useMatplan. Basisvare-administrasjonen (StapleManager) er bevisst IKKE en
// del av dette — den hører hjemme kun på Middag-siden.

const removeBtnStyle: React.CSSProperties = {
  background: 'transparent', border: '1px solid var(--line)', borderRadius: 6,
  cursor: 'pointer', fontSize: 14, color: 'var(--ink-4)', flexShrink: 0,
  minWidth: 32, minHeight: 32, display: 'grid', placeItems: 'center',
};

function GroceryRow({ name, amount, approx, unit, done, onToggle, onRemove }: {
  name: string; amount: number | null; approx?: boolean; unit: string | null; done: boolean;
  onToggle: () => void; onRemove: () => void;
}) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
      background: done ? 'var(--surface-2)' : 'var(--bg)', border: '1px solid var(--line)', borderRadius: 6,
      opacity: done ? 0.55 : 1,
    }}>
      <Check on={done} onClick={onToggle} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <span style={{ fontSize: 14, color: 'var(--ink)', textDecoration: done ? 'line-through' : 'none' }}>{name}</span>
        {(amount != null || unit) && (
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-4)', marginLeft: 8 }}>
            {amount ?? ''}{approx ? '+' : ''} {unit ?? ''}
          </span>
        )}
      </div>
      <button onClick={onRemove} aria-label="Fjern vare" style={removeBtnStyle}>×</button>
    </div>
  );
}

// Frittstående dagligvare (ikke koblet til middag/basisvare) — samme
// avkrysning som GroceryRow, men med +/- for antall i stedet for en fast
// mengde fra en oppskrift/basisvare-definisjon.
function FreeGroceryRow({ item, onToggle, onDecrement, onIncrement, onRemove }: {
  item: GroceryItem; onToggle: () => void; onDecrement: () => void; onIncrement: () => void; onRemove: () => void;
}) {
  const stepperBtn: React.CSSProperties = {
    background: 'transparent', border: '1px solid var(--line)', borderRadius: 6,
    cursor: 'pointer', fontSize: 14, color: 'var(--ink-3)', fontWeight: 700,
    width: 26, height: 26, display: 'grid', placeItems: 'center', lineHeight: 1,
  };
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
      background: item.done ? 'var(--surface-2)' : 'var(--bg)', border: '1px solid var(--line)', borderRadius: 6,
      opacity: item.done ? 0.55 : 1,
    }}>
      <Check on={item.done} onClick={onToggle} />
      <span style={{ flex: 1, minWidth: 0, fontSize: 14, color: 'var(--ink)', textDecoration: item.done ? 'line-through' : 'none' }}>
        {item.name}
      </span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
        <button onClick={onDecrement} aria-label="Færre" style={stepperBtn}>−</button>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 600, minWidth: 16, textAlign: 'center' }}>{item.amount ?? 1}</span>
        <button onClick={onIncrement} aria-label="Flere" style={stepperBtn}>+</button>
      </div>
      <button onClick={onRemove} aria-label="Fjern vare" style={removeBtnStyle}>×</button>
    </div>
  );
}

export interface MergedGroup {
  key: string;
  name: string;
  unit: string | null;
  amount: number | null;
  /** true når minst én rad i gruppen manglet mengde — summen er da et minimum, ikke eksakt. */
  approx: boolean;
  done: boolean;
  ids: string[];
}

// Samme ingrediens (navn+enhet) fra flere planlagte middager denne uken skal
// vises som ÉN rad med summert mengde, ikke én rad per middag — men radene i
// databasen holdes fortsatt separate (én per meal_plan_id), så sporbarhet til
// hvilken middag som trenger hva består, og fjernes en middag fra ukeplanen
// forsvinner riktig kun DEN middagens bidrag (on delete cascade). Grupperingen
// skjer derfor kun her, i visningslaget — se samtalen for hvorfor det er
// tryggere enn å slå sammen ved innsetting.
// Ulik enhet slås aldri sammen (nøkkelen inkluderer enheten), så «1 Liter» og
// «500 ml» melk forblir to rader i stedet for feilaktig 501.
export function groupByNameUnit(items: GroceryItem[]): MergedGroup[] {
  const groups = new Map<string, MergedGroup>();
  for (const g of items) {
    const key = `${g.name.trim().toLowerCase()}|${(g.unit ?? '').trim().toLowerCase()}`;
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, { key, name: g.name, unit: g.unit, amount: g.amount, approx: g.amount == null, done: g.done, ids: [g.id] });
      continue;
    }
    existing.ids.push(g.id);
    existing.done = existing.done && g.done;
    if (g.amount == null) existing.approx = true;
    else existing.amount = (existing.amount ?? 0) + g.amount;
  }
  return [...groups.values()];
}

export default function HandlelisteCard() {
  const { groceryItems, loading, syncGroceryList, addGroceryItem, setGroceryAmount, toggleGroceryItem, removeGroceryItem } = useMatplan();
  const [showDone, setShowDone] = useState(false);
  const [newItem, setNewItem] = useState('');

  // Genererer manglende rader (planlagte middager denne uken + forfalte
  // basisvarer) én gang når dataene er klare — idempotent (databasen håndhever
  // det, se syncGroceryList), rører aldri eksisterende avhukinger. Kjører
  // uansett hvilken side komponenten monteres på.
  useEffect(() => {
    if (!loading) void syncGroceryList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  const submitNewItem = async () => {
    const name = newItem.trim();
    if (!name) return;
    setNewItem('');
    await addGroceryItem({ name, amount: 1 });
  };

  // Frittstående varer (verken meal_plan_id eller staple_item_id) — den enkle
  // handlelisten. Vises alltid, kjøpte varer nedtonet nederst i egen seksjon,
  // ikke bak et skjul/vis-tuggel som resten av lista under.
  const freeform       = groceryItems.filter(g => !g.mealPlanId && !g.stapleItemId);
  const freeformActive = freeform.filter(g => !g.done);
  const freeformDone   = freeform.filter(g => g.done);

  // Middag/basisvare-genererte rader. Aktive ruller over uendret (ingen
  // dato-avgrensning), men «vis handlet» skal kun vise det som ble kjøpt i
  // INNEVÆRENDE handleuke — ellers ville avhukede rader fra uker tilbake i
  // tid bare hope seg opp der for alltid. Rader uten done_at (avhuket før
  // denne kolonnen fantes) matcher aldri — de forsvinner fra «vis handlet»,
  // men slettes ikke fra databasen.
  const linked = groceryItems.filter(g => g.mealPlanId || g.stapleItemId);
  const active = linked.filter(g => !g.done);
  const handleukeDays = new Set(weekDates(handleukeStart()));
  const doneThisHandleuke = (g: GroceryItem) =>
    g.doneAt != null && handleukeDays.has(new Date(g.doneAt).toLocaleDateString('sv-SE', { timeZone: 'Europe/Oslo' }));
  const done = linked.filter(g => g.done && doneThisHandleuke(g));
  const fromMeals     = groupByNameUnit(active.filter(g => g.mealPlanId));
  const fromMealsDone = groupByNameUnit(done.filter(g => g.mealPlanId));
  const staples     = active.filter(g => g.stapleItemId);
  const staplesDone = done.filter(g => g.stapleItemId);

  return (
    <Card eyebrow="Dagligvarer" title="Handleliste">
      {loading && <SkeletonList rows={5} />}
      {!loading && active.length === 0 && done.length === 0 && freeform.length === 0 && (
        <div style={{ padding: '24px 0', textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--ink-4)' }}>
          Ingenting på handlelisten — legg til en vare under, planlegg middager i Ukeplan, eller legg til basisvarer nederst.
        </div>
      )}

      {!loading && (
        <div style={{ marginBottom: (fromMeals.length || staples.length) ? 16 : 0 }}>
          <div className="card-eyebrow" style={{ marginBottom: 8 }}>Andre varer</div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
            <input className="input" placeholder="Legg til vare…" value={newItem}
              onChange={e => setNewItem(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && void submitNewItem()}
              style={{ flex: 1 }} />
            <button onClick={() => void submitNewItem()} className="btn primary sm" disabled={!newItem.trim()}
              style={{ opacity: !newItem.trim() ? 0.4 : 1 }}>+ Legg til</button>
          </div>
          {freeform.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {[...freeformActive, ...freeformDone].map(g => (
                <FreeGroceryRow key={g.id} item={g}
                  onToggle={() => void toggleGroceryItem(g.id)}
                  onDecrement={() => void setGroceryAmount(g.id, Math.max(1, (g.amount ?? 1) - 1))}
                  onIncrement={() => void setGroceryAmount(g.id, (g.amount ?? 1) + 1)}
                  onRemove={() => void removeGroceryItem(g.id)} />
              ))}
            </div>
          )}
        </div>
      )}

      {!loading && fromMeals.length > 0 && (
        <div style={{ marginBottom: staples.length ? 16 : 0 }}>
          <div className="card-eyebrow" style={{ marginBottom: 8 }}>Fra ukens middager</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {fromMeals.map(group => (
              <GroceryRow key={group.key} name={group.name} amount={group.amount} approx={group.approx} unit={group.unit} done={group.done}
                onToggle={() => group.ids.forEach(id => void toggleGroceryItem(id))}
                onRemove={() => group.ids.forEach(id => void removeGroceryItem(id))} />
            ))}
          </div>
        </div>
      )}

      {!loading && staples.length > 0 && (
        <div>
          <div className="card-eyebrow" style={{ marginBottom: 8 }}>Basisvarer</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {staples.map(g => (
              <GroceryRow key={g.id} name={g.name} amount={g.amount} unit={g.unit} done={g.done}
                onToggle={() => void toggleGroceryItem(g.id)} onRemove={() => void removeGroceryItem(g.id)} />
            ))}
          </div>
        </div>
      )}

      {!loading && done.length > 0 && (
        <div style={{ marginTop: active.length ? 16 : 0 }}>
          <button onClick={() => setShowDone(s => !s)}
            style={{ width: '100%', padding: '8px 0', background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 6, cursor: 'pointer', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-3)' }}>
            {showDone ? '↑ Skjul handlet' : `↓ Vis handlet (${fromMealsDone.length + staplesDone.length})`}
          </button>
          {showDone && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
              {fromMealsDone.map(group => (
                <GroceryRow key={group.key} name={group.name} amount={group.amount} approx={group.approx} unit={group.unit} done={group.done}
                  onToggle={() => group.ids.forEach(id => void toggleGroceryItem(id))}
                  onRemove={() => group.ids.forEach(id => void removeGroceryItem(id))} />
              ))}
              {staplesDone.map(g => (
                <GroceryRow key={g.id} name={g.name} amount={g.amount} unit={g.unit} done={g.done}
                  onToggle={() => void toggleGroceryItem(g.id)} onRemove={() => void removeGroceryItem(g.id)} />
              ))}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
