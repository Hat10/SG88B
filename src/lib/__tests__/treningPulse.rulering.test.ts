// Anti-underprioriterings-stresstest for info-boksen. Komplement til
// `treningPulse.dekning.test.ts`: den sjekker at hver regel blir *vist* i minst
// ett håndplukket scenario over 21 døgn. Denne går rett på selve frykta —
// «kan en melding bli underprioritert bort så den aldri kommer med i rulleringa»
// — og gjør det på to måter:
//
//   1. Per-regel-garanti: for hver av de 22 reglene bygges et scenario som
//      isolerer den, og vi sjekker at regelen faktisk er MED i rotasjonsbåndet
//      (`pulseBand`), ikke bare at den fyrer. Er den i båndet, blir den garantert
//      vist innen band.length ≤ 5 døgn — så vi verifiserer også at den dukker opp
//      når vi lar døgnet rulle fem dager framover.
//
//   2. Fuzz: tusenvis av deterministiske, tilfeldige datasett. Her sjekkes at
//      rulleringa alltid er velformet (båndet er aldri tomt når noe kvalifiserer,
//      aldri mer enn fem brede, alt i båndet er innenfor 30 poeng fra toppen, og
//      den valgte meldinga er alltid et båndmedlem), og at ingen regel som fyrer
//      titalls ganger blir stående utenfor båndet hver eneste gang.
import { it, expect, vi } from 'vitest';
import type { WorkoutSession, WorkoutRecord, WorkoutGoal, GoalKind, Trainer, RecordUnit } from '../../contexts/TreningContext';
import type { Who } from '../../data';
import { buildPulseRules, pickPulse, pulseBand, pulseScore, startOfWeek } from '../treningPulse';

const DAY = 86400000;
/** Regelfamilie: strip goal-id-halen, så «mal-nadd-g3» og «mal-nadd-g7» er ett. */
const baseId = (id: string) => id.replace(/-g\d+$/, '');

let seq = 0;
function sessAt(start: Date, who: Trainer, opts: { cat?: string; min?: number; group?: string | null } = {}): WorkoutSession {
  const { cat = 'Push', min = 50, group = null } = opts;
  return {
    id: `s${seq++}`, templateId: 't1', templateName: `${cat} A`, category: cat, who,
    sessionGroup: group,
    startedAt: start.toISOString(),
    completedAt: new Date(start.getTime() + min * 60000).toISOString(),
    note: null,
  };
}
function sess(daysAgo: number, who: Trainer, opts: { cat?: string; min?: number; group?: string | null } = {}): WorkoutSession {
  const start = new Date(Date.now() - daysAgo * DAY);
  start.setHours(18, 0, 0, 0);
  return sessAt(start, who, opts);
}
function rec(daysAgo: number, who: Trainer, value: number, ex = 'Benkpress', unit: RecordUnit = 'kg'): WorkoutRecord {
  return { id: `r${seq++}`, exercise: ex, who, value, unit, date: new Date(Date.now() - daysAgo * DAY).toISOString().slice(0, 10) };
}
function goal(kind: GoalKind, target: number, extra: Partial<WorkoutGoal> = {}): WorkoutGoal {
  return { id: `g${seq++}`, title: `Mål ${kind}`, who: 'f', kind, target, exercise: null, unit: null, deadline: null, ...extra };
}
const inDays = (n: number) => new Date(Date.now() + n * DAY).toISOString().slice(0, 10);

/**
 * `perWeek` økter i uke `w` (0 = denne uka) for hver i `who`, ferskest først:
 * øktene legges på de siste dagene i uka som ligger i fortida. Slik havner den
 * nyeste økta i inneværende uke bare et døgn eller to tilbake — ikke fire, som
 * ville tippet `etterslep` over terskelen og gjort scenarioene ubrukelige.
 */
function weekSessions(w: number, perWeek: number, who: Trainer[], opts: { cat?: string; togetherIdx?: number[]; min?: number } = {}): WorkoutSession[] {
  const { cat = 'Push', togetherIdx = [], min = 50 } = opts;
  const both = who.includes('M') && who.includes('L');
  const weekStart = startOfWeek(new Date()).getTime() - w * 7 * DAY;
  const out: WorkoutSession[] = [];
  let placed = 0;
  for (let dow = 6; dow >= 0 && placed < perWeek; dow--) {
    const at = new Date(weekStart + dow * DAY);
    at.setHours(18, 0, 0, 0);
    if (at.getTime() >= Date.now()) continue; // aldri økter i framtida
    const group = both && togetherIdx.includes(placed) ? `grp-${cat}-${w}-${placed}` : null;
    for (const p of who) out.push(sessAt(at, p, { cat, min, group }));
    placed++;
  }
  return out;
}
/** `weeks` kan være et antall (0..n-1) eller en eksplisitt liste med ukenumre. */
function routine(weeks: number | number[], perWeek: number, who: Trainer[] = ['M', 'L'], opts: { cat?: string; togetherIdx?: number[]; min?: number } = {}): WorkoutSession[] {
  const list = Array.isArray(weeks) ? weeks : Array.from({ length: weeks }, (_, i) => i);
  return list.flatMap(w => weekSessions(w, perWeek, who, opts));
}

