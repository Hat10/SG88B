process.env.TZ = 'Europe/Oslo';

import { describe, it, expect } from 'vitest';
import type { Recipe } from '../../contexts/MatplanContext';
import {
  DEFAULT_DINNER_PATTERN, dayRangeLabel, isOneDayRecipe, resolvePattern, suggestWeek, suggestionEntries, weekdayName,
  type SuggestedBlock, type VariableMode,
} from '../suggestWeek';

const recipe = (id: string, ingredients = [{ name: 'ris', amount: 1, unit: 'dl' }], tags: string[] = []): Recipe => ({
  id, name: `Oppskrift ${id}`, ingredients, cookTimeMinutes: null, instructions: null, tags, source: 'egen',
});
const oneDay = (id: string, tag = '1 dag') => recipe(id, undefined, [tag]);
const recipes = (n: number) => Array.from({ length: n }, (_, i) => recipe(`r${i + 1}`));
const mp = (date: string, recipeId: string) => ({ id: `mp-${date}`, date, recipeId });

// Liten deterministisk rng (mulberry32) så testene er repeterbare.
function seeded(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Lørdag 7. nov 2026 → fredag 13. nov. «I dag» er før uka, så alle dager er aktuelle.
const WEEK = '2026-11-07';
const TODAY = '2026-11-01';
const [LOR, SON, MAN, TIR, ONS, TOR, FRE] =
  ['2026-11-07', '2026-11-08', '2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13'];

const run = (over: Partial<Parameters<typeof suggestWeek>[0]> = {}, seed = 1) =>
  suggestWeek({ weekStart: WEEK, today: TODAY, recipes: recipes(10), history: [], existing: [], rng: seeded(seed), ...over });
const byId = (blocks: SuggestedBlock[], id: string) => blocks.find(b => b.id === id)!;

describe('standardmalen', () => {
  it('gir riktige dager og rester-koblinger (fredag = rester fra onsdag)', () => {
    const blocks = run();
    expect(blocks.map(b => [b.id, b.freeDates])).toEqual([
      ['lor', [LOR]],
      ['son', [SON, MAN, TIR]],
      ['ons', [ONS, TOR, FRE]],
    ]);
    expect(byId(blocks, 'son').cookDate).toBe(SON);
    expect(byId(blocks, 'ons').cookDate).toBe(ONS);
    expect(blocks.every(b => b.origin === 'suggested' && b.recipeId)).toBe(true);
  });

  it('lagrer samme oppskrift på alle dagene i en blokk', () => {
    const blocks = run();
    const entries = suggestionEntries(blocks);
    expect(entries.map(e => e.date)).toEqual([LOR, SON, MAN, TIR, ONS, TOR, FRE]);
    const rid = (d: string) => entries.find(e => e.date === d)!.recipeId;
    expect(rid(MAN)).toBe(rid(SON));
    expect(rid(TIR)).toBe(rid(SON));
    expect(rid(TOR)).toBe(rid(ONS));
    expect(rid(FRE)).toBe(rid(ONS));
    expect(new Set([rid(LOR), rid(SON), rid(ONS)]).size).toBe(3);
  });

  it('er deterministisk for samme rng', () => {
    expect(run({}, 7)).toEqual(run({}, 7));
  });

  it('resolvePattern gir blokker per modus', () => {
    const ids = (m: VariableMode) => resolvePattern(DEFAULT_DINNER_PATTERN, m).map(b => `${b.id}:${[b.cookDay, ...b.leftoverDays]}`);
    expect(ids('leftover')).toEqual(['lor:0', 'son:1,2,3', 'ons:4,5,6']);
    expect(ids('new')).toEqual(['lor:0', 'son:1,2,3', 'ons:4,5', 'fre:6']);
    expect(ids('none')).toEqual(['lor:0', 'son:1,2,3', 'ons:4,5']);
  });
});

describe('fredag-bryteren', () => {
  it('rester: fredag deler oppskrift med onsdag', () => {
    const blocks = run({ variableMode: 'leftover' });
    expect(byId(blocks, 'ons').freeDates).toEqual([ONS, TOR, FRE]);
    expect(blocks.find(b => b.id === 'fre')).toBeUndefined();
  });

  it('ny: fredag blir egen blokk med egen oppskrift', () => {
    const blocks = run({ variableMode: 'new' });
    expect(byId(blocks, 'ons').freeDates).toEqual([ONS, TOR]);
    expect(byId(blocks, 'fre').freeDates).toEqual([FRE]);
    expect(byId(blocks, 'fre').recipeId).not.toBe(byId(blocks, 'ons').recipeId);
    expect(byId(blocks, 'fre').origin).toBe('suggested');
  });

  it('ingen: fredag får ingenting', () => {
    const blocks = run({ variableMode: 'none' });
    expect(suggestionEntries(blocks).map(e => e.date)).not.toContain(FRE);
    expect(blocks.flatMap(b => b.days.map(d => d.date))).not.toContain(FRE);
  });

  it('default kommer fra malen', () => {
    const pattern = { ...DEFAULT_DINNER_PATTERN, variable: { ...DEFAULT_DINNER_PATTERN.variable, defaultMode: 'none' as const } };
    expect(run({ pattern }).flatMap(b => b.freeDates)).not.toContain(FRE);
  });
});

describe('ingen duplikater', () => {
  it('ingen oppskrift to ganger i samme forslag (mange rng-frø, alle moduser)', () => {
    for (const mode of ['leftover', 'new', 'none'] as const) {
      for (let seed = 1; seed <= 50; seed++) {
        const ids = run({ variableMode: mode, recipes: recipes(5) }, seed).map(b => b.recipeId);
        expect(new Set(ids).size).toBe(ids.length);
      }
    }
  });

  it('foreslår ikke en oppskrift som allerede står i uka', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const blocks = run({ recipes: recipes(4), existing: [mp(ONS, 'r1')] }, seed);
      const picked = blocks.filter(b => b.origin === 'suggested').map(b => b.recipeId);
      expect(picked).not.toContain('r1');
    }
  });
});

