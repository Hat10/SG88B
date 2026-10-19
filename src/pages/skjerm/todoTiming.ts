// Tidsvisning for Gjøremål-kortet på Gangskjermen: hvilken gruppe et gjøremål
// hører til (Forfalt / I dag / Denne uken / Senere / Uten frist), og en kort,
// relativ etikett («I morgen», «Om 3 dager») som er lett å lese på tvers av rommet.
//
// «Denne uken» følger MANDAG-ankeret (startOfWeek, samme som Trening) og går
// til og med søndag — bevisst ikke «neste 7 dager» og ikke handleukas
// lørdag-anker. På en søndag er «Denne uken» derfor alltid tom etter i dag.

import { dateLabel } from '../../lib/dayLabel';
import { startOfWeek } from '../../lib/treningPulse';

export type TodoBucket = 'forfalt' | 'idag' | 'uke' | 'senere' | 'ingen';

export const BUCKET_ORDER: TodoBucket[] = ['forfalt', 'idag', 'uke', 'senere', 'ingen'];

export const BUCKET_LABEL: Record<TodoBucket, string> = {
  forfalt: 'Forfalt', idag: 'I dag', uke: 'Denne uken', senere: 'Senere', ingen: 'Uten frist',
};

/** CSS-variabel (definert i styles.css for begge temaer) som fargekoder gruppen. */
export const BUCKET_COLOR: Record<TodoBucket, string> = {
  forfalt: 'var(--due-over)', idag: 'var(--due-today)', uke: 'var(--due-soon)',
  senere: 'var(--due-later)', ingen: 'var(--ink-4)',
};

export interface TodoTiming {
  bucket: TodoBucket;
  /** Hovedetiketten i pillen, f.eks. «I dag 18:00», «Om 3 dager». */
  label: string;
  /** Liten tekst under pillen: faktisk dato, eller «om 4 t» for i dag. */
  sub?: string;
  /** Kun for Forfalt: opprinnelig frist (YYYY-MM-DD) — eldst først = lengst forfalt. */
  sortKey?: string;
}

function localIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Antall kalenderdager fra `fromIso` til `toIso` (begge YYYY-MM-DD). DST-trygt via UTC. */
export function dayDiff(fromIso: string, toIso: string): number {
  const [fy, fm, fd] = fromIso.split('-').map(Number);
  const [ty, tm, td] = toIso.split('-').map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000);
}

/** «om 25 min», «om 1 t 30 min», «om 4 t». */
export function fmtUntil(ms: number): string {
  const totalMin = Math.max(0, Math.ceil(ms / 60_000));
  if (totalMin < 60) return `om ${totalMin} min`;
  const h = Math.floor(totalMin / 60);
  const rest = totalMin % 60;
  return h < 3 && rest > 0 ? `om ${h} t ${rest} min` : `om ${h} t`;
}

/** Relativ etikett for en fremtidig frist `n` dager unna (n ≥ 1). */
export function relativeDays(n: number): string {
  if (n === 1) return 'I morgen';
  if (n < 14) return `Om ${n} dager`;
  return `Om ${Math.floor(n / 7)} uker`;
}

/**
 * @param t.deadline     YYYY-MM-DD, eller undefined for gjøremål uten frist
 * @param t.time         HH:MM, valgfritt
 * @param t.overdueSince YYYY-MM-DD for den OPPRINNELIGE fristen når gjøremålet
 *                       er forfalt (rollover flytter `deadline` til i dag og teller
 *                       opp overdue_days, så dette må regnes ut av kalleren).
 */
export function todoTiming(
  t: { deadline?: string; time?: string; overdueSince?: string },
  now: Date,
): TodoTiming {
  if (!t.deadline) return { bucket: 'ingen', label: 'Ingen frist' };

  const today = localIso(now);

  if (t.overdueSince) {
    const n = dayDiff(t.overdueSince, today);
    const sortKey = t.overdueSince;
    if (n <= 0) return { bucket: 'forfalt', label: 'Forfalt i dag', sub: t.time ? `kl. ${t.time}` : undefined, sortKey };
    return { bucket: 'forfalt', label: `Forfalt ${n} d`, sub: dateLabel(t.overdueSince), sortKey };
  }

  const n = dayDiff(today, t.deadline);
  if (n < 0) return { bucket: 'forfalt', label: `Forfalt ${-n} d`, sub: dateLabel(t.deadline), sortKey: t.deadline };
  if (n === 0) {
    if (!t.time) return { bucket: 'idag', label: 'I dag' };
    const ms = new Date(`${t.deadline}T${t.time}:00`).getTime() - now.getTime();
    return { bucket: 'idag', label: `I dag ${t.time}`, sub: fmtUntil(ms) };
  }

  const sunday = startOfWeek(now);
  sunday.setDate(sunday.getDate() + 6);
  const bucket: TodoBucket = t.deadline <= localIso(sunday) ? 'uke' : 'senere';
  const sub = dateLabel(t.deadline) + (t.time ? ` ${t.time}` : '');
  return { bucket, label: relativeDays(n), sub };
}
