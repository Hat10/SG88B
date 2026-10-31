import { describe, it, expect, vi } from 'vitest';

// basisvarer.ts → MatplanContext / useWeeklyBucket oppretter supabase-klienten
// ved import — byttes ut med en tom stub (testene rører aldri databasen).
vi.mock('../supabase', () => ({ supabase: {} }));

import type { GroceryItem, StapleItem } from '../../contexts/MatplanContext';
import {
  planBasisBatch, nextHandleukeStart, formatHandleukeRange, planUndo, withSelection,
  buildBatchWrites, selectionSummary,
  latestUndoableBatch, newBatchId, batchTimestamp, undoMessage, LEGACY_DONE_AT,
  reactivationPatch, restorePatch,
} from '../basisvarer';

const staple = (id: string, over: Partial<StapleItem> = {}): StapleItem => ({
  id, name: id, amount: null, unit: null,
  // Kjøpt i inneværende handleuke, ukentlig ⇒ forfaller neste handleuke.
  intervalWeeks: 1, lastBoughtAt: '2026-10-31', postponedUntil: null, ...over,
});
const row = (id: string, over: Partial<GroceryItem> = {}): GroceryItem => ({
  id, name: id, amount: null, amountRange: null, unit: null, done: false, doneAt: null,
  mealPlanId: null, stapleItemId: null, category: null,
  basisBatchId: null, basisPrevDoneAt: null, ...over,
});

// 2026-10-31 er en lørdag (start på en handleuke), 2026-11-05 en torsdag.
const SAT = '2026-10-31';
const THU = '2026-11-05';

describe('nextHandleukeStart (lørdag-anker, ikke mandag)', () => {
  it('fra en lørdag: lørdagen en uke senere', () => {
    expect(nextHandleukeStart(SAT)).toBe('2026-11-07');
  });
  it('midt i uken (torsdag): kommende lørdag, ikke neste mandag', () => {
    expect(nextHandleukeStart(THU)).toBe('2026-11-07');
  });
  it('fredag: dagen etter', () => {
    expect(nextHandleukeStart('2026-11-06')).toBe('2026-11-07');
  });
});

describe('formatHandleukeRange', () => {
  it('innen én måned', () => {
    expect(formatHandleukeRange('2026-11-07')).toBe('lør 7.–fre 13. nov');
  });
  it('over et månedsskifte', () => {
    expect(formatHandleukeRange('2026-10-31')).toBe('lør 31. okt–fre 6. nov');
  });
});

describe('planBasisBatch', () => {
  it('tar med det som forfaller neste uke, og gir lør–fre-intervallet', () => {
    const plan = planBasisBatch([staple('Melk'), staple('Egg')], [], SAT);
    expect(plan.toAdd.map(a => a.staple.id)).toEqual(['Melk', 'Egg']);
    expect(plan.weekStart).toBe('2026-11-07');
    expect(plan.weekEnd).toBe('2026-11-13');
    expect(plan.skipped).toEqual([]);
  });

  it('hopper over det som allerede står uavhuket på listen', () => {
    const items = [row('g1', { stapleItemId: 'Melk' })];
    const plan = planBasisBatch([staple('Melk'), staple('Egg')], items, SAT);
    expect(plan.toAdd.map(a => a.staple.id)).toEqual(['Egg']);
    expect(plan.skipped.map(s => s.id)).toEqual(['Melk']);
  });

  it('tar ikke med det som er forfalt nå, ikke forfaller, eller mangler frekvens', () => {
    const plan = planBasisBatch([
      staple('NåForfalt', { lastBoughtAt: null }),
      staple('Senere', { intervalWeeks: 4 }),
      staple('Referanse', { intervalWeeks: null }),
    ], [], SAT);
    expect(plan.toAdd).toEqual([]);
    expect(plan.skipped).toEqual([]);
  });

  it('en avhuket rad for basisvaren gjenaktiveres og husker sin gamle done_at', () => {
    const items = [
      row('g1', { stapleItemId: 'Melk', done: true, doneAt: '2026-10-31T10:00:00Z' }),
      row('g2', { stapleItemId: 'Egg', done: true, doneAt: null }),
    ];
    const plan = planBasisBatch([staple('Melk'), staple('Egg'), staple('Brød')], items, SAT);
    expect(plan.toAdd).toEqual([
      { staple: staple('Melk'), existingRowId: 'g1', prevDoneAt: '2026-10-31T10:00:00Z' },
      { staple: staple('Egg'), existingRowId: 'g2', prevDoneAt: LEGACY_DONE_AT },
      { staple: staple('Brød'), existingRowId: null, prevDoneAt: null },
    ]);
  });

  it('frittstående/middag-rader med samme navn teller ikke som «på listen» (samme regel som upserten)', () => {
    const items = [row('g1', { name: 'Melk' })];
    expect(planBasisBatch([staple('Melk')], items, SAT).toAdd).toHaveLength(1);
  });
});

