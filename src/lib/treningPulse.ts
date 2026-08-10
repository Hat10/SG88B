// Regelsettet bak info-boksen på Trening → Statistikk, og den samme boksen på
// Gangskjermen. Alt her er rene funksjoner uten React, så begge sidene kan dele
// én implementasjon i stedet for å ha hver sin som driver fra hverandre.
//
// Familiene er Etterslep og Mål/milepæler. Rotasjonsmeldinger er med
// vilje utelatt: hvem rekkefølgen venter på hører hjemme på hero-kortet på
// forsiden, der man faktisk kan gjøre noe med det.
//
// Utvelgelse: hver regel har en vekt 0–100 for hvor mye den er verdt akkurat
// nå. Hendelser (rekorder, milepæler) aldres med `fade()` i stedet for å ha et
// hardt vindu, tilstander står fast. Påminnelser får et påslag, men kan ikke
// blokkere positive meldinger. Toppsjiktet deler på plassen med én bytting i
// døgnet. Se `pickPulse` for detaljene.
//
// Dette erstattet et rent prioritetssystem der påminnelser slo alt positivt og
// bare eksakt like prioriteter byttet på. Der ble en fersk rekord skjult av
// «ingen økter denne uka», og de laveste reglene kom aldri til orde i praksis.

import type { WorkoutSession, WorkoutRecord, WorkoutGoal, GoalKind, Trainer } from '../contexts/TreningContext';
import type { Who } from '../data';

export const WHO_LABEL: Record<Who, string> = { f: 'Felles', M: 'Andreas', L: 'Taran' };
export const TRAINERS: Trainer[] = ['M', 'L'];

const DAY = 86400000;

export const pad = (n: number) => String(n).padStart(2, '0');
export const dayKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const fmtNum = (n: number, decimals = 1) =>
  n.toLocaleString('nb-NO', { maximumFractionDigits: decimals });

/** Varighet i minutter for en fullført økt. null ⇒ økta løper fortsatt. */
export function durationMin(s: WorkoutSession): number | null {
  if (!s.completedAt) return null;
  const ms = new Date(s.completedAt).getTime() - new Date(s.startedAt).getTime();
  return ms > 0 ? ms / 60000 : null;
}

/** Sum av målt tid, i minutter. */
export function totalMinutes(sessions: WorkoutSession[]): number {
  return sessions.reduce((sum, s) => sum + (durationMin(s) ?? 0), 0);
}

/** Registrert tillegg utenfor økta, i minutter. 0 når det ikke finnes noe. */
export const extraMinutes = (s: WorkoutSession): number => s.extraMinutes ?? 0;

/**
 * Total tid på gymmen: øktvarighet + tillegg. Tillegget («Diverse») teller her,
 * og bare her — aldri i durationMin eller noe snitt. Det er tid på gymmen, ikke
 * en del av økta, så øktsnittet skal ikke merke det.
 */
export function totalGymMinutes(sessions: WorkoutSession[]): number {
  return sessions.reduce((sum, s) => sum + (durationMin(s) ?? 0) + extraMinutes(s), 0);
}

/** «45 min», «1 t 20 min», «2 t». */
export function fmtDur(mins: number | null | undefined): string {
  if (mins == null || !isFinite(mins) || mins < 1) return '—';
  const m = Math.round(mins);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest === 0 ? `${h} t` : `${h} t ${rest} min`;
}

export function startOfWeek(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); // mandag = 0
  return x;
}

// ─── Streak ─────────────────────────────────────────────────────────────────
//
// DEFINISJONEN PÅ EN STREAK
//
//   En uke teller i streaken når HVER av personene streaken gjelder for har
//   minst STREAK_MIN_SESSIONS fullførte økter i den uka. Uker går mandag til
//   søndag. For den felles streaken må altså både Andreas og Taran ha trent tre
//   ganger den uka; for en personlig streak (et `weekly_streak`-mål med
//   who = 'M' eller 'L') gjelder kravet bare den ene.
//
//   Streaken er summen av slike uker bakover fra og med inneværende uke. Er
//   ikke kravet nådd ennå denne uka, telles det fra forrige — uka er ikke over,
//   så den skal ikke kunne bryte rekka før søndag kveld.
//
// Dette er den eneste definisjonen: alt som heter «streak» i appen — tallet på
// statistikksiden, `weekly_streak`-mål og pulsreglene — leser herfra. Den gamle
// definisjonen var «minst én økt i uka», som lot rekka løpe i det uendelige på
// et minimum av trening.

