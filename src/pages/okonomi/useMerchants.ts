// Butikkregisteret (merchants + merchant_aliases) som delt hook.
// Brukes av importfanen (matching), Butikker-fanen (administrasjon) og
// transaksjonslista (rename → alias-læring).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import type { Merchant, MerchantAlias, MerchantKind } from '../../lib/import';
import { buildMatchContext } from '../../lib/import';

export function useMerchants() {
  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [aliases, setAliases] = useState<MerchantAlias[]>([]);
  const [loaded, setLoaded] = useState(false);

  const reload = useCallback(async () => {
    const [m, a] = await Promise.all([
      supabase.from('merchants').select('id,name,category,kind').order('name'),
      supabase.from('merchant_aliases').select('alias,merchant_id'),
    ]);
    setMerchants((m.data ?? []) as Merchant[]);
    setAliases((a.data ?? []) as MerchantAlias[]);
    setLoaded(true);
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const ctx = useMemo(() => buildMatchContext(merchants, aliases), [merchants, aliases]);

  /** Finn eksisterende butikk på navn (case-insensitivt) eller opprett ny. */
  const ensureMerchant = useCallback(async (
    name: string, category: string, kind: MerchantKind = 'merchant',
  ): Promise<Merchant> => {
    const trimmed = name.trim();
    const existing = merchants.find(m => m.name.toLowerCase() === trimmed.toLowerCase());
    if (existing) return existing;
    const { data, error } = await supabase.from('merchants')
      .insert({ name: trimmed, category, kind }).select('id,name,category,kind').single();
    if (error || !data) throw new Error(error?.message ?? 'Kunne ikke opprette butikk');
    const created = data as Merchant;
    setMerchants(prev => [...prev, created].sort((a, b) => a.name.localeCompare(b.name, 'nb')));
    return created;
  }, [merchants]);

  /** Læringssteget: koble en normalisert banktekst til en butikk. */
  const addAlias = useCallback(async (alias: string, merchantId: string) => {
    if (!alias.trim()) return;
    await supabase.from('merchant_aliases').upsert({ alias, merchant_id: merchantId }, { onConflict: 'alias' });
    setAliases(prev => {
      const rest = prev.filter(a => a.alias !== alias);
      return [...rest, { alias, merchant_id: merchantId }];
    });
  }, []);

  const removeAlias = useCallback(async (alias: string) => {
    await supabase.from('merchant_aliases').delete().eq('alias', alias);
    setAliases(prev => prev.filter(a => a.alias !== alias));
  }, []);

  /** Oppdater navn/kategori/kind — med kaskade til transaksjonene (via merchant_id). */
  const updateMerchant = useCallback(async (
    id: string,
    changes: { name?: string; category?: string; kind?: MerchantKind },
    opts: { renameTxs?: boolean; recategorizeTxs?: boolean; oldCategory?: string } = {},
  ) => {
    const { error } = await supabase.from('merchants').update(changes).eq('id', id);
    if (error) throw new Error(error.message);
    if (changes.name && opts.renameTxs !== false) {
      await supabase.from('transactions').update({ description: changes.name }).eq('merchant_id', id);
    }
    if (changes.category && opts.recategorizeTxs !== false) {
      // Kun rader som fortsatt har butikkens gamle kategori — manuelle unntak beholdes
      let q = supabase.from('transactions').update({ category: changes.category }).eq('merchant_id', id);
      if (opts.oldCategory) q = q.eq('category', opts.oldCategory);
      await q;
    }
    setMerchants(prev => prev.map(m => m.id === id ? { ...m, ...changes } : m)
      .sort((a, b) => a.name.localeCompare(b.name, 'nb')));
  }, []);

  /** Slå sammen `fromId` inn i `toId`: aliaser og transaksjoner flyttes, butikken slettes. */
  const mergeMerchants = useCallback(async (fromId: string, toId: string) => {
    const to = merchants.find(m => m.id === toId);
    if (!to || fromId === toId) return;
    await supabase.from('merchant_aliases').update({ merchant_id: toId }).eq('merchant_id', fromId);
    await supabase.from('transactions')
      .update({ merchant_id: toId, description: to.name, category: to.category })
      .eq('merchant_id', fromId);
    await supabase.from('merchants').delete().eq('id', fromId);
    await reload();
  }, [merchants, reload]);

  const deleteMerchant = useCallback(async (id: string) => {
    await supabase.from('merchants').delete().eq('id', id);   // aliaser følger med (cascade)
    setMerchants(prev => prev.filter(m => m.id !== id));
    setAliases(prev => prev.filter(a => a.merchant_id !== id));
  }, []);

  return { merchants, aliases, loaded, ctx, reload, ensureMerchant, addAlias, removeAlias, updateMerchant, mergeMerchants, deleteMerchant };
}

export type MerchantsApi = ReturnType<typeof useMerchants>;