// Faste ankre. Ukedagen er en del av flere regler (streak-ryker og tom-uke ser
// på den), så vi trenger en av hver. Lørdag gjør dessuten «denne uka» ferdig nok
// til at mandag–onsdag-øktene ligger i fortida.
const THU = Date.UTC(2026, 6, 9, 10);   // torsdag 9. juli
const SAT = Date.UTC(2026, 6, 11, 10);  // lørdag 11. juli
const FEB = Date.UTC(2026, 1, 16, 10);  // mandag 16. februar — lav yearProgress

type Data = { sessions: WorkoutSession[]; records: WorkoutRecord[]; goals: WorkoutGoal[] };
type Case = { id: string; anchor: number; build: () => Partial<Data> };

// Ett scenario per regel, skrudd sammen så nettopp den regelen kommer med i
// båndet. Der en sterkere regel uunngåelig fyrer i samme situasjon (en fersk
// rekord ved siden av «snart i mål», f.eks.) holder det at målregelen er innenfor
// de 30 poenga og topp fem — det er nettopp det båndet er.
const CASES: Case[] = [
  { id: 'ingen-okter', anchor: SAT, build: () => ({ sessions: routine(3, 3, ['M']) }) },
  { id: 'etterslep', anchor: SAT, build: () => ({
      sessions: [...routine([0, 1, 2, 3, 4, 5, 6, 7, 8], 2, ['L']), ...routine([2, 3, 4, 5, 6, 7, 8], 3, ['M'])] }) },
  { id: 'streak-ryker', anchor: SAT, build: () => ({
      sessions: [...routine([1, 2, 3, 4], 3, ['M', 'L']), ...weekSessions(0, 3, ['M']), ...weekSessions(0, 1, ['L'])] }) },
  { id: 'tom-uke', anchor: THU, build: () => ({ sessions: routine([1, 2, 3, 4, 5, 6, 7, 8], 1, ['M', 'L']) }) },
  { id: 'kategori-etterslep', anchor: SAT, build: () => ({
      sessions: [
        ...routine([0, 1, 2, 3], 1, ['M', 'L'], { cat: 'Push' }),
        ...routine([0, 1, 2, 3], 1, ['M', 'L'], { cat: 'Pull' }),
        sess(25, 'M', { cat: 'Legs' }), sess(25, 'L', { cat: 'Legs' })] }) },
  { id: 'under-snitt', anchor: SAT, build: () => ({
      // Tungt i uke 5–9, så bare én fersk økt hver. De fire siste ukene er nesten
      // tomme, så snittet for perioden ligger godt under årssnittet.
      sessions: [...routine([5, 6, 7, 8, 9], 3, ['M', 'L']), sess(1, 'M'), sess(1, 'L')] }) },
  { id: 'mal-nadd', anchor: SAT, build: () => ({
      sessions: routine([0, 1, 2], 2, ['M', 'L']), records: [rec(1, 'M', 105)],
      goals: [goal('record', 100, { who: 'M', exercise: 'Benkpress', unit: 'kg' })] }) },
  { id: 'mal-frist-ute', anchor: SAT, build: () => ({
      sessions: routine([0, 1, 2], 2, ['M', 'L']), records: [rec(10, 'M', 80)],
      goals: [goal('record', 120, { who: 'M', exercise: 'Benkpress', unit: 'kg', deadline: inDays(-5) })] }) },
  { id: 'mal-frist', anchor: SAT, build: () => ({
      sessions: routine([0, 1, 2], 2, ['M', 'L']), records: [rec(10, 'M', 80)],
      goals: [goal('record', 120, { who: 'M', exercise: 'Benkpress', unit: 'kg', deadline: inDays(10) })] }) },
  { id: 'mal-narme', anchor: SAT, build: () => ({
      // Rekorden er 60 dager gammel, så «ny rekord» har falmet under terskelen og
      // skygger ikke for «snart i mål».
      sessions: routine([0, 1, 2], 2, ['M', 'L']), records: [rec(60, 'M', 98)],
      goals: [goal('record', 100, { who: 'M', exercise: 'Benkpress', unit: 'kg' })] }) },
  { id: 'mal-foran', anchor: FEB, build: () => ({
      sessions: routine([0, 1, 2, 3, 4, 5], 2, ['M', 'L']), goals: [goal('sessions_year', 100)] }) },
  { id: 'mal-bak', anchor: SAT, build: () => ({
      sessions: routine([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], 1, ['M', 'L']), goals: [goal('sessions_year', 400)] }) },
  { id: 'ny-rekord', anchor: SAT, build: () => ({
      sessions: routine([0, 1, 2], 2, ['M', 'L']), records: [rec(1, 'M', 100)] }) },
  { id: 'okt-milepal', anchor: SAT, build: () => ({ sessions: routine([0, 1, 2, 3, 4, 5, 6], 2, ['M', 'L']) }) },
  { id: 'beste-streak', anchor: SAT, build: () => ({ sessions: routine([0, 1, 2], 3, ['M', 'L']) }) },
  { id: 'streak-milepal', anchor: SAT, build: () => ({ sessions: routine([0, 1, 3, 4, 5, 6], 3, ['M', 'L']) }) },
  { id: 'beste-maned', anchor: SAT, build: () => ({
      sessions: [...weekSessions(0, 3, ['M', 'L']), sess(35, 'M'), sess(35, 'L'), sess(38, 'M'), sess(38, 'L')] }) },
  { id: 'sammen-okt', anchor: SAT, build: () => ({ sessions: routine([0, 1, 2], 2, ['M', 'L'], { togetherIdx: [0] }) }) },
  { id: 'sammen-streak', anchor: SAT, build: () => ({ sessions: routine([0, 1, 2], 2, ['M', 'L'], { togetherIdx: [0] }) }) },
  { id: 'lenge-siden-sammen', anchor: SAT, build: () => ({
      sessions: [...routine([0, 1, 2, 3], 2, ['M', 'L']), sess(28, 'M', { group: 'grp-old' }), sess(28, 'L', { group: 'grp-old' })] }) },
  { id: 'aldri-sammen', anchor: SAT, build: () => ({ sessions: routine([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], 1, ['M', 'L']) }) },
  { id: 'snitt', anchor: SAT, build: () => ({ sessions: [sess(3, 'M'), sess(3, 'L')] }) },
];