/** Antall økter hver person må ha i løpet av uka for at uka teller i streaken. */
export const STREAK_MIN_SESSIONS = 3;

/** Ukene (nøklet på mandagen) der alle i `who` nådde kravet. */
function streakWeeks(sessions: WorkoutSession[], who: Trainer[]): Set<string> {
  const counts = new Map<string, Map<Trainer, number>>();
  for (const s of sessions) {
    if (!s.completedAt) continue;
    const k = dayKey(startOfWeek(new Date(s.startedAt)));
    if (!counts.has(k)) counts.set(k, new Map());
    const week = counts.get(k)!;
    week.set(s.who, (week.get(s.who) ?? 0) + 1);
  }
  return new Set(
    [...counts]
      .filter(([, week]) => who.every(p => (week.get(p) ?? 0) >= STREAK_MIN_SESSIONS))
      .map(([k]) => k),
  );
}

/** Hvor mange økter `who` mangler denne uka for at den skal telle. 0 = i boks. */
export function streakShortfall(sessions: WorkoutSession[], who: Trainer): number {
  const from = startOfWeek(new Date()).getTime();
  const n = sessions.filter(s =>
    s.completedAt && s.who === who && new Date(s.startedAt).getTime() >= from).length;
  return Math.max(0, STREAK_MIN_SESSIONS - n);
}

/** Uker på rad som oppfyller streak-kravet, fram til denne uka (eller forrige). */
export function weekStreak(sessions: WorkoutSession[], who: Trainer[] = TRAINERS): number {
  const weeks = streakWeeks(sessions, who);
  if (weeks.size === 0) return 0;
  const cursor = startOfWeek(new Date());
  if (!weeks.has(dayKey(cursor))) cursor.setDate(cursor.getDate() - 7);
  let n = 0;
  while (weeks.has(dayKey(cursor))) { n++; cursor.setDate(cursor.getDate() - 7); }
  return n;
}

/**
 * Tidspunktet streaken sist ble forlenget: da den siste av dem tok økt nummer
 * STREAK_MIN_SESSIONS i den nyeste kvalifiserende uka. null om ingen uke
 * kvalifiserer. Brukes til å aldre «lengste rekke»-skrytet, som ellers ville
 * stått med samme setning hver dag så lenge rekka varte.
 */
export function streakExtendedOn(sessions: WorkoutSession[], who: Trainer[] = TRAINERS): number | null {
  const weeks = streakWeeks(sessions, who);
  if (weeks.size === 0) return null;
  const cursor = startOfWeek(new Date());
  if (!weeks.has(dayKey(cursor))) cursor.setDate(cursor.getDate() - 7);
  if (!weeks.has(dayKey(cursor))) return null;
  const from = cursor.getTime(), to = from + 7 * DAY;
  const qualified = who.map(p => sessions
    .filter(s => s.completedAt && s.who === p)
    .map(s => new Date(s.startedAt).getTime())
    .filter(t => t >= from && t < to)
    .sort((a, b) => a - b)[STREAK_MIN_SESSIONS - 1]);
  return qualified.some(t => t === undefined) ? null : Math.max(...qualified);
}

/** Beste rekke med uker som oppfylte streak-kravet. */
export function bestWeekStreak(sessions: WorkoutSession[], who: Trainer[] = TRAINERS): number {
  const weeks = [...streakWeeks(sessions, who)].sort();
  let best = 0, run = 0;
  let prev: number | null = null;
  for (const k of weeks) {
    const t = new Date(k).getTime();
    run = prev !== null && t - prev === 7 * DAY ? run + 1 : 1;
    best = Math.max(best, run);
    prev = t;
  }
  return best;
}

/**
 * Median av en tallrekke. Tom rekke ⇒ null.
 *
 * Med et partall verdier er medianen snittet av de to midterste — ikke den
 * øverste av dem. Med to økter kl. 17 og kl. 18 er svaret 17:30, ikke 18:00.
 */
export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const half = Math.floor(s.length / 2);
  return s.length % 2 ? s[half] : (s[half - 1] + s[half]) / 2;
}