describe('nylig brukte', () => {
  // r1–r5 brukt de siste ukene, r6–r10 ikke.
  const history = ['r1', 'r2', 'r3', 'r4', 'r5'].map((r, i) => mp(`2026-10-${20 + i}`, r));

  it('velges ikke når det finnes nok alternativer', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const ids = run({ history, variableMode: 'new' }, seed).map(b => b.recipeId!);
      expect(ids).toHaveLength(4);
      expect(ids.every(id => Number(id.slice(1)) >= 6)).toBe(true);
    }
  });

  it('brukes som reserve når for få friske: alle friske tas først', () => {
    // 3 friske (r8–r10) for 4 blokker ⇒ alle tre friske + én nylig brukt.
    for (let seed = 1; seed <= 50; seed++) {
      const pool = recipes(10).filter(r => !['r6', 'r7'].includes(r.id));
      const ids = run({ history, variableMode: 'new', recipes: pool }, seed).map(b => b.recipeId!);
      expect(ids).toHaveLength(4);
      for (const fresh of ['r8', 'r9', 'r10']) expect(ids).toContain(fresh);
    }
  });

  it('eldst brukt foretrekkes blant nylig brukte', () => {
    const old = [mp('2026-10-18', 'r1'), mp('2026-11-05', 'r2')];
    let r1 = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const b = run({ history: old, recipes: recipes(2), variableMode: 'none' }, seed);
      if (byId(b, 'lor').recipeId === 'r1') r1++;
    }
    expect(r1).toBeGreaterThan(120);
  });

  it('historikk eldre enn tre uker teller ikke som nylig', () => {
    const stale = recipes(2).map(r => mp('2026-09-01', r.id));
    const blocks = run({ history: stale, recipes: recipes(2), variableMode: 'none' });
    expect(blocks.filter(b => b.recipeId)).toHaveLength(2);
  });
});

describe('for få oppskrifter', () => {
  it('tar de som finnes og lar resten stå tomt', () => {
    const blocks = run({ recipes: recipes(2) });
    expect(blocks).toHaveLength(3);
    expect(blocks.filter(b => b.recipeId)).toHaveLength(2);
    const empty = blocks.find(b => !b.recipeId)!;
    expect(empty.origin).toBe('none');
    expect(suggestionEntries(blocks).every(e => e.recipeId)).toBe(true);
  });

  it('ingen oppskrifter gir tomme blokker uten å krasje', () => {
    const blocks = run({ recipes: [] });
    expect(blocks.every(b => b.recipeId === null && b.origin === 'none')).toBe(true);
    expect(suggestionEntries(blocks)).toEqual([]);
  });
});