describe('newBatchId / batchTimestamp', () => {
  it('er en gyldig uuid v7 med tidsstempelet innbakt', () => {
    const now = Date.UTC(2026, 9, 31, 12, 0, 0);
    const id = newBatchId(now);
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(batchTimestamp(id)).toBe(now);
  });
  it('sorteres i tidsrekkefølge', () => {
    expect(newBatchId(1000) < newBatchId(2000)).toBe(true);
  });
  it('null for andre uuid-versjoner', () => {
    expect(batchTimestamp('3f1c2a4e-1b2c-4d3e-8f90-123456789abc')).toBeNull();
  });
});

describe('planUndo', () => {
  const B = newBatchId(Date.UTC(2026, 9, 31, 12));
  const OTHER = newBatchId(Date.UTC(2026, 9, 24, 12));

  it('sletter bare nye rader fra innsettingen som ikke er krysset av', () => {
    const items = [
      row('ny', { basisBatchId: B }),
      row('kryssetAv', { basisBatchId: B, done: true, doneAt: '2026-11-01T09:00:00Z' }),
      row('fraFør', {}),
      row('fraFørAvhuket', { done: true }),
      row('annenInnsetting', { basisBatchId: OTHER }),
    ];
    expect(planUndo(items, B)).toEqual({ deleteIds: ['ny'], restore: [], keptIds: ['kryssetAv'] });
  });

  it('en gjenaktivert rad slettes aldri — den settes tilbake til avhuket', () => {
    const items = [
      row('gjenaktivert', { basisBatchId: B, basisPrevDoneAt: '2026-10-31T10:00:00Z' }),
      row('gjenaktivertKryssetAv', { basisBatchId: B, basisPrevDoneAt: '2026-10-30T10:00:00Z', done: true }),
    ];
    expect(planUndo(items, B)).toEqual({
      deleteIds: [],
      restore: [{ id: 'gjenaktivert', doneAt: '2026-10-31T10:00:00Z' }],
      keptIds: ['gjenaktivertKryssetAv'],
    });
  });
});

describe('latestUndoableBatch', () => {
  // Lagt til lørdag 31. okt (Oslo) ⇒ gjelder handleuken som starter 7. nov.
  const B = newBatchId(Date.UTC(2026, 9, 31, 12));
  const OLDER = newBatchId(Date.UTC(2026, 9, 30, 12));

  it('teller radene som kan angres i den siste innsettingen', () => {
    const items = [
      row('a', { basisBatchId: B }),
      row('b', { basisBatchId: B, basisPrevDoneAt: '2026-10-31T10:00:00Z' }),
      row('c', { basisBatchId: B, done: true }),
      row('d', { basisBatchId: OLDER }),
    ];
    expect(latestUndoableBatch(items, THU)).toEqual({ batchId: B, count: 2 });
  });

  it('null når alt i siste innsetting er krysset av — faller ikke tilbake til en eldre', () => {
    const items = [row('c', { basisBatchId: B, done: true }), row('d', { basisBatchId: OLDER })];
    expect(latestUndoableBatch(items, THU)).toBeNull();
  });

  it('null når handleuken innsettingen gjaldt har startet', () => {
    expect(latestUndoableBatch([row('a', { basisBatchId: B })], '2026-11-07')).toBeNull();
    expect(latestUndoableBatch([row('a', { basisBatchId: B })], '2026-11-06')).not.toBeNull();
  });

  it('null uten batch-id (f.eks. når migreringen ikke er kjørt)', () => {
    expect(latestUndoableBatch([row('a'), row('b', { done: true })], THU)).toBeNull();
  });
});