/** Typisk antall dager mellom øktene til én person. Median tåler ferier og sykdom. */
export function typicalGapDays(sessions: WorkoutSession[], who: Trainer): number | null {
  const cutoff = Date.now() - 90 * DAY;
  const times = sessions
    .filter(s => s.completedAt && s.who === who && new Date(s.startedAt).getTime() >= cutoff)
    .map(s => new Date(s.startedAt).getTime())
    .sort((a, b) => a - b);
  if (times.length < 3) return null;
  return median(times.slice(1).map((t, i) => (t - times[i]) / DAY));
}

// ─── Mål ────────────────────────────────────────────────────────────────────
//
// Ett sted som regner ut hvor et mål står. Både statistikksiden og reglene
// under leser herfra, så en frist eller en ny måltype ikke kan bety to ting
// på to steder.

export interface GoalKindInfo {
  v: GoalKind;
  label: string;
  hint: string;
  /** Enheten målet måles i. Rekordmål arver enheten fra selve rekorden. */
  unit: string;
  /** Rekordmål trenger en øvelse; resten regnes ut fra øktloggen. */
  needsExercise?: boolean;
  /** Rekordmål gir bare mening for én person; resten for alle. */
  who: 'alle' | 'felles' | 'person';
  /** Forslag til mål når man bytter type. */
  suggest: number;
  /** Desimaler er meningsfulle for kg, ikke for antall økter. */
  decimals?: boolean;
  /** Halen på tittelforslaget: «150 økter» + « i år». */
  titleSuffix: string;
}

export const GOAL_KINDS: GoalKindInfo[] = [
  { v: 'record',         label: 'Rekord i en øvelse', hint: 'Nå en gitt vekt eller repetisjon — med eller uten frist', unit: 'kg',    who: 'person', suggest: 100, needsExercise: true, decimals: true, titleSuffix: '' },
  { v: 'sessions_year',  label: 'Økter i år',         hint: 'Teller fullførte økter hittil i år',                      unit: 'økter', who: 'alle',   suggest: 150, titleSuffix: ' i år' },
  { v: 'sessions_month', label: 'Økter denne måneden',hint: 'Teller fullførte økter i inneværende måned',              unit: 'økter', who: 'alle',   suggest: 12,  titleSuffix: ' denne måneden' },
  { v: 'sessions_total', label: 'Økter totalt',       hint: 'Teller alle fullførte økter noensinne',                   unit: 'økter', who: 'alle',   suggest: 500, titleSuffix: ' totalt' },
  { v: 'weekly_streak',  label: 'Uker på rad',        hint: `Teller uker på rad der hver av dere har minst ${STREAK_MIN_SESSIONS} økter`, unit: 'uker', who: 'alle', suggest: 8, titleSuffix: ' på rad' },
];

// Ikke lenger valgbare for nye mål (varighet registreres ikke), men eksisterende
// mål av disse typene finnes fortsatt i basen og må vises med riktig enhet.
const LEGACY_GOAL_KINDS: GoalKindInfo[] = [
  { v: 'hours_year',   label: 'Timer trent i år',   hint: 'Summerer målt tid på øktene hittil i år', unit: 'timer', who: 'alle', suggest: 100, decimals: true, titleSuffix: ' i år' },
  { v: 'minutes_week', label: 'Minutter denne uka', hint: 'Summerer målt tid på øktene denne uka',    unit: 'min',   who: 'alle', suggest: 180, titleSuffix: ' denne uka' },
];

export const goalKindInfo = (k: GoalKind): GoalKindInfo =>
  GOAL_KINDS.find(x => x.v === k) ?? LEGACY_GOAL_KINDS.find(x => x.v === k) ?? GOAL_KINDS[1];

export interface GoalStatus {
  /** Hvor langt de er kommet, i målets enhet. */
  now: number;
  /** Andel av målet, 0–1 (klippet, så en overoppfylling ikke sprenger baren). */
  pct: number;
  /** «12/150», «57,5/55 kg». */
  label: string;
  done: boolean;
  /** Hva som gjenstår, i målets enhet. */
  remaining: number;
  unit: string;
  /** Datoen målet ble nådd, når vi kan vite den (rekordmål). */
  achievedOn: string | null;
  /** Dager til fristen; negativ = fristen har gått ut. null = ingen frist. */
  daysLeft: number | null;
}