it('hver regel kan komme med i rotasjonsbåndet og bli vist når døgnet ruller', () => {
  const missing: string[] = [];
  const notShown: string[] = [];
  const debug: string[] = [];

  for (const c of CASES) {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(c.anchor));
    seq = 0;
    const data: Data = { sessions: [], records: [], goals: [], ...c.build() };
    // Reglene beregnes én gang på ankeret; døgnrulleringa endrer bare hvilket
    // båndmedlem som plukkes, ikke selve båndet.
    const rules = buildPulseRules(data.sessions, data.records, data.goals);
    const band = pulseBand(rules);
    const bandIds = band.map(r => baseId(r.id));

    if (!bandIds.includes(c.id)) {
      missing.push(c.id);
      debug.push(`  ${c.id}: IKKE i båndet. Bånd = [${band.map(r => `${baseId(r.id)}(${pulseScore(r)})`).join(', ')}]`
        + `\n     alle regler = [${rules.filter(r => r.weight >= 5).sort((a, b) => pulseScore(b) - pulseScore(a)).map(r => `${baseId(r.id)}(${pulseScore(r)})`).join(', ')}]`);
    }

    // Rull døgnet fem dager: band.length ≤ 5, så fem sammenhengende døgn treffer
    // hver plass i båndet minst én gang. Regelen skal dukke opp underveis.
    const shown = new Set<string>();
    for (let d = 0; d < 5; d++) {
      vi.setSystemTime(new Date(c.anchor + d * DAY));
      const p = pickPulse(rules);
      if (p) shown.add(baseId(rules.find(r => r.text === p.text)!.id));
    }
    if (!shown.has(c.id)) notShown.push(c.id);
    vi.useRealTimers();
  }

  if (missing.length || notShown.length) {
    console.log('\n════ UNDERPRIORITERTE REGLER ════\n' + debug.join('\n'));
  }
  expect(missing).toEqual([]);
  expect(notShown).toEqual([]);
  // Alle 22 familiene skal være dekket av et scenario hver.
  expect(new Set(CASES.map(c => c.id)).size).toBe(22);
});

