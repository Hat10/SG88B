import { describe, it, expect } from 'vitest';
import type { GroceryItem, StapleItem } from '../../contexts/MatplanContext';
import { snapshotGroceryRows, addUndoEntry, flattenSnapshots, boughtMessage } from '../groceryUndo';

const g = (id: string, over: Partial<GroceryItem> = {}): GroceryItem => ({
  id, name: 'Melk', amount: 1, amountRange: null, unit: 'l', done: false, doneAt: null,
  mealPlanId: null, stapleItemId: null, category: null, ...over,
});
const staple: StapleItem = {
  id: 's1', name: 'Kaffe', amount: 1, unit: 'pk', intervalWeeks: 2,
  lastBoughtAt: '2026-10-01', postponedUntil: '2026-10-20',
};

describe('snapshotGroceryRows', () => {
  it('tar opptak av alle radene i en gruppe', () => {
    const items = [g('a'), g('b'), g('c')];
    const snaps = snapshotGroceryRows(['a', 'b'], items, []);
    expect(snaps.map(s => s.id)).toEqual(['a', 'b']);
    expect(snaps[0]).toMatchObject({ done: false, doneAt: null, stapleItemId: null, stapleBefore: null });
  });
  it('hopper over ukjente id-er', () => {
    expect(snapshotGroceryRows(['x'], [g('a')], [])).toEqual([]);
  });
  it('tar med basisvarens verdier før avhaking', () => {
    const [snap] = snapshotGroceryRows(['k'], [g('k', { stapleItemId: 's1' })], [staple]);
    expect(snap.stapleBefore).toEqual({ lastBoughtAt: '2026-10-01', postponedUntil: '2026-10-20' });
  });
});

describe('addUndoEntry', () => {
  const snap = (id: string) => snapshotGroceryRows([id], [g(id), g('b'), g('c')], [])[0];
  it('samler flere avhakinger', () => {
    let p = addUndoEntry([], { label: 'A', snapshots: [snap('a')] });
    p = addUndoEntry(p, { label: 'B', snapshots: [snap('b')] });
    expect(p).toHaveLength(2);
    expect(flattenSnapshots(p).map(s => s.id)).toEqual(['a', 'b']);
  });
  it('beholder eldste opptak ved dobbel avhaking av samme rad', () => {
    const first = { ...snap('a'), doneAt: 'ORIG' };
    const p = addUndoEntry([], { label: 'A', snapshots: [first] });
    const p2 = addUndoEntry(p, { label: 'A', snapshots: [{ ...snap('a'), doneAt: 'NY' }] });
    expect(p2).toBe(p);
    expect(flattenSnapshots(p2)[0].doneAt).toBe('ORIG');
  });
});

describe('boughtMessage', () => {
  const e = (label: string) => ({ label, snapshots: [] });
  it('navngir én vare', () => expect(boughtMessage([e('Melk')])).toBe('✓ Melk kjøpt'));
  it('teller flere varer, ikke rader', () => expect(boughtMessage([e('Melk'), e('Brød')])).toBe('✓ 2 varer kjøpt'));
});
