export const config = { maxDuration: 15 };

// ─── Types ─────────────────────────────────────────────────────────────────

export interface CalEvent {
  id: string;
  title: string;
  start: string;   // 'YYYY-MM-DD' for all-day, ISO datetime for timed
  end?: string;
  allDay: boolean;
  source: 'andreas' | 'taran' | 'felles';
  color: string;
}

// ─── Feed config ───────────────────────────────────────────────────────────

const FEEDS = [
  { env: 'CAL_ANDREAS_PERSONAL', source: 'andreas', color: '#4A80C4' },
  { env: 'CAL_ANDREAS_FELLES',   source: 'felles',  color: '#7AB394' },
  { env: 'CAL_TARAN_PERSONAL',   source: 'taran',   color: '#6B2FA0' },
  { env: 'CAL_TARAN_FELLES',     source: 'felles',  color: '#7AB394' },
] as const;

// ─── Date helpers ──────────────────────────────────────────────────────────

function addDays(d: Date, n: number): Date {
  const r = new Date(d); r.setUTCDate(r.getUTCDate() + n); return r;
}
function addMonths(d: Date, n: number): Date {
  const r = new Date(d); r.setUTCMonth(r.getUTCMonth() + n); return r;
}
function addYears(d: Date, n: number): Date {
  const r = new Date(d); r.setUTCFullYear(r.getUTCFullYear() + n); return r;
}
function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}
// Replace only the date portion of an ISO string, keeping time/tz intact
function shiftDate(iso: string, newDate: string): string {
  if (!iso.includes('T')) return newDate;
  return newDate + iso.slice(10);
}

// ─── iCal low-level ────────────────────────────────────────────────────────

function unfold(text: string): string {
  return text.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '');
}
function unescape(val: string): string {
  return val.replace(/\\n/g, ' ').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\');
}

function parseDate(propKey: string, val: string): { iso: string; allDay: boolean } {
  const allDay = !val.includes('T');
  if (allDay) {
    return { iso: `${val.slice(0,4)}-${val.slice(4,6)}-${val.slice(6,8)}`, allDay: true };
  }
  const y = val.slice(0,4), mo = val.slice(4,6), d = val.slice(6,8);
  const h = val.slice(9,11), mi = val.slice(11,13);
  const utc = val.endsWith('Z');
  const hasTzid = propKey.toUpperCase().includes('TZID');
  const iso = `${y}-${mo}-${d}T${h}:${mi}:00${utc || !hasTzid ? 'Z' : ''}`;
  return { iso, allDay: false };
}

// Parse EXDATE value(s) → array of 'YYYY-MM-DD' strings
function parseExdateVal(val: string): string[] {
  return val.split(',').map(v => {
    const s = v.trim().replace(/T.*$/, ''); // strip time part
    if (s.length === 8) return `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}`;
    return s; // already YYYY-MM-DD
  });
}

// ─── RRULE ─────────────────────────────────────────────────────────────────

const WDAY: Record<string, number> = { SU:0, MO:1, TU:2, WE:3, TH:4, FR:5, SA:6 };

interface Rrule {
  freq: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
  interval: number;
  until?: Date;
  count?: number;
  byDay?: number[];
  byMonthDay?: number[];
  byMonth?: number[];
}

function parseRrule(val: string): Rrule | null {
  const p: Record<string,string> = {};
  for (const s of val.split(';')) {
    const i = s.indexOf('=');
    if (i > 0) p[s.slice(0,i).toUpperCase()] = s.slice(i+1);
  }
  const freq = p['FREQ'] as Rrule['freq'];
  if (!freq) return null;

  let until: Date | undefined;
  if (p['UNTIL']) {
    const u = p['UNTIL'].replace(/T.*$/, '');
    until = new Date(`${u.slice(0,4)}-${u.slice(4,6)}-${u.slice(6,8)}T23:59:59Z`);
  }

  return {
    freq,
    interval:   parseInt(p['INTERVAL'] ?? '1'),
    until,
    count:      p['COUNT'] ? parseInt(p['COUNT']) : undefined,
    byDay:      p['BYDAY']      ? p['BYDAY'].split(',').map(d => WDAY[d.replace(/^[+-]?\d+/, '')]).filter(n => !isNaN(n)) : undefined,
    byMonthDay: p['BYMONTHDAY'] ? p['BYMONTHDAY'].split(',').map(Number) : undefined,
    byMonth:    p['BYMONTH']    ? p['BYMONTH'].split(',').map(Number) : undefined,
  };
}

