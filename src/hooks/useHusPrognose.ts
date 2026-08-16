import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

// The Boligdrømmen prognosis assumptions live in the shared `settings` table
// (key below) so they sync across every device — same pattern as the house goal.
// Until the couple saves once there is no row, and the page falls back to sensible
// defaults (savings derived from their actual history).
// NOTE: the key itself ('lb_prognose', from the page's former name) is left
// unchanged on purpose — it's a live lookup key in the settings table, and
// renaming it would orphan any assumptions already saved there.
const KEY = 'lb_prognose';

/** One value per asset class — used both for % returns and for kr/month savings. */
export interface ClassValues {
  eiendom: number;
  aksjefond: number;
  rentefond: number;
  annet: number;
}
export type ClassReturns = ClassValues;

export const DEFAULT_RETURNS: ClassReturns = { eiendom: 3, aksjefond: 7, rentefond: 4, annet: 2 };
export const DEFAULT_SAVINGS: ClassValues = { eiendom: 0, aksjefond: 12000, rentefond: 6000, annet: 2000 };

export interface PrognoseParams {
  savings: ClassValues;    // kr/month contributed to each class (each gets its class return)
  salaryGrowth: number;    // % per year
  returns: ClassReturns;   // % per year, one per asset class
  horizonYears: number;    // how far ahead to chart
}

export function useHusPrognose() {
  const [params, setParams] = useState<PrognoseParams | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase
      .from('settings')
      .select('value')
      .eq('key', KEY)
      .maybeSingle()
      .then(({ data }) => {
        if (data?.value != null) setParams(data.value as PrognoseParams);
        setLoading(false);
      });

    const channel = supabase
      .channel(`hus_prognose_${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'settings', filter: `key=eq.${KEY}` }, ({ new: row }) => {
        const r = row as { value?: PrognoseParams };
        if (r?.value != null) setParams(r.value);
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  const save = async (next: PrognoseParams) => {
    setParams(next); // optimistic, so the forecast updates immediately
    await supabase
      .from('settings')
      .upsert({ key: KEY, value: next }, { onConflict: 'key' });
  };

  return { params, save, loading };
}
