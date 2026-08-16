import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useBucket, type BucketEntry } from '../contexts/BucketContext';

// One shared "ting vi vil gjøre" reminder for the whole household. The chosen
// item lives in the `settings` table (key below) so every device shows the same
// one, and it rolls over to a fresh random pick the night into Monday — done by
// the daily cron (api/cron/rollover.ts), which runs ~00:05 Oslo time. This hook
// reads that shared value, keeps it live over realtime, and self-heals if no
// pick exists yet for the current week (first load, or a missed cron run).
const KEY = 'weekly_bucket';

interface WeeklyPick { week: string; item_id: string; prev_item_id?: string | null }

// YYYY-MM-DD (Oslo) of the Monday that starts the current week. Flips exactly at
// the Sunday→Monday midnight boundary in Oslo. The cron computes the identical
// value, so client and server always agree on which week we're in.
export function osloMondayKey(d = new Date()): string {
  const ymd = d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Oslo' }); // "2026-06-08"
  const [y, m, day] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, day));
  dt.setUTCDate(dt.getUTCDate() - ((dt.getUTCDay() + 6) % 7)); // back to Monday (Mon=0…Sun=6)
  return dt.toISOString().slice(0, 10);
}

// YYYY-MM-DD (Oslo) of the Saturday that starts the current "handleuke"
// (shopping week: Saturday through Friday) — same pattern as osloMondayKey,
// anchored to Saturday instead of Monday. Flips at the Friday→Saturday
// midnight boundary in Oslo. Used by the Middagsplanlegger/Dagligvarer
// domain (MatplanContext.tsx, HandlelisteCard.tsx, UkeplanTab.tsx) so meal
// planning, staple due-dates, and the grocery list all agree on the same
// 7-day window.
export function handleukeStart(d = new Date()): string {
  const ymd = d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Oslo' });
  const [y, m, day] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, day));
  dt.setUTCDate(dt.getUTCDate() - ((dt.getUTCDay() + 1) % 7)); // back to Saturday (Sat=0…Fri=6)
  return dt.toISOString().slice(0, 10);
}

// Deterministic pick, used only as the immediate fallback before the cron's
// random pick exists for the week. Seeding by the week key means every device
// computes the same item, so screens never disagree even if several self-heal
// at once. Once a pick for the week exists, nothing overwrites it.
function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function seededItem(items: BucketEntry[], seed: string): BucketEntry {
  const sorted = [...items].sort((a, b) => (a.id < b.id ? -1 : 1));
  return sorted[hashStr(seed) % sorted.length];
}

export function useWeeklyBucket(): { item: BucketEntry | null } {
  const { items } = useBucket();
  const [pick, setPick] = useState<WeeklyPick | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [, setTick] = useState(0);          // nudges the week re-check on always-on screens
  const writing = useRef(false);
  const channelName = useRef(`weekly_bucket_${Math.random().toString(36).slice(2)}`);

  // Read the shared pick once, then keep it live (cron write / other devices).
  useEffect(() => {
    supabase.from('settings').select('value').eq('key', KEY).maybeSingle()
      .then(({ data }) => {
        if (data?.value) setPick(data.value as WeeklyPick);
        setLoaded(true);
      });

    const ch = supabase
      .channel(channelName.current)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'settings', filter: `key=eq.${KEY}` },
        payload => {
          const v = (payload.new as { value?: WeeklyPick })?.value;
          if (v?.item_id) setPick(v);
        },
      )
      .subscribe();

    return () => { void supabase.removeChannel(ch); };
  }, []);

  // The Gangskjerm can stay open for days — re-check the week periodically so it
  // rolls over even without a reload. (The cron's realtime write is the normal
  // path; this just makes sure a stale week is noticed.)
  useEffect(() => {
    const id = window.setInterval(() => setTick(t => t + 1), 15 * 60 * 1000);
    return () => window.clearInterval(id);
  }, []);

  // Self-heal: make this week's pick if the shared value is missing or stale.
  useEffect(() => {
    if (!loaded || writing.current) return;
    const week = osloMondayKey();
    if (pick && pick.week === week) return;                 // already have this week's pick
    const active = items.filter(i => !i.done);
    if (active.length === 0) return;                        // nothing to remind about yet
    const pool = active.length > 1 ? active.filter(i => i.id !== pick?.item_id) : active;
    const chosen = seededItem(pool.length ? pool : active, week);
    const next: WeeklyPick = { week, item_id: chosen.id, prev_item_id: pick?.item_id ?? null };
    writing.current = true;
    setPick(next);                                          // optimistic, so the UI updates now
    supabase.from('settings')
      .upsert({ key: KEY, value: next }, { onConflict: 'key' })
      .then(() => { writing.current = false; });
  });

  const item = pick ? items.find(i => i.id === pick.item_id) ?? null : null;
  return { item };
}
