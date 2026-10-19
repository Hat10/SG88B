import { describe, it, expect } from 'vitest';
import type { GroceryItem, StapleItem } from '../../contexts/MatplanContext';
import {
  snapshotGroceryRows, pushToast, startLeaving, removeToast, dueToastIds, boughtMessage,
  MAX_UNDO_TOASTS, type UndoToast,
} from '../groceryUndo';

const g = (id: string, over: Partial<GroceryItem> = {}): GroceryItem => ({
  id, name: 'Melk', amount: 1, amountRange: null, unit: 'l', done: false, doneAt: null,
  mealPlanId: null, stapleItemId: null, category: null, ...over,
});
const staple: StapleItem = {
  id: 's1', name: 'Kaffe', amount: 1, unit: 'pk', intervalWeeks: 2,
  lastBoughtAt: '2026-10-01', postponedUntil: '2026-10-20',
};
const toast = (id: string, expiresAt = 6000, over: Partial<UndoToast> = {}): UndoToast =>
  ({ id, label: id.toUpperCase(), snapshots: [], expiresAt, ...over });

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

describe('pushToast', () => {
  it('legger nyeste sist (eldst øverst)', () => {
    const st = ['a', 'b', 'c'].reduce((acc, id) => pushToast(acc, toast(id)), [] as UndoToast[]);
    expect(st.map(t => t.id)).toEqual(['a', 'b', 'c']);
  });
  it(`tillater maks ${MAX_UNDO_TOASTS} aktive; den eldste dyttes ut av en femte`, () => {
    const st = ['a', 'b', 'c', 'd', 'e'].reduce((acc, id) => pushToast(acc, toast(id)), [] as UndoToast[]);
    expect(st.filter(t => !t.leaving).map(t => t.id)).toEqual(['b', 'c', 'd', 'e']);
    expect(st.find(t => t.id === 'a')?.leaving).toBe(true);
  });
  it('teller ikke meldinger som allerede forsvinner mot taket', () => {
    let st = ['a', 'b', 'c', 'd'].reduce((acc, id) => pushToast(acc, toast(id)), [] as UndoToast[]);
    st = startLeaving(st, 'b');
    st = pushToast(st, toast('e'));
    expect(st.filter(t => !t.leaving).map(t => t.id)).toEqual(['a', 'c', 'd', 'e']);
  });
  it('muterer ikke inndata', () => {
    const before = [toast('a')];
    pushToast(before, toast('b'));
    expect(before).toHaveLength(1);
  });
});

describe('uavhengige frister', () => {
  it('bare meldinger hvis egen frist er nådd utløper', () => {
    const st = [toast('a', 6000), toast('b', 7500), toast('c', 9000)];
    expect(dueToastIds(st, 5999)).toEqual([]);
    expect(dueToastIds(st, 6000)).toEqual(['a']);
    expect(dueToastIds(st, 8000)).toEqual(['a', 'b']);
  });
  it('en melding som forsvinner rører ikke de andre', () => {
    const st = startLeaving([toast('a'), toast('b', 9000)], 'a');
    expect(st[1]).toEqual(toast('b', 9000));
    expect(dueToastIds(st, 10_000)).toEqual(['b']);
  });
});

describe('angre én vare', () => {
  const items = [g('a1', { name: 'Egg' }), g('a2', { name: 'Egg' }), g('b', { name: 'Brød' })];
  const mk = (id: string, label: string, ids: string[]) =>
    toast(id, 6000, { label, snapshots: snapshotGroceryRows(ids, items, []) });

  it('gjelder bare den meldingens rader (alle radene i en gruppe)', () => {
    const st = pushToast(pushToast([], mk('t1', 'Egg', ['a1', 'a2'])), mk('t2', 'Brød', ['b']));
    const undone = st.find(t => t.id === 't1')!;
    expect(undone.snapshots.map(s => s.id)).toEqual(['a1', 'a2']);
    const after = startLeaving(st, 't1');
    expect(after.find(t => t.id === 't2')!.snapshots.map(s => s.id)).toEqual(['b']);
    expect(after.find(t => t.id === 't2')!.leaving).toBeUndefined();
  });
  it('startLeaving på ukjent eller allerede forsvinnende id er en no-op', () => {
    const st = startLeaving([toast('a')], 'a');
    expect(startLeaving(st, 'a')).toBe(st);
    expect(startLeaving(st, 'x')).toBe(st);
  });
  it('removeToast fjerner bare den ene', () => {
    expect(removeToast([toast('a'), toast('b')], 'a').map(t => t.id)).toEqual(['b']);
  });
});

describe('boughtMessage', () => {
  it('navngir varen', () => expect(boughtMessage('Melk')).toBe('✓ Melk kjøpt'));
});