/** Hvor et mål står akkurat nå. `sessions` kan inneholde pågående økter — de filtreres bort. */
export function goalStatus(g: WorkoutGoal, sessions: WorkoutSession[], records: WorkoutRecord[]): GoalStatus {
  const done = sessions.filter(s => s.completedAt);
  const mine = g.who === 'f' ? done : done.filter(s => s.who === g.who);
  const now = new Date();
  const year = now.getFullYear();
  const info = goalKindInfo(g.kind);

  let value = 0;
  let unit = info.unit;
  let achievedOn: string | null = null;

  switch (g.kind) {
    case 'sessions_year':
      value = mine.filter(s => new Date(s.startedAt).getFullYear() === year).length;
      break;
    case 'sessions_month':
      value = mine.filter(s => {
        const d = new Date(s.startedAt);
        return d.getFullYear() === year && d.getMonth() === now.getMonth();
      }).length;
      break;
    case 'sessions_total':
      value = mine.length;
      break;
    case 'hours_year':
      // Tid-mål er «tid på gymmen», så tillegg teller med (i motsetning til snitt).
      value = totalGymMinutes(mine.filter(s => new Date(s.startedAt).getFullYear() === year)) / 60;
      break;
    case 'minutes_week':
      value = Math.round(totalGymMinutes(mine.filter(s => new Date(s.startedAt).getTime() >= startOfWeek(now).getTime())));
      break;
    case 'weekly_streak':
      // Et felles streak-mål krever at begge nådde kravet; et personlig bare den
      // ene. Derfor hele øktlista her, ikke `mine` — filteret ligger i `who`.
      value = weekStreak(done, g.who === 'f' ? TRAINERS : [g.who as Trainer]);
      break;
    case 'record': {
      unit = g.unit ?? 'kg';
      // Enheten er en del av identiteten: 100 kg og 100 reps i samme øvelse er
      // to helt ulike mål, og skal ikke kunne oppfylle hverandre.
      const rs = records.filter(r =>
        r.exercise === g.exercise && r.unit === unit && (g.who === 'f' || r.who === g.who));
      value = rs.length ? Math.max(...rs.map(r => r.value)) : 0;
      achievedOn = rs.filter(r => r.value >= g.target).map(r => r.date).sort()[0] ?? null;
      break;
    }
  }

  const remaining = Math.max(0, g.target - value);
  const daysLeft = g.deadline
    ? Math.round((new Date(g.deadline).getTime() - new Date(dayKey(now)).getTime()) / DAY)
    : null;

  const label = g.kind === 'weekly_streak'
    ? `${value}/${g.target} uker`
    : g.kind === 'record' || g.kind === 'hours_year'
      ? `${fmtNum(value)}/${fmtNum(g.target)} ${unit === 'timer' ? 't' : unit}`
      : `${fmtNum(value, 0)}/${fmtNum(g.target, 0)}`;

  return {
    now: value,
    pct: Math.min(1, value / Math.max(g.target, 0.0001)),
    label,
    done: value >= g.target,
    remaining,
    unit: unit === 'timer' ? 't' : unit,
    achievedOn,
    daysLeft,
  };
}

/** «innen 31. desember», til visning under et mål. */
export const fmtDeadline = (iso: string) =>
  new Date(iso).toLocaleDateString('nb-NO', { day: 'numeric', month: 'long', year: 'numeric' });

// ─── Reglene ────────────────────────────────────────────────────────────────

export interface PulseRule {
  id: string;
  tone: 'warn' | 'good';
  /**
   * Hvor mye meldingen er verdt akkurat nå, 0–100, uavhengig av tone.
   * Hendelser bruker `fade()` så vekta faller med alderen; tilstander står fast.
   */
  weight: number;
  from: string;
  text: string;
}

export interface Pulse {
  color: string;
  from: string;
  text: string;
  tone: 'warn' | 'good';
}

/** Påminnelser teller litt tyngre enn skryt, men kan ikke lenger blokkere det. */
const WARN_BONUS = 12;
/** Alt innenfor så mange poeng fra toppen er med i døgnrotasjonen. */
const ROTATION_BAND = 30;
/** Flere enn dette, og en melding må vente for lenge på tur. */
const MAX_ROTATION = 5;
/** Under dette er meldinga for gammel eller for marginal til å vises. */
const MIN_WEIGHT = 5;

/**
 * Vekt som faller med alderen på hendelsen: full pott samme dag, halvparten
 * etter `halfLife` dager. Slik slipper hendelser å ha et hardt vindu de kan bli
 * sultet ut av — en ny rekord blir gradvis mindre viktig i stedet for å
 * forsvinne på dag åtte uansett om den rakk å bli vist.
 */