// Generate all occurrence start-dates for an RRULE within [dtstart, hardLimit]
function generateOccurrences(dtstart: Date, rrule: Rrule, hardLimit: Date): Date[] {
  const limit = rrule.until && rrule.until < hardLimit ? rrule.until : hardLimit;
  const maxCount = rrule.count ?? 5000;
  const dates: Date[] = [];

  if (rrule.freq === 'DAILY') {
    let cur = new Date(dtstart);
    while (cur <= limit && dates.length < maxCount) {
      dates.push(new Date(cur));
      cur = addDays(cur, rrule.interval);
    }

  } else if (rrule.freq === 'WEEKLY') {
    if (rrule.byDay?.length) {
      // Walk week-by-week (interval*7 days), emit matching weekdays each week
      // Start from the Sunday of dtstart's week
      const sun = new Date(dtstart);
      sun.setUTCDate(sun.getUTCDate() - sun.getUTCDay());

      let weekBase = new Date(sun);
      while (weekBase <= limit && dates.length < maxCount) {
        for (const wday of [...rrule.byDay].sort((a,b) => a-b)) {
          const candidate = new Date(weekBase);
          candidate.setUTCDate(candidate.getUTCDate() + wday);
          if (candidate >= dtstart && candidate <= limit && dates.length < maxCount) {
            dates.push(new Date(candidate));
          }
        }
        weekBase = addDays(weekBase, rrule.interval * 7);
      }
    } else {
      let cur = new Date(dtstart);
      while (cur <= limit && dates.length < maxCount) {
        dates.push(new Date(cur));
        cur = addDays(cur, rrule.interval * 7);
      }
    }

  } else if (rrule.freq === 'MONTHLY') {
    if (rrule.byMonthDay?.length) {
      let monthBase = new Date(Date.UTC(dtstart.getUTCFullYear(), dtstart.getUTCMonth(), 1));
      while (monthBase <= limit && dates.length < maxCount) {
        for (const mday of rrule.byMonthDay) {
          const candidate = new Date(Date.UTC(monthBase.getUTCFullYear(), monthBase.getUTCMonth(), mday));
          if (candidate >= dtstart && candidate <= limit && dates.length < maxCount) {
            dates.push(candidate);
          }
        }
        monthBase = addMonths(monthBase, rrule.interval);
      }
    } else {
      let cur = new Date(dtstart);
      while (cur <= limit && dates.length < maxCount) {
        dates.push(new Date(cur));
        cur = addMonths(cur, rrule.interval);
      }
    }

  } else if (rrule.freq === 'YEARLY') {
    let cur = new Date(dtstart);
    while (cur <= limit && dates.length < maxCount) {
      if (rrule.byMonth?.length) {
        for (const month of rrule.byMonth) {
          const candidate = new Date(Date.UTC(cur.getUTCFullYear(), month - 1, dtstart.getUTCDate()));
          if (candidate >= dtstart && candidate <= limit && dates.length < maxCount) {
            dates.push(candidate);
          }
        }
      } else {
        dates.push(new Date(cur));
      }
      cur = addYears(cur, rrule.interval);
    }
  }

  return dates.sort((a,b) => a.getTime()-b.getTime());
}

// Expand a recurring event into individual instances within the display window
function expandRrule(
  base: CalEvent,
  rruleStr: string,
  exdates: Set<string>,
  winStart: string,  // 'YYYY-MM-DD'
  winEnd: string,    // 'YYYY-MM-DD'
): CalEvent[] {
  const rrule = parseRrule(rruleStr);
  if (!rrule) return [base];

  // Parse dtstart as a UTC date (date-only events use midnight UTC)
  const dtStartStr = base.start.includes('T') ? base.start : base.start + 'T00:00:00Z';
  const dtStart = new Date(dtStartStr);

  // Duration in ms (for shifting end date to each instance)
  const dtEndStr = base.end ? (base.end.includes('T') ? base.end : base.end + 'T00:00:00Z') : null;
  const durMs = dtEndStr ? new Date(dtEndStr).getTime() - dtStart.getTime() : 0;

  const hardLimit = new Date(winEnd + 'T23:59:59Z');
  const occurrences = generateOccurrences(dtStart, rrule, hardLimit);

  const winStartDate = new Date(winStart + 'T00:00:00Z');
  const instances: CalEvent[] = [];

  for (const occ of occurrences) {
    const occDateStr = toDateStr(occ);
    if (exdates.has(occDateStr)) continue;
    // Only emit instances that overlap with the display window
    if (occ < winStartDate && durMs === 0) continue;
    const occEnd = durMs > 0 ? new Date(occ.getTime() + durMs) : occ;
    if (occEnd < winStartDate) continue;

    const newStart = shiftDate(base.start, occDateStr);
    const newEnd   = dtEndStr ? shiftDate(base.end!, toDateStr(new Date(occ.getTime() + durMs))) : undefined;

    instances.push({ ...base, id: `${base.id}_${occDateStr}`, start: newStart, end: newEnd });
  }

  return instances;
}

