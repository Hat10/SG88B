import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

export interface Countdown { label: string; date: string }

const DEFAULT: Countdown = { label: 'Kina-tur', date: '2027-04-12' };
const KEY = 'countdown';

export function useCountdown() {
  const [cd, setCd]       = useState<Countdown>(DEFAULT);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase
      .from('settings')
      .select('value')
      .eq('key', KEY)
      .maybeSingle()
      .then(({ data }) => {
        if (data?.value) setCd(data.value as Countdown);
        setLoading(false);
      });

    const channel = supabase
      .channel(`countdown_${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'settings', filter: `key=eq.${KEY}` }, ({ new: row }) => {
        const r = row as { value?: Countdown };
        if (r?.value) setCd(r.value);
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

  return { cd, save, loading };
}
