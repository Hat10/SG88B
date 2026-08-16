import { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { handleukeStart } from '../hooks/useWeeklyBucket';

// Faste enhetsvalg — delt mellom oppskrift-editoren (Ingredient.unit) og
// «Legg til kjøpsfrekvens» i StapleManager (StapleItem.unit), én kilde til
// sannhet i stedet for to separate lister som kan gli fra hverandre.
export const INGREDIENT_UNITS = ['stk', 'g', 'kg', 'dl', 'ml', 'l', 'ts', 'ss', 'klype', 'boks/pakke'] as const;

export interface Ingredient {
  name: string;
  amount: number | null;
  unit: string | null;
  // Besluttet og lagret permanent når oppskriften opprettes/redigeres — IKKE
  // regnet ut på nytt hver gang en middag planlegges (se syncGroceryList).
  // false ⇒ ingrediensen matchet en basisvare (staple_items) og ble aktivt
  // latt stå av; true ⇒ vanlig oppførsel, med på handlelisten. Oppskrifter
  // fra før dette feltet fantes mangler det helt (undefined) — behandles som
  // true i syncGroceryList, se kommentar der for hvorfor.
  onGroceryList?: boolean;
  // Tekstlig intervall (f.eks. "0.5-1") for ingredienser der et enkelt tall
  // ikke passer — typisk krydder ("0.5-1 ts salt"). Nøyaktig én av amount/
  // amountRange er satt, aldri begge; ikke satt (undefined) for oppskrifter
  // fra før dette feltet fantes. Se groupByNameUnit i HandlelisteCard.tsx for
  // hvorfor et intervall aldri summeres numerisk med andre rader.
  amountRange?: string | null;
}

export type RecipeSource = 'egen' | 'spoonacular';

export interface Recipe {
  id: string;
  name: string;
  ingredients: Ingredient[];
  cookTimeMinutes: number | null;
  instructions: string | null;
  tags: string[];
  source: RecipeSource;
}

export interface MealPlanEntry {
  id: string;
  date: string;       // yyyy-mm-dd
  recipeId: string;
}

export interface StapleItem {
  id: string;
  name: string;
  amount: number | null;
  unit: string | null;
  // null = ingen kjøpsfrekvens definert — ren referanse i lista, forfaller
  // aldri (se isStapleDue). Atskilt fra en eksplisitt verdi som 1 ("hver uke").
  intervalWeeks: number | null;
  lastBoughtAt: string | null;
  postponedUntil: string | null;
}

export interface GroceryItem {
  id: string;
  name: string;
  amount: number | null;
  // Kopiert fra Ingredient.amountRange (se der) når raden stammer fra en
  // oppskrift-ingrediens med intervall — alltid null for basisvare- og
  // frittstående rader, som aldri har hatt et intervall å arve.
  amountRange: string | null;
  unit: string | null;
  done: boolean;
  // Satt av toggleGroceryItem() når raden markeres kjøpt, nullstilt hvis
  // avhukingen angres. Brukes til å avgrense «Vis handlet» til inneværende
  // handleuke (se HandlelisteCard.tsx) — rader avhuket i en tidligere
  // handleuke skal ikke ligge og hope seg opp der.
  doneAt: string | null;
  mealPlanId: string | null;
  stapleItemId: string | null;
}

interface MatplanCtx {
  recipes: Recipe[];
  mealPlan: MealPlanEntry[];
  stapleItems: StapleItem[];
  groceryItems: GroceryItem[];
  loading: boolean;
  addRecipe: (r: Omit<Recipe, 'id'>) => Promise<void>;
  updateRecipe: (id: string, patch: Partial<Omit<Recipe, 'id'>>) => Promise<void>;
  removeRecipe: (id: string) => Promise<void>;
  restoreRecipe: (r: Recipe) => Promise<void>;
  setMealPlan: (date: string, recipeId: string) => Promise<void>;
  clearMealPlan: (date: string) => Promise<void>;
  addStaple: (s: Omit<StapleItem, 'id'>) => Promise<void>;
  updateStaple: (id: string, patch: Partial<Omit<StapleItem, 'id'>>) => Promise<void>;
  removeStaple: (id: string) => Promise<void>;
  restoreStaple: (s: StapleItem) => Promise<void>;
  /** Genererer manglende handlelistevarer for denne uken (planlagte middager + forfalte basisvarer). Idempotent. */
  syncGroceryList: () => Promise<void>;
  /** Frittstående dagligvare — ikke koblet til en middag eller basisvare. */
  addGroceryItem: (input: { name: string; amount: number | null }) => Promise<void>;
  setGroceryAmount: (id: string, amount: number) => Promise<void>;
  toggleGroceryItem: (id: string) => Promise<void>;
  removeGroceryItem: (id: string) => Promise<void>;
}

const noop = async () => {};

const MatplanContext = createContext<MatplanCtx>({
  recipes: [], mealPlan: [], stapleItems: [], groceryItems: [], loading: true,
  addRecipe: noop, updateRecipe: noop, removeRecipe: noop, restoreRecipe: noop,
  setMealPlan: noop, clearMealPlan: noop,
  addStaple: noop, updateStaple: noop, removeStaple: noop, restoreStaple: noop,
  syncGroceryList: noop, addGroceryItem: noop, setGroceryAmount: noop,
  toggleGroceryItem: noop, removeGroceryItem: noop,
});

const recipeFromRow = (r: Record<string, unknown>): Recipe => ({
  id: r.id as string,
  name: r.name as string,
  ingredients: Array.isArray(r.ingredients) ? (r.ingredients as Ingredient[]) : [],
  cookTimeMinutes: (r.cook_time_minutes as number | null) ?? null,
  instructions: (r.instructions as string | null) ?? null,
  tags: Array.isArray(r.tags) ? (r.tags as string[]) : [],
  source: (r.source as RecipeSource) ?? 'egen',
});

const mealPlanFromRow = (r: Record<string, unknown>): MealPlanEntry => ({
  id: r.id as string,
  date: r.date as string,
  recipeId: r.recipe_id as string,
});

const stapleFromRow = (r: Record<string, unknown>): StapleItem => ({
  id: r.id as string,
  name: r.name as string,
  amount: r.amount == null ? null : Number(r.amount),
  unit: (r.unit as string | null) ?? null,
  intervalWeeks: r.interval_weeks == null ? null : Number(r.interval_weeks),
  lastBoughtAt: (r.last_bought_at as string | null) ?? null,
  postponedUntil: (r.postponed_until as string | null) ?? null,
});

const groceryFromRow = (r: Record<string, unknown>): GroceryItem => ({
  id: r.id as string,
  name: r.name as string,
  amount: r.amount == null ? null : Number(r.amount),
  amountRange: (r.amount_range as string | null) ?? null,
  unit: (r.unit as string | null) ?? null,
  done: !!r.done,
  doneAt: (r.done_at as string | null) ?? null,
  mealPlanId: (r.meal_plan_id as string | null) ?? null,
  stapleItemId: (r.staple_item_id as string | null) ?? null,
});

/**
 * Datoene (yyyy-mm-dd) fra og med gitt startdato til og med 6 dager senere.
 * Anker-agnostisk — bryr seg ikke om startKey er en mandag (osloMondayKey)
 * eller en lørdag (handleukeStart, selve handleuke-syklusen). Kalleren
 * avgjør hvilket 7-dagers vindu det er.
 */
export function weekDates(startKey: string): string[] {
  const [y, m, d] = startKey.split('-').map(Number);
  const start = new Date(Date.UTC(y, m - 1, d));
  return Array.from({ length: 7 }, (_, i) => {
    const dt = new Date(start);
    dt.setUTCDate(dt.getUTCDate() + i);
    return dt.toISOString().slice(0, 10);
  });
}

const todayKey = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Oslo' });

// En basisvare er forfalt når minst intervallet i hele handleuke-sykluser
// (lørdag–fredag) har passert siden handleuken sist kjøpt-datoen falt i —
// IKKE rå dager siden kjøpsdatoen. Kjøper du melk en tirsdag, forfaller den
// derfor ved neste lørdag som starter en ny syklus intervallet unna, ikke
// nøyaktig 7×intervall dager senere — hele husstandens ukentlige basisvarer
// forfaller dermed samtidig, på lørdager, uansett hvilken dag i forrige
// syklus de faktisk ble kjøpt. Ingen definert frekvens (intervalWeeks null)
// ⇒ ren referanse i lista, forfaller aldri av seg selv — uendret fra før
// denne ombyggingen.
function isStapleDue(s: StapleItem, today: string): boolean {
  if (s.intervalWeeks == null) return false;
  if (s.postponedUntil && s.postponedUntil > today) return false;
  if (!s.lastBoughtAt) return true;

  const lastCycleStart = handleukeStart(new Date(s.lastBoughtAt + 'T00:00:00Z'));
  const nowCycleStart  = handleukeStart(new Date(today + 'T00:00:00Z'));
  // To handleuke-startdatoer er alltid et helt multiplum av 7 dager fra
  // hverandre, så dette blir alltid et eksakt heltall — Math.round er kun
  // samme sikkerhetsmargin den forrige rå-dager-utregningen hadde.
  const cyclesPassed = Math.round(
    (new Date(nowCycleStart + 'T00:00:00Z').getTime() - new Date(lastCycleStart + 'T00:00:00Z').getTime())
    / (7 * 86_400_000)
  );
  return cyclesPassed >= s.intervalWeeks;
}

export function MatplanProvider({ children }: { children: React.ReactNode }) {
  const [recipes,      setRecipes]      = useState<Recipe[]>([]);
  const [mealPlan,     setMealPlanRows] = useState<MealPlanEntry[]>([]);
  const [stapleItems,  setStapleItems]  = useState<StapleItem[]>([]);
  const [groceryItems, setGroceryItems] = useState<GroceryItem[]>([]);
  const [loading,      setLoading]      = useState(true);

  const load = async () => {
    const [{ data: rec }, { data: mp }, { data: st }, { data: gr }] = await Promise.all([
      supabase.from('recipes').select('*').order('name'),
      supabase.from('meal_plan').select('*').order('date'),
      supabase.from('staple_items').select('*').order('name'),
      supabase.from('grocery_items').select('*').order('created_at'),
    ]);
    if (rec) setRecipes(rec.map(recipeFromRow));
    if (mp) setMealPlanRows(mp.map(mealPlanFromRow));
    if (st) setStapleItems(st.map(stapleFromRow));
    if (gr) setGroceryItems(gr.map(groceryFromRow));
  };

  useEffect(() => {
    (async () => { await load(); setLoading(false); })();

    const channel = supabase
      .channel('matplan_realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'recipes' },       () => { load(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'meal_plan' },     () => { load(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'staple_items' },  () => { load(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'grocery_items' }, () => { load(); })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  // ── Oppskrifter ────────────────────────────────────────────────────────────

  const addRecipe = async (r: Omit<Recipe, 'id'>) => {
    await supabase.from('recipes').insert({
      name: r.name, ingredients: r.ingredients, cook_time_minutes: r.cookTimeMinutes,
      instructions: r.instructions, tags: r.tags, source: r.source,
    });
    await load();
  };

  const updateRecipe = async (id: string, patch: Partial<Omit<Recipe, 'id'>>) => {
    const db: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if ('name' in patch)            db.name              = patch.name;
    if ('ingredients' in patch)     db.ingredients        = patch.ingredients;
    if ('cookTimeMinutes' in patch) db.cook_time_minutes  = patch.cookTimeMinutes;
    if ('instructions' in patch)    db.instructions       = patch.instructions;
    if ('tags' in patch)            db.tags               = patch.tags;
    if ('source' in patch)          db.source             = patch.source;
    await supabase.from('recipes').update(db).eq('id', id);
    await load();
  };

  const removeRecipe = async (id: string) => {
    await supabase.from('recipes').delete().eq('id', id);
    await load();
  };

  const restoreRecipe = async (r: Recipe) => {
    await supabase.from('recipes').insert({
      id: r.id, name: r.name, ingredients: r.ingredients, cook_time_minutes: r.cookTimeMinutes,
      instructions: r.instructions, tags: r.tags, source: r.source,
    });
    await load();
  };

  // ── Ukeplan ────────────────────────────────────────────────────────────────

  // Speiler valgt middag til den delte Google-kalenderen (19:30–20:30 samme
  // dag). Best-effort: kalenderen kan mangle konfigurasjon (GOOGLE_*-env-vars)
  // uten at selve ukeplanleggingen skal feile, derfor kun logget, ikke kastet.
  const syncDinnerCalendar = async (date: string, title: string | null) => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { console.warn('Middag-kalender: ingen innlogget sesjon, hopper over synk'); return; }
      const resp = await fetch('/api/middag-kalender', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ date, title }),
      });
      if (!resp.ok) {
        console.error('Middag-kalender: serveren avviste synken', resp.status, await resp.text());
      }
    } catch (err) {
      console.warn('Klarte ikke synke middag til Google-kalenderen', err);
    }
  };

  const setMealPlan = async (date: string, recipeId: string) => {
    await supabase.from('meal_plan').upsert({ date, recipe_id: recipeId }, { onConflict: 'date' });
    await load();
    const recipe = recipes.find(r => r.id === recipeId);
    void syncDinnerCalendar(date, recipe?.name ?? 'Middag');
  };

  const clearMealPlan = async (date: string) => {
    await supabase.from('meal_plan').delete().eq('date', date);
    await load();
    void syncDinnerCalendar(date, null);
  };

  // ── Basisvarer ─────────────────────────────────────────────────────────────

  const addStaple = async (s: Omit<StapleItem, 'id'>) => {
    await supabase.from('staple_items').insert({
      name: s.name, amount: s.amount, unit: s.unit, interval_weeks: s.intervalWeeks,
      last_bought_at: s.lastBoughtAt, postponed_until: s.postponedUntil,
    });
    await load();
  };

  const updateStaple = async (id: string, patch: Partial<Omit<StapleItem, 'id'>>) => {
    const db: Record<string, unknown> = {};
    if ('name' in patch)           db.name             = patch.name;
    if ('amount' in patch)         db.amount           = patch.amount;
    if ('unit' in patch)           db.unit             = patch.unit;
    if ('intervalWeeks' in patch)  db.interval_weeks   = patch.intervalWeeks;
    if ('lastBoughtAt' in patch)   db.last_bought_at   = patch.lastBoughtAt;
    if ('postponedUntil' in patch) db.postponed_until  = patch.postponedUntil;
    await supabase.from('staple_items').update(db).eq('id', id);
    await load();
  };

  const removeStaple = async (id: string) => {
    await supabase.from('staple_items').delete().eq('id', id);
    await load();
  };

  const restoreStaple = async (s: StapleItem) => {
    await supabase.from('staple_items').insert({
      id: s.id, name: s.name, amount: s.amount, unit: s.unit, interval_weeks: s.intervalWeeks,
      last_bought_at: s.lastBoughtAt, postponed_until: s.postponedUntil,
    });
    await load();
  };

  // ── Handleliste ────────────────────────────────────────────────────────────

  // Legger til rader for det som mangler — planlagte middager denne
  // handleuken (lørdag–fredag, se handleukeStart) og forfalte basisvarer.
  // Hva som "mangler" avgjøres av databasen (upsert + onConflict), ikke av
  // groceryItems-øyeblikksbildet her — to samtidige kjøringer (to enheter,
  // eller komponenten som monter på nytt ved sidebytte) kan derfor ikke
  // lenger produsere duplikater. Se scripts/grocery-dedupe-migration.sql for
  // de unike indeksene dette forutsetter (grocery_items_meal_name_uidx /
  // grocery_items_staple_uidx).
  const syncGroceryList = async () => {
    const today = todayKey();
    const days = new Set(weekDates(handleukeStart()));

    const plannedThisWeek = mealPlan.filter(mp => days.has(mp.date));
    const mealRows: Record<string, unknown>[] = [];
    for (const mp of plannedThisWeek) {
      const recipe = recipes.find(r => r.id === mp.recipeId);
      if (!recipe) continue;
      for (const ing of recipe.ingredients) {
        // onGroceryList er besluttet og lagret på selve ingrediensen ved
        // opprettelse/redigering av oppskriften (se Ingredient-typen) — kun
        // eksplisitt false ekskluderer. Oppskrifter fra før feltet fantes
        // mangler det (undefined) og skal oppføre seg akkurat som de alltid
        // har gjort: alle ingrediensene deres var alltid med på handlelisten,
        // og blir det fortsatt inntil oppskriften redigeres og feltet settes
        // eksplisitt.
        if (ing.onGroceryList === false) continue;
        mealRows.push({
          name: ing.name, amount: ing.amount, amount_range: ing.amountRange ?? null, unit: ing.unit,
          meal_plan_id: mp.id, staple_item_id: null,
        });
      }
    }
    // En rad som allerede finnes for (meal_plan_id, navn) hoppes bare over —
    // rører aldri en eksisterende rads avhuking.
    if (mealRows.length) {
      await supabase.from('grocery_items')
        .upsert(mealRows, { onConflict: 'meal_plan_id,name', ignoreDuplicates: true });
    }

    const stapleRows: Record<string, unknown>[] = [];
    for (const s of stapleItems) {
      if (!isStapleDue(s, today)) continue;
      stapleRows.push({
        name: s.name, amount: s.amount, unit: s.unit,
        meal_plan_id: null, staple_item_id: s.id, done: false,
      });
    }
    // Én rad per basisvare, for alltid — når den forfaller på nytt etter å ha
    // vært kjøpt, gjenbrukes samme rad (flippes til done:false, navn/mengde/
    // enhet friskes opp) i stedet for at det hoper seg opp en ny rad hver gang.
    if (stapleRows.length) {
      await supabase.from('grocery_items')
        .upsert(stapleRows, { onConflict: 'staple_item_id' });
    }

    await load();
  };

  const addGroceryItem = async ({ name, amount }: { name: string; amount: number | null }) => {
    await supabase.from('grocery_items').insert({
      name, amount, unit: null, meal_plan_id: null, staple_item_id: null,
    });
    await load();
  };

  const setGroceryAmount = async (id: string, amount: number) => {
    await supabase.from('grocery_items').update({ amount }).eq('id', id);
    await load();
  };

  const toggleGroceryItem = async (id: string) => {
    const item = groceryItems.find(g => g.id === id);
    if (!item) return;
    const done = !item.done;
    await supabase.from('grocery_items')
      .update({ done, done_at: done ? new Date().toISOString() : null })
      .eq('id', id);
    if (done && item.stapleItemId) {
      await supabase.from('staple_items')
        .update({ last_bought_at: todayKey(), postponed_until: null })
        .eq('id', item.stapleItemId);
    }
    await load();
  };

  const removeGroceryItem = async (id: string) => {
    await supabase.from('grocery_items').delete().eq('id', id);
    await load();
  };

  return (
    <MatplanContext.Provider value={{
      recipes, mealPlan, stapleItems, groceryItems, loading,
      addRecipe, updateRecipe, removeRecipe, restoreRecipe,
      setMealPlan, clearMealPlan,
      addStaple, updateStaple, removeStaple, restoreStaple,
      syncGroceryList, addGroceryItem, setGroceryAmount, toggleGroceryItem, removeGroceryItem,
    }}>
      {children}
    </MatplanContext.Provider>
  );
}

export const useMatplan = () => useContext(MatplanContext);
