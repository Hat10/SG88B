import type { BucketEntry } from '../contexts/BucketContext';
import type { MapPin } from '../contexts/MapContext';

type PinRef = Pick<MapPin, 'sourceType' | 'sourceId'>;
type ItemRef = Pick<BucketEntry, 'id' | 'done'>;

// Bucket-pinner som peker på en aktivitet som ikke finnes lenger. Avhakede
// aktiviteter beholder pinnen sin (vises som besøkt). Andre pin-typer røres ikke.
export function orphanedBucketPinIds(pins: PinRef[], items: Pick<BucketEntry, 'id'>[]): string[] {
  const ids = new Set(items.map(i => i.id));
  return pins
    .filter(p => p.sourceType === 'bucket' && !ids.has(p.sourceId))
    .map(p => p.sourceId);
}

// Deler aktiviteter med pinne i «vil besøke» (ikke avhaket) og «besøkt» (avhaket).
export function splitPinnedBuckets<T extends ItemRef>(items: T[], hasPin: (id: string) => boolean) {
  const pinned = items.filter(i => hasPin(i.id));
  return {
    active: pinned.filter(i => !i.done),
    visited: pinned.filter(i => i.done),
  };
}
