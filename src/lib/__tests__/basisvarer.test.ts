import { describe, it, expect, vi } from 'vitest';

// basisvarer.ts → MatplanContext / useWeeklyBucket oppretter supabase-klienten
// ved import — byttes ut med en tom stub (testene rører aldri databasen).
vi.mock('../supabase', () => ({ supabase: {} }));

import type { GroceryItem, StapleItem } from '../../contexts/MatplanContext';
import {
  planBasisBatch, nextHandleukeStart, formatHandleukeRange, previewNames, planUndo,
  latestUndoableBatch, newBatchId, batchTimestamp, undoMessage, LEGACY_DONE_AT,
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

describe('previewNames', () => {
  it('viser de første 7 og teller resten', () => {
    const names = Array.from({ length: 10 }, (_, i) => `v${i}`);
    expect(previewNames(names)).toEqual({ shown: names.slice(0, 7), rest: 3 });
    expect(previewNames(['a', 'b'])).toEqual({ shown: ['a', 'b'], rest: 0 });
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
