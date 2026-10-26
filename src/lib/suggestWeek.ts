// Ren logikk for «Foreslå uke» i Ukeplan: fordeler oppskrifter på handleuka
// (lørdag–fredag, se handleukeStart) etter en middagsrytme med rester-dager.
// Holdt utenfor komponenten og med injisert rng, så den kan testes uten React
// og deterministisk.
import type { MealPlanEntry, Recipe } from '../contexts/MatplanContext';
import { addDaysLocal } from './dagensMiddag';

// ── Malen ────────────────────────────────────────────────────────────────────

/** Dagindeks i handleuka: 0 = lørdag … 6 = fredag. */
export type PatternBlock = {
  id: string;
  /** Dagen oppskriften lages. */
  cookDay: number;
  /** Dager med rester av samme oppskrift. */
  leftoverDays: number[];
};

export type VariableMode = 'leftover' | 'new' | 'none';

export interface DinnerPattern {
  blocks: PatternBlock[];
  /** Dagen som varierer fra uke til uke (fredag): rester av `leftoverFrom`, ny middag eller ingen. */
  variable: { id: string; day: number; leftoverFrom: string; defaultMode: VariableMode };
}

// Husstandens rytme: lør ny, søn ny (rester man + tir), ons ny (rester tor),
// fredag varierer. Eneste sted malen er definert, så den senere kan gjøres
// redigerbar uten å røre resten av koden.
export const DEFAULT_DINNER_PATTERN: DinnerPattern = {
  blocks: [
    { id: 'lor', cookDay: 0, leftoverDays: [] },
    { id: 'son', cookDay: 1, leftoverDays: [2, 3] },
    { id: 'ons', cookDay: 4, leftoverDays: [5] },
  ],
  variable: { id: 'fre', day: 6, leftoverFrom: 'ons', defaultMode: 'leftover' },
};

/** Siste ~3 uker før handleuka: oppskrifter brukt da vektes ned. */
export const RECENT_DAYS = 21;

/** Blokkene malen gir med valgt modus for den variable dagen, sortert på lagedag. */
export function resolvePattern(pattern: DinnerPattern, mode: VariableMode): PatternBlock[] {
  const v = pattern.variable;
  let blocks: PatternBlock[];
  if (mode === 'none') blocks = pattern.blocks;
  else if (mode === 'new') blocks = [...pattern.blocks, { id: v.id, cookDay: v.day, leftoverDays: [] }];
  else blocks = pattern.blocks.map(b => b.id === v.leftoverFrom ? { ...b, leftoverDays: [...b.leftoverDays, v.day] } : b);
  return [...blocks].sort((a, b) => a.cookDay - b.cookDay);
}

// ── Forslaget ────────────────────────────────────────────────────────────────

export interface SuggestedDay {
  date: string;
  /** Oppskriften som allerede står på dagen (låst), ellers null. */
  existingRecipeId: string | null;
}

export type BlockOrigin =
  | 'locked'     // alle dagene har allerede middag — ingenting å foreslå
  | 'anchored'   // lagedagen har middag fra før; ledige rester-dager får samme oppskrift
  | 'fixed'      // oppskriften er bestemt av brukeren (lås / velg selv)
  | 'suggested'  // trukket av suggestWeek
  | 'none';      // ingen oppskrift igjen å foreslå

export interface SuggestedBlock {
  id: string;
  /** Dagen oppskriften lages (første gjenværende dag hvis lagedagen er passert uten middag). */
  cookDate: string;
  /** Blokkens dager som ikke er passert, stigende. */
  days: SuggestedDay[];
  /** Dagene i `days` uten middag fra før — kun disse skal lagres. */
  freeDates: string[];
  /** Oppskriften for `freeDates`; null ved 'locked' og 'none'. */
  recipeId: string | null;
  origin: BlockOrigin;
}

export interface SuggestWeekInput {
  /** Handleukens lørdag. */
  weekStart: string;
  /** Dagens dato (Oslo). Dager før denne foreslås ikke. */
  today: string;
  recipes: Recipe[];
  /** Hele meal_plan — brukes til «nylig brukt». */
  history: MealPlanEntry[];
  /** Oppføringer som allerede finnes i uka. Oppføringer utenfor uka ignoreres. */
  existing: MealPlanEntry[];
  pattern?: DinnerPattern;
  /** Valg for den variable dagen; default fra malen. */
  variableMode?: VariableMode;
  rng?: () => number;
  /** blokk-id → oppskrift brukeren har bestemt (lås / velg selv / beholdt forslag). Ugyldige ignoreres. */
  fixed?: Record<string, string>;
  /** Oppskrifter som ikke skal trekkes (f.eks. den «Bytt» skal bort fra). */
  exclude?: string[];
}

function daysBetween(fromIso: string, toIso: string): number {
  const [y1, m1, d1] = fromIso.split('-').map(Number);
  const [y2, m2, d2] = toIso.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000);
}

