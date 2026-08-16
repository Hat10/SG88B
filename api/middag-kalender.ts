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

    const requestBody = {
      summary: `🍽️ ${title}`,
      start: { dateTime: `${date}T19:30:00`, timeZone: 'Europe/Oslo' },
      end: { dateTime: `${date}T20:30:00`, timeZone: 'Europe/Oslo' },
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
