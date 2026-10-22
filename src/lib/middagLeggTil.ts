// Ren logikk for «Legg til middag» på Gangskjerm (MiddagAddModal): hvor mange
// dager på rad man kan legge middagen på, hvilke datoer som havner i
// inneværende handleuke, og «mest brukt»-lista. Holdt utenfor komponenten så
// den kan testes uten React.
import type { MealPlanEntry } from '../contexts/MatplanContext';
import { addDaysLocal } from './dagensMiddag';
import { cookCountByRecipe, lastCookedByRecipe } from './middagVelger';

/** Samme horisont som middag-kortet: i dag + 13 dager. */
export const MAX_DAYS_AHEAD = 13;
/** Øvre tak på ×N-steppern, uansett hvor mange dager som er ledige. */
export const MAX_MEAL_DAYS = 7;

export interface MealDaysLimit {
  /** Antall dager som kan velges (≥ 1 så lenge startdagen er ledig, 0 hvis den er opptatt). */
  max: number;
  /** Første opptatte dag som stopper rekken, eller null hvis noe annet begrenset (horisont/tak). */
  blockedBy: string | null;
}

/**
 * Maks antall sammenhengende ledige dager fra og med `date`. Stopper ved første
 * dag med middag, ved horisonten (i dag + MAX_DAYS_AHEAD) eller ved `cap`.
 * `blockedBy` er dagen som stoppet rekken, kun hvis det var en opptatt dag.
 */
export function maxMealDays(
  mealPlan: MealPlanEntry[], date: string, today: string,
  { horizon = MAX_DAYS_AHEAD, cap = MAX_MEAL_DAYS }: { horizon?: number; cap?: number } = {},
): MealDaysLimit {
  const taken = new Set(mealPlan.map(mp => mp.date));
  const lastAllowed = addDaysLocal(today, horizon);
  let n = 0;
  while (n < cap) {
    const d = addDaysLocal(date, n);
    if (d > lastAllowed) break;
    if (taken.has(d)) return { max: n, blockedBy: d };
    n++;
  }
  return { max: n, blockedBy: null };
}

/** `days` påfølgende datoer fra og med `date`. */
export function mealDates(date: string, days: number): string[] {
  return Array.from({ length: Math.max(days, 0) }, (_, i) => addDaysLocal(date, i));
}

/**
 * Datoene som ligger i handleuken som starter på `weekStart` (lørdag, se
 * handleukeStart): `weekStart` t.o.m. 6 dager senere. Dager utenfor får ikke
 * handlelisterader med en gang (samme regel som Ukeplan).
 */
export function datesInHandleuke(dates: string[], weekStart: string): string[] {
  const last = addDaysLocal(weekStart, 6);
  return dates.filter(d => d >= weekStart && d <= last);
}

/** Er noen av datoene allerede opptatt i planen? */
export function anyTaken(mealPlan: MealPlanEntry[], dates: string[]): boolean {
  const taken = new Set(mealPlan.map(mp => mp.date));
  return dates.some(d => taken.has(d));
}

/**
 * Oppskrifter sortert etter hvor mange ganger de er LAGET (≤ i dag, rester
 * teller ikke), flest først; likt ⇒ sist laget først. `exclude` tas ut (f.eks.
 * de som allerede står i «Nylig brukt»).
 */
export function mostUsedRecipeIds(
  mealPlan: MealPlanEntry[], today: string, limit = 6, exclude: string[] = [],
): string[] {
  const counts = cookCountByRecipe(mealPlan, today);
  const last = lastCookedByRecipe(mealPlan, today);
  const skip = new Set(exclude);
  return [...counts.entries()]
    .filter(([id]) => !skip.has(id))
    .sort((a, b) => b[1] - a[1] || (last.get(b[0]) ?? '').localeCompare(last.get(a[0]) ?? ''))
    .slice(0, limit)
    .map(([id]) => id);
}

/** «onsdag 28. okt» — lang ukedag til modaltittelen. */
export function longDayLabel(iso: string): string {
  const d = new Date(iso + 'T12:00:00');
  const wd = d.toLocaleDateString('nb-NO', { weekday: 'long' });
  const mon = d.toLocaleDateString('nb-NO', { month: 'short' }).replace('.', '');
  return `${wd} ${d.getDate()}. ${mon}`;
}
