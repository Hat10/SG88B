import { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

export type RatingCat = string;

export interface Rating {
  id: string;
  title: string;
  cat: RatingCat;
  score_m?: number;
  score_l?: number;
  comment_m?: string;
  comment_l?: string;
  image_path?: string;
  created_at: string;
}

// created_at is editable — it's the date shown on cards and sorted by ("Nyeste").
export type RatingPatch = Partial<Omit<Rating, 'id'>>;

interface RatingContextValue {
  ratings: Rating[];
  categories: string[];
  loading: boolean;
  addRating: (r: Omit<Rating, 'id' | 'created_at'> & { created_at?: string }) => Promise<void>;
  updateRating: (id: string, patch: RatingPatch) => Promise<void>;
  removeRating: (id: string) => Promise<void>;
  addCategory: (name: string) => Promise<void>;
  renameCategory: (oldName: string, newName: string) => Promise<void>;
  removeCategory: (name: string) => Promise<void>;
}

const Ctx = createContext<RatingContextValue | null>(null);

export function RatingProvider({ children }: { children: React.ReactNode }) {
  const [ratings, setRatings]       = useState<Rating[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [loading, setLoading]       = useState(true);

  const load = async () => {
    const [{ data: cats }, { data: rows }] = await Promise.all([
      supabase.from('rating_categories').select('name').order('name'),
      supabase.from('ratings').select('*').order('created_at', { ascending: false }),
    ]);
    if (cats) setCategories(cats.map((c: { name: string }) => c.name));
    if (rows) setRatings(rows.map((r: Record<string, unknown>) => ({
      id: r.id as string,
      title: r.title as string,
      cat: r.cat as string,
      score_m:   (r.score_m   as number | null) ?? undefined,
      score_l:   (r.score_l   as number | null) ?? undefined,
      comment_m: (r.comment_m as string | null) ?? undefined,
      comment_l: (r.comment_l as string | null) ?? undefined,
      image_path: (r.image_path as string | null) ?? undefined,
      created_at: r.created_at as string,
    })));
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const addRating = async (r: Omit<Rating, 'id' | 'created_at'> & { created_at?: string }) => {
    const row: Record<string, unknown> = {
      title: r.title, cat: r.cat,
      score_m:   r.score_m   ?? null,
      score_l:   r.score_l   ?? null,
      comment_m: r.comment_m ?? null,
      comment_l: r.comment_l ?? null,
      image_path: r.image_path ?? null,
    };
    // Only override the DB default (now()) when an explicit date was chosen.
    if (r.created_at) row.created_at = r.created_at;
    await supabase.from('ratings').insert(row);
    await load();
  };

  const updateRating = async (id: string, patch: RatingPatch) => {
    const db: Record<string, unknown> = {};
    if ('title'     in patch) db.title     = patch.title;
    if ('cat'       in patch) db.cat       = patch.cat;
    if ('score_m'   in patch) db.score_m   = patch.score_m   ?? null;
    if ('score_l'   in patch) db.score_l   = patch.score_l   ?? null;
    if ('comment_m' in patch) db.comment_m = patch.comment_m ?? null;
    if ('comment_l' in patch) db.comment_l = patch.comment_l ?? null;
    if ('image_path' in patch) db.image_path = patch.image_path ?? null;
    if ('created_at' in patch) db.created_at = patch.created_at;
    await supabase.from('ratings').update(db).eq('id', id);
    await load();
  };

  const removeRating = async (id: string) => {
    await supabase.from('ratings').delete().eq('id', id);
    setRatings(prev => prev.filter(r => r.id !== id));
  };

  const addCategory = async (name: string) => {
    await supabase.from('rating_categories').insert({ name });
    await load();
  };

  // Rename a category everywhere. The categories table has no UPDATE policy, so we
  // re-create it under the new name, move every tagged rating, then drop the old row —
  // all operations (insert / update-ratings / delete) that already work for add & remove.
  const renameCategory = async (oldName: string, newName: string) => {
    const name = newName.trim();
    if (!name || name === oldName) return;
    await supabase.from('rating_categories').insert({ name });
    await supabase.from('ratings').update({ cat: name }).eq('cat', oldName);
    await supabase.from('rating_categories').delete().eq('name', oldName);
    await load();
  };

  const removeCategory = async (name: string) => {
    await supabase.from('rating_categories').delete().eq('name', name);
    await load();
  };

  return (
    <Ctx.Provider value={{ ratings, categories, loading, addRating, updateRating, removeRating, addCategory, renameCategory, removeCategory }}>
      {children}
    </Ctx.Provider>
  );
}

export function useRatings() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useRatings must be used within RatingProvider');
  return ctx;
}
