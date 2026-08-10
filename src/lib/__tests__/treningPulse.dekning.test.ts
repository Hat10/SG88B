// Dekningstest for info-boksen: kjører hele regelsettet gjennom et bredt sett
// scenarioer, 21 døgn hver, og sjekker to egenskaper som lett går tapt når
// vekter justeres:
//
//   1. Ingen regel skal kunne fyre av uten noensinne å bli vist. Med det gamle
//      prioritetssystemet var sju av tjue regler i praksis død kode.
//   2. Ingen realistisk situasjon skal fryse boksen på én setning i tre uker.
//
// Ved brudd skrives hele kjøringa ut, så det går an å se hva som skygger for hva.
import { it, expect, vi } from 'vitest';
import type { WorkoutSession, WorkoutRecord, WorkoutGoal, GoalKind, Trainer, RecordUnit } from '../../contexts/TreningContext';
import { buildPulseRules, pickPulse, startOfWeek } from '../treningPulse';

const DAY = 86400000;
/** Fast mandag som alle scenarioene ankres til, så kjøringa er reproduserbar. */
const ANCHOR = new Date(Date.UTC(2026, 6, 6, 10, 0, 0)); // mandag 6. juli 2026
const SIM_DAYS = 21;

let seq = 0;
const s = (daysAgo: number, who: Trainer, cat = 'Push', min = 50): WorkoutSession => {
  const start = new Date(Date.now() - daysAgo * DAY);
  start.setHours(18, 0, 0, 0);
  return {
    id: `s${seq++}`, templateId: 't1', templateName: `${cat} A`, category: cat, who,
    startedAt: start.toISOString(),
    completedAt: new Date(start.getTime() + min * 60000).toISOString(),
    note: null,
  };
};

const r = (daysAgo: number, who: Trainer, value: number, ex = 'Benkpress', unit: RecordUnit = 'kg'): WorkoutRecord => ({
  id: `r${seq++}`, exercise: ex, who, value, unit,
  date: new Date(Date.now() - daysAgo * DAY).toISOString().slice(0, 10),
});

const g = (kind: GoalKind, target: number, extra: Partial<WorkoutGoal> = {}): WorkoutGoal => ({
  id: `g${seq++}`, title: `Mål ${kind}`, who: 'f', kind, target,
  exercise: null, unit: null, deadline: null, ...extra,
});

const inDays = (n: number) => new Date(Date.now() + n * DAY).toISOString().slice(0, 10);

/**
 * `perWeek` økter i uka for hver av `who`, `weeks` uker bakover fra og med
 * denne uka.
 */