describe('oppskrifter uten ingredienser', () => {
  it('kan foreslås som alle andre', () => {
    const noIng = [recipe('x', []), recipe('y', [])];
    const ids = new Set<string>();
    for (let seed = 1; seed <= 20; seed++) run({ recipes: noIng }, seed).forEach(b => b.recipeId && ids.add(b.recipeId));
    expect(ids).toEqual(new Set(['x', 'y']));
  });
});

describe('eksisterende oppføringer', () => {
  it('lagedag med middag ⇒ ledige rester-dager får samme oppskrift (ikke ny)', () => {
    const blocks = run({ existing: [mp(SON, 'r1')] });
    const son = byId(blocks, 'son');
    expect(son.origin).toBe('anchored');
    expect(son.recipeId).toBe('r1');
    expect(son.freeDates).toEqual([MAN, TIR]);
    expect(son.days[0]).toEqual({ date: SON, existingRecipeId: 'r1' });
    // søndagen skrives aldri på nytt
    expect(suggestionEntries(blocks).map(e => e.date)).not.toContain(SON);
    // de andre blokkene trekker ikke r1
    expect(blocks.filter(b => b.id !== 'son').map(b => b.recipeId)).not.toContain('r1');
  });

  it('hele blokken opptatt ⇒ låst, ingenting lagres', () => {
    const blocks = run({ existing: [mp(SON, 'r1'), mp(MAN, 'r1'), mp(TIR, 'r1')] });
    const son = byId(blocks, 'son');
    expect(son.origin).toBe('locked');
    expect(son.freeDates).toEqual([]);
    expect(suggestionEntries(blocks).map(e => e.date)).toEqual([LOR, ONS, TOR, FRE]);
  });

  it('bare én rester-dag opptatt ⇒ resten fylles som normalt med ny oppskrift', () => {
    const blocks = run({ existing: [mp(MAN, 'r1')] });
    const son = byId(blocks, 'son');
    expect(son.origin).toBe('suggested');
    expect(son.freeDates).toEqual([SON, TIR]);
    expect(son.recipeId).not.toBe('r1');
    expect(son.days.find(d => d.date === MAN)?.existingRecipeId).toBe('r1');
    expect(suggestionEntries(blocks).map(e => e.date)).not.toContain(MAN);
  });

  it('overskriver aldri: ingen foreslått dato har middag fra før', () => {
    const existing = [mp(LOR, 'r1'), mp(TOR, 'r2'), mp(SON, 'r3')];
    const taken = new Set(existing.map(e => e.date));
    for (let seed = 1; seed <= 30; seed++) {
      for (const e of suggestionEntries(run({ existing, variableMode: 'new' }, seed))) expect(taken.has(e.date)).toBe(false);
    }
  });

  it('ignorerer oppføringer utenfor uka', () => {
    const blocks = run({ existing: [mp('2026-11-14', 'r1'), mp('2026-11-06', 'r1')] });
    expect(blocks.every(b => b.origin === 'suggested')).toBe(true);
  });
});

describe('inneværende uke', () => {
  const MON_TODAY = MAN; // mandag: lørdag og søndag er passert

  it('foreslår bare fra og med i dag', () => {
    const blocks = run({ today: MON_TODAY });
    expect(blocks.flatMap(b => b.freeDates)).toEqual([MAN, TIR, ONS, TOR, FRE]);
    expect(blocks.find(b => b.id === 'lor')).toBeUndefined();
  });

  it('lagedag passert uten middag ⇒ første gjenværende dag blir lagedag', () => {
    const son = byId(run({ today: MON_TODAY }), 'son');
    expect(son.cookDate).toBe(MAN);
    expect(son.freeDates).toEqual([MAN, TIR]);
    expect(son.origin).toBe('suggested');
  });

  it('lagedag passert med middag ⇒ rester-dagene får den oppskriften', () => {
    const son = byId(run({ today: MON_TODAY, existing: [mp(SON, 'r1')] }), 'son');
    expect(son.origin).toBe('anchored');
    expect(son.recipeId).toBe('r1');
    expect(son.cookDate).toBe(SON);
    expect(son.freeDates).toEqual([MAN, TIR]);
  });

  it('dagens dato er med', () => {
    expect(run({ today: LOR }).flatMap(b => b.freeDates)).toContain(LOR);
  });

  it('alt passert ⇒ ingen blokker', () => {
    expect(run({ today: '2026-11-14' })).toEqual([]);
  });
});

