import type { Ingredient, MealPlanEntry } from '../contexts/MatplanContext';

// Rene hjelpere for «Dagens middag» på Gangskjerm (Skjerm.tsx): hvor mange
// dager på rad samme oppskrift er planlagt, og hvordan ingredienser vises når
// mengden dekker flere dager. Kun visning — påvirker aldri syncGroceryList.

// Lokal dato-aritmetikk (ikke toISOString/UTC) så sommertid og midnatt ikke
// kan skyve datoen en dag. Tar og gir yyyy-mm-dd.
export function addDaysLocal(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d + n);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

// Antall sammenhengende dager fra og med `startDate` med samme recipeId.
// Stopper ved første dag med annen oppskrift eller uten oppføring. 0 hvis
// ingen middag er planlagt på startDate.
export function consecutiveDays(mealPlan: MealPlanEntry[], startDate: string): number {
  const byDate = new Map(mealPlan.map(mp => [mp.date, mp.recipeId]));
  const id = byDate.get(startDate);
  if (!id) return 0;
  let n = 1;
  while (byDate.get(addDaysLocal(startDate, n)) === id) n++;
  return n;
}

const fmtNumber = (n: number) =>
  n.toLocaleString('nb-NO', { maximumFractionDigits: 2 });

// Mengde-teksten for én ingrediens (uten navn), eller '' hvis det ikke er noe
// å vise. amount multipliseres med `days`; et intervall (amountRange) vises
// uendret med «×N» ved siden av, siden fritekst ikke kan skaleres trygt.
export function formatIngredientAmount(ing: Pick<Ingredient, 'amount' | 'unit' | 'amountRange'>, days = 1): string {
  const unit = ing.unit ?? '';
  let qty = '';
  if (ing.amountRange) {
    qty = ing.amountRange.replace(/\./g, ',');
    return `${qty}${unit ? ` ${unit}` : ''}${days > 1 ? ` ×${days}` : ''}`;
  }
  if (ing.amount != null) qty = fmtNumber(ing.amount * Math.max(days, 1));
  return [qty, unit].filter(Boolean).join(' ');
}
