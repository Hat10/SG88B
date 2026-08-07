import { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { CATEGORY_LABELS as SEED_LABELS } from '../lib/import/categoryRules';

// A spending category. The `key` is the stable id stored on transactions/merchants;
// `label` + `color` are presentation and can be edited freely on the site.
export interface Category {
  key: string;
  label: string;
  color: string;
  sort_order: number;
  is_system: boolean;
}

// ── Fallbacks ─────────────────────────────────────────────────────────────────
// The database is the source of truth. These code defaults only cover two cases so
// the UI never renders a blank/greyed tag: (1) the brief moment before the
// `categories` table has loaded, and (2) a legacy key that exists on a transaction
// but has no row (e.g. a built-in that was deleted) — it still shows a sensible name.
const FALLBACK_COLORS: Record<string, string> = {
  dagligvarer: '#5B9BD5', kiosk: '#7BC4C4', kafé: '#F4A261',
  hjem: '#8BC34A', klær: '#C97A8B', transport: '#7B68EE',
  abonnement: '#FF8C00', forsikring: '#4A80C4', trening: '#26A69A',
  velvære: '#B39DDB', helse: '#EC407A', utdanning: '#5C6BC0',
  bolig: '#A0856A', arrangement: '#AB47BC', gambling: '#D32F2F',
  reise: '#26C6DA', finans: '#78909C', overføring: '#BDBDBD',
  inntekt: '#66BB6A', investering: '#FFD700', annet: '#9E9E9E',
};
const DEFAULT_COLOR = '#9E9E9E';

// Keys the import code generates but that must never be user-pickable spending
// categories. `overføring` marks internal transfers — those are auto-excluded on
// import and aren't forbruk, so it stays out of the selectable list. Its label and
// colour still resolve via SEED_LABELS/FALLBACK_COLORS below, so any transfer
// transaction that does get logged still renders correctly.
const CODE_ONLY_KEYS = new Set(['overføring']);

const FALLBACK: Category[] = Object.keys(SEED_LABELS)
  .filter(key => !CODE_ONLY_KEYS.has(key))
  .map((key, i) => ({
    key,
    label: SEED_LABELS[key],
    color: FALLBACK_COLORS[key] ?? DEFAULT_COLOR,
    sort_order: i,
    is_system: true,
  }));

// Turn a free-typed label into a stable url-ish key. Keeps Norwegian letters, drops
// punctuation, collapses spaces to dashes. Uniqueness is enforced by the caller.
function slugify(label: string): string {
  return label
    .toLowerCase()
    .trim()
    .replace(/[\s/]+/g, '-')
    .replace(/[^a-z0-9æøåäöüéèàç-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

interface CategoryCtx {
  categories: Category[];               // sorted by sort_order, then label
  labels: Record<string, string>;       // key → label
  colors: Record<string, string>;       // key → color
  counts: Record<string, number>;       // key → # transactions (for the delete guard/display)
  loading: boolean;
  labelOf: (key: string) => string;
  colorOf: (key: string) => string;
  refreshCounts: () => Promise<void>;
  addCategory: (label: string, color: string) => Promise<{ ok: boolean; error?: string }>;
  updateCategory: (key: string, patch: { label?: string; color?: string }) => Promise<void>;
  deleteCategory: (key: string) => Promise<{ ok: boolean; count?: number }>;
}

const CategoryContext = createContext<CategoryCtx>({
  categories: FALLBACK,
  labels: SEED_LABELS,
  colors: FALLBACK_COLORS,
  counts: {},
  loading: true,
  labelOf: (k) => SEED_LABELS[k] ?? k,
  colorOf: (k) => FALLBACK_COLORS[k] ?? DEFAULT_COLOR,
  refreshCounts: async () => {},
  addCategory: async () => ({ ok: false }),
  updateCategory: async () => {},
  deleteCategory: async () => ({ ok: false }),
});

export function CategoryProvider({ children }: { children: React.ReactNode }) {
  const [categories, setCategories] = useState<Category[]>(FALLBACK);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('spending_categories')
      .select('*')
      .order('sort_order', { ascending: true })
      .order('label', { ascending: true });
    // Before the migration has run (table missing) or if it's empty, keep the code
    // seed so the page keeps working.
    if (!error && data && data.length) setCategories(data as Category[]);
    setLoading(false);
  }, []);

  const refreshCounts = useCallback(async () => {
    const { data } = await supabase.from('transactions').select('category');
    const c: Record<string, number> = {};
    for (const r of data ?? []) {
      const cat = (r as { category: string }).category;
      c[cat] = (c[cat] ?? 0) + 1;
    }
    setCounts(c);
  }, []);

  useEffect(() => {
    load();
    const channel = supabase
      .channel('spending_categories_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'spending_categories' }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [load]);

  const addCategory = useCallback(async (label: string, color: string) => {
    const name = label.trim();
    if (!name) return { ok: false, error: 'Skriv inn et navn' };
    const existing = new Set(categories.map(c => c.key));
    const base = slugify(name) || 'kategori';
    let key = base;
    for (let n = 2; existing.has(key); n++) key = `${base}-${n}`;
    const maxOrder = categories.reduce((m, c) => Math.max(m, c.sort_order), 0);
    const { error } = await supabase
      .from('spending_categories')
      .insert({ key, label: name, color, sort_order: maxOrder + 1, is_system: false });
    if (error) return { ok: false, error: error.message };
    await load();
    return { ok: true };
  }, [categories, load]);

  const updateCategory = useCallback(async (key: string, patch: { label?: string; color?: string }) => {
    const clean: { label?: string; color?: string } = {};
    if (patch.label !== undefined) clean.label = patch.label.trim();
    if (patch.color !== undefined) clean.color = patch.color;
    if (clean.label === '') return; // don't allow blanking a name
    // Optimistic local update so inline edits feel instant.
    setCategories(prev => prev.map(c => c.key === key ? { ...c, ...clean } : c));
    await supabase.from('spending_categories').update(clean).eq('key', key);
  }, []);

  // Delete is allowed ONLY when no transaction uses the category. We re-check the
  // count authoritatively here (not just the cached `counts`) to avoid a race.
  const deleteCategory = useCallback(async (key: string) => {
    const { count } = await supabase
      .from('transactions')
      .select('id', { count: 'exact', head: true })
      .eq('category', key);
    if ((count ?? 0) > 0) return { ok: false, count: count ?? 0 };
    await supabase.from('spending_categories').delete().eq('key', key);
    await load();
    return { ok: true };
  }, [load]);

  const labels = useMemo(() => {
    const m: Record<string, string> = {};
    for (const c of categories) m[c.key] = c.label;
    return m;
  }, [categories]);

  const colors = useMemo(() => {
    const m: Record<string, string> = {};
    for (const c of categories) m[c.key] = c.color;
    return m;
  }, [categories]);

  const labelOf = useCallback((k: string) => labels[k] ?? SEED_LABELS[k] ?? k, [labels]);
  const colorOf = useCallback((k: string) => colors[k] ?? FALLBACK_COLORS[k] ?? DEFAULT_COLOR, [colors]);

  return (
    <CategoryContext.Provider value={{
      categories, labels, colors, counts, loading,
      labelOf, colorOf, refreshCounts, addCategory, updateCategory, deleteCategory,
    }}>
      {children}
    </CategoryContext.Provider>
  );
}

export const useCategories = () => useContext(CategoryContext);