const fade = (base: number, ageDays: number, halfLife: number, floor = 0) =>
  Math.max(floor, base * Math.pow(0.5, Math.max(0, ageDays) / halfLife));

const ageDays = (t: number | string) =>
  (Date.now() - (typeof t === 'number' ? t : new Date(t).getTime())) / DAY;

// Kalenderdøgn siden en dato — «i går» skal si i går selv når økta bare er
// noen timer gammel (kveld → morgen). ageDays teller 24-timers bolker fra nå,
// som ikke er det samme som et datoskifte ved lokal midnatt. Math.round tåler
// at et døgn er 23/25 timer ved sommertidsskifte.
const calDaysAgo = (t: number | string) => {
  const d = new Date(typeof t === 'number' ? t : new Date(t).getTime());
  const then = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((today.getTime() - then.getTime()) / DAY);
};

const MILESTONE_SESSIONS = [25, 50, 100, 250, 500, 1000];
// Med tre økter hver i uka som krav er en streak mye tyngre å holde enn før,
// så milepælene ligger tettere enn den gamle [4, 10, 25, 52, 104].
const MILESTONE_WEEKS = [2, 4, 8, 12, 26, 52];
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** «Andreas mangler 2 økter og Taran mangler 1 økt» */
const andList = (parts: string[]) =>
  parts.length <= 1 ? parts.join('') : `${parts.slice(0, -1).join(', ')} og ${parts[parts.length - 1]}`;

