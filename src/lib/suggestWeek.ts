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

/**
 * Taggen for retter som ikke tåler rester: de lages og spises samme dag og
 * skal aldri strekkes over flere dager.
 */
export const ONE_DAY_TAG = '1 dag';

// Tagger er fritekst, så sammenlign uten store/små bokstaver og uten
// mellomrom («1 dag», «1 Dag», « 1 dag », «1dag»). «11 dager» treffer ikke.
const normTag = (t: string) => t.toLocaleLowerCase('nb').replace(/\s+/g, '');

export function isOneDayRecipe(recipe: Pick<Recipe, 'tags'> | null | undefined): boolean {
  return !!recipe && Array.isArray(recipe.tags) && recipe.tags.some(t => typeof t === 'string' && normTag(t) === normTag(ONE_DAY_TAG));
}

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
  /**
   * Satt når blokken er resten av en blokk som ble delt fordi lagedagens
   * oppskrift er en «1 dag»-rett (tåler ikke rester). `recipeId` er den retten.
   */
  splitFrom: { blockId: string; recipeId: string } | null;
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
  const recipeById = new Map(recipes.map(r => [r.id, r]));
  const validIds = new Set(recipeById.keys());
  const oneDay = (id: string | null | undefined) => !!id && isOneDayRecipe(recipeById.get(id));

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

  const makeBlock = (id: string, cookDate: string, days: SuggestedDay[]): SuggestedBlock => ({
    id, cookDate, days, freeDates: days.filter(d => !d.existingRecipeId).map(d => d.date),
    recipeId: null, origin: 'none', splitFrom: null,
  });

  // Deler `block` etter `afterDate`: dagene etter blir en egen blokk med nytt
  // forslag («1 dag»-retter får ikke rester). Null hvis det ikke er noe ledig igjen.
  const splitOff = (block: SuggestedBlock, afterDate: string, recipeId: string): SuggestedBlock | null => {
    const rest = makeBlock(`${block.id}-rest`, '', block.days.filter(d => d.date > afterDate));
    if (rest.freeDates.length === 0) return null;
    rest.cookDate = rest.freeDates[0];
    rest.splitFrom = { blockId: block.id, recipeId };
    block.days = block.days.filter(d => d.date <= afterDate);
    block.freeDates = block.days.filter(d => !d.existingRecipeId).map(d => d.date);
    return rest;
  };

  const place = (block: SuggestedBlock, anchor: string | null, patternCook: string): void => {
    blocks.push(block);
    let rest: SuggestedBlock | null = null;

    if (block.freeDates.length === 0) block.origin = 'locked';
    else if (anchor) {
      // Lagedagen har middag fra før. En «1 dag»-rett gir ikke rester.
      if (oneDay(anchor) && (rest = splitOff(block, patternCook, anchor))) {
        block.origin = 'locked';
        if (block.days.length === 0) blocks.splice(blocks.indexOf(block), 1);
      } else { block.origin = 'anchored'; block.recipeId = anchor; }
    } else if (fixed[block.id] && validIds.has(fixed[block.id])) {
      const f = fixed[block.id];
      used.add(f);
      // «Velg selv» med en «1 dag»-rett i en flerdagsblokk: den får bare lagedagen.
      if (oneDay(f) && block.freeDates.length > 1) rest = splitOff(block, block.freeDates[0], f);
      block.origin = 'fixed';
      block.recipeId = f;
    } else needsPick.push(block);

    if (rest) place(rest, null, rest.cookDate);
  };

  for (const b of resolvePattern(pattern, mode)) {
    const allDates = [b.cookDay, ...b.leftoverDays].map(i => dates[i]).sort();
    const upcoming = allDates.filter(d => d >= today);
    if (upcoming.length === 0) continue;

    const days = upcoming.map(date => ({ date, existingRecipeId: existingByDate.get(date) ?? null }));
    const anchor = existingByDate.get(allDates[0]) ?? null;
    place(makeBlock(b.id, anchor ? allDates[0] : upcoming[0], days), anchor, allDates[0]);
  }

  const skip = new Set(exclude);
  let pool = recipes.filter(r => !used.has(r.id) && !skip.has(r.id));

  // Friske først. Er ingen friske igjen, trekkes blant nylig brukte, vektet
  // etter hvor lenge siden de sist ble brukt (eldst mest sannsynlig).
  const draw = (from: Recipe[]): Recipe | null => {
    const fresh = from.filter(r => !lastUsed.has(r.id));
    if (fresh.length > 0) return fresh[Math.min(Math.floor(rng() * fresh.length), fresh.length - 1)];
    if (from.length === 0) return null;
    const weights = from.map(r => Math.max(daysBetween(lastUsed.get(r.id)!, weekStart), 1));
    let r = rng() * weights.reduce((a, w) => a + w, 0);
    for (let i = 0; i < from.length; i++) {
      r -= weights[i];
      if (r < 0) return from[i];
    }
    return from[from.length - 1];
  };

  needsPick.forEach((block, i) => {
    // «1 dag»-retter kan aldri strekkes over flere dager.
    const multi = block.freeDates.length > 1;
    const normal = pool.filter(r => !isOneDayRecipe(r));
    let from = multi ? normal : pool;
    if (!multi) {
      // En enkeltdag tar en «1 dag»-rett i stedet for en vanlig hvis de vanlige
      // ellers ikke rekker til flerdagsblokkene som står igjen.
      const laterMulti = needsPick.slice(i + 1).filter(b => b.freeDates.length > 1).length;
      const ones = pool.filter(r => isOneDayRecipe(r));
      if (ones.length > 0 && normal.length <= laterMulti) from = ones;
    }
    const r = draw(from);
    if (!r) return; // for få oppskrifter: blokken står tom
    block.recipeId = r.id;
    block.origin = 'suggested';
    pool = pool.filter(p => p.id !== r.id);
  });

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
