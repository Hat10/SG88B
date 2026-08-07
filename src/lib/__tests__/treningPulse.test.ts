import { describe, it, expect, vi } from 'vitest';
import type { WorkoutSession, WorkoutRecord, WorkoutGoal, GoalKind } from '../../contexts/TreningContext';
import {
  goalStatus, totalMinutes, durationMin, fmtDur, dayKey, startOfWeek, median,
  weekStreak, bestWeekStreak, streakShortfall, pickPulse, pulseBand, buildPulseRules,
  togetherGroups, togetherOccasions, togetherSessionIds, togetherDays,
  STREAK_MIN_SESSIONS, type PulseRule,
} from '../treningPulse';

// Øktene lages relativt til «nå», siden alle måltypene er periodebaserte —
// faste datoer ville sluttet å virke ved neste årsskifte.
const at = (offsetDays: number, minutes: number, who: 'M' | 'L' = 'M'): WorkoutSession => {
  const start = new Date();
  start.setDate(start.getDate() - offsetDays);
  start.setHours(12, 0, 0, 0);
  return {
    id: `s${offsetDays}-${who}-${minutes}`,
    templateId: 't1',
    templateName: 'Push A',
    category: 'Push',
    who,
    sessionGroup: null,
    startedAt: start.toISOString(),
    completedAt: new Date(start.getTime() + minutes * 60000).toISOString(),
    note: null,
  };
};

const rec = (value: number, date: string, who: 'M' | 'L' = 'M', unit: 'kg' | 'reps' = 'kg'): WorkoutRecord =>
  ({ id: `r${value}${date}${unit}`, exercise: 'Benkpress', who, value, unit, date });

const goal = (kind: GoalKind, target: number, extra: Partial<WorkoutGoal> = {}): WorkoutGoal => ({
  id: 'g1', title: 'Mål', who: 'M', kind, target,
  exercise: null, unit: null, deadline: null, ...extra,
});

/** Antall dager siden mandag denne uka — så «denne uka»-testene ikke bommer på en søndag. */
const daysIntoWeek = Math.round((Date.now() - startOfWeek(new Date()).getTime()) / 86400000);

/** `n` økter for én person i uka som ligger `weeksAgo` uker tilbake. */
const inWeek = (weeksAgo: number, who: 'M' | 'L', n: number): WorkoutSession[] => {
  const monday = startOfWeek(new Date());
  monday.setDate(monday.getDate() - weeksAgo * 7);
  return Array.from({ length: n }, (_, i) => {
    const start = new Date(monday);
    start.setDate(start.getDate() + i);
    start.setHours(12, 0, 0, 0);
    return {
      id: `w${weeksAgo}-${who}-${i}`, templateId: 't1', templateName: 'Push A',
      category: 'Push', who, sessionGroup: null,
      startedAt: start.toISOString(),
      completedAt: new Date(start.getTime() + 45 * 60000).toISOString(),
      note: null,
    };
  });
};

/** En full streak-uke: begge nådde kravet. */
const fullWeek = (weeksAgo: number) => [
  ...inWeek(weeksAgo, 'M', STREAK_MIN_SESSIONS),
  ...inWeek(weeksAgo, 'L', STREAK_MIN_SESSIONS),
];

describe('varighet', () => {
  it('måler fra start til slutt, og hopper over økter som løper', () => {
    expect(durationMin(at(0, 45))).toBe(45);
    expect(durationMin({ ...at(0, 45), completedAt: null })).toBeNull();
    expect(totalMinutes([at(0, 45), at(1, 30), { ...at(2, 60), completedAt: null }])).toBe(75);
  });

  it('skriver timer og minutter på norsk', () => {
    expect(fmtDur(45)).toBe('45 min');
    expect(fmtDur(80)).toBe('1 t 20 min');
    expect(fmtDur(120)).toBe('2 t');
    expect(fmtDur(null)).toBe('—');
  });

  it('runder aldri bort enkeltminutter', () => {
    // 62 minutter skal aldri bli «60 min» — det var hele poenget med å droppe
    // fem-minutters-bøttene.
    expect(fmtDur(62)).toBe('1 t 2 min');
    expect(fmtDur(61)).toBe('1 t 1 min');
    expect(fmtDur(59)).toBe('59 min');
    expect(fmtDur(durationMin(at(0, 62)))).toBe('1 t 2 min');
    // Sekunder rundes til nærmeste minutt — under det er tallet ikke meningsfullt.
    expect(fmtDur(62.4)).toBe('1 t 2 min');
    expect(fmtDur(62.6)).toBe('1 t 3 min');
  });
});

