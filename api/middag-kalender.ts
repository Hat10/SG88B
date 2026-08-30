import { createClient } from '@supabase/supabase-js';
import { google } from 'googleapis';

export const config = { maxDuration: 10 };

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
// tredjeparts tidssone-bibliotek (se f.eks. api/cron/rollover.ts).
function osloTimeOfDay(iso: string): string {
  return new Date(iso).toLocaleTimeString('sv-SE', { timeZone: 'Europe/Oslo', hour12: false });
}
function osloDateOf(iso: string): string {
  return new Date(iso).toLocaleDateString('sv-SE', { timeZone: 'Europe/Oslo' });
}

// Legger `hours` timer til et 'HH:MM:SS'-klokkeslett — ren klokke-aritmetikk
// (tidssonen er allerede håndtert av kalleren), med midnatts-rullover for
// sikkerhets skyld selv om det ikke er en realistisk case her.
function addHours(time: string, hours: number): string {
  const [h, m, s] = time.split(':').map(Number);
  const total = (((h * 60 + m + hours * 60) % (24 * 60)) + 24 * 60) % (24 * 60);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

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
// middag midt i en treningsøkt. Finnes Trening med et satt sluttidspunkt,
// blir DET middagens starttid; finnes Trening uten sluttidspunkt (eller et
// heldags-arrangement uten klokkeslett), faller vi tilbake til 20:00.
// Feiler selve oppslaget mot Google (uavhengig av om skriving fungerer),
// faller vi tilbake til standardtiden i stedet for å la hele synken feile
// — samme best-effort-filosofi som resten av denne ruten.
async function resolveMealStartTime(calendar: Calendar, calendarId: string, date: string): Promise<string> {
  try {
    const trening = await findEventByTitle(calendar, calendarId, date, 'Trening');
    if (!trening) return '19:00:00';
    const end = trening.end?.dateTime;
    return end ? osloTimeOfDay(end) : '20:00:00';
  } catch (e: any) {
    console.warn('middag-kalender: klarte ikke sjekke for Trening-hendelse, bruker standardtid', e?.message ?? e);
    return '19:00:00';
  }
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.status(405).send('Method not allowed');
    return;
  }

  const authHeader = req.headers['authorization'] as string | undefined;
  const accessToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!accessToken) {
    res.status(401).send('Unauthorized');
    return;
  }

  const supabase = createClient(
    process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
  const { data: userData, error: authError } = await supabase.auth.getUser(accessToken);
  if (authError || !userData?.user) {
    res.status(401).send('Unauthorized');
    return;
  }

  const { date, title } = (req.body ?? {}) as { date?: string; title?: string | null };
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    res.status(400).send('Ugyldig dato');
    return;
  }

  const calendarId = process.env.GOOGLE_CALENDAR_ID_FELLES;
  if (!calendarId) {
    res.status(500).send('GOOGLE_CALENDAR_ID_FELLES er ikke satt');
    return;
  }

  let calendar;
  try {
    calendar = await getCalendar();
  } catch (e: any) {
    res.status(500).send(e.message ?? 'Google-kalender er ikke konfigurert');
    return;
  }

  const eventId = eventIdForDate(date);

  try {
    if (!title) {
      // Middagen ble fjernet fra ukeplanen — fjern også hendelsen, hvis den finnes.
      try {
        await calendar.events.delete({ calendarId, eventId });
      } catch (e: any) {
        if (e?.code !== 404 && e?.response?.status !== 404) throw e;
      }
      res.status(200).json({ ok: true, deleted: true });
      return;
    }

    const startTime = await resolveMealStartTime(calendar, calendarId, date);
    const endTime = addHours(startTime, 1);
    const requestBody = {
      summary: `🍽️ ${title}`,
      start: { dateTime: `${date}T${startTime}`, timeZone: 'Europe/Oslo' },
      end: { dateTime: `${date}T${endTime}`, timeZone: 'Europe/Oslo' },
    };

    try {
      await calendar.events.patch({ calendarId, eventId, requestBody });
    } catch (e: any) {
      if (e?.code === 404 || e?.response?.status === 404) {
        await calendar.events.insert({ calendarId, requestBody: { id: eventId, ...requestBody } });
      } else {
        throw e;
      }
    }

    res.status(200).json({ ok: true });
  } catch (e: any) {
    console.error('middag-kalender: klarte ikke oppdatere Google-kalenderen', e?.message ?? e);
    res.status(502).json({ ok: false, error: 'Kunne ikke oppdatere kalenderen' });
  }
}
