import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { DEFAULT_BP_PARAMS, type BuyingPowerParams } from '../lib/buyingPower';

// The lending rules — how many × annual income the bank lends, and the equity
// requirement — live in the shared `settings` table so they sync across every
// device, same pattern as the house goal and the prognosis assumptions.
const KEY = 'bp_params';

function clean(v: Partial<BuyingPowerParams> | null | undefined): BuyingPowerParams {
  return {
    loanMultiple: typeof v?.loanMultiple === 'number' ? v.loanMultiple : DEFAULT_BP_PARAMS.loanMultiple,
    equityPct:    typeof v?.equityPct    === 'number' ? v.equityPct    : DEFAULT_BP_PARAMS.equityPct,
  };
}

// One-time housekeeping. The rules used to live in localStorage ('pt_house_params',
// written by the old "Veien til hus" page) and the prognosis briefly used
// 'lb_prognose'. Both now live in the DB, so the first time we load we migrate any
// real lending value into the DB and then drop the dead localStorage keys for good.
let bootstrapped = false;
function bootstrap(dbValue: unknown) {
  if (bootstrapped) return;
  bootstrapped = true;
  try {
    if (dbValue == null) {
      const raw = JSON.parse(localStorage.getItem('pt_house_params') ?? '{}') as Partial<BuyingPowerParams>;
      if (typeof raw.loanMultiple === 'number' || typeof raw.equityPct === 'number') {
        void supabase.from('settings').upsert({ key: KEY, value: clean(raw) }, { onConflict: 'key' });
      }
    }
  } catch { /* ignore */ }
  try {
    localStorage.removeItem('pt_house_params');
    localStorage.removeItem('lb_prognose');
  } catch { /* ignore */ }
}

export function useBuyingPowerParams() {
  const [params, setParams] = useState<BuyingPowerParams>(DEFAULT_BP_PARAMS);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase
      .from('settings')
      .select('value')
      .eq('key', KEY)
      .maybeSingle()
      .then(({ data }) => {
        bootstrap(data?.value);
        if (data?.value != null) setParams(clean(data.value as Partial<BuyingPowerParams>));
        setLoading(false);
      });

    const channel = supabase
      .channel(`bp_params_${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'settings', filter: `key=eq.${KEY}` }, ({ new: row }) => {
        const r = row as { value?: Partial<BuyingPowerParams> };
        if (r?.value != null) setParams(clean(r.value));
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  const save = async (next: BuyingPowerParams) => {
    const c = clean(next);
    setParams(c); // optimistic
    await supabase.from('settings').upsert({ key: KEY, value: c }, { onConflict: 'key' });
  };

  return { params, save, loading };
}
