import { createClient } from '@supabase/supabase-js';
import { fetchPickups } from '../tommeplan';

export const config = { maxDuration: 60 };

// How long to keep price-history rows. Deal detection only ever reads the last
// 30 days (see below), so anything older is dead weight; we keep double that as
// headroom in case the deal window is ever widened.
const PRICE_HISTORY_RETENTION_DAYS = 60;

// Prisjakt scraper — inlined (duplicated in api/price.ts) because Vercel excludes
// `_`-prefixed files under /api from the build, so a shared `../_lib/prisjakt`
// import crashes the function at runtime. Keep the two copies in sync.
interface PrisjaktResult { price: number; name: string | null; offerCount: number | null; currency: string; }

function toPrice(v: unknown): number | null {
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

async function fetchPrisjaktPrice(url: string): Promise<PrisjaktResult | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  let html: string;
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'nb-NO,nb;q=0.9,no;q=0.8,en;q=0.7',
        'Referer': 'https://www.prisjakt.no/',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'same-origin',
      },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    html = await response.text();
  } finally {
    clearTimeout(timer);
  }

  const jsonLdBlocks = [...html.matchAll(/<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)];
  for (const block of jsonLdBlocks) {
    try {
      const data = JSON.parse(block[1]);
      const product = Array.isArray(data) ? data.find((d: any) => d['@type'] === 'Product') : data['@type'] === 'Product' ? data : null;
      if (!product?.offers) continue;
      const name: string = product.name ?? null;
      const offers = product.offers;
      if (offers['@type'] === 'AggregateOffer') {
        const price = toPrice(offers.lowPrice);
        if (price != null) return { price, name, offerCount: offers.offerCount ?? null, currency: offers.priceCurrency ?? 'NOK' };
        continue;
      }
      const offerList = Array.isArray(offers) ? offers : [offers];
      const prices = offerList.map((o: any) => toPrice(o.price)).filter((p): p is number => p != null);
      if (prices.length) return { price: Math.min(...prices), name, offerCount: prices.length, currency: 'NOK' };
    } catch { /* skip malformed block */ }
  }

  const nextDataMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (nextDataMatch) {
    try {
      const props = JSON.parse(nextDataMatch[1])?.props?.pageProps;
      const price = toPrice(
        props?.product?.cheapestOffer?.price ??
        props?.cheapestOffer?.price ??
        props?.lowestPrice ??
        props?.product?.lowestPrice,
      );
      if (price != null) return { price, name: props?.product?.name ?? props?.name ?? null, offerCount: props?.product?.offerCount ?? props?.offerCount ?? null, currency: 'NOK' };
    } catch { /* ignore */ }
  }

  return null;
}