describe('median', () => {
  const clock = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
  const asClock = (mins: number | null) => {
    if (mins === null) return null;
    const m = Math.round(mins);
    return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  };

  it('tar snittet av de to midterste ved partall', () => {
    // To økter kl. 17 og kl. 18 er 17:30 — ikke 18:00, som en øvre median gir.
    expect(asClock(median([clock('17:00'), clock('18:00')]))).toBe('17:30');
    expect(asClock(median([clock('17:00'), clock('17:00'), clock('18:00'), clock('18:00')]))).toBe('17:30');
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });

  it('tar den midterste ved oddetall', () => {
    expect(asClock(median([clock('17:00'), clock('18:00'), clock('20:00')]))).toBe('18:00');
    expect(median([1, 2, 3])).toBe(2);
  });

  it('lar seg ikke rive med av én uteligger', () => {
    expect(asClock(median([clock('06:00'), clock('19:00'), clock('19:30')]))).toBe('19:00');
  });

  it('gir null for tom rekke, og sorterer selv', () => {
    expect(median([])).toBeNull();
    expect(median([9, 1, 5])).toBe(5);
  });
});

describe('sammen', () => {
  // Definisjonen: en sammen-økt er én økt begge kjørte, markert med delt
  // `sessionGroup` av «Start sammen». Samme dag er ikke nok.
  const pair = (daysAgo: number, group = `grp${daysAgo}`): WorkoutSession[] =>
    (['M', 'L'] as const).map(who => ({ ...at(daysAgo, 50, who), id: `${group}-${who}`, sessionGroup: group }));

  it('teller bare økter startet med «Start sammen»', () => {
    const s = pair(1);
    expect(togetherGroups(s).size).toBe(1);
    expect(togetherOccasions(s)).toHaveLength(1);
    expect(togetherSessionIds(s).size).toBe(2); // to loggrader, én anledning
    expect(togetherDays(s).size).toBe(1);
  });

  it('teller ikke at begge trente samme dag hver for seg', () => {
    // Kjernen i endringa: Push kl. 07 og Legs kl. 20 er ikke en felles økt.
    const s = [at(1, 50, 'M'), at(1, 45, 'L')];
    expect(togetherOccasions(s)).toHaveLength(0);
    expect(togetherDays(s).size).toBe(0);
    expect(togetherSessionIds(s).size).toBe(0);
  });

  it('krever at begge radene er fullført', () => {
    const [m, l] = pair(1);
    expect(togetherOccasions([m, { ...l, completedAt: null }])).toHaveLength(0);
    expect(togetherOccasions([m])).toHaveLength(0); // gruppe med bare én person
  });

  it('sorterer anledningene eldst først', () => {
    const s = [...pair(1, 'a'), ...pair(9, 'b'), ...pair(4, 'c')];
    expect(togetherOccasions(s).map(o => o.group)).toEqual(['b', 'c', 'a']);
  });

  it('regner sammen-mål i anledninger, ikke loggrader', () => {
    // To sammen-økter denne uka = fire rader, men målet «2 sammen per uke» er nådd.
    const s = [...pair(0, 'a'), ...pair(1, 'b')];
    const st = goalStatus(goal('together_week', 2, { who: 'f' }), s, []);
    expect(st.now).toBe(daysIntoWeek >= 1 ? 2 : 1);
    expect(st.unit).toBe('økter');
  });

  // En sammen-økt i går kveld er bare noen timer unna om morgenen etter, men
  // det er fortsatt «i går». Ordvalget må følge datoskiftet ved lokal midnatt,
  // ikke 24-timers bolker fra nå — ellers sto «I dag» der helt til kl. 22.
  const sammenTekst = (startedAt: string) => {
    const s = (['M', 'L'] as const).map((who): WorkoutSession => ({
      id: `kveld-${who}`, templateId: 't1', templateName: 'Push A', category: 'Push',
      who, sessionGroup: 'kveld', startedAt,
      completedAt: new Date(new Date(startedAt).getTime() + 50 * 60000).toISOString(),
      note: null,
    }));
    return buildPulseRules(s, [], []).find(r => r.id === 'sammen-okt')?.text;
  };

  it('sier «I går» om morgenen etter en økt i går kveld', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(2026, 6, 27, 6, 0, 0));        // 27. juli 06:00 lokal
      const iGar = new Date(2026, 6, 26, 22, 0, 0).toISOString(); // 8 timer før → i går
      expect(sammenTekst(iGar)).toBe('I går kjørte dere en økt sammen. 💪');
    } finally {
      vi.useRealTimers();
    }
  });

  it('sier fortsatt «I dag» for en økt tidligere samme dag', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(2026, 6, 27, 20, 0, 0));       // 27. juli 20:00 lokal
      const iDag = new Date(2026, 6, 27, 6, 0, 0).toISOString();  // 14 timer før, samme dato
      expect(sammenTekst(iDag)).toBe('I dag kjørte dere en økt sammen. 💪');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('streak', () => {
  // Definisjonen: en uke teller når HVER av personene streaken gjelder for har
  // minst STREAK_MIN_SESSIONS fullførte økter i den uka.
  it('teller uker der begge nådde kravet', () => {
    const s = [...fullWeek(1), ...fullWeek(2), ...fullWeek(3)];
    expect(weekStreak(s)).toBe(3);
  });

  it('teller ikke en uke der én av dem manglet én økt', () => {
    const s = [
      ...fullWeek(1),
      ...inWeek(2, 'M', STREAK_MIN_SESSIONS),
      ...inWeek(2, 'L', STREAK_MIN_SESSIONS - 1), // Leah manglet én
      ...fullWeek(3),
    ];
    expect(weekStreak(s)).toBe(1);       // bare uke 1 henger sammen med nå
    expect(bestWeekStreak(s)).toBe(1);   // ingen sammenhengende rekke er lengre
  });

  it('lar inneværende uke være i gang uten å bryte rekka', () => {
    // Ingen økter denne uka ennå — rekka bakover skal stå til søndag er over.
    const s = [...fullWeek(1), ...fullWeek(2)];
    expect(weekStreak(s)).toBe(2);
    // Og når kravet nås denne uka også, teller den med.
    expect(weekStreak([...s, ...fullWeek(0)])).toBe(3);
  });

  it('krever bare av den ene når streaken er personlig', () => {
    const s = [...inWeek(1, 'M', 3), ...inWeek(2, 'M', 4), ...inWeek(1, 'L', 1)];
    expect(weekStreak(s, ['M'])).toBe(2);
    expect(weekStreak(s, ['L'])).toBe(0);
    expect(weekStreak(s)).toBe(0); // felles: Leah nådde aldri kravet
  });

  it('finner den lengste rekka, ikke den siste', () => {
    const s = [...fullWeek(1), ...fullWeek(4), ...fullWeek(5), ...fullWeek(6)];
    expect(weekStreak(s)).toBe(1);
    expect(bestWeekStreak(s)).toBe(3);
  });

  it('sier hvor mange økter som mangler denne uka', () => {
    const s = inWeek(0, 'M', 1);
    expect(streakShortfall(s, 'M')).toBe(STREAK_MIN_SESSIONS - 1);
    expect(streakShortfall(s, 'L')).toBe(STREAK_MIN_SESSIONS);
    expect(streakShortfall([...s, ...inWeek(0, 'M', 5)], 'M')).toBe(0);
  });

  it('regner weekly_streak-mål etter samme definisjon', () => {
    const s = [...fullWeek(1), ...fullWeek(2)];
    expect(goalStatus(goal('weekly_streak', 4, { who: 'f' }), s, []).now).toBe(2);
    expect(goalStatus(goal('weekly_streak', 4, { who: 'M' }), s, []).now).toBe(2);
    // Leah dropper uke 1 → hennes personlige streak er kortere enn den felles.
    const uneven = [...inWeek(1, 'M', 3), ...inWeek(1, 'L', 1), ...fullWeek(2)];
    expect(goalStatus(goal('weekly_streak', 4, { who: 'L' }), uneven, []).now).toBe(0);
    expect(goalStatus(goal('weekly_streak', 4, { who: 'M' }), uneven, []).now).toBe(2);
  });
});

