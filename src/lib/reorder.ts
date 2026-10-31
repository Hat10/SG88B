// Ren rekkefølge-logikk for sorterbare lister (ingredienser i RecipeForm via
// SortableList). Holdt fri for React/dnd-kit så den kan testes direkte.
//
// Ingredienser lagres som en JSON-array på recipes.ingredients — rekkefølgen
// i arrayen ER rekkefølgen, så det finnes ingen egen position-verdi å regne ut.

/**
 * Flytter elementet på `from` til `to` og returnerer en NY array (samme
 * semantikk som dnd-kit sin arrayMove). Indekser utenfor listen, eller
 * from === to, gir en uendret kopi.
 */
export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  const next = items.slice();
  if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) return next;
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/** ▲ er deaktivert for øverste element (og for ugyldige indekser). */
export function canMoveUp(index: number, length: number): boolean {
  return index > 0 && index < length;
}

/** ▼ er deaktivert for nederste element (og for ugyldige indekser). */
export function canMoveDown(index: number, length: number): boolean {
  return index >= 0 && index < length - 1;
}

/** ▲/▼-knappene: flytter ett hakk, eller lar listen stå hvis det ikke går. */
export function moveByStep<T>(items: readonly T[], index: number, direction: 'up' | 'down'): T[] {
  if (direction === 'up') return canMoveUp(index, items.length) ? moveItem(items, index, index - 1) : items.slice();
  return canMoveDown(index, items.length) ? moveItem(items, index, index + 1) : items.slice();
}
