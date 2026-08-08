import { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { osloMondayKey } from '../hooks/useWeeklyBucket';

export interface Ingredient {
  name: string;
  amount: number | null;
  unit: string | null;
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
  intervalWeeks: number;
  lastBoughtAt: string | null;
  postponedUntil: string | null;
}

export interface GroceryItem {
  id: string;
  name: string;
  amount: number | null;
  unit: string | null;
  done: boolean;
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
  intervalWeeks: Number(r.interval_weeks ?? 1),
  lastBoughtAt: (r.last_bought_at as string | null) ?? null,
  postponedUntil: (r.postponed_until as string | null) ?? null,
});

const groceryFromRow = (r: Record<string, unknown>): GroceryItem => ({
  id: r.id as string,
  name: r.name as string,
  amount: r.amount == null ? null : Number(r.amount),
  unit: (r.unit as string | null) ?? null,
  done: !!r.done,
  mealPlanId: (r.meal_plan_id as string | null) ?? null,
  stapleItemId: (r.staple_item_id as string | null) ?? null,
});

/** Datoene (yyyy-mm-dd) fra og med gitt mandag til og med søndagen etter. */
export function weekDates(mondayKey: string): string[] {
  const [y, m, d] = mondayKey.split('-').map(Number);
  const monday = new Date(Date.UTC(y, m - 1, d));
  return Array.from({ length: 7 }, (_, i) => {
    const dt = new Date(monday);
    dt.setUTCDate(dt.getUTCDate() + i);
    return dt.toISOString().slice(0, 10);
  });
}

const todayKey = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Oslo' });

// En basisvare er forfalt når det er >= intervallet siden sist kjøpt (eller aldri
// kjøpt), og en eventuell utsettelse er passert.
function isStapleDue(s: StapleItem, today: string): boolean {
  if (s.postponedUntil && s.postponedUntil > today) return false;
  if (!s.lastBoughtAt) return true;
  const last = new Date(s.lastBoughtAt + 'T00:00:00Z').getTime();
  const now = new Date(today + 'T00:00:00Z').getTime();
  const days = Math.round((now - last) / 86_400_000);
  return days >= s.intervalWeeks * 7;
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

  const setMealPlan = async (date: string, recipeId: string) => {
    await supabase.from('meal_plan').upsert({ date, recipe_id: recipeId }, { onConflict: 'date' });
    await load();
  };

  const clearMealPlan = async (date: string) => {
    await supabase.from('meal_plan').delete().eq('date', date);
    await load();
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

  // Legger til rader for det som mangler — planlagte middager denne uken og
  // forfalte basisvarer som ikke allerede har en uavhuket rad. Rører aldri
  // eksisterende rader, så avhukinger/manuelle slettinger består ved re-synk.
  const syncGroceryList = async () => {
    const today = todayKey();
    const monday = osloMondayKey();
    const days = new Set(weekDates(monday));

    const plannedThisWeek = mealPlan.filter(mp => days.has(mp.date));
    const toInsert: Record<string, unknown>[] = [];

    for (const mp of plannedThisWeek) {
      const recipe = recipes.find(r => r.id === mp.recipeId);
      if (!recipe) continue;
      const existing = groceryItems.filter(g => g.mealPlanId === mp.id);
      for (const ing of recipe.ingredients) {
        if (existing.some(g => g.name === ing.name)) continue;
        toInsert.push({
          name: ing.name, amount: ing.amount, unit: ing.unit,
          meal_plan_id: mp.id, staple_item_id: null,
        });
      }
    }

    for (const s of stapleItems) {
      if (!isStapleDue(s, today)) continue;
      const hasActive = groceryItems.some(g => g.stapleItemId === s.id && !g.done);
      if (hasActive) continue;
      toInsert.push({
        name: s.name, amount: s.amount, unit: s.unit,
        meal_plan_id: null, staple_item_id: s.id,
      });
    }

    if (toInsert.length) await supabase.from('grocery_items').insert(toInsert);
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
    await supabase.from('grocery_items').update({ done }).eq('id', id);
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
