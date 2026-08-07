import { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { ShoppingItem, Priority, PriceSource, Who } from '../data';

export type ListKey = 'felles' | 'mikkel' | 'leah';

export type WishPatch = {
  t?: string;
  on?: boolean;
  note?: string | null;
  priority?: Priority;
  price?: number | null;
  priceUrl?: string | null;
  priceSource?: PriceSource | null;
};

interface WishCtx {
  items: Record<ListKey, ShoppingItem[]>;
  loading: boolean;
  add: (list: ListKey, item: Omit<ShoppingItem, 'id'>) => Promise<void>;
  toggle: (id: string, current: boolean) => Promise<void>;
  update: (id: string, patch: WishPatch) => Promise<void>;
  patchPrice: (id: string, price: number) => void;
  remove: (id: string) => Promise<void>;
}

const EMPTY: Record<ListKey, ShoppingItem[]> = { felles: [], mikkel: [], leah: [] };

const WishContext = createContext<WishCtx>({
  items: EMPTY, loading: true,
  add: async () => {}, toggle: async () => {}, update: async () => {},
  patchPrice: () => {}, remove: async () => {},
});

const fromRow = (r: Record<string, unknown>): ShoppingItem => ({
  id: r.id as string,
  t: r.t as string,
  on: r.done as boolean,
  who: r.who as Who,
  note: (r.note as string | null) ?? undefined,
  priority: r.priority as Priority,
  addedAt: r.added_at as string,
  price: (r.price as number | null) ?? undefined,
  priceUrl: (r.price_url as string | null) ?? undefined,
  priceSource: (r.price_source as PriceSource | null) ?? undefined,
  dealPct: (r.deal_pct as number | null) ?? undefined,
  dealAvg30: (r.deal_avg30 as number | null) ?? undefined,
});

const toPatch = (patch: WishPatch): Record<string, unknown> => {
  const db: Record<string, unknown> = {};
  if ('t' in patch)           db.t           = patch.t;
  if ('on' in patch)          db.done        = patch.on;
  if ('note' in patch)        db.note        = patch.note ?? null;
  if ('priority' in patch)    db.priority    = patch.priority;
  if ('price' in patch)       db.price       = patch.price ?? null;
  if ('priceUrl' in patch)    db.price_url   = patch.priceUrl ?? null;
  if ('priceSource' in patch) db.price_source = patch.priceSource ?? null;
  return db;
};

export function WishProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<Record<ListKey, ShoppingItem[]>>(EMPTY);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    const { data } = await supabase
      .from('wish_items')
      .select('*')
      .order('added_at', { ascending: false });
    if (data) {
      setItems({
        felles: data.filter(r => r.list === 'felles').map(fromRow),
        mikkel: data.filter(r => r.list === 'mikkel').map(fromRow),
        leah:   data.filter(r => r.list === 'leah').map(fromRow),
      });
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
    // Realtime so the always-on Gangskjerm picks up cron price/deal updates without a reload.
    const channel = supabase
      .channel('wish_realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'wish_items' }, () => { load(); })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  const add = async (list: ListKey, item: Omit<ShoppingItem, 'id'>) => {
    await supabase.from('wish_items').insert({
      list, t: item.t, done: item.on, who: item.who,
      note: item.note ?? null, priority: item.priority, added_at: item.addedAt,
      price: item.price ?? null, price_url: item.priceUrl ?? null, price_source: item.priceSource ?? null,
    });
    await load();
  };

  const toggle = async (id: string, current: boolean) => {
    await supabase.from('wish_items').update({ done: !current }).eq('id', id);
    await load();
  };

  const update = async (id: string, patch: WishPatch) => {
    await supabase.from('wish_items').update(toPatch(patch)).eq('id', id);
    await load();
  };

  const patchPrice = (id: string, price: number) => {
    setItems(prev => {
      const next = { ...prev };
      for (const list of Object.keys(next) as ListKey[]) {
        next[list] = next[list].map(it => it.id === id ? { ...it, price } : it);
      }
      return next;
    });
    void supabase.from('wish_items').update({ price }).eq('id', id);
  };

  const remove = async (id: string) => {
    await supabase.from('wish_items').delete().eq('id', id);
    await load();
  };

  return (
    <WishContext.Provider value={{ items, loading, add, toggle, update, patchPrice, remove }}>
      {children}
    </WishContext.Provider>
  );
}

export const useWish = () => useContext(WishContext);