export function buildPulseRules(sessions: WorkoutSession[], records: WorkoutRecord[], goals: WorkoutGoal[]): PulseRule[] {
  const done = sessions.filter(s => s.completedAt);
  if (done.length === 0) return [];

  const rules: PulseRule[] = [];
  const now = Date.now();
  const year = new Date().getFullYear();

  const thisYear = done.filter(s => new Date(s.startedAt).getFullYear() === year);
  // Snittet teller normalt fra 1. januar, men det året systemet ble tatt i bruk
  // finnes det ingen data før første økt — å dele på hele året ville gitt et
  // kunstig lavt snitt. Bare det aller første loggeåret teller derfor fra første
  // logga økt; alle senere år starter på 1. januar som vanlig.
  const firstEver = Math.min(...done.map(s => new Date(s.startedAt).getTime()));
  const countFrom = new Date(firstEver).getFullYear() === year
    ? firstEver
    : new Date(year, 0, 1).getTime();
  const weeksElapsed = Math.max(1, Math.ceil((now - countFrom) / (7 * DAY)));
  const perWeek = thisYear.length / weeksElapsed;
  const perWeekLast = done.filter(s => new Date(s.startedAt).getFullYear() === year - 1).length / 52;

  const thisWeekStart = startOfWeek(new Date()).getTime();
  const inThisWeek = done.filter(s => new Date(s.startedAt).getTime() >= thisWeekStart);
  const weekday = (new Date().getDay() + 6) % 7; // 0 = mandag

  // ── Etterslep ────────────────────────────────────────────────────────────
  // Siste økt finnes med max, ikke ved å plukke den første i lista: rekkefølgen
  // på `sessions` er ikke en del av kontrakten her, selv om Supabase leverer dem
  // nyest først i dag.
  const status = TRAINERS.map(who => {
    const times = done.filter(s => s.who === who).map(s => new Date(s.startedAt).getTime());
    if (times.length === 0) return { who, days: null as number | null, gap: null as number | null, overdue: Infinity };
    const days = Math.floor((now - Math.max(...times)) / DAY);
    const gap = typicalGapDays(done, who);
    return { who, days, gap, overdue: days / Math.max(4, Math.round((gap ?? 3.5) * 2)) };
  }).sort((a, b) => b.overdue - a.overdue);

  // Den som aldri har trent og den som ligger etter er to uavhengige beskjeder.
  // Var de en if/else før, og da kunne «Taran har ingen økter ennå» skjule at
  // Andreas samtidig hadde tatt tre ukers pause.
  const never = status.filter(x => x.days === null);
  const active = status.filter(x => x.days !== null);

  if (never.length > 0) {
    // At den ene ikke har begynt er en beskjed de første ukene, ikke en
    // overskrift i evig tid — ellers står boksen bom fast på den for alltid.
    // Alderen på den aller første økta er proxyen for «hvor lenge har dette
    // vært sant». Gulvet holder den med i rotasjonen.
    const firstEver = Math.min(...done.map(s => new Date(s.startedAt).getTime()));
    rules.push({ id: 'ingen-okter', tone: 'warn',
      weight: fade(100, ageDays(firstEver), 30, 25), from: 'Kom i gang',
      text: `${andList(never.map(x => WHO_LABEL[x.who]))} har ingen registrerte økter ennå — første avhuking teller.` });
  }

  const worst = active[0];
  const hasEtterslep = !!worst && worst.overdue >= 1;
  if (hasEtterslep) {
    rules.push({ id: 'etterslep', tone: 'warn', weight: 90, from: 'Vennlig påminnelse',
      text: `${WHO_LABEL[worst.who]} har ikke trent på ${worst.days} dager — ${worst.gap
        ? `vanligvis går det ${fmtNum(worst.gap)} dager mellom øktene`
        : 'kanskje en tur til gymmet i dag?'}` });
  }

  // Streak-kravet er tre økter hver, så en advarsel først på søndag kommer for
  // seint til å kunne reddes. Den går fra lørdag, og sier hvem som mangler hva.
  const wStreak = weekStreak(done);
  const short = TRAINERS
    .map(who => ({ who, missing: streakShortfall(done, who) }))
    .filter(x => x.missing > 0);
  if (wStreak >= 2 && short.length > 0 && weekday >= 5) {
    rules.push({ id: 'streak-ryker', tone: 'warn', weight: 78, from: 'Siste sjanse',
      text: `Ukesstreaken på ${wStreak} uker ryker søndag kveld — ${andList(short.map(x =>
        `${WHO_LABEL[x.who]} mangler ${x.missing} ${x.missing === 1 ? 'økt' : 'økter'}`))}.` });
  }
  // Bare når ingen er individuelt på etterslep — ellers sier de to reglene det
  // samme, og etterslepsmeldinga sier det mer presist.
  if (inThisWeek.length === 0 && weekday >= 3 && !hasEtterslep) {
    rules.push({ id: 'tom-uke', tone: 'warn', weight: 60, from: 'Vennlig påminnelse',
      text: `Ingen økter denne uka ennå, og det er allerede ${new Date().toLocaleDateString('nb-NO', { weekday: 'long' })}.` });
  }
  const last4 = done.filter(s => new Date(s.startedAt).getTime() >= now - 28 * DAY).length / 4;
  if (done.length >= 20 && perWeek > 0 && last4 < perWeek * 0.7) {
    rules.push({ id: 'under-snitt', tone: 'warn', weight: 40, from: 'Trenden',
      text: `Siste fire uker ligger på ${fmtNum(last4)} økter i uka — under snittet deres på ${fmtNum(perWeek)}.` });
  }

  // ── Mål ──────────────────────────────────────────────────────────────────
  const yearProgress = (now - new Date(year, 0, 1).getTime()) / (365 * DAY);
  for (const g of goals) {
    const st = goalStatus(g, done, records);

    if (st.done) {
      // Et rekordmål vet nøyaktig når det ble nådd, så feiringa tones ned med
      // alderen. De løpende målene (økter i år o.l.) har ingen slik dato — de
      // står som «i havn» resten av perioden, men på en lav vekt: det er en
      // kvittering som fortsatt er sann, ikke en nyhet som skal eie boksen.
      rules.push({ id: `mal-nadd-${g.id}`, tone: 'good',
        weight: st.achievedOn ? fade(85, ageDays(st.achievedOn), 21) : 45,
        from: 'Mål nådd', text: `«${g.title}» er i havn — ${st.label}. 🎉` });
      continue;
    }

    if (st.daysLeft !== null && st.daysLeft < 0) {
      rules.push({ id: `mal-frist-ute-${g.id}`, tone: 'warn', weight: 62, from: 'Fristen gikk ut',
        text: `Fristen for «${g.title}» gikk ut for ${-st.daysLeft} ${-st.daysLeft === 1 ? 'dag' : 'dager'} siden — ${fmtNum(st.remaining)} ${st.unit} gjensto.` });
    } else if (st.daysLeft !== null && st.daysLeft <= 30) {
      rules.push({ id: `mal-frist-${g.id}`, tone: 'warn', weight: 58, from: 'Frist nærmer seg',
        text: `«${g.title}»: ${fmtNum(st.remaining)} ${st.unit} igjen, og ${st.daysLeft} ${st.daysLeft === 1 ? 'dag' : 'dager'} til fristen.` });
    }

    if (g.kind === 'record' && st.now > 0 && st.remaining <= g.target * 0.05) {
      rules.push({ id: `mal-narme-${g.id}`, tone: 'good', weight: 60, from: 'Snart i mål',
        text: `«${g.title}» er innen rekkevidde — ${fmtNum(st.remaining)} ${st.unit} igjen fra ${fmtNum(st.now)}.` });
    }

    if (g.kind === 'sessions_year') {
      const expected = Math.round(g.target * yearProgress);
      if (st.now >= expected + 5) {
        rules.push({ id: `mal-foran-${g.id}`, tone: 'good', weight: 55, from: 'Foran skjema',
          text: `«${g.title}»: ${st.now} av ${g.target} — ${st.now - expected} økter foran skjema.` });
      } else if (st.now <= expected - 5) {
        rules.push({ id: `mal-bak-${g.id}`, tone: 'warn', weight: 50, from: 'Bak skjema',
          text: `«${g.title}»: ${st.now} av ${g.target} — ${expected - st.now} økter bak skjema for datoen.` });
      }
    }
  }

  // ── Milepæler ────────────────────────────────────────────────────────────
  // Nyeste registrering som fortsatt er den beste i sin øvelse. Enheten er en
  // del av sammenligninga — ellers kunne en reps-rekord skygge for kg-rekorden
  // i samme øvelse, stikk i strid med hvordan rekordmål regnes.
  const latestPR = [...records]
    .sort((a, b) => b.date.localeCompare(a.date))
    .find(r => r.value === Math.max(...records
      .filter(x => x.exercise === r.exercise && x.who === r.who && x.unit === r.unit)
      .map(x => x.value)));
  if (latestPR) {
    rules.push({ id: 'ny-rekord', tone: 'good', weight: fade(95, ageDays(latestPR.date), 14),
      from: 'Ny rekord',
      text: `${WHO_LABEL[latestPR.who]} satte ny rekord i ${latestPR.exercise}: ${fmtNum(latestPR.value)} ${latestPR.unit}. 💪` });
  }

  // Milepælen står for alltid — den høyeste dere har passert — men vekta faller
  // med alderen ned til et gulv. Fersk er den en nyhet; et halvår etter er den
  // en fotnote som dukker opp i rolige perioder i stedet for at boksen står tom.
  const chrono = [...done].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  const reached = [...MILESTONE_SESSIONS].reverse().find(m => chrono.length >= m);
  if (reached) {
    const passedOn = chrono[reached - 1].startedAt;
    const age = ageDays(passedOn);
    rules.push({ id: 'okt-milepal', tone: 'good', weight: fade(80, age, 30, 25), from: 'Milepæl',
      text: age < 14
        ? `Dere passerte ${reached} loggførte økter sammen. Det er ganske mange timer på gymmen.`
        : `${done.length} loggførte økter sammen — ${reached} passerte dere i ${new Date(passedOn).toLocaleDateString('nb-NO', { month: 'long', year: 'numeric' })}.` });
  }

  if (wStreak >= 2 && wStreak === bestWeekStreak(done)) {
    // En løpende streak slår sin egen rekord hver eneste uke, så uten aldring
    // sto denne setninga i boksen hver dag i månedsvis. Nå topper den seg den
    // dagen uka faktisk ble sikret, og gir gradvis plass til noe annet.
    const extended = streakExtendedOn(done);
    // Het «Ny rekord» før, men nå som den kan stå rett før eller etter den
    // faktiske rekordmeldinga trenger den sin egen etikett.
    rules.push({ id: 'beste-streak', tone: 'good',
      weight: extended === null ? 40 : fade(80, ageDays(extended), 4), from: 'Lengste rekke',
      text: `${wStreak} uker på rad med ${STREAK_MIN_SESSIONS} økter hver — det er den lengste rekka deres til nå.` });
  } else if (MILESTONE_WEEKS.includes(wStreak)) {
    rules.push({ id: 'streak-milepal', tone: 'good', weight: 70, from: 'Milepæl',
      text: `${wStreak} uker på rad der dere begge har minst ${STREAK_MIN_SESSIONS} økter i uka.` });
  }

  const monthCounts = new Map<string, number>();
  for (const s of done) {
    const d = new Date(s.startedAt);
    monthCounts.set(`${d.getFullYear()}-${pad(d.getMonth() + 1)}`, (monthCounts.get(`${d.getFullYear()}-${pad(d.getMonth() + 1)}`) ?? 0) + 1);
  }
  const thisMonthKey = `${new Date().getFullYear()}-${pad(new Date().getMonth() + 1)}`;
  const thisMonth = monthCounts.get(thisMonthKey) ?? 0;
  const bestOther = Math.max(0, ...[...monthCounts].filter(([k]) => k !== thisMonthKey).map(([, v]) => v));
  if (thisMonth > bestOther && monthCounts.size > 1 && thisMonth >= 4) {
    rules.push({ id: 'beste-maned', tone: 'good', weight: 55, from: 'Beste måned',
      text: `${capitalize(new Date().toLocaleDateString('nb-NO', { month: 'long' }))} er den travleste måneden deres hittil — ${thisMonth} økter.` });
  }

  // ── Fallback ─────────────────────────────────────────────────────────────
  // Ikke bare et nødrim: snittet er en ekte trend som alltid er sann, og på 30
  // kommer den med i rotasjonen i rolige perioder i stedet for aldri å vises.
  rules.push({ id: 'snitt', tone: 'good', weight: 30, from: 'Trenden',
    text: perWeekLast > 0
      ? `${fmtNum(perWeek)} økter i uka i snitt i år — ${perWeek >= perWeekLast ? 'opp' : 'ned'} fra ${fmtNum(perWeekLast)} i fjor.`
      : `${fmtNum(perWeek)} økter i uka i snitt i år.` });

  return rules;
}

