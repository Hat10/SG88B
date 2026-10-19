// Rene hjelpere for «Angre» på Gangskjerm-handlelisten (src/pages/Skjerm.tsx).
// Avhaking sletter aldri raden — toggleGroceryItem() setter done/done_at, og for
// basisvarer også staple_items.last_bought_at og nullstiller postponed_until.
// Angre betyr derfor å skrive tilbake de gamle verdiene, ikke å opprette på nytt;
// navn, mengde, enhet og created_at (rekkefølgen) er aldri rørt.
import type { GroceryItem, StapleItem } from '../contexts/MatplanContext';

/** Tilstanden en rad (og evt. tilhørende basisvare) hadde FØR den ble avhuket. */
export interface GroceryUndoSnapshot {
  id: string;
  done: boolean;
  doneAt: string | null;
  stapleItemId: string | null;
  /** Kun satt for basisvarerader: basisvarens verdier før avhaking. */
  stapleBefore: { lastBoughtAt: string | null; postponedUntil: string | null } | null;
}

/** Ei avhuket rad i visningen — én rad kan bestå av flere grocery_items (groupByNameUnit). */
export interface UndoEntry {
  label: string;
  snapshots: GroceryUndoSnapshot[];
}

/** Tar opptak av radene `ids` slik de er nå. Ukjente id-er hoppes over. */
export function snapshotGroceryRows(
  ids: string[],
  items: GroceryItem[],
  staples: StapleItem[],
): GroceryUndoSnapshot[] {
  const out: GroceryUndoSnapshot[] = [];
  for (const id of ids) {
    const g = items.find(x => x.id === id);
    if (!g) continue;
    const s = g.stapleItemId ? staples.find(x => x.id === g.stapleItemId) : undefined;
    out.push({
      id: g.id, done: g.done, doneAt: g.doneAt, stapleItemId: g.stapleItemId,
      stapleBefore: s ? { lastBoughtAt: s.lastBoughtAt, postponedUntil: s.postponedUntil } : null,
    });
  }
  return out;
}

/**
 * Legger en ny avhaking til de ventende. Rader som allerede ligger i settet
 * beholder det ELDSTE opptaket (tilstanden før første avhaking).
 */
export function addUndoEntry(pending: UndoEntry[], entry: UndoEntry): UndoEntry[] {
  const known = new Set(pending.flatMap(e => e.snapshots.map(s => s.id)));
  const snapshots = entry.snapshots.filter(s => !known.has(s.id));
  if (snapshots.length === 0) return pending;
  return [...pending, { label: entry.label, snapshots }];
}

/** Alle radopptak på tvers av ventende avhakinger. */
export function flattenSnapshots(pending: UndoEntry[]): GroceryUndoSnapshot[] {
  return pending.flatMap(e => e.snapshots);
}

/** «✓ Melk kjøpt» for én vare, «✓ 2 varer kjøpt» for flere. */
export function boughtMessage(pending: UndoEntry[]): string {
  if (pending.length === 1) return `✓ ${pending[0].label} kjøpt`;
  return `✓ ${pending.length} varer kjøpt`;
}