describe('regler bygget fra øktlogg', () => {
  const ids = (s: WorkoutSession[], r: WorkoutRecord[] = [], g: WorkoutGoal[] = []) =>
    new Set(buildPulseRules(s, r, g).map(x => x.id));
  const weightOf = (s: WorkoutSession[], id: string) =>
    buildPulseRules(s, [], []).find(x => x.id === id)?.weight ?? 0;

  it('gir samme svar uansett rekkefølge på øktene', () => {
    // `sessions` kom sortert nyest først fra Supabase, og etterslepsregelen
    // plukket «siste økt» med find(). Usortert input ga da helt feil dagtall.
    const s = [...inWeek(0, 'M', 3), ...inWeek(4, 'M', 3), ...inWeek(0, 'L', 3)];
    const asc = [...s].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
    const desc = [...asc].reverse();
    const text = (x: WorkoutSession[]) =>
      buildPulseRules(x, [], []).map(r => `${r.id}:${r.text}`).sort().join('|');
    expect(text(asc)).toBe(text(desc));
    expect(text([...s].sort(() => Math.random() - 0.5))).toBe(text(desc));
  });

  it('lar ikke «har aldri trent» skjule at den andre ligger etter', () => {
    // Var if/else før: da sto boksen fast på Leah, og Mikkels tre ukers pause
    // ble aldri nevnt.
    const s = Array.from({ length: 12 }, (_, i) => at(30 + i * 3, 50, 'M'));
    const r = ids(s);
    expect(r.has('ingen-okter')).toBe(true);
    expect(r.has('etterslep')).toBe(true);
  });

  it('lar «har aldri trent» falme, så den ikke eier boksen for alltid', () => {
    const fresh = [at(1, 50, 'M'), at(3, 50, 'M')];
    const old = Array.from({ length: 20 }, (_, i) => at(i * 14, 50, 'M'));
    expect(weightOf(fresh, 'ingen-okter')).toBeGreaterThan(90);
    expect(weightOf(old, 'ingen-okter')).toBeLessThan(45);
  });

  it('gjentar ikke etterslepet som «tom uke»', () => {
    const s = Array.from({ length: 12 }, (_, i) => [
      ...[0, 1].map(k => at(20 + i * 3 + k, 50, 'M')),
      ...[0, 1].map(k => at(20 + i * 3 + k, 50, 'L')),
    ]).flat();
    const r = ids(s);
    expect(r.has('etterslep')).toBe(true);
    expect(r.has('tom-uke')).toBe(false);
  });

  it('lar skrytet om lengste rekke falme utover uka', () => {
    // Uten aldring sto «det er den lengste rekka deres til nå» i boksen hver
    // eneste dag så lenge rekka varte — altså i månedsvis.
    const s = [...fullWeek(0), ...fullWeek(1), ...fullWeek(2)];
    const w = weightOf(s, 'beste-streak');
    expect(w).toBeGreaterThan(0);
    expect(w).toBeLessThanOrEqual(80);
  });

  it('blander ikke reps-rekord inn i kg-rekorden for samme øvelse', () => {
    const s = [...fullWeek(1), ...fullWeek(2)];
    const text = buildPulseRules(s, [rec(100, dayKey(new Date()), 'M', 'kg'),
      rec(200, dayKey(new Date()), 'M', 'reps')], []).find(x => x.id === 'ny-rekord')!.text;
    expect(text).toMatch(/200 reps|100 kg/);
  });
});

