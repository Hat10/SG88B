import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

export interface Countdown { label: string; date: string }

const KEY = 'countdown';

export function useCountdown() {
  const [cd, setCd]       = useState<Countdown | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase
      .from('settings')
      .select('value')
      .eq('key', KEY)
      .maybeSingle()
      .then(({ data }) => {
        setCd((data?.value as Countdown | undefined) ?? null);
        setLoading(false);
      });

    const channel = supabase
      .channel(`countdown_${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'settings', filter: `key=eq.${KEY}` }, ({ new: row }) => {
        const r = row as { value?: Countdown } | undefined;
        setCd(r?.value ?? null);
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  const save = async (next: Countdown) => {
    setCd(next);
    await supabase
      .from('settings')
      .upsert({ key: KEY, value: next }, { onConflict: 'key' });
  };

  /** Fjerner nedtellingen helt — ingen rad igjen i settings før en ny lagres. */
  const clear = async () => {
    setCd(null);
    await supabase.from('settings').delete().eq('key', KEY);
  };

  return { cd, save, clear, loading };
}
