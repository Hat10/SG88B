import type { Who } from '../data';

/** Fanerekkefølge for personvalg: Felles, Andreas, Taran. */
export const WHO_TAB_ORDER: Who[] = ['f', 'M', 'L'];

/**
 * Hører et element hjemme i valgt fane?
 * Felles-fanen viser alt når `kunFelles` er av, ellers bare felles-elementer.
 * Andreas- og Taran-fanen viser bare den personens elementer.
 */
export function matchesWhoView(itemWho: Who, tab: Who, kunFelles: boolean): boolean {
  if (tab === 'f') return !kunFelles || itemWho === 'f';
  return itemWho === tab;
}

/** Antall ikke-fullførte elementer per person (uavhengig av «kun felles»). */
export function openCountsByWho(items: ReadonlyArray<{ who: Who; done: boolean }>): Record<Who, number> {
  const counts: Record<Who, number> = { f: 0, M: 0, L: 0 };
  for (const it of items) {
    if (!it.done) counts[it.who] += 1;
  }
  return counts;
}
