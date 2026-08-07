import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

const KEY = 'hus_goal';
const DEFAULT = 15_000_000;

export function useHusGoal() {
  const [goal, setGoal]     = useState(DEFAULT);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase
      .from('settings')
      .select('value')
      .eq('key', KEY)
      .maybeSingle()
      .then(({ data }) => {
        if (data?.value != null) setGoal(data.value as number);
        setLoading(false);
      });

    const channel = supabase
      .channel(`hus_goal_${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'settings', filter: `key=eq.${KEY}` }, ({ new: row }) => {
        const r = row as { value?: number };
        if (r?.value != null) setGoal(r.value);
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  const save = async (next: number) => {
    setGoal(next);
    await supabase
      .from('settings')
      .upsert({ key: KEY, value: next }, { onConflict: 'key' });
  };

  return { goal, save, loading };
}