// ── Fuzz ────────────────────────────────────────────────────────────────────
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomData(rand: () => number): Data {
  const pick = <T>(arr: T[]): T => arr[Math.floor(rand() * arr.length)];
  const ri = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
  const cats = ['Push', 'Pull', 'Legs', 'Kondisjon'];
  const monday = startOfWeek(new Date()).getTime();
  const sessions: WorkoutSession[] = [];

  const weeks = ri(0, 40);
  for (const who of [['M'], ['L']] as Trainer[][]) {
    const pw = ri(0, 5);
    for (let w = 0; w < weeks; w++) {
      const n = Math.max(0, pw + ri(-1, 1));
      for (let i = 0; i < n; i++) {
        const t = monday - w * 7 * DAY + i * DAY;
        if (t > Date.now()) continue;
        sessions.push(sess(Math.round((Date.now() - t) / DAY), who[0], { cat: pick(cats) }));
      }
    }
  }
  for (let k = 0, tog = ri(0, 8); k < tog; k++) {
    const d = ri(0, 60), grp = `tg-${k}`;
    sessions.push(sess(d, 'M', { group: grp }));
    sessions.push(sess(d, 'L', { group: grp }));
  }

  const records: WorkoutRecord[] = [];
  for (let k = 0, nr = ri(0, 4); k < nr; k++) {
    records.push(rec(ri(0, 200), pick(['M', 'L']) as Trainer, ri(20, 200),
      pick(['Benkpress', 'Knebøy', 'Markløft']), pick(['kg', 'reps']) as RecordUnit));
  }

  const goals: WorkoutGoal[] = [];
  const kinds: GoalKind[] = ['record', 'sessions_year', 'sessions_month', 'sessions_total', 'hours_year', 'minutes_week', 'together_week', 'weekly_streak'];
  for (let k = 0, ng = ri(0, 4); k < ng; k++) {
    const kind = pick(kinds);
    const deadline = rand() < 0.4 ? inDays(ri(-40, 60)) : null;
    if (kind === 'record') {
      goals.push(goal(kind, ri(20, 200), { who: pick(['M', 'L']) as Who, exercise: 'Benkpress', unit: 'kg', deadline }));
    } else {
      goals.push(goal(kind, ri(1, 300), { deadline }));
    }
  }
  return { sessions, records, goals };
}

it('fuzz: rulleringa er alltid velformet, og ingen regel som fyrer ofte blir stengt ute', () => {
  const N = 4000;
  const firedIn = new Map<string, number>();
  const bandedIn = new Map<string, number>();
  const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);
  const bandedEver = new Set<string>();

  vi.useFakeTimers();
  for (let n = 0; n < N; n++) {
    const rand = rng(0x9e3779b9 ^ n);
    const anchor = Date.UTC(2026, Math.floor(rand() * 12), 1 + Math.floor(rand() * 27), 10);
    vi.setSystemTime(new Date(anchor));
    seq = 0;
    const data = randomData(rand);
    const rules = buildPulseRules(data.sessions, data.records, data.goals);
    const live = rules.filter(r => r.weight >= 5);
    const band = pulseBand(rules);

    // ── Invarianter for rulleringa ──
    expect(band.length).toBeLessThanOrEqual(5);
    if (live.length === 0) {
      expect(band.length).toBe(0);
      expect(pickPulse(rules)).toBeNull();
      continue;
    }
    expect(band.length).toBeGreaterThanOrEqual(1);
    const top = Math.max(...live.map(pulseScore));
    for (const r of band) expect(pulseScore(r)).toBeGreaterThanOrEqual(top - 30);
    const p = pickPulse(rules);
    expect(p).not.toBeNull();
    expect(band.some(r => r.text === p!.text)).toBe(true);

    for (const id of new Set(live.map(r => baseId(r.id)))) bump(firedIn, id);
    for (const id of new Set(band.map(r => baseId(r.id)))) { bump(bandedIn, id); bandedEver.add(id); }
  }
  vi.useRealTimers();

  // En regel som fyrer i mange datasett, men aldri én eneste gang klarer å komme
  // inn i båndet, er per definisjon underprioritert bort. 60 er romslig nok til
  // ikke å slå ut på sjeldne regler, men fanger en reell utestenging.
  const starved = [...firedIn]
    .filter(([id, c]) => c >= 60 && (bandedIn.get(id) ?? 0) === 0)
    .map(([id, c]) => `${id}: fyrte i ${c} datasett, aldri i båndet`);

  if (starved.length) {
    console.log('\n════ UTESTENGT AV RULLERINGA ════\n  ' + starved.join('\n  '));
  }
  expect(starved).toEqual([]);
  // Fuzz-en skal treffe bredt av seg selv, ikke bare de håndlagde scenarioene.
  expect(bandedEver.size).toBeGreaterThanOrEqual(15);
});