describe('undoMessage', () => {
  it('nevner beholdte bare når det finnes noen', () => {
    expect(undoMessage(10, 2)).toBe('10 fjernet, 2 beholdt fordi de er krysset av');
    expect(undoMessage(1, 1)).toBe('1 fjernet, 1 beholdt fordi den er krysset av');
    expect(undoMessage(3, 0)).toBe('3 fjernet');
  });
});

describe('gjenaktivering + angring av en gjenbrukt rad', () => {
  const B = newBatchId(Date.UTC(2026, 9, 31, 12));
  // En rad slik den ligger i databasen: kjøpt forrige gang med brukerjustert
  // mengde (2 i stedet for basisvarens 1), og basisvaren har siden fått nytt
  // navn, enhet og kategori-forslag.
  const dbRow = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    id: 'g1', name: 'Melk lett', amount: 2, amount_range: null, unit: 'l', category: 'Meieri',
    done: true, done_at: '2026-10-31T10:00:00Z', meal_plan_id: null, staple_item_id: 'Melk',
    created_at: '2026-09-01T08:00:00Z', basis_batch_id: null, basis_prev_done_at: null, ...over,
  });
  const toItem = (r: Record<string, unknown>) => row(r.id as string, {
    name: r.name as string, amount: r.amount as number, unit: r.unit as string, category: r.category as string,
    done: r.done as boolean, doneAt: r.done_at as string | null, stapleItemId: r.staple_item_id as string,
    basisBatchId: r.basis_batch_id as string | null, basisPrevDoneAt: r.basis_prev_done_at as string | null,
  });
  const renamed = staple('Melk', { name: 'Melk ekstra lett', amount: 1, unit: 'stk' });

  it('gjenaktivering rører bare avkrysning og batch-felt — ikke navn, mengde, enhet, kategori eller done_at', () => {
    const [a] = planBasisBatch([renamed], [toItem(dbRow())], SAT).toAdd;
    const patch = reactivationPatch(a, B);
    expect(Object.keys(patch).sort()).toEqual(['basis_batch_id', 'basis_prev_done_at', 'done']);
  });

  it.each([
    ['vanlig done_at', '2026-10-31T10:00:00Z'],
    ['legacy-rad uten done_at', null],
  ])('angring gir raden tilbake nøyaktig slik den var (%s)', (_, doneAt) => {
    const before = dbRow({ done_at: doneAt });
    const [a] = planBasisBatch([renamed], [toItem(before)], SAT).toAdd;
    const reactivated = { ...before, ...reactivationPatch(a, B) };
    expect(reactivated.done).toBe(false);

    const plan = planUndo([toItem(reactivated)], B);
    expect(plan.deleteIds).toEqual([]);
    expect(plan.restore).toHaveLength(1);
    const after = { ...reactivated, ...restorePatch(plan.restore[0]) };
    expect(after).toEqual(before);
  });
});