/**
 * Meldinga som står i boksen.
 *
 * Tre steg:
 *  1. Alt som har falmet under MIN_WEIGHT lukes bort.
 *  2. Poeng = vekt + WARN_BONUS for påminnelser. Tonen vipper altså utfallet,
 *     men kan ikke lenger blokkere: en fersk rekord (95) slår «ingen økter denne
 *     uka» (60 + 12), mens et lengre etterslep (90 + 12) slår rekorden.
 *  3. Alt innenfor ROTATION_BAND poeng fra toppen, maks MAX_ROTATION regler,
 *     deler på plassen — én bytting i døgnet. Da får også nummer to og tre
 *     luft, i stedet for at boksen står på samme setning i ukevis.
 *
 * Døgnet er UTC-basert (heltallsdivisjon på epoch), så byttet skjer ved norsk
 * midnatt ± en time. Det er godt nok for en boks som dette.
 */
/** Poengsummen som avgjør plasseringa: vekt pluss et påslag for påminnelser. */
export const pulseScore = (r: PulseRule) => r.weight + (r.tone === 'warn' ? WARN_BONUS : 0);

/**
 * Reglene som deler på rotasjonsplassen akkurat nå, sterkest først — det vil si
 * de som er innenfor ROTATION_BAND poeng fra toppen, maks MAX_ROTATION stykker.
 * Tom liste når ingenting kvalifiserer. Skilt ut fra `pickPulse` så både selve
 * valget og stresstesten kan lese hvem som faktisk er med i rulleringa.
 */
export function pulseBand(rules: PulseRule[]): PulseRule[] {
  const live = rules.filter(r => r.weight >= MIN_WEIGHT);
  if (live.length === 0) return [];
  const sorted = [...live].sort((a, b) => pulseScore(b) - pulseScore(a) || a.id.localeCompare(b.id));
  return sorted
    .filter(r => pulseScore(r) >= pulseScore(sorted[0]) - ROTATION_BAND)
    .slice(0, MAX_ROTATION);
}

export function pickPulse(rules: PulseRule[]): Pulse | null {
  const band = pulseBand(rules);
  if (band.length === 0) return null;
  const pick = band[Math.floor(Date.now() / DAY) % band.length];
  return {
    color: pick.tone === 'warn' ? 'var(--warn)' : 'var(--good)',
    from: pick.from,
    text: pick.text,
    tone: pick.tone,
  };
}

/** Meldingen som skal vises nå, eller null når det ikke finnes økter ennå. */
export function computePulse(sessions: WorkoutSession[], records: WorkoutRecord[], goals: WorkoutGoal[]): Pulse | null {
  return pickPulse(buildPulseRules(sessions, records, goals));
}
