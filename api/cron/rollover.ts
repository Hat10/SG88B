import { createClient } from '@supabase/supabase-js';
import * as cheerio from 'cheerio';
import { google } from 'googleapis';

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

// Iris tømmeplan scraper — inlined (duplicated in api/tommeplan.ts) for the
// same reason as the Prisjakt scraper above: Vercel bundles each file under
// /api as its own isolated function, and a cross-file import between two
// sibling route files (`../tommeplan`) resolves fine in `tsc`/local dev but
// 404s at runtime once deployed (ERR_MODULE_NOT_FOUND) — confirmed by an
// actual failed cron run, not just a theoretical risk. Keep the two copies
// in sync; the parsing logic is small and Iris rarely changes its markup.
const TOMMEPLAN_URL = 'https://iris-salten.no/privat/tommeplan/?lookup=3f31203b-fd52-4343-afdb-7eff87b1d24e&address=Storgata%2088%20H0303&municipality=Bod%C3%B8%20kommune';

const MONTHS_NO = [
  'januar', 'februar', 'mars', 'april', 'mai', 'juni',
  'juli', 'august', 'september', 'oktober', 'november', 'desember',
];

interface WasteType {
  name: string;
  category: 'plast' | 'mat' | 'papir' | 'rest' | 'glass' | 'hage' | 'annet';
}

interface Pickup {
  date: string;       // yyyy-mm-dd
  weekday: string;
  dateLabel: string;
  types: WasteType[];
}

function categorizeWaste(label: string): WasteType['category'] {
  const l = label.toLowerCase();
  if (l.includes('plast')) return 'plast';
  if (l.includes('mat')) return 'mat';
  if (l.includes('papir') || l.includes('papp')) return 'papir';
  if (l.includes('rest')) return 'rest';
  if (l.includes('glass') || l.includes('metall')) return 'glass';
  if (l.includes('hage')) return 'hage';
  return 'annet';
}