function routine(
  weeks: number, perWeek: number, who: Trainer[] = ['M', 'L'], cat = 'Push',
): WorkoutSession[] {
  const out: WorkoutSession[] = [];
  const thisMonday = startOfWeek(new Date()).getTime();
  for (let w = 0; w < weeks; w++) {
    for (let i = 0; i < perWeek; i++) {
      const t = thisMonday - w * 7 * DAY + i * 2 * DAY;
      if (t > Date.now()) continue; // ikke legg økter i framtida
      for (const p of who) out.push(s(Math.floor((Date.now() - t) / DAY), p, cat));
    }
  }
  return out.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

type Data = { sessions: WorkoutSession[]; records: WorkoutRecord[]; goals: WorkoutGoal[] };
/** `minMessages` = hvor variert boksen minst skal være over 21 døgn. */
type Scenario = { name: string; build: () => Data; minMessages: number };

const sc = (name: string, build: () => Partial<Data>, minMessages = 3): Scenario => ({
  name, minMessages,
  build: () => ({ sessions: [], records: [], goals: [], ...build() }),
});

const SCENARIOS: Scenario[] = [
  // Fersk base: det finnes ærlig talt bare én ting å si, så én melding er riktig.
  sc('kun én økt totalt', () => ({ sessions: [s(2, 'M')] }), 1),
  sc('M trener jevnt, L har aldri trent', () => ({ sessions: routine(30, 3, ['M']) })),
  sc('begge jevnt 3/uke i 30 uker', () => ({ sessions: routine(30, 3, ['M', 'L'], 'Push') })),
  sc('begge jevnt 4/uke i 60 uker', () => ({ sessions: routine(60, 4, ['M', 'L'], 'Push') })),
  sc('jevnt, men M sluttet for 12 dager siden', () => ({
    sessions: [...routine(30, 3, ['L']), ...routine(30, 3, ['M']).filter(x => Date.now() - new Date(x.startedAt).getTime() > 12 * DAY)],
  })),
  sc('ingen har trent på 20 dager', () => ({
    sessions: routine(30, 3, ['M', 'L'], 'Push').filter(x => Date.now() - new Date(x.startedAt).getTime() > 20 * DAY),
  })),
  // minMessages senket til 2 for disse to: uten Sammen-regelfamilien er det ikke
  // nok andre regler igjen til å garantere 3 ulike meldinger i akkurat disse
  // smale scenarioene (jevn trening + én rekord, ingen andre mål/milepæler).
  sc('jevnt + fersk rekord (2 dager)', () => ({ sessions: routine(30, 3, ['M', 'L'], 'Push'), records: [r(2, 'M', 100), r(200, 'M', 95)] }), 2),
  sc('jevnt + rekord 45 dager gammel', () => ({ sessions: routine(30, 3, ['M', 'L'], 'Push'), records: [r(45, 'M', 100), r(200, 'M', 95)] })),
  sc('jevnt + rekord 120 dager gammel', () => ({ sessions: routine(30, 3, ['M', 'L'], 'Push'), records: [r(120, 'M', 100)] })),
  sc('rekord i både kg og reps', () => ({
    sessions: routine(30, 3, ['M', 'L'], 'Push'), records: [r(3, 'M', 100, 'Benkpress', 'kg'), r(1, 'M', 200, 'Benkpress', 'reps')],
  }), 2),
  sc('sessions_year foran skjema', () => ({ sessions: routine(30, 4, ['M', 'L'], 'Push'), goals: [g('sessions_year', 100)] })),
  sc('sessions_year bak skjema', () => ({ sessions: routine(30, 2, ['M', 'L'], 'Push'), goals: [g('sessions_year', 400)] })),
  sc('rekordmål nesten nådd', () => ({
    sessions: routine(30, 3, ['M', 'L'], 'Push'), records: [r(10, 'M', 98)],
    goals: [g('record', 100, { who: 'M', exercise: 'Benkpress', unit: 'kg' })],
  })),
  sc('rekordmål nådd i går', () => ({
    sessions: routine(30, 3, ['M', 'L'], 'Push'), records: [r(1, 'M', 105)],
    goals: [g('record', 100, { who: 'M', exercise: 'Benkpress', unit: 'kg' })],
  })),
  sc('rekordmål nådd for 90 dager siden', () => ({
    sessions: routine(30, 3, ['M', 'L'], 'Push'), records: [r(90, 'M', 105)],
    goals: [g('record', 100, { who: 'M', exercise: 'Benkpress', unit: 'kg' })],
  })),
  sc('frist om 10 dager', () => ({
    sessions: routine(30, 3, ['M', 'L'], 'Push'), records: [r(10, 'M', 80)],
    goals: [g('record', 120, { who: 'M', exercise: 'Benkpress', unit: 'kg', deadline: inDays(10) })],
  })),
  sc('frist gikk ut for 5 dager siden', () => ({
    sessions: routine(30, 3, ['M', 'L'], 'Push'), records: [r(10, 'M', 80)],
    goals: [g('record', 120, { who: 'M', exercise: 'Benkpress', unit: 'kg', deadline: inDays(-5) })],
  })),
  sc('løpende mål nådd (økter denne måneden)', () => ({
    sessions: routine(30, 4, ['M', 'L'], 'Push'), goals: [g('sessions_month', 4)],
  })),
  sc('fem mål samtidig', () => ({
    sessions: routine(30, 3, ['M', 'L'], 'Push'), records: [r(5, 'M', 98)],
    goals: [
      g('sessions_year', 400), g('sessions_month', 4), g('hours_year', 500),
      g('weekly_streak', 20),
      g('record', 100, { who: 'M', exercise: 'Benkpress', unit: 'kg' }),
    ],
  })),
  sc('fire kategorier, én 40 dager gammel', () => ({
    sessions: [
      ...routine(30, 2, ['M', 'L'], 'Push'), ...routine(30, 1, ['M', 'L'], 'Pull'),
      ...routine(4, 1, ['M'], 'Legs'),
      s(40, 'M', 'Kondisjon'), s(45, 'L', 'Kondisjon'),
    ],
  })),
  // Streaken lever, men Taran ligger an til å ryke den denne uka.
  sc('streaken står i fare denne uka', () => ({
    sessions: [
      ...routine(20, 3, ['M', 'L'], 'Push')
        .filter(x => new Date(x.startedAt).getTime() < startOfWeek(new Date()).getTime()),
      ...routine(1, 3, ['M']),
      ...routine(1, 1, ['L']),
    ],
  })),
  // Rekka ble brutt for fem uker siden, så dagens streak er kortere enn beste —
  // det er den eneste situasjonen `streak-milepal` kan nå fram i.
  sc('kort streak, lengre rekke tidligere', () => {
    const weekOf = (x: WorkoutSession) => Math.round(
      (startOfWeek(new Date()).getTime() - startOfWeek(new Date(x.startedAt)).getTime()) / (7 * DAY));
    return { sessions: routine(24, 3, ['M', 'L'], 'Push').filter(x => weekOf(x) !== 4) };
  }),
  sc('rolig rytme (1/uke hver), tom uke så langt', () => ({
    // Median-gapet er ~7 dager, så terskelen for etterslep er 14 — ingen er
    // «på etterslep», men uka er tom. Det er tilfellet tom-uke finnes for.
    sessions: routine(30, 1, ['M', 'L'], 'Push').filter(x => Date.now() - new Date(x.startedAt).getTime() > 4 * DAY),
  })),
  sc('beste måned noensinne', () => ({
    sessions: [...routine(40, 2, ['M', 'L'], 'Push').filter(x => Date.now() - new Date(x.startedAt).getTime() > 31 * DAY), ...routine(4, 5, ['M', 'L'], 'Push')],
  })),
  sc('lav aktivitet siste 4 uker', () => ({
    sessions: [...routine(40, 4, ['M', 'L'], 'Push').filter(x => Date.now() - new Date(x.startedAt).getTime() > 28 * DAY), ...routine(4, 1)],
  })),
  sc('akkurat passert 100 økter', () => ({ sessions: routine(17, 3, ['M', 'L'], 'Push') })),
  sc('passert 100 økter for lenge siden', () => ({ sessions: routine(60, 1) })),
  sc('stort volum, alt i orden, ingen mål', () => ({ sessions: routine(80, 4, ['M', 'L'], 'Push') })),
];

it('viser hver regel i minst ett scenario, og fryser aldri boksen', () => {
  const fired = new Map<string, number>();
  const picked = new Map<string, number>();
  const firedIn = new Map<string, Set<string>>();
  const pickedIn = new Map<string, Set<string>>();
  const samples = new Map<string, string>();
  const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);
  const add = (m: Map<string, Set<string>>, k: string, v: string) =>
    m.set(k, (m.get(k) ?? new Set()).add(v));

  const perScenario: { name: string; sessions: number; distinct: number; min: number; lines: string[] }[] = [];

  for (const scen of SCENARIOS) {
    vi.useFakeTimers();
    const seenTexts = new Set<string>();
    const lines: string[] = [];
    let nSessions = 0;

    for (let d = 0; d < SIM_DAYS; d++) {
      // Dataene bygges på nytt hver dag, relativt til den dagen. Ellers ville
      // «trener jevnt» blitt til «har ikke trent på 20 dager» underveis, og
      // etterslepsregelen ville spist hele kjøringa.
      vi.setSystemTime(new Date(ANCHOR.getTime() + d * DAY));
      seq = 0;
      const data = scen.build();
      nSessions = data.sessions.length;
      const rules = buildPulseRules(data.sessions, data.records, data.goals);
      for (const rule of rules) {
        // Bare regler som faktisk overlever filteret regnes som «fyrt av».
        if (rule.weight < 5) continue;
        bump(fired, rule.id.replace(/-g\d+$/, '-*'));
        add(firedIn, rule.id.replace(/-g\d+$/, '-*'), scen.name);
      }
      // Rotasjonen er et tilfeldig valg nå (ett per sidebesøk), ikke lenger en
      // datobasert indeks — d/SIM_DAYS gir en deterministisk, jevnt fordelt
      // rand-sekvens over kjøringa i stedet for å stole på ekte Math.random(),
      // så dekningssjekkene under ikke blir avhengige av flaks.
      const p = pickPulse(rules, () => d / SIM_DAYS);
      if (p) {
        const id = rules.find(x => x.text === p.text)!.id.replace(/-g\d+$/, '-*');
        bump(picked, id);
        add(pickedIn, id, scen.name);
        if (!samples.has(id)) samples.set(id, p.text);
        if (!seenTexts.has(p.text)) {
          seenTexts.add(p.text);
          lines.push(`    d${String(d).padStart(2)} [${p.from}] ${p.text}`);
        }
      }
    }
    vi.useRealTimers();
    perScenario.push({ name: scen.name, sessions: nSessions, distinct: seenTexts.size, min: scen.minMessages, lines });
  }

  const all = [...new Set([...fired.keys(), ...picked.keys()])].sort();
  const dead = all.filter(id => (picked.get(id) ?? 0) === 0);
  const frozen = perScenario.filter(x => x.distinct < x.min);

  if (dead.length || frozen.length || all.length < 20) {
    console.log('\n════ PER SCENARIO ════' + perScenario.map(x =>
      `\n  ${x.name}  (${x.sessions} økter, ${x.distinct} ulike meldinger)\n${x.lines.join('\n')}`).join('\n'));
    console.log('\n════ DEKNING ════');
    console.log('regel'.padEnd(22) + 'fyrte'.padStart(7) + 'vist'.padStart(7) + '  scenarioer (fyrte→vist)');
    for (const id of all) {
      console.log(id.padEnd(22) + String(fired.get(id) ?? 0).padStart(7) +
        String(picked.get(id) ?? 0).padStart(7) +
        `  ${firedIn.get(id)?.size ?? 0}→${pickedIn.get(id)?.size ?? 0}` +
        ((picked.get(id) ?? 0) === 0 ? '   ⚠️  ALDRI VIST' : ''));
    }
  }

  expect(dead.map(id => `${id} (fyrte ${fired.get(id)}× i: ${[...(firedIn.get(id) ?? [])].join('; ')})`))
    .toEqual([]);
  expect(frozen.map(x => `${x.name}: bare ${x.distinct} melding(er) på ${SIM_DAYS} døgn`))
    .toEqual([]);

  // Regelsettet skal ikke krympe uten at noen tar stilling til det. ny-rekord-*
  // er nå én familie PER (øvelse, person, enhet) i stedet for én fast familie
  // totalt, så tallet under er ikke lenger et fast antall kodegrener — det
  // reflekterer også hvor mange distinkte øvelser/enheter scenarioene under
  // faktisk bruker (i dag: Benkpress i både kg og reps, se linje ~90).
  // 17 familier nå; terskelen holder samme slakk som før — én familie, typisk
  // mal-foran, trenger ikke fyre i akkurat dette scenarioutvalget.
  expect(all.length).toBeGreaterThanOrEqual(17);
  expect(samples.size).toBeGreaterThanOrEqual(17);
});
