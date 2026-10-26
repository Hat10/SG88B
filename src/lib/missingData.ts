import type { Recipe } from '../contexts/MatplanContext';

// Avledede varseltagger for middager som mangler data. Beregnes alltid fra
// selve oppskriften ved visning — aldri lagret — så de forsvinner av seg selv
// så snart dataene legges inn (også live via Realtime på `recipes`).

export type MissingDataTag = 'ingredients' | 'instructions';

export const MISSING_DATA_LABEL: Record<MissingDataTag, string> = {
  ingredients: 'mangler ingredienser',
  instructions: 'mangler oppskrift',
};

type RecipeLike = Pick<Recipe, 'ingredients' | 'instructions'>;

/**
 * Hvilke varseltagger gjelder for oppskriften? Tom liste ⇒ ingenting mangler.
 *
 * - «ingredients»: ingen ingrediens med et ikke-blankt navn (tom liste,
 *   null/undefined eller bare tomme rader).
 * - «instructions» («mangler oppskrift»): fremgangsmåten er null, tom eller
 *   bare whitespace. Det finnes ikke noe eget lenkefelt i datamodellen.
 *
 * `null`/`undefined` (en ukeplan-oppføring uten koblet oppskrift) gir alltid
 * [] — vi vet ingenting å advare om. `only` begrenser hvilke tagger som
 * vurderes (ukeplanen viser kun «ingredients»).
 */
export function getMissingDataTags(
  recipe: Partial<RecipeLike> | null | undefined,
  only?: readonly MissingDataTag[],
): MissingDataTag[] {
  if (!recipe) return [];
  const tags: MissingDataTag[] = [];
  const hasIngredients = Array.isArray(recipe.ingredients)
    && recipe.ingredients.some(i => !!i && typeof i.name === 'string' && i.name.trim() !== '');
  if (!hasIngredients) tags.push('ingredients');
  if (!recipe.instructions || recipe.instructions.trim() === '') tags.push('instructions');
  return only ? tags.filter(t => only.includes(t)) : tags;
}