// Kilden oppgir kun dag + måned på hver dato («Onsdag 5. august»), og året
// separat på måned-overskriften («August 2026») — de kombineres her.
function parsePickups(html: string): Pickup[] {
  const $ = cheerio.load(html);
  const out: Pickup[] = [];

  $('.calendar__item').each((_, monthEl) => {
    const titleText = $(monthEl).find('.calendar__title').first().text().trim().toLowerCase();
    const titleMatch = titleText.match(/([a-zæøå]+)\s+(\d{4})/);
    if (!titleMatch) return;
    const monthIdx = MONTHS_NO.indexOf(titleMatch[1]);
    const year = Number(titleMatch[2]);
    if (monthIdx < 0 || !Number.isFinite(year)) return;

    $(monthEl).find('.calendar__list > li').each((_, li) => {
      const dateText = $(li).find('.calendar__date').first().text().trim();
      const dayMatch = dateText.match(/(\d{1,2})\./);
      if (!dayMatch) return;
      const day = Number(dayMatch[1]);
      const weekday = dateText.split(/\s+/)[0] ?? '';

      const types: WasteType[] = [];
      $(li).find('.calendar__fraction .calendar__label').each((_, labelEl) => {
        const name = $(labelEl).text().trim();
        if (name) types.push({ name, category: categorizeWaste(name) });
      });
      if (!types.length) return;

      const date = `${year}-${String(monthIdx + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      out.push({ date, weekday, dateLabel: `${day}. ${MONTHS_NO[monthIdx]}`, types });
    });
  });

  return out.sort((a, b) => a.date.localeCompare(b.date));
}

async function fetchPickups(): Promise<Pickup[]> {
  const resp = await fetch(TOMMEPLAN_URL, {
    headers: { 'User-Agent': 'Felles-App/1.0 div@ofrim.no' },
    signal: AbortSignal.timeout(9000),
  });
  if (!resp.ok) throw new Error(`Iris svarte ${resp.status}`);
  const html = await resp.text();
  const all = parsePickups(html);
  if (all.length === 0) throw new Error('Fant ingen tømmedatoer — siden kan ha endret struktur');
  return all;
}

// ─── Middag → Google Calendar ──────────────────────────────────────────────
// Duplisert fra api/middag-kalender.ts (se kommentaren ved syncMealEvent) —
// hold de to kopiene i synk.
// Event-ID er avledet direkte fra datoen, så samme dag alltid treffer samme
// hendelse (upsert i stedet for å hope opp duplikater ved re-valg av middag).
// Google krever id i [a-v0-9]{5,1024} — rent tallformat holder seg innenfor det.
function eventIdForDate(date: string): string {
  return `middag${date.replace(/-/g, '')}`;
}

async function getCalendar() {
  const email = process.env.GOOGLE_CLIENT_EMAIL;
  const key = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');
  if (!email || !key) throw new Error('Google-kalender er ikke konfigurert (mangler GOOGLE_CLIENT_EMAIL/GOOGLE_PRIVATE_KEY)');

  const auth = new google.auth.JWT({
    email,
    key,
    scopes: ['https://www.googleapis.com/auth/calendar.events'],
  });
  return google.calendar({ version: 'v3', auth });
}
type Calendar = Awaited<ReturnType<typeof getCalendar>>;

// 'HH:MM:SS' / 'YYYY-MM-DD' i Oslo lokal tid for et vilkårlig ISO-tidspunkt —
// samme sv-SE-triks som resten av appen bruker for lokal dato/tid uten et
// tredjeparts tidssone-bibliotek (se f.eks. api/cron/rollover.ts). All
// tidsberegning i denne filen går via Europe/Oslo, aldri serverens egen
// tidssone (Vercel kjører UTC).
function osloTimeOfDay(iso: string): string {
  return new Date(iso).toLocaleTimeString('sv-SE', { timeZone: 'Europe/Oslo', hour12: false });
}
function osloDateOf(iso: string): string {
  return new Date(iso).toLocaleDateString('sv-SE', { timeZone: 'Europe/Oslo' });
}

// Legger `hours` timer til et 'HH:MM:SS'-klokkeslett — ren klokke-aritmetikk
// (tidssonen er allerede håndtert av kalleren). Passerer resultatet midnatt,
// klemmes det til 23:59:59 slik at slutt aldri havner FØR start på samme dato.
function addHours(time: string, hours: number): string {
  const [h, m, s] = time.split(':').map(Number);
  const total = h * 60 + m + hours * 60;
  if (total >= 24 * 60) return '23:59:59';
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

const DEFAULT_MEAL_TIME = '19:00:00';
const TRAINING_NO_END_MEAL_TIME = '20:00:00';

// Finner en hendelse med EKSAKT denne tittelen på denne datoen (Oslo lokal
// dato), i den oppgitte kalenderen — direkte mot Google Calendar API med
// skrivesidens egen autentiserte klient, IKKE via api/kalender.ts (som
// filtrerer bort andre ting før den returnerer, og uansett leser en helt
// annen kilde — iCal-feeden, ikke selve Calendar-API-et). singleEvents:
// true utvider en eventuell gjentakende hendelse til den faktiske
// forekomsten denne dagen, så en flyttet/endret enkeltinstans leses riktig
// i stedet for seriens opprinnelige starttidspunkt. Vinduet er bevisst
// ±1 døgn i UTC (fremfor å regne ut eksakte Oslo-døgngrenser, som ville
// krevd å vite sommer-/vintertid på forhånd) — selve datofiltreringen
// skjer presist under, på Oslo-lokal dato.
async function findEventByTitle(calendar: Calendar, calendarId: string, date: string, title: string) {
  const DAY = 24 * 60 * 60 * 1000;
  const center = new Date(`${date}T12:00:00Z`).getTime();
  const { data } = await calendar.events.list({
    calendarId,
    timeMin: new Date(center - DAY).toISOString(),
    timeMax: new Date(center + DAY).toISOString(),
    singleEvents: true,
  });
  return (data.items ?? []).find(e => {
    if ((e.summary ?? '').trim() !== title) return false;
    const startIso = e.start?.dateTime ?? (e.start?.date ? `${e.start.date}T00:00:00Z` : null);
    return !!startIso && osloDateOf(startIso) === date;
  }) ?? null;
}

// Middagens starttid: 19:00 som standard, men styrt av en eventuell
// Trening-hendelse samme dag i den felles kalenderen — spiser man ikke
// middag midt i en treningsøkt. Finnes Trening med et satt sluttidspunkt
// (samme Oslo-dato), blir DET middagens starttid; finnes Trening uten
// sluttidspunkt (eller et heldags-arrangement uten klokkeslett, eller en
// økt som slutter etter midnatt), faller vi tilbake til 20:00.
// Feiler selve oppslaget mot Google (uavhengig av om skriving fungerer),
// faller vi tilbake til standardtiden i stedet for å la hele synken feile
// — samme best-effort-filosofi som resten av denne ruten.
async function resolveMealStartTime(calendar: Calendar, calendarId: string, date: string): Promise<string> {
  try {
    const trening = await findEventByTitle(calendar, calendarId, date, 'Trening');
    if (!trening) return DEFAULT_MEAL_TIME;
    const end = trening.end?.dateTime;
    if (!end || osloDateOf(end) !== date) return TRAINING_NO_END_MEAL_TIME;
    return osloTimeOfDay(end);
  } catch (e: any) {
    console.warn('middag-kalender: klarte ikke sjekke for Trening-hendelse, bruker standardtid', e?.message ?? e);
    return DEFAULT_MEAL_TIME;
  }
}

const httpStatus = (e: any): number | undefined => e?.code ?? e?.response?.status;

// Slår av/på Google-eventet for én dato. `title === null` fjerner det.
// Duplisert i api/cron/rollover.ts (Vercel bundler hver api-fil isolert, så
// kryss-import mellom rutefiler krasjer i drift) — hold de to kopiene i synk.
async function syncMealEvent(calendar: Calendar, calendarId: string, date: string, title: string | null) {
  const eventId = eventIdForDate(date);

  if (!title) {
    try {
      await calendar.events.delete({ calendarId, eventId });
    } catch (e: any) {
      // 404/410: finnes ikke / allerede slettet — da er målet nådd.
      if (httpStatus(e) !== 404 && httpStatus(e) !== 410) throw e;
    }
    return;
  }

  const startTime = await resolveMealStartTime(calendar, calendarId, date);
  const endTime = addHours(startTime, 1);
  // status: 'confirmed' er med hver gang: Google beholder ID-en til et slettet
  // event som «cancelled», og en patch uten status svarer 200 uten å gjøre
  // eventet synlig igjen.
  const requestBody = {
    status: 'confirmed',
    summary: `🍽️ ${title}`,
    start: { dateTime: `${date}T${startTime}`, timeZone: 'Europe/Oslo' },
    end: { dateTime: `${date}T${endTime}`, timeZone: 'Europe/Oslo' },
  };
  const patch = () => calendar.events.patch({ calendarId, eventId, requestBody });

  try {
    await patch();
  } catch (e: any) {
    // 404: aldri opprettet. 410: slettet for godt. Begge → opprett på nytt.
    if (httpStatus(e) !== 404 && httpStatus(e) !== 410) throw e;
    try {
      await calendar.events.insert({ calendarId, requestBody: { id: eventId, ...requestBody } });
    } catch (e2: any) {
      // 409: ID-en finnes allerede (cancelled event, eller samtidig insert) —
      // patch med status: 'confirmed' reaktiverer/oppdaterer det.
      if (httpStatus(e2) !== 409) throw e2;
      await patch();
    }
  }
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
  // Same underlying source as the "Neste plast" line in the clock box
  // (api/tommeplan.ts) — see the inlined fetchPickups()/parsePickups() above.
  // Deadline = the day before pickup, so the reminder lands "ta den ut i
  // kveld". Server-side, and gated by a unique index on (title, deadline) —
  // see scripts/todo-plast-dedupe-migration.sql — for the same reason the
  // handleliste sync moved off a client-side existence check: two concurrent
  // cron invocations (or a stray manual retry) can't produce duplicate rows
  // for the same pickup cycle.
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
          { title: 'Ta ut plast', deadline, who: 'f', priority: 'høy', done: false, overdue_days: 0 },
          { onConflict: 'title,deadline', ignoreDuplicates: true },
        );
        plastTodoSynced = !plastErr;
      }
    } catch {
      // Iris-skraping/parsing feilet denne kjøringen — hopp over, prøv igjen i morgen.
    }
  }

  // ─── 5. Avstem middager mot Google Calendar (i dag + 14 dager) ────────────
  // Fanger opp synker som feilet underveis (nettverk, kvote, utløpt innlogging
  // i nettleseren) og endringer gjort utenom appen. Sletter også hendelser for
  // datoer der middagen er fjernet. Sekvensielt for å være snill mot kvoten;
  // én dato som feiler stopper ikke resten.
  const mealCal = { synced: 0, failed: 0, skipped: null as string | null };
  {
    const calendarId = process.env.GOOGLE_CALENDAR_ID_FELLES;
    if (!calendarId) {
      mealCal.skipped = 'GOOGLE_CALENDAR_ID_FELLES er ikke satt';
    } else {
      try {
        const calendar = await getCalendar();
        const [y, m, d] = todayOslo.split('-').map(Number);
        const dates = Array.from({ length: 15 }, (_, i) =>
          new Date(Date.UTC(y, m - 1, d + i)).toISOString().slice(0, 10));

        const { data: rows, error } = await supabase
          .from('meal_plan')
          .select('date, recipes(name)')
          .gte('date', dates[0])
          .lte('date', dates[dates.length - 1]);
        if (error) throw new Error(`meal_plan: ${error.message}`);

        const titleByDate = new Map<string, string>();
        for (const r of (rows ?? []) as any[]) {
          const rec = Array.isArray(r.recipes) ? r.recipes[0] : r.recipes;
          titleByDate.set(r.date, rec?.name || 'Middag');
        }

        for (const date of dates) {
          try {
            await syncMealEvent(calendar, calendarId, date, titleByDate.get(date) ?? null);
            mealCal.synced++;
          } catch (e: any) {
            mealCal.failed++;
            console.error('rollover: middag-kalender-synk feilet for', date, e?.message ?? e);
          }
        }
      } catch (e: any) {
        mealCal.skipped = e?.message ?? String(e);
        console.error('rollover: hoppet over middag-kalender-avstemming', mealCal.skipped);
      }
    }
  }

  return res.json({ date: todayOslo, rolledTodos, priced, deals, prunedHistory, bucketRolled, plastTodoSynced, mealCal });
}