describe('lås / bytt (fixed og exclude)', () => {
  it('fixed beholdes og trekkes ikke andre steder', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const blocks = run({ recipes: recipes(4), fixed: { son: 'r2' } }, seed);
      expect(byId(blocks, 'son')).toMatchObject({ recipeId: 'r2', origin: 'fixed' });
      expect(blocks.filter(b => b.id !== 'son').map(b => b.recipeId)).not.toContain('r2');
    }
  });

  it('ugyldig fixed (slettet oppskrift) ignoreres', () => {
    const b = byId(run({ fixed: { son: 'finnes-ikke' } }), 'son');
    expect(b.origin).toBe('suggested');
    expect(b.recipeId).not.toBe('finnes-ikke');
  });

  it('exclude trekkes ikke', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const ids = run({ recipes: recipes(4), exclude: ['r1'] }, seed).map(b => b.recipeId);
      expect(ids).not.toContain('r1');
    }
  });

  it('fixed på anchored blokk endrer ikke den (oppskriften er allerede bestemt)', () => {
    const son = byId(run({ existing: [mp(SON, 'r1')], fixed: { son: 'r2' } }), 'son');
    expect(son.recipeId).toBe('r1');
  });
});

describe('datoer i Oslo-tid over sommertidsskifte', () => {
  const sevenDays = (blocks: SuggestedBlock[]) => blocks.flatMap(b => b.freeDates).sort();

  it('uka over høstens skifte (24.–30. okt 2026) gir sju riktige datoer', () => {
    const blocks = run({ weekStart: '2026-10-24', today: '2026-10-20' });
    expect(sevenDays(blocks)).toEqual([
      '2026-10-24', '2026-10-25', '2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30',
    ]);
    expect(byId(blocks, 'son').freeDates).toEqual(['2026-10-25', '2026-10-26', '2026-10-27']);
  });

  it('uka over vårens skifte (28. mars–3. april 2026) gir sju riktige datoer', () => {
    const blocks = run({ weekStart: '2026-03-28', today: '2026-03-20' });
    expect(sevenDays(blocks)).toEqual([
      '2026-03-28', '2026-03-29', '2026-03-30', '2026-03-31', '2026-04-01', '2026-04-02', '2026-04-03',
    ]);
  });

  it('inneværende uke 24.–30. okt, mandag 26. okt', () => {
    const blocks = run({ weekStart: '2026-10-24', today: '2026-10-26', existing: [mp('2026-10-25', 'r1')] });
    expect(sevenDays(blocks)).toEqual(['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30']);
    expect(byId(blocks, 'son').recipeId).toBe('r1');
  });
});

describe('etiketter', () => {
  it('dayRangeLabel', () => {
    expect(dayRangeLabel(WEEK, [SON, MAN, TIR])).toBe('Søn–tir');
    expect(dayRangeLabel(WEEK, [LOR])).toBe('Lør');
    expect(dayRangeLabel(WEEK, [ONS, TOR, FRE])).toBe('Ons–fre');
    expect(dayRangeLabel(WEEK, [SON, TIR])).toBe('Søn og tir');
    expect(dayRangeLabel(WEEK, [])).toBe('');
  });

  it('weekdayName', () => {
    expect(weekdayName(WEEK, SON)).toBe('søndag');
    expect(weekdayName(WEEK, FRE)).toBe('fredag');
  });
});