// ─── iCal parser ───────────────────────────────────────────────────────────

function parseIcal(
  text: string,
  source: CalEvent['source'],
  color: string,
  winStart: string,
  winEnd: string,
): CalEvent[] {
  const lines = unfold(text).split(/\r?\n/);
  const events: CalEvent[] = [];
  let inEvent = false;
  let props: Record<string, { key: string; val: string }> = {};
  let exdateVals: string[] = [];
  let rruleVal: string | undefined;

  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') {
      inEvent = true; props = {}; exdateVals = []; rruleVal = undefined;
      continue;
    }
    if (line === 'END:VEVENT') {
      inEvent = false;
      const uid     = props['UID']?.val;
      const summary = props['SUMMARY']?.val;
      const dtstart = props['DTSTART'];
      if (!uid || !summary || !dtstart) continue;

      const { iso: start, allDay } = parseDate(dtstart.key, dtstart.val);
      const endProp = props['DTEND'];
      const end = endProp ? parseDate(endProp.key, endProp.val).iso : undefined;

      const base: CalEvent = { id: uid, title: unescape(summary), start, end, allDay, source, color };

      if (rruleVal) {
        // Expand all recurrences within window
        const exSet = new Set(exdateVals);
        events.push(...expandRrule(base, rruleVal, exSet, winStart, winEnd));
      } else {
        // Single event — include if it overlaps with the window
        const startDay = start.slice(0, 10);
        const endDay   = (end ?? start).slice(0, 10);
        if (startDay <= winEnd && endDay >= winStart) {
          // Multi-day all-day event: expand to one entry per day
          if (allDay && end && end.slice(0, 10) > startDay) {
            const s = new Date(startDay + 'T00:00:00Z');
            const e = new Date(end.slice(0, 10) + 'T00:00:00Z'); // DTEND is exclusive
            let cur = new Date(s);
            let safety = 0;
            while (cur < e && safety++ < 365) {
              const dayStr = toDateStr(cur);
              if (dayStr >= winStart && dayStr <= winEnd) {
                events.push({ ...base, id: `${base.id}_${dayStr}`, start: dayStr, end: toDateStr(addDays(cur, 1)) });
              }
              cur = addDays(cur, 1);
            }
          } else {
            events.push(base);
          }
        }
      }
      continue;
    }
    if (!inEvent) continue;

    const colon = line.indexOf(':');
    if (colon <= 0) continue;
    const fullKey  = line.slice(0, colon);
    const baseName = fullKey.split(';')[0].toUpperCase();
    const val      = line.slice(colon + 1);

    if (baseName === 'EXDATE') {
      exdateVals.push(...parseExdateVal(val));
    } else if (baseName === 'RRULE') {
      rruleVal = val;
    } else {
      props[baseName] = { key: fullKey, val };
    }
  }
  return events;
}

// ─── Handler ───────────────────────────────────────────────────────────────

export default async function handler(_req: any, res: any) {
  const now = new Date();
  const horizon = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);
  const todayStr   = now.toISOString().slice(0, 10);
  const horizonStr = horizon.toISOString().slice(0, 10);

  const results = await Promise.allSettled(
    FEEDS.map(async ({ env, source, color }) => {
      const url = process.env[env];
      if (!url) return [] as CalEvent[];
      const resp = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (!resp.ok) return [] as CalEvent[];
      const text = await resp.text();
      return parseIcal(text, source, color, todayStr, horizonStr);
    })
  );

  const events: CalEvent[] = [];
  for (const r of results) {
    if (r.status === 'fulfilled') events.push(...r.value);
  }

  // Deduplicate felles events (same UID from both feeds)
  const seen = new Set<string>();
  const deduped = events.filter(e => {
    const key = `${e.source}-${e.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  deduped.sort((a, b) => a.start.localeCompare(b.start));

  res.setHeader('Cache-Control', 's-maxage=300');
  res.json(deduped);
}