export function suggestWeek({
  weekStart, today, recipes, history, existing,
  pattern = DEFAULT_DINNER_PATTERN, variableMode, rng = Math.random, fixed = {}, exclude = [],
}: SuggestWeekInput): SuggestedBlock[] {
  const mode = variableMode ?? pattern.variable.defaultMode;
  const dates = Array.from({ length: 7 }, (_, i) => addDaysLocal(weekStart, i));
  const inWeek = new Set(dates);
  const existingByDate = new Map(existing.filter(e => inWeek.has(e.date)).map(e => [e.date, e.recipeId]));
  const validIds = new Set(recipes.map(r => r.id));

  // Nylig brukt: sist brukt før handleuka, innen siste ~3 uker. Oppføringer
  // i selve uka er allerede utelukket via `used` under.
  const windowStart = addDaysLocal(weekStart, -RECENT_DAYS);
  const lastUsed = new Map<string, string>();
  for (const e of history) {
    if (e.date >= weekStart || e.date < windowStart) continue;
    const prev = lastUsed.get(e.recipeId);
    if (!prev || e.date > prev) lastUsed.set(e.recipeId, e.date);
  }

  const used = new Set(existingByDate.values());
  const blocks: SuggestedBlock[] = [];
  const needsPick: SuggestedBlock[] = [];

  for (const b of resolvePattern(pattern, mode)) {
    const allDates = [b.cookDay, ...b.leftoverDays].map(i => dates[i]).sort();
    const upcoming = allDates.filter(d => d >= today);
    if (upcoming.length === 0) continue;

    const days = upcoming.map(date => ({ date, existingRecipeId: existingByDate.get(date) ?? null }));
    const freeDates = days.filter(d => !d.existingRecipeId).map(d => d.date);
    const anchor = existingByDate.get(allDates[0]) ?? null;
    const block: SuggestedBlock = {
      id: b.id, cookDate: anchor ? allDates[0] : upcoming[0], days, freeDates, recipeId: null, origin: 'none',
    };
    blocks.push(block);

    if (freeDates.length === 0) block.origin = 'locked';
    else if (anchor) { block.origin = 'anchored'; block.recipeId = anchor; }
    else if (fixed[b.id] && validIds.has(fixed[b.id])) {
      block.origin = 'fixed';
      block.recipeId = fixed[b.id];
      used.add(fixed[b.id]);
    } else needsPick.push(block);
  }

  const skip = new Set(exclude);
  let pool = recipes.filter(r => !used.has(r.id) && !skip.has(r.id));

  // Friske først. Er ingen friske igjen, trekkes blant nylig brukte, vektet
  // etter hvor lenge siden de sist ble brukt (eldst mest sannsynlig).
  const draw = (): Recipe | null => {
    const fresh = pool.filter(r => !lastUsed.has(r.id));
    if (fresh.length > 0) return fresh[Math.min(Math.floor(rng() * fresh.length), fresh.length - 1)];
    if (pool.length === 0) return null;
    const weights = pool.map(r => Math.max(daysBetween(lastUsed.get(r.id)!, weekStart), 1));
    let r = rng() * weights.reduce((a, w) => a + w, 0);
    for (let i = 0; i < pool.length; i++) {
      r -= weights[i];
      if (r < 0) return pool[i];
    }
    return pool[pool.length - 1];
  };

  for (const block of needsPick) {
    const r = draw();
    if (!r) continue; // for få oppskrifter: blokken står tom
    block.recipeId = r.id;
    block.origin = 'suggested';
    pool = pool.filter(p => p.id !== r.id);
  }

  return blocks;
}

/** Radene som skal lagres: blokkens oppskrift på hver ledige dag. */
export function suggestionEntries(blocks: SuggestedBlock[]): { date: string; recipeId: string }[] {
  return blocks
    .flatMap(b => b.recipeId ? b.freeDates.map(date => ({ date, recipeId: b.recipeId! })) : [])
    .sort((a, b) => a.date.localeCompare(b.date));
}

const WEEKDAY_SHORT = ['lør', 'søn', 'man', 'tir', 'ons', 'tor', 'fre'];

/** «Søn–tir», «Lør», «Søn og tir» (hull) — ukedagene for datoene i handleuka fra `weekStart`. */
export function dayRangeLabel(weekStart: string, dates: string[]): string {
  const idx = dates.map(d => daysBetween(weekStart, d)).filter(i => i >= 0 && i < 7).sort((a, b) => a - b);
  const ranges: [number, number][] = [];
  for (const i of idx) {
    const last = ranges[ranges.length - 1];
    if (last && last[1] === i - 1) last[1] = i;
    else ranges.push([i, i]);
  }
  const text = ranges
    .map(([a, b]) => a === b ? WEEKDAY_SHORT[a] : `${WEEKDAY_SHORT[a]}–${WEEKDAY_SHORT[b]}`)
    .join(' og ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** «søndag», «onsdag» … — navnet på lagedagen i «lages søndag». */
export function weekdayName(weekStart: string, date: string): string {
  return ['lørdag', 'søndag', 'mandag', 'tirsdag', 'onsdag', 'torsdag', 'fredag'][daysBetween(weekStart, date)] ?? '';
}