describe('«1 dag»-oppskrifter', () => {
  // r1–r3 vanlige, o1–o2 «1 dag».
  const mixed = [...recipes(3), oneDay('o1'), oneDay('o2')];
  const rid = (blocks: SuggestedBlock[], date: string) => suggestionEntries(blocks).find(e => e.date === date)?.recipeId;

  it('tag-matching: ignorerer store/små bokstaver og mellomrom, godtar «1dag»', () => {
    for (const tag of ['1 dag', '1 Dag', ' 1 dag ', '1dag', '1  DAG', '1\u00a0dag']) {
      expect(isOneDayRecipe(recipe('a', undefined, [tag]))).toBe(true);
    }
    for (const tag of ['11 dager', '1 dager', '21 dag', '1 dag til', 'dag', '1', '']) {
      expect(isOneDayRecipe(recipe('a', undefined, [tag]))).toBe(false);
    }
    expect(isOneDayRecipe(recipe('a', undefined, ['rask', '1 dag']))).toBe(true);
    expect(isOneDayRecipe(recipe('a'))).toBe(false);
    expect(isOneDayRecipe(undefined)).toBe(false);
  });

  it('velges aldri til flerdagsblokk (alle moduser, mange frø)', () => {
    for (const mode of ['leftover', 'new', 'none'] as const) {
      for (let seed = 1; seed <= 60; seed++) {
        const blocks = run({ recipes: mixed, variableMode: mode }, seed);
        for (const b of blocks) {
          if (b.freeDates.length > 1) expect(['o1', 'o2']).not.toContain(b.recipeId);
        }
      }
    }
  });

  it('kan velges til lørdag og fredag («ny middag»)', () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 100; seed++) {
      const blocks = run({ recipes: mixed, variableMode: 'new' }, seed);
      for (const id of ['lor', 'fre']) {
        const r = byId(blocks, id).recipeId!;
        if (r.startsWith('o')) seen.add(`${id}:${r}`);
      }
    }
    expect([...seen].some(x => x.startsWith('lor:'))).toBe(true);
    expect([...seen].some(x => x.startsWith('fre:'))).toBe(true);
  });

  it('for få vanlige oppskrifter ⇒ tom flerdagsblokk, ikke en «1 dag»-rett', () => {
    // 2 vanlige + 3 «1 dag»: søn og ons trenger hver sin vanlige, lørdag tar en «1 dag».
    const pool = [...recipes(2), oneDay('o1'), oneDay('o2'), oneDay('o3')];
    for (let seed = 1; seed <= 50; seed++) {
      const blocks = run({ recipes: pool }, seed);
      expect(byId(blocks, 'lor').recipeId).toMatch(/^o/);
      expect(byId(blocks, 'son').recipeId).toMatch(/^r/);
      expect(byId(blocks, 'ons').recipeId).toMatch(/^r/);
    }
    // 1 vanlig + 3 «1 dag»: én flerdagsblokk står tom.
    const few = [recipe('r1'), oneDay('o1'), oneDay('o2'), oneDay('o3')];
    for (let seed = 1; seed <= 50; seed++) {
      const multi = run({ recipes: few }, seed).filter(b => b.freeDates.length > 1);
      expect(multi.filter(b => b.recipeId).map(b => b.recipeId)).toEqual(['r1']);
      expect(multi.filter(b => !b.recipeId)).toHaveLength(1);
    }
    // bare «1 dag»-retter ⇒ bare lørdag fylles
    const onlyOne = run({ recipes: [oneDay('o1'), oneDay('o2')] });
    expect(onlyOne.filter(b => b.recipeId).map(b => b.id)).toEqual(['lor']);
  });

  it('«Velg selv» med «1 dag» i søndagsblokken splitter: søn = valgt, man–tir = ny blokk', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const blocks = run({ recipes: mixed, fixed: { son: 'o1' } }, seed);
      const son = byId(blocks, 'son');
      expect(son).toMatchObject({ recipeId: 'o1', origin: 'fixed', freeDates: [SON] });
      expect(son.days.map(d => d.date)).toEqual([SON]);
      const rest = byId(blocks, 'son-rest');
      expect(rest.freeDates).toEqual([MAN, TIR]);
      expect(rest.cookDate).toBe(MAN);
      expect(rest.splitFrom).toEqual({ blockId: 'son', recipeId: 'o1' });
      expect(rest.origin).toBe('suggested');
      expect(['o1', 'o2']).not.toContain(rest.recipeId);
      expect(rest.recipeId).not.toBe('o1');
      // blokkene ligger etter hverandre i dato-rekkefølge
      expect(blocks.map(b => b.id)).toEqual(['lor', 'son', 'son-rest', 'ons']);
      expect(rid(blocks, MAN)).toBe(rid(blocks, TIR));
      expect(rid(blocks, MAN)).not.toBe(rid(blocks, SON));
    }
  });

  it('delt rest-blokk kan låses/velges selv via fixed på `-rest`', () => {
    const blocks = run({ recipes: mixed, fixed: { son: 'o1', 'son-rest': 'r2' } });
    expect(byId(blocks, 'son-rest')).toMatchObject({ recipeId: 'r2', origin: 'fixed' });
  });

  it('«Velg selv» med «1 dag» i onsdagsblokken (med fredag) splitter ons / tor–fre', () => {
    const blocks = run({ recipes: mixed, fixed: { ons: 'o1' } });
    expect(byId(blocks, 'ons').freeDates).toEqual([ONS]);
    expect(byId(blocks, 'ons-rest').freeDates).toEqual([TOR, FRE]);
    expect(byId(blocks, 'ons-rest').cookDate).toBe(TOR);
  });

  it('«Velg selv» med «1 dag» i en enkeltdagsblokk splitter ikke', () => {
    const blocks = run({ recipes: mixed, fixed: { lor: 'o1' } });
    expect(byId(blocks, 'lor')).toMatchObject({ recipeId: 'o1', origin: 'fixed' });
    expect(blocks.find(b => b.id === 'lor-rest')).toBeUndefined();
  });

  it('«Velg selv» med vanlig oppskrift splitter ikke', () => {
    const blocks = run({ recipes: mixed, fixed: { son: 'r1' } });
    expect(byId(blocks, 'son').freeDates).toEqual([SON, MAN, TIR]);
    expect(blocks.find(b => b.id === 'son-rest')).toBeUndefined();
  });

  it('eksisterende «1 dag»-middag søndag gir ikke rester man/tir av samme', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const blocks = run({ recipes: mixed, existing: [mp(SON, 'o1')] }, seed);
      const son = byId(blocks, 'son');
      expect(son.origin).toBe('locked');
      expect(son.freeDates).toEqual([]);
      const rest = byId(blocks, 'son-rest');
      expect(rest.freeDates).toEqual([MAN, TIR]);
      expect(rest.splitFrom).toEqual({ blockId: 'son', recipeId: 'o1' });
      expect(rest.recipeId).not.toBe('o1');
      expect(['o1', 'o2']).not.toContain(rest.recipeId);
      expect(suggestionEntries(blocks).map(e => e.date)).not.toContain(SON);
    }
  });

  it('eksisterende vanlig middag søndag gir fortsatt rester (uendret)', () => {
    const blocks = run({ recipes: mixed, existing: [mp(SON, 'r1')] });
    expect(byId(blocks, 'son')).toMatchObject({ origin: 'anchored', recipeId: 'r1', freeDates: [MAN, TIR] });
  });

  it('eksisterende «1 dag» på passert lagedag: bare ny blokk for resten', () => {
    const blocks = run({ recipes: mixed, today: MAN, existing: [mp(SON, 'o1')] });
    expect(blocks.find(b => b.id === 'son')).toBeUndefined();
    const rest = byId(blocks, 'son-rest');
    expect(rest.freeDates).toEqual([MAN, TIR]);
    expect(rest.cookDate).toBe(MAN);
    expect(rest.recipeId).not.toBe('o1');
  });

  it('eksisterende «1 dag» søndag og rester-dagene allerede opptatt ⇒ ingen ny blokk', () => {
    const blocks = run({ recipes: mixed, existing: [mp(SON, 'o1'), mp(MAN, 'r1'), mp(TIR, 'r1')] });
    expect(byId(blocks, 'son').origin).toBe('locked');
    expect(blocks.find(b => b.id === 'son-rest')).toBeUndefined();
  });

  it('«Bytt» (fixed på de andre + exclude) holder seg til reglene', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const first = run({ recipes: mixed }, seed);
      const fixed = Object.fromEntries(first.filter(b => b.id !== 'son').map(b => [b.id, b.recipeId!]));
      const next = run({ recipes: mixed, fixed, exclude: [byId(first, 'son').recipeId!] }, seed + 100);
      const son = byId(next, 'son');
      expect(son.recipeId).not.toBe(byId(first, 'son').recipeId);
      expect(['o1', 'o2']).not.toContain(son.recipeId);
    }
  });

  it('«Foreslå på nytt» med låst «1 dag»-split beholder splitten og trekker ny rest', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const blocks = run({ recipes: mixed, fixed: { son: 'o1', lor: 'r3' } }, seed);
      expect(byId(blocks, 'son').freeDates).toEqual([SON]);
      expect(byId(blocks, 'son-rest').recipeId).not.toMatch(/^o/);
    }
  });

  it('ingen duplikater selv med «1 dag»-retter', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const ids = run({ recipes: mixed, variableMode: 'new', fixed: { son: 'o1' } }, seed).map(b => b.recipeId).filter(Boolean);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
});
