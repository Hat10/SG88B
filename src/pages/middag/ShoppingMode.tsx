import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useMatplan, weekDates, type GroceryItem } from '../../contexts/MatplanContext';
import { handleukeStart } from '../../hooks/useWeeklyBucket';
import { useScrollLock } from '../../lib/useScrollLock';
import { useWakeLock } from '../../lib/useWakeLock';
import { GROCERY_CATEGORIES, CATEGORY_EMOJI, type GroceryCategory } from '../../lib/groceryCategories';
import { groupByNameUnit, type MergedGroup } from './HandlelisteCard';

// Egen, forenklet fullskjerm-visning for bruk i butikken — bevisst IKKE en
// gjenbruk av HandlelisteCard sitt kortoppsett (seksjoner per opprinnelse,
// rediger-modus, hold-forsinkelse ved avhuking, ...). Handlemodus har ett
// mål: raskt, ett trykk = kjøpt, ingen bekreftelse og ingen forsinkelse (i
// motsetning til hovedlistens toggleWithHold, se HandlelisteCard.tsx for
// hvorfor DEN har en forsinkelse — det problemet gjelder ikke her, siden en
// vare som flytter seg til bunnen av SIN EGEN kategori fortsatt er synlig,
// den forsvinner ikke inn i en skjult seksjon).
//
// Bruker groupByNameUnit (samme funksjon som hovedlisten) for å slå sammen
// samme vare fra flere middager til én rad, og samme amount/amountRange-
// formatering — se formatAmount under.

function doneThisHandleuke(g: GroceryItem, handleukeDays: Set<string>): boolean {
  return g.doneAt != null && handleukeDays.has(new Date(g.doneAt).toLocaleDateString('sv-SE', { timeZone: 'Europe/Oslo' }));
}

function formatAmount(group: MergedGroup): string {
  const qty = group.amountRange ?? group.amount ?? '';
  return `${qty}${group.approx ? '+' : ''} ${group.unit ?? ''}`.trim();
}

function categoryOf(group: MergedGroup): GroceryCategory {
  return group.category && (GROCERY_CATEGORIES as readonly string[]).includes(group.category)
    ? (group.category as GroceryCategory) : 'Annet';
}

function ShoppingRow({ group, onToggle, onCategoryChange }: {
  group: MergedGroup; onToggle: () => void; onCategoryChange: (category: string) => void;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', borderBottom: '1px solid var(--line)' }}>
      <button onClick={onToggle} style={{
        flex: 1, display: 'flex', alignItems: 'center', gap: 14, textAlign: 'left',
        padding: '16px 4px', background: 'transparent', border: 'none', cursor: 'pointer',
        opacity: group.done ? 0.4 : 1, minHeight: 60,
      }}>
        <span aria-hidden style={{
          width: 30, height: 30, borderRadius: '50%', flexShrink: 0,
          border: `2px solid ${group.done ? 'var(--ink-4)' : 'var(--ink)'}`,
          background: group.done ? 'var(--ink-4)' : 'transparent',
          display: 'grid', placeItems: 'center', color: '#fff', fontSize: 16, fontWeight: 700,
        }}>{group.done ? '✓' : ''}</span>
        <span style={{
          flex: 1, fontSize: 19, fontWeight: 600, color: 'var(--ink)',
          textDecoration: group.done ? 'line-through' : 'none',
        }}>
          {group.name}
        </span>
        {formatAmount(group) && (
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 15, color: 'var(--ink-3)', flexShrink: 0 }}>
            {formatAmount(group)}
          </span>
        )}
      </button>
      <select
        aria-label={`Endre kategori for ${group.name}`}
        value={categoryOf(group)}
        onChange={e => onCategoryChange(e.target.value)}
        style={{
          fontSize: 12, padding: '6px 2px', border: 'none', background: 'transparent',
          color: 'var(--ink-4)', flexShrink: 0, maxWidth: 90, cursor: 'pointer',
        }}
      >
        {GROCERY_CATEGORIES.map(c => <option key={c} value={c}>{CATEGORY_EMOJI[c]} {c}</option>)}
      </select>
    </div>
  );
}

