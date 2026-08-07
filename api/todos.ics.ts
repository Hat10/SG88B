import { createClient } from '@supabase/supabase-js';

export const config = { maxDuration: 10 };

function pad(n: number) { return String(n).padStart(2, '0'); }

function toIcalDate(iso: string): string {
  // iso is 'YYYY-MM-DD'
  return iso.replace(/-/g, '');
}

function stamp(): string {
  const n = new Date();
  return `${n.getUTCFullYear()}${pad(n.getUTCMonth() + 1)}${pad(n.getUTCDate())}T${pad(n.getUTCHours())}${pad(n.getUTCMinutes())}${pad(n.getUTCSeconds())}Z`;
}

function foldLine(line: string): string {
  if (line.length <= 75) return line;
  const chunks = [];
  chunks.push(line.slice(0, 75));
  let i = 75;
  while (i < line.length) { chunks.push(' ' + line.slice(i, i + 74)); i += 74; }
  return chunks.join('\r\n');
}

export default async function handler(req: any, res: any) {
  const token = new URL(req.url!, 'http://localhost').searchParams.get('token');
  if (!token || token !== process.env.CAL_TODO_TOKEN) {
    res.status(401).send('Unauthorized');
    return;
  }

  const supabase = createClient(
    process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  // Roll over overdue items so the calendar always shows today's date for late todos
  const today = new Date().toISOString().slice(0, 10);
  const { data: overdue } = await supabase
    .from('todo_items')
    .select('id, deadline, overdue_days')
    .eq('done', false)
    .not('deadline', 'is', null)
    .lt('deadline', today);

  if (overdue && overdue.length > 0) {
    await Promise.all(overdue.map(t => {
      const daysPast = Math.round(
        (new Date(today).getTime() - new Date(t.deadline).getTime()) / 86400000
      );
      return supabase.from('todo_items').update({
        deadline: today,
        overdue_days: (t.overdue_days ?? 0) + daysPast,
      }).eq('id', t.id);
    }));
  }

  const whoFilter = new URL(req.url!, 'http://localhost').searchParams.get('who') as 'M' | 'L' | null;

  let query = supabase
    .from('todo_items')
    .select('id, title, description, who, priority, deadline, overdue_days, time')
    .not('deadline', 'is', null)
    .eq('done', false)
    .order('deadline');

  if (whoFilter === 'M' || whoFilter === 'L') {
    query = query.in('who', [whoFilter, 'f']);
  }

  const { data: todos, error } = await query;

  if (error) { res.status(500).send('Database error'); return; }

  const who: Record<string, string> = { f: 'Felles', M: 'Andreas', L: 'Taran' };
  const pri: Record<string, string> = { høy: '🔴', middels: '🟡', lav: '⚪' };
  const now = stamp();

  const vevents = (todos ?? []).map(t => {
    const date = toIcalDate(t.deadline);
    const whoLabel = t.who === 'f' ? '' : `(${who[t.who]})`;
    const overdueDays = t.overdue_days ?? 0;
    const overdueLabel = overdueDays > 0 ? ` · ${overdueDays}d forsinket` : '';
    const label = `${pri[t.priority] ?? ''} ${t.title}${whoLabel ? ' ' + whoLabel : ''}${overdueLabel}`.trim();
    const desc = [who[t.who], t.description].filter(Boolean).join(' · ');

    let dtstart: string;
    let dtend: string;
    if (t.time) {
      const [hh, mm] = t.time.split(':');
      const endHh = (parseInt(hh) + 1) % 24;
      const endDate = endHh === 0
        ? (() => { const d = new Date(t.deadline + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10).replace(/-/g, ''); })()
        : date;
      dtstart = `DTSTART;TZID=Europe/Oslo:${date}T${hh}${mm}00`;
      dtend   = `DTEND;TZID=Europe/Oslo:${endDate}T${pad(endHh)}${mm}00`;
    } else {
      dtstart = `DTSTART;VALUE=DATE:${date}`;
      // DTEND for all-day events must be the next day (non-inclusive per RFC 5545)
      const d = new Date(Date.UTC(parseInt(date.slice(0,4)), parseInt(date.slice(4,6))-1, parseInt(date.slice(6,8)) + 1));
      const nextDate = `${d.getUTCFullYear()}${pad(d.getUTCMonth()+1)}${pad(d.getUTCDate())}`;
      dtend   = `DTEND;VALUE=DATE:${nextDate}`;
    }

    // Include deadline in UID so rolled-over todos get a new UID each day,
    // causing calendar apps to create a fresh event (and a fresh notification)
    // instead of silently updating the existing one.
    return [
      'BEGIN:VEVENT',
      foldLine(`UID:todo-${t.id}-${t.deadline}@felles.ofrim.no`),
      `DTSTAMP:${now}`,
      dtstart,
      dtend,
      foldLine(`SUMMARY:${label}`),
      ...(desc ? [foldLine(`DESCRIPTION:${desc}`)] : []),
      'END:VEVENT',
    ].join('\r\n');
  });

  const ical = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Felles//Gjøremål//NO',
    'X-WR-CALNAME:Gjøremål',
    'CALSCALE:GREGORIAN',
    ...vevents,
    'END:VCALENDAR',
  ].join('\r\n');

  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="gjoremal.ics"');
  res.setHeader('Cache-Control', 'max-age=300, must-revalidate');
  res.send(ical);
}