describe('utvelgelse av melding', () => {
  const rule = (id: string, tone: 'warn' | 'good', weight: number): PulseRule =>
    ({ id, tone, weight, from: id, text: id });

  it('lar ikke en påminnelse skjule en klart viktigere positiv melding', () => {
    // Fersk rekord (95) mot «ingen økter denne uka» (60 + påslag = 72): rekorden
    // topper båndet, så påminnelsen kan ikke stenge den ute slik det gamle
    // prioritetssystemet gjorde. (Begge er innenfor 30 poeng og deler dermed på
    // rulleringa — hvem som vises akkurat i dag avhenger av døgnet, så vi sjekker
    // rekkefølgen i båndet, ikke dagens plukk.)
    const band = pulseBand([rule('ny-rekord', 'good', 95), rule('tom-uke', 'warn', 60)]);
    expect(band[0].id).toBe('ny-rekord');
    expect(band.map(r => r.id)).toContain('tom-uke');
  });

  it('lar påminnelsen vinne når den er den viktigste', () => {
    expect(pickPulse([rule('etterslep', 'warn', 90), rule('beste-maned', 'good', 60)])!.text)
      .toBe('etterslep');
  });

  it('viser aldri en melding som har falmet bort', () => {
    expect(pickPulse([rule('gammel', 'good', 2), rule('snitt', 'good', 8)])!.text).toBe('snitt');
    expect(pickPulse([rule('gammel', 'good', 2)])).toBeNull();
    expect(pickPulse([])).toBeNull();
  });

  it('bytter mellom likeverdige meldinger fra dag til dag', () => {
    const band = [rule('a', 'good', 60), rule('b', 'good', 55), rule('c', 'good', 50)];
    const seen = new Set<string>();
    vi.useFakeTimers();
    try {
      for (let d = 0; d < 6; d++) {
        vi.setSystemTime(new Date(Date.UTC(2026, 6, 20 + d, 12)));
        seen.add(pickPulse(band)!.text);
      }
    } finally {
      vi.useRealTimers();
    }
    expect(seen).toEqual(new Set(['a', 'b', 'c']));
  });

  it('slipper ikke meldinger langt under toppen inn i rotasjonen', () => {
    const seen = new Set<string>();
    vi.useFakeTimers();
    try {
      for (let d = 0; d < 6; d++) {
        vi.setSystemTime(new Date(Date.UTC(2026, 6, 20 + d, 12)));
        seen.add(pickPulse([rule('topp', 'good', 90), rule('langt-under', 'good', 40)])!.text);
      }
    } finally {
      vi.useRealTimers();
    }
    expect(seen).toEqual(new Set(['topp']));
  });
});

