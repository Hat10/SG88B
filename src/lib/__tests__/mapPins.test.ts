import { describe, it, expect } from 'vitest';
import { orphanedBucketPinIds, splitPinnedBuckets } from '../mapPins';

const pin = (sourceType: 'bucket' | 'rating', sourceId: string) => ({ sourceType, sourceId });

describe('orphanedBucketPinIds', () => {
  it('rydder bare pinner til aktiviteter som ikke finnes', () => {
    const items = [{ id: 'a' }, { id: 'b' }];
    expect(orphanedBucketPinIds([pin('bucket', 'a'), pin('bucket', 'x')], items)).toEqual(['x']);
  });
  it('beholder pinner til avhakede aktiviteter', () => {
    const items = [{ id: 'a', done: true }];
    expect(orphanedBucketPinIds([pin('bucket', 'a')], items)).toEqual([]);
  });
  it('rører ikke andre pin-typer', () => {
    expect(orphanedBucketPinIds([pin('rating', 'finnes-ikke')], [])).toEqual([]);
  });
  it('tom aktivitetsliste rydder alle bucket-pinner', () => {
    expect(orphanedBucketPinIds([pin('bucket', 'a'), pin('bucket', 'b')], [])).toEqual(['a', 'b']);
  });
});

describe('splitPinnedBuckets', () => {
  const items = [
    { id: 'a', done: false },
    { id: 'b', done: true },
    { id: 'c', done: false },
    { id: 'd', done: true },
  ];
  const has = (id: string) => ['a', 'b', 'c'].includes(id);

  it('skiller vil besøke fra besøkt, og ignorerer uten pinne', () => {
    const r = splitPinnedBuckets(items, has);
    expect(r.active.map(i => i.id)).toEqual(['a', 'c']);
    expect(r.visited.map(i => i.id)).toEqual(['b']);
  });
  it('hake av igjen gjør pinnen vanlig igjen', () => {
    const r = splitPinnedBuckets(items.map(i => i.id === 'b' ? { ...i, done: false } : i), has);
    expect(r.active.map(i => i.id)).toEqual(['a', 'b', 'c']);
    expect(r.visited).toEqual([]);
  });
});
