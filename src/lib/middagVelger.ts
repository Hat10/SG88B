// Ren logikk for middagsvelgeren i Ukeplan (søk, «sist laget», «nylig brukt»,
// rester-merking). Holdt utenfor komponenten så den kan testes uten React.
import type { MealPlanEntry, Recipe } from '../contexts/MatplanContext';
import { addDaysLocal } from './dagensMiddag';

const norm = (s: string) => s.toLocaleLowerCase('nb').trim();

/**
 * Søk på navn, ingrediensnavn og tags. Alle ord i søket må treffe et sted
 * (så «kylling ris» finner oppskrifter med begge). Rangering: navn som
 * starter med søket → ord i navnet som starter med søket → navn som
 * inneholder søket → treff kun i tags/ingredienser. Tomt søk ⇒ alle,
 * alfabetisk.
 */
export function searchRecipes(recipes: Recipe[], query: string): Recipe[] {
  const q = norm(query);
  const byName = (a: Recipe, b: Recipe) => a.name.localeCompare(b.name, 'nb');
  if (!q) return [...recipes].sort(byName);
  const words = q.split(/\s+/).filter(Boolean);

  const scored: { r: Recipe; score: number }[] = [];
  for (const r of recipes) {
    const name = norm(r.name);
    const haystack = [name, ...r.tags.map(norm), ...r.ingredients.map(i => norm(i.name))].join(' \u0000 ');
    if (!words.every(w => haystack.includes(w))) continue;
    let score = 3;
    if (name.startsWith(q)) score = 0;
    else if (name.split(/[\s-]+/).some(part => part.startsWith(words[0]))) score = 1;
    else if (name.includes(words[0])) score = 2;
    scored.push({ r, score });
  }
  return scored.sort((a, b) => a.score - b.score || byName(a.r, b.r)).map(s => s.r);
}

/** Siste dato (≤ i dag) hver oppskrift har stått på planen. */
export function lastCookedByRecipe(mealPlan: MealPlanEntry[], today: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const mp of mealPlan) {
    if (mp.date > today) continue;
    const prev = out.get(mp.recipeId);
    if (!prev || mp.date > prev) out.set(mp.recipeId, mp.date);
  }
  return out;
}

/** Distinkte oppskrifter sortert etter sist brukt (≤ i dag), nyeste først. */
export function recentRecipeIds(mealPlan: MealPlanEntry[], today: string, limit = 6): string[] {
  return [...lastCookedByRecipe(mealPlan, today).entries()]
    .sort((a, b) => (a[1] < b[1] ? 1 : a[1] > b[1] ? -1 : 0))
    .slice(0, limit)
    .map(([id]) => id);
}

function daysBetween(fromIso: string, toIso: string): number {
  const [y1, m1, d1] = fromIso.split('-').map(Number);
  const [y2, m2, d2] = toIso.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000);
}

/** «i dag», «i går», «5 dager siden», «3 uker siden», «2 mnd siden», «aldri laget». */
export function lastCookedLabel(lastDate: string | undefined, today: string): string {
  if (!lastDate) return 'aldri laget';
  const n = daysBetween(lastDate, today);
  if (n <= 0) return 'i dag';
  if (n === 1) return 'i går';
  if (n < 14) return `${n} dager siden`;
  if (n < 60) return `${Math.floor(n / 7)} uker siden`;
  return `${Math.floor(n / 30)} mnd siden`;
}

/**
 * Er `date` en «rester»-dag, dvs. samme oppskrift som dagen før? Kun visning —
 * handlelisten skal fortsatt telle hver dag (oppskriftene er for én dag, og
 * man lager hele mengden første dag).
 */
export function isLeftoverDay(mealPlan: MealPlanEntry[], date: string): boolean {
  const today = mealPlan.find(mp => mp.date === date);
  if (!today) return false;
  const prev = mealPlan.find(mp => mp.date === addDaysLocal(date, -1));
  return prev?.recipeId === today.recipeId;
}