describe('rekordmål', () => {
  const records = [rec(90, '2026-01-10'), rec(100, '2026-03-01'), rec(97.5, '2026-05-02')];

  it('måler mot beste registrering, ikke den siste', () => {
    const st = goalStatus(goal('record', 105, { exercise: 'Benkpress', unit: 'kg' }), [], records);
    expect(st.now).toBe(100);
    expect(st.done).toBe(false);
    expect(st.remaining).toBe(5);
    expect(st.label).toBe('100/105 kg');
  });

  it('er nådd når en registrering passerer målet, og husker datoen', () => {
    const st = goalStatus(goal('record', 95, { exercise: 'Benkpress', unit: 'kg' }), [], records);
    expect(st.done).toBe(true);
    expect(st.achievedOn).toBe('2026-03-01'); // første gang det ble nådd, ikke siste
    expect(st.remaining).toBe(0);
  });

  it('blander ikke kg og reps i samme øvelse', () => {
    const mixed = [...records, rec(200, '2026-06-01', 'M', 'reps')];
    const st = goalStatus(goal('record', 150, { exercise: 'Benkpress', unit: 'kg' }), [], mixed);
    expect(st.now).toBe(100);
    expect(st.done).toBe(false);
  });

  it('holder Mikkel og Leah fra hverandre', () => {
    const both = [rec(100, '2026-03-01', 'M'), rec(60, '2026-03-02', 'L')];
    expect(goalStatus(goal('record', 80, { who: 'L', exercise: 'Benkpress', unit: 'kg' }), [], both).now).toBe(60);
    expect(goalStatus(goal('record', 80, { who: 'M', exercise: 'Benkpress', unit: 'kg' }), [], both).now).toBe(100);
  });

  it('står på 0 når øvelsen aldri er logget', () => {
    const st = goalStatus(goal('record', 55, { exercise: 'Knebøy', unit: 'kg' }), [], records);
    expect(st.now).toBe(0);
    expect(st.pct).toBe(0);
  });
});

describe('frister', () => {
  const withDeadline = (iso: string) => goal('record', 200, { exercise: 'Benkpress', unit: 'kg', deadline: iso });

  it('teller dager igjen, og negativt når fristen har gått ut', () => {
    const inTen = new Date(); inTen.setDate(inTen.getDate() + 10);
    const tenAgo = new Date(); tenAgo.setDate(tenAgo.getDate() - 10);
    expect(goalStatus(withDeadline(dayKey(inTen)), [], []).daysLeft).toBe(10);
    expect(goalStatus(withDeadline(dayKey(tenAgo)), [], []).daysLeft).toBe(-10);
  });

  it('gir null dager igjen for et mål uten frist', () => {
    expect(goalStatus(goal('record', 55, { exercise: 'Benkpress', unit: 'kg' }), [], []).daysLeft).toBeNull();
  });
});

describe('øktbaserte mål', () => {
  const sessions = [at(0, 60), at(1, 45), at(2, 30, 'L'), at(400, 60)];

  it('teller bare i år for sessions_year', () => {
    // at(400) ligger over et år tilbake og skal ikke telle med.
    const st = goalStatus(goal('sessions_year', 10), sessions, []);
    expect(st.now).toBe(2);
    expect(st.label).toBe('2/10');
  });

  it('teller alt for sessions_total', () => {
    expect(goalStatus(goal('sessions_total', 10), sessions, []).now).toBe(3); // bare M
    expect(goalStatus(goal('sessions_total', 10, { who: 'f' }), sessions, []).now).toBe(4);
  });

  it('summerer minutter for uka', () => {
    const st = goalStatus(goal('minutes_week', 120), sessions, []);
    // Kjøres testen på en mandag, ligger gårsdagens økt i forrige uke.
    expect(st.now).toBe(daysIntoWeek === 0 ? 60 : 105);
    expect(st.unit).toBe('min');
  });

  it('klipper andelen ved 100 %, men beholder tallet', () => {
    const st = goalStatus(goal('sessions_total', 2), sessions, []);
    expect(st.now).toBe(3);
    expect(st.pct).toBe(1);
    expect(st.done).toBe(true);
  });
});