describe('valg av varer i dialogen', () => {
  const B = newBatchId(Date.UTC(2026, 9, 31, 12));
  const cat = () => null;
  const staples = [staple('Melk'), staple('Egg'), staple('Brød'), staple('Smør')];
  // Melk: gjenbrukt (avhuket) rad · Smør: gjenbrukt rad, men velges bort ·
  // Egg/Brød: ingen rad fra før. Kaffe: sto på listen fra før (uten batch).
  const before = [
    row('gMelk', { stapleItemId: 'Melk', done: true, doneAt: '2026-10-31T10:00:00Z' }),
    row('gSmør', { stapleItemId: 'Smør', done: true, doneAt: '2026-10-30T10:00:00Z' }),
    row('gKaffe', { stapleItemId: 'Kaffe' }),
  ];

  it('uten utvalg legges alle kandidatene til; med utvalg bare de valgte', () => {
    expect(planBasisBatch(staples, before, SAT).toAdd.map(a => a.staple.id)).toEqual(['Melk', 'Egg', 'Brød', 'Smør']);
    const plan = planBasisBatch(staples, before, SAT, ['Brød', 'Melk', 'Ukjent']);
    expect(plan.candidates.map(a => a.staple.id)).toEqual(['Melk', 'Egg', 'Brød', 'Smør']);
    expect(plan.toAdd.map(a => a.staple.id)).toEqual(['Melk', 'Brød']);
    expect(withSelection(planBasisBatch(staples, before, SAT), ['Brød', 'Melk'])).toEqual(plan);
  });

  it('bare valgte varer settes inn — bortvalgte gir ingen skriving i det hele tatt', () => {
    const plan = planBasisBatch(staples, before, SAT, ['Melk', 'Brød']);
    const w = buildBatchWrites(plan, B, cat);
    expect(w.insertRows.map(r => r.staple_item_id)).toEqual(['Brød']);
    expect(w.insertRows[0]).toMatchObject({ basis_batch_id: B, basis_prev_done_at: null, done: false });
    expect(w.updates).toEqual([{ id: 'gMelk', patch: { done: false, basis_batch_id: B, basis_prev_done_at: '2026-10-31T10:00:00Z' } }]);
    // Egg (ny) og Smør (gjenbrukt) er valgt bort: ingen rad, ingen oppdatering.
    const touched = [...w.insertRows.map(r => r.staple_item_id), ...w.updates.map(u => u.id)];
    expect(touched).not.toContain('Egg');
    expect(touched).not.toContain('gSmør');
  });

  it('0 valgt gir ingen innsetting', () => {
    const plan = planBasisBatch(staples, before, SAT, []);
    expect(plan.toAdd).toEqual([]);
    expect(buildBatchWrites(plan, B, cat)).toEqual({ insertRows: [], updates: [] });
  });

  it('angring etter et delvis valg rører bare de innsatte radene', () => {
    const plan = planBasisBatch(staples, before, SAT, ['Melk', 'Brød']);
    const w = buildBatchWrites(plan, B, cat);
    // «Databasen» etter innsettingen.
    const after: GroceryItem[] = before.map(g => {
      const u = w.updates.find(x => x.id === g.id);
      return u ? { ...g, done: false, basisBatchId: B, basisPrevDoneAt: u.patch.basis_prev_done_at as string } : g;
    });
    after.push(row('gBrød', { stapleItemId: 'Brød', basisBatchId: B }));

    expect(latestUndoableBatch(after, SAT)).toEqual({ batchId: B, count: 2 });
    expect(planUndo(after, B)).toEqual({
      deleteIds: ['gBrød'],
      restore: [{ id: 'gMelk', doneAt: '2026-10-31T10:00:00Z' }],
      keptIds: [],
    });
  });

  it('teksten følger valget', () => {
    expect(selectionSummary(7, 7, 'lør 7.–fre 13. nov')).toBe('7 varer blir lagt til handlelisten for neste handleuke (lør 7.–fre 13. nov).');
    expect(selectionSummary(5, 7, 'lør 7.–fre 13. nov')).toBe('5 av 7 varer legges til handlelisten for neste handleuke (lør 7.–fre 13. nov).');
  });
});
