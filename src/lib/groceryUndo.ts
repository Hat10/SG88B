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

/** Hvor mange angre-meldinger som vises samtidig; en ny utover dette dytter den eldste ut. */
export const MAX_UNDO_TOASTS = 4;
/** Hvor lenge hver melding står før den forsvinner av seg selv (ms). */
export const UNDO_TOAST_MS = 6000;
/** Varighet på utgangsanimasjonen (ms) — en «leaving»-melding fjernes etter dette. */
export const UNDO_TOAST_LEAVE_MS = 220;

/**
 * Én angre-melding = én avhuket vare i visningen (en gruppe fra groupByNameUnit
 * kan bestå av flere grocery_items, derfor flere opptak).
 */
export interface UndoToast {
  id: string;
  label: string;
  snapshots: GroceryUndoSnapshot[];
  /** Tidspunkt (ms) da meldingen forsvinner av seg selv. Hver melding har sin egen. */
  expiresAt: number;
  /** Utgangsanimasjonen pågår; meldingen kan ikke lenger angres og teller ikke mot taket. */
  leaving?: boolean;
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
 * Legger en ny melding nederst (nyest sist, eldst øverst). Blir det flere enn
 * `max` aktive, markeres de eldste som «leaving» — varen forblir avhaket.
 */
export function pushToast(stack: UndoToast[], toast: UndoToast, max: number = MAX_UNDO_TOASTS): UndoToast[] {
  const next = [...stack, toast];
  let active = next.filter(t => !t.leaving).length;
  return next.map(t => {
    if (t.leaving || active <= max) return t;
    active--;
    return { ...t, leaving: true };
  });
}

/** Starter utgangen for én melding (timer utløpt, angret). Ukjent/allerede leaving id gir uendret stabel. */
export function startLeaving(stack: UndoToast[], id: string): UndoToast[] {
  if (!stack.some(t => t.id === id && !t.leaving)) return stack;
  return stack.map(t => (t.id === id ? { ...t, leaving: true } : t));
}

/** Fjerner meldingen helt (etter utgangsanimasjonen). */
export function removeToast(stack: UndoToast[], id: string): UndoToast[] {
  return stack.filter(t => t.id !== id);
}

/** Id-ene til aktive meldinger hvis egen frist er nådd — uavhengig av de andre. */
export function dueToastIds(stack: UndoToast[], now: number): string[] {
  return stack.filter(t => !t.leaving && t.expiresAt <= now).map(t => t.id);
}

export const boughtMessage = (label: string) => `✓ ${label} kjøpt`;
