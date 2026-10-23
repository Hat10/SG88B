import { createClient } from '@supabase/supabase-js';
import { google } from 'googleapis';

export const config = { maxDuration: 30 };

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

// Middagen ligger ALLTID kl. 20:00–21:00 (Europe/Oslo), uansett hva annet som
// står i kalenderen.
const MEAL_START_TIME = '20:00:00';
const MEAL_END_TIME = '21:00:00';

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

  // status: 'confirmed' er med hver gang: Google beholder ID-en til et slettet
  // event som «cancelled», og en patch uten status svarer 200 uten å gjøre
  // eventet synlig igjen.
  const requestBody = {
    status: 'confirmed',
    summary: `🍽️ ${title}`,
    start: { dateTime: `${date}T${MEAL_START_TIME}`, timeZone: 'Europe/Oslo' },
    end: { dateTime: `${date}T${MEAL_END_TIME}`, timeZone: 'Europe/Oslo' },
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

  const { date } = (req.body ?? {}) as { date?: string };
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

  try {
    // Databasen er sannhetskilden: klienten sender bare datoen, og vi leser
    // gjeldende meal_plan-rad her. Samtidige kall for samme dato konvergerer
    // da alle mot samme sluttilstand, uavhengig av rekkefølgen de fullføres i.
    const { data: row, error: dbError } = await supabase
      .from('meal_plan')
      .select('recipes(name)')
      .eq('date', date)
      .maybeSingle();
    if (dbError) throw new Error(`meal_plan: ${dbError.message}`);

    const recipe = (row as any)?.recipes;
    const name = Array.isArray(recipe) ? recipe[0]?.name : recipe?.name;
    const title: string | null = row ? (name || 'Middag') : null;

    await syncMealEvent(calendar, calendarId, date, title);
    res.status(200).json({ ok: true, deleted: title === null });
  } catch (e: any) {
    console.error('middag-kalender: klarte ikke oppdatere Google-kalenderen', e?.message ?? e);
    res.status(502).json({ ok: false, error: 'Kunne ikke oppdatere kalenderen' });
  }
}
