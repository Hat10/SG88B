import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import type { ClassValues, ClassReturns } from './useHusPrognose';

// A frozen annual prognosis. Each January we capture the year's forecast *as it
// was* — anchored at that January's actuals, with the assumptions in force then —
// and store it as fixed points. It never changes again, so "Faktisk vs. prognose"
// can honestly show how each year played out against the plan made that January.
export interface FrozenYear {
  year: number;          // anchor year, e.g. 2026
  anchorMonth: string;   // "Jan 26"
  frozenAt: string;      // ISO date frozen
  points: { mk: number; bp: number }[]; // monthly projected buying power from the January anchor
  // The assumptions in force when this year was frozen — so the per-year view can
  // show how savings/returns/salary-growth evolved year over year. Optional for
  // backward compatibility with rows frozen before this field existed.
  assumptions?: { savings: ClassValues; salaryGrowth: number; returns: ClassReturns };
}

const KEY = 'lb_prognose_history';

export function useHusPrognoseHistory() {
  const [history, setHistory] = useState<FrozenYear[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.from('settings').select('value').eq('key', KEY).maybeSingle()
      .then(({ data }) => {
        if (Array.isArray(data?.value)) setHistory(data.value as FrozenYear[]);
        setLoading(false);
      });

    const channel = supabase
      .channel(`hus_prog_hist_${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'settings', filter: `key=eq.${KEY}` }, ({ new: row }) => {
        const v = (row as { value?: unknown })?.value;
        if (Array.isArray(v)) setHistory(v as FrozenYear[]);
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  const save = async (next: FrozenYear[]) => {
    setHistory(next); // optimistic
    await supabase.from('settings').upsert({ key: KEY, value: next }, { onConflict: 'key' });
  };

  return { history, save, loading };
}
