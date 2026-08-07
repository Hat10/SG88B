import { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { Who } from '../data';

export interface BucketEntry {
  id: string;
  title: string;
  description?: string;
  category: string;
  who: Who;
  done: boolean;
  doneYear?: string;
}

export type BucketPatch = Partial<Omit<BucketEntry, 'id'>>;

interface BucketCtx {
  items: BucketEntry[];
  categories: string[];
  loading: boolean;
  addItem: (item: Omit<BucketEntry, 'id'>) => Promise<void>;
  updateItem: (id: string, patch: BucketPatch) => Promise<void>;
  toggleItem: (id: string, done: boolean) => Promise<void>;
  removeItem: (id: string) => Promise<void>;
  addCategory: (name: string) => Promise<void>;
  renameCategory: (oldName: string, newName: string) => Promise<void>;
  removeCategory: (name: string) => Promise<void>;
}

const BucketContext = createContext<BucketCtx>({
  items: [], categories: [], loading: true,
  addItem: async () => {}, updateItem: async () => {}, toggleItem: async () => {},
  removeItem: async () => {}, addCategory: async () => {}, renameCategory: async () => {}, removeCategory: async () => {},
});

const fromRow = (r: Record<string, unknown>): BucketEntry => ({
  id: r.id as string,
  title: r.title as string,
  description: (r.description as string | null) ?? undefined,
  category: (r.category as string | null) ?? '',
  who: (r.who as Who) ?? 'f',
  done: r.done as boolean,
  doneYear: (r.done_year as string | null) ?? undefined,
});

export function BucketProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<BucketEntry[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    const [{ data: cats }, { data: its }] = await Promise.all([
      supabase.from('bucket_categories').select('name').order('name'),
      supabase.from('bucket_items').select('*').order('created_at', { ascending: false }),
    ]);
    if (cats) setCategories(cats.map(c => c.name as string));
    if (its) setItems(its.map(fromRow));
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const addItem = async (item: Omit<BucketEntry, 'id'>) => {
    await supabase.from('bucket_items').insert({
      title: item.title,
      description: item.description ?? null,
      category: item.category || null,
      who: item.who,
      done: item.done,
      done_year: item.doneYear ?? null,
    });
    await load();
  };

  const updateItem = async (id: string, patch: BucketPatch) => {
    const db: Record<string, unknown> = {};
    if ('title' in patch)       db.title       = patch.title;
    if ('description' in patch) db.description = patch.description ?? null;
    if ('category' in patch)    db.category    = patch.category || null;
    if ('who' in patch)         db.who         = patch.who;
    if ('done' in patch)        db.done        = patch.done;
    if ('doneYear' in patch)    db.done_year   = patch.doneYear ?? null;
    await supabase.from('bucket_items').update(db).eq('id', id);
    await load();
  };

  const toggleItem = async (id: string, done: boolean) => {
    const year = !done ? String(new Date().getFullYear()) : undefined;
    await supabase.from('bucket_items').update({ done: !done, done_year: year ?? null }).eq('id', id);
    await load();
  };

  const removeItem = async (id: string) => {
    await supabase.from('bucket_items').delete().eq('id', id);
    await load();
  };

  const addCategory = async (name: string) => {
    await supabase.from('bucket_categories').insert({ name });
    await load();
  };

  // Rename a category everywhere. The categories table has no UPDATE policy, so we
  // re-create it under the new name, move every item, then drop the old row — all
  // operations (insert / update-items / delete) that already work for add & remove.
  const renameCategory = async (oldName: string, newName: string) => {
    const name = newName.trim();
    if (!name || name === oldName) return;
    await supabase.from('bucket_categories').insert({ name });
    await supabase.from('bucket_items').update({ category: name }).eq('category', oldName);
    await supabase.from('bucket_categories').delete().eq('name', oldName);
    await load();
  };

  const removeCategory = async (name: string) => {
    await supabase.from('bucket_categories').delete().eq('name', name);
    await load();
  };

  return (
    <BucketContext.Provider value={{ items, categories, loading, addItem, updateItem, toggleItem, removeItem, addCategory, renameCategory, removeCategory }}>
      {children}
    </BucketContext.Provider>
  );
}

export const useBucket = () => useContext(BucketContext);