export default async function handler(req: any, res: any) {
  // Vercel sends this header automatically when CRON_SECRET is set
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  // Today's date in Oslo timezone
  const todayOslo = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Oslo' });
  const todayMs   = new Date(todayOslo + 'T00:00:00').getTime();

  // ─── 1. Roll overdue todos forward to today ──────────────────────────────
  let rolledTodos = 0;
  {
    const { data: items, error } = await supabase
      .from('todo_items')
      .select('id, deadline, overdue_days')
      .eq('done', false)
      .not('deadline', 'is', null)
      .lt('deadline', todayOslo);

    if (error) return res.status(500).json({ error: error.message });

    if (items && items.length) {
      await Promise.all(items.map((it: any) => {
        const daysPast = Math.round(
          (todayMs - new Date(it.deadline + 'T00:00:00').getTime()) / 86_400_000
        );
        return supabase
          .from('todo_items')
          .update({ deadline: todayOslo, overdue_days: (it.overdue_days ?? 0) + daysPast })
          .eq('id', it.id);
      }));
      rolledTodos = items.length;
    }
  }

  // ─── 2. Track Prisjakt prices + flag "cheapest in 30 days" deals ──────────
  let priced = 0;
  let deals = 0;
  {
    const since30 = new Date(todayMs - 30 * 86_400_000).toISOString();
    const { data: wishes } = await supabase
      .from('wish_items')
      .select('id, price_url')
      .eq('price_source', 'prisjakt')
      .eq('done', false)
      .not('price_url', 'is', null);

    // Sequential on purpose — gentle on Prisjakt, avoids burst blocking.
    for (const w of wishes ?? []) {
      try {
        const result = await fetchPrisjaktPrice(w.price_url as string);
        if (!result) continue;
        const price = result.price;

        // Read the prior 30-day history BEFORE logging today's point, so
        // today's (possibly low) price is naturally excluded — otherwise it
        // drags down the very average it's being compared against and hides
        // the true drop. (Doing this by timestamp is fragile: the cron runs
        // ~23:00 UTC, which is already the next Oslo day, so a "today" cutoff
        // wouldn't line up with when the row was written. Ordering is robust.)
        const { data: hist } = await supabase
          .from('wish_price_history')
          .select('price')
          .eq('item_id', w.id)
          .gte('checked_at', since30);

        const prevPrices = (hist ?? [])
          .map((h: any) => Number(h.price))
          .filter((p: number) => !isNaN(p));

        let deal_pct: number | null = null;
        let deal_avg30: number | null = null;

        // Need a few prior data points before an average means anything
        if (prevPrices.length >= 5) {
          const avg = prevPrices.reduce((a, b) => a + b, 0) / prevPrices.length;
          const min = Math.min(...prevPrices);
          deal_avg30 = Math.round(avg);
          // New 30-day low (at/below the cheapest of the prior 30 days) AND
          // meaningfully below the prior average: ≥5 % OR ≥500 kr under
          // (kr covers pricey items where a small % is still a big saving).
          if (avg > 0 && price <= min) {
            const pct = Math.round(((avg - price) / avg) * 100);
            const kr = Math.round(avg - price);
            if (pct >= 5 || kr >= 500) deal_pct = pct;
          }
        }

        // Log today's price point now that the comparison above is done.
        await supabase.from('wish_price_history').insert({ item_id: w.id, price });

        await supabase
          .from('wish_items')
          .update({ price, deal_pct, deal_avg30 })
          .eq('id', w.id);

        priced++;
        if (deal_pct) deals++;
      } catch {
        /* skip this item, keep the batch going */
      }
    }
  }

  // ─── 2b. Prune dead price history ─────────────────────────────────────────
  // wish_price_history is only ever read for the 30-day deal window above, so
  // two kinds of rows are dead weight and get removed here:
  //   • rows older than the retention window — never read again
  //   • rows for checked-off (done) items — no longer priced or shown
  // (Rows for *deleted* wishlist items are already gone via the
  //  `on delete cascade` FK, so they need no handling here.)
  let prunedHistory = 0;
  {
    const cutoff = new Date(todayMs - PRICE_HISTORY_RETENTION_DAYS * 86_400_000).toISOString();

    const { count: oldCount } = await supabase
      .from('wish_price_history')
      .delete({ count: 'exact' })
      .lt('checked_at', cutoff);
    prunedHistory += oldCount ?? 0;

    const { data: doneItems } = await supabase
      .from('wish_items')
      .select('id')
      .eq('done', true);
    const doneIds = (doneItems ?? []).map((d: any) => d.id);
    if (doneIds.length) {
      const { count: doneCount } = await supabase
        .from('wish_price_history')
        .delete({ count: 'exact' })
        .in('item_id', doneIds);
      prunedHistory += doneCount ?? 0;
    }
  }

  // ─── 3. Weekly "ting vi vil gjøre" reminder — fresh random pick each Monday ─
  // Runs daily but writes once per week: the first run after the week flips is
  // the one that crosses 00:05 Oslo on Monday ("natt til mandag"). The pick is a
  // truly random active bucket item from the full live list, never the same as
  // last week's when there's a real choice. Shared via `settings` so every
  // device shows the same one.
  let bucketRolled = false;
  {
    const mondayKey = (() => {
      const [y, m, day] = todayOslo.split('-').map(Number);
      const dt = new Date(Date.UTC(y, m - 1, day));
      dt.setUTCDate(dt.getUTCDate() - ((dt.getUTCDay() + 6) % 7)); // back to Monday
      return dt.toISOString().slice(0, 10);
    })();

    const { data: row } = await supabase
      .from('settings').select('value').eq('key', 'weekly_bucket').maybeSingle();
    const stored = row?.value as { week?: string; item_id?: string } | undefined;

    if (!stored || stored.week !== mondayKey) {
      const { data: bucket } = await supabase
        .from('bucket_items').select('id').eq('done', false);
      const all = (bucket ?? []) as { id: string }[];
      // Avoid repeating last week's item when there's a real choice.
      const pool = all.length > 1 ? all.filter(b => b.id !== stored?.item_id) : all;
      const candidates = pool.length ? pool : all;
      if (candidates.length) {
        const chosen = candidates[Math.floor(Math.random() * candidates.length)];
        await supabase.from('settings').upsert(
          { key: 'weekly_bucket', value: { week: mondayKey, item_id: chosen.id, prev_item_id: stored?.item_id ?? null } },
          { onConflict: 'key' },
        );
        bucketRolled = true;
      }
    }
  }

  // ─── 4. Auto-create "Ta ut plast" ahead of the next Iris plastic pickup ────
  // Same source as the "Neste plast" line in the clock box (api/tommeplan.ts,
  // via the shared fetchPickups()). Deadline = the day before pickup, so the
  // reminder lands "ta den ut i kveld". Server-side, and gated by a unique
  // index on (title, deadline) — see scripts/todo-plast-dedupe-migration.sql
  // — for the same reason the handleliste sync moved off a client-side
  // existence check: two concurrent cron invocations (or a stray manual
  // retry) can't produce duplicate rows for the same pickup cycle.
  let plastTodoSynced = false;
  {
    try {
      const pickups = await fetchPickups();
      const nextPlast = pickups.find(p => p.date >= todayOslo && p.types.some(t => t.category === 'plast'));
      if (nextPlast) {
        const [y, m, day] = nextPlast.date.split('-').map(Number);
        const dt = new Date(Date.UTC(y, m - 1, day));
        dt.setUTCDate(dt.getUTCDate() - 1);
        const deadline = dt.toISOString().slice(0, 10);

        const { error: plastErr } = await supabase.from('todo_items').upsert(
          { title: 'Ta ut plast', deadline, who: 'f', priority: 'middels', done: false, overdue_days: 0 },
          { onConflict: 'title,deadline', ignoreDuplicates: true },
        );
        plastTodoSynced = !plastErr;
      }
    } catch {
      // Iris-skraping/parsing feilet denne kjøringen — hopp over, prøv igjen i morgen.
    }
  }

  return res.json({ date: todayOslo, rolledTodos, priced, deals, prunedHistory, bucketRolled, plastTodoSynced });
}
