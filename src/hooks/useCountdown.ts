import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

export interface Countdown { id: string; label: string; date: string }

const fromRow = (r: Record<string, unknown>): Countdown => ({
  id: r.id as string,
  label: r.label as string,
  date: r.date as string,
});

// Liste med nedtellinger — Dashboard.tsx har full CRUD (legg til/rediger/fjern
// flere), Skjerm.tsx viser foreløpig bare items[0] (nærmeste dato). Swipe
// mellom flere på Gangskjerm er ikke bygget ennå.
export function useCountdowns() {
  const [items, setItems]     = useState<Countdown[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    const { data } = await supabase.from('countdowns').select('*').order('date', { ascending: true });
    setItems(data ? data.map(fromRow) : []);
  };

  useEffect(() => {
    (async () => { await load(); setLoading(false); })();

    // Random suffix — this is a bare hook, not a context, so every component
    // that calls it (Dashboard.tsx alone has 2-3 at once: CountdownPanel +
    // CountdownAdminSection) gets its own channel. A shared static name here
    // made the second .on() call land on a channel the first instance had
    // already subscribed, which throws. See src/hooks/useHusGoal.ts for the
    // same pattern.
    const channel = supabase
      .channel(`countdowns_${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'countdowns' }, () => { load(); })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  const add = async (c: { label: string; date: string }) => {
    await supabase.from('countdowns').insert({ label: c.label, date: c.date });
    await load();
  };

  const update = async (id: string, patch: { label: string; date: string }) => {
    await supabase.from('countdowns').update({ label: patch.label, date: patch.date }).eq('id', id);
    await load();
  };

  const remove = async (id: string) => {
    await supabase.from('countdowns').delete().eq('id', id);
    await load();
  };

  const restore = async (c: Countdown) => {
    await supabase.from('countdowns').insert({ id: c.id, label: c.label, date: c.date });
    await load();
  };

  return { items, loading, add, update, remove, restore };
}