export default function ShoppingMode({ onClose }: { onClose: () => void }) {
  const { groceryItems, toggleGroceryItem, addGroceryItem, setGroceryCategory } = useMatplan();
  const [newItem, setNewItem] = useState('');

  useScrollLock();
  useWakeLock(true);

  // Alt som faktisk hører hjemme på DENNE handleturen — aktive varer uansett
  // opprinnelse, pluss varer kjøpt i inneværende handleuke (samme grense som
  // hovedlistens «Vis handlet», se HandlelisteCard.tsx). Ingen pending-hold
  // her — se komponentkommentaren over for hvorfor det ikke trengs.
  // Regnes ut på nytt hver render (ikke memoisert/modulnivå), som i
  // HandlelisteCard, så handleuke-grensen ikke blir stående og bli feil om
  // appen holdes åpen over lørdags-overgangen.
  const handleukeDays = new Set(weekDates(handleukeStart()));
  const shoppingItems = groceryItems.filter(g => !g.done || doneThisHandleuke(g, handleukeDays));
  const groups = groupByNameUnit(shoppingItems);

  const byCategory = new Map<GroceryCategory, MergedGroup[]>();
  for (const cat of GROCERY_CATEGORIES) byCategory.set(cat, []);
  for (const group of groups) byCategory.get(categoryOf(group))!.push(group);
  // Kjøpte varer til bunnen av SIN EGEN kategori, ikke en egen global
  // «kjøpt»-seksjon — stabil sort bevarer ellers rekkefølgen innad i hver av
  // de to gruppene (aktive/kjøpte).
  for (const list of byCategory.values()) list.sort((a, b) => Number(a.done) - Number(b.done));
  const visibleCategories = GROCERY_CATEGORIES.filter(cat => (byCategory.get(cat)?.length ?? 0) > 0);

  const totalCount = groups.length;
  const doneCount = groups.filter(g => g.done).length;

  const toggleGroup = (group: MergedGroup) => group.ids.forEach(id => void toggleGroceryItem(id));
  // setGroceryCategory oppdaterer nå ALLE rader med samme varenavn server-side
  // i én spørring (se MatplanContext.tsx) — ett kall holder, selv om gruppen
  // her har flere ids (de deler uansett navn, siden groupByNameUnit grupperer
  // på nettopp det).
  const changeCategory = (group: MergedGroup, category: string) => void setGroceryCategory(group.ids[0], category);

  const submitNewItem = async () => {
    const name = newItem.trim();
    if (!name) return;
    setNewItem('');
    try {
      await addGroceryItem({ name, amount: 1 });
    } catch {
      // Feilen er allerede varslet av addGroceryItem (MatplanContext.tsx) —
      // her legges bare varenavnet tilbake i feltet slik at forsøket ikke går tapt.
      setNewItem(name);
    }
  };

  return createPortal(
    <div style={{
      position: 'fixed', inset: 0, zIndex: 500, background: 'var(--bg)',
      display: 'flex', flexDirection: 'column',
    }}>
      <div style={{ flexShrink: 0, padding: '16px 20px 12px', borderBottom: '1px solid var(--line)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <span style={{ fontSize: 17, fontWeight: 700, color: 'var(--ink)' }}>
            {doneCount} av {totalCount} kjøpt
          </span>
          <button onClick={onClose} aria-label="Lukk handlemodus" style={{
            background: 'transparent', border: '1px solid var(--line)', borderRadius: 8,
            width: 40, height: 40, display: 'grid', placeItems: 'center', cursor: 'pointer',
            fontSize: 18, color: 'var(--ink-3)',
          }}>×</button>
        </div>
        <div style={{ height: 8, borderRadius: 4, background: 'var(--chip)', overflow: 'hidden' }}>
          <div style={{
            height: '100%', width: `${totalCount ? (doneCount / totalCount) * 100 : 0}%`,
            background: 'var(--good)', transition: 'width 200ms ease',
          }} />
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '0 20px' }}>
        {visibleCategories.length === 0 && (
          <div style={{ textAlign: 'center', padding: '60px 0', fontSize: 15, color: 'var(--ink-4)' }}>
            Handlelisten er tom
          </div>
        )}
        {visibleCategories.map(cat => (
          <div key={cat} style={{ marginTop: 20 }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2,
              fontSize: 13, fontWeight: 700, color: 'var(--ink-3)',
              textTransform: 'uppercase', letterSpacing: '0.04em',
            }}>
              <span aria-hidden style={{ fontSize: 18 }}>{CATEGORY_EMOJI[cat]}</span> {cat}
            </div>
            <div>
              {byCategory.get(cat)!.map(group => (
                <ShoppingRow key={group.key} group={group}
                  onToggle={() => toggleGroup(group)}
                  onCategoryChange={c => changeCategory(group, c)} />
              ))}
            </div>
          </div>
        ))}
      </div>

      <div style={{
        flexShrink: 0, borderTop: '1px solid var(--line)', background: 'var(--bg)',
        padding: '10px 20px calc(10px + env(safe-area-inset-bottom, 0px))',
        display: 'flex', gap: 8,
      }}>
        <input className="input" placeholder="Legg til vare…" value={newItem}
          onChange={e => setNewItem(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && void submitNewItem()}
          style={{ flex: 1, fontSize: 16 }} />
        <button onClick={() => void submitNewItem()} className="btn primary" disabled={!newItem.trim()}
          style={{ opacity: !newItem.trim() ? 0.4 : 1 }}>+ Legg til</button>
      </div>
    </div>,
    document.body,
  );
}
