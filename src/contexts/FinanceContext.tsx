import { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { FinanceEntry } from '../data';

const MONTH_ORDER = ['Jan','Feb','Mar','Apr','Mai','Jun','Jul','Aug','Sep','Okt','Nov','Des'];
function monthKey(s: string) {
  const [m, y] = s.split(' ');
  return parseInt('20' + y) * 100 + MONTH_ORDER.indexOf(m);
}

export type FinanceData = Record<'M' | 'L', FinanceEntry[]>;

interface FinanceCtx {
  finance: FinanceData;
  loading: boolean;
  save: (who: 'M' | 'L', entry: FinanceEntry) => Promise<void>;
}

const FinanceContext = createContext<FinanceCtx>({
  finance: { M: [], L: [] },
  loading: true,
  save: async () => {},
});

export function FinanceProvider({ children }: { children: React.ReactNode }) {
  const [finance, setFinance] = useState<FinanceData>({ M: [], L: [] });
  const [loading, setLoading] = useState(true);

  const load = async () => {
    // select('*') so this keeps working both before and after the asset-class
    // migration (missing columns simply read as undefined → 0).
    const { data } = await supabase.from('finance_entries').select('*');
    if (data) {
      const num = (v: unknown) => Number(v ?? 0) || 0;
      const toEntry = (r: Record<string, unknown>): FinanceEntry => {
        const eiendom = num(r.eiendom), aksjefond = num(r.aksjefond), rentefond = num(r.rentefond), annet = num(r.annet);
        const sum = eiendom + aksjefond + rentefond + annet;
        return {
          month: r.month as string,
          eiendom, aksjefond, rentefond, annet,
          // Before the migration/re-plot the four classes are 0 → fall back to the old total.
          assets: sum > 0 ? sum : num(r.assets),
          boligLaan: num(r.bolig_laan),
          annetLaan: num(r.annet_laan),
          salary: num(r.salary),
        };
      };
      const sort = (arr: FinanceEntry[]) =>
        [...arr].sort((a, b) => monthKey(a.month) - monthKey(b.month));
      setFinance({
        M: sort(data.filter(r => r.who === 'M').map(toEntry)),
        L: sort(data.filter(r => r.who === 'L').map(toEntry)),
      });
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
    const channel = supabase
      .channel('finance_entries_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'finance_entries' }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  const save = async (who: 'M' | 'L', entry: FinanceEntry) => {
    await supabase.from('finance_entries').upsert(
      {
        who,
        month: entry.month,
        eiendom: entry.eiendom,
        aksjefond: entry.aksjefond,
        rentefond: entry.rentefond,
        annet: entry.annet,
        assets: entry.eiendom + entry.aksjefond + entry.rentefond + entry.annet, // keep the old column = sum
        bolig_laan: entry.boligLaan,
        annet_laan: entry.annetLaan,
        salary: entry.salary,
      },
      { onConflict: 'who,month' },
    );
    await load();
  };

  return (
    <FinanceContext.Provider value={{ finance, loading, save }}>
      {children}
    </FinanceContext.Provider>
  );
}

export const useFinance = () => useContext(FinanceContext);
