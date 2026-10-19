// Rene hjelpere for useSwipePager (src/lib/useSwipePager.ts) og useIdleReset —
// ingen DOM, ingen React, så terskler og retningsvalg kan enhetstestes.

/** Horisontal bevegelse over dette (px) regnes som sveip; under er det fortsatt et trykk. */
export const SWIPE_LOCK_PX = 10;
/** Andel av kortbredden et sakte drag må over for å bla. */
export const SWIPE_COMMIT_FRACTION = 0.25;
/** Flikk: rask nok bevegelse (px/ms) blar selv om draget er kort... */
export const SWIPE_FLICK_VELOCITY = 0.4;
/** ...men bare hvis den har gått minst så langt (px). */
export const SWIPE_FLICK_MIN_PX = 24;
/** Maks gummistrikk-utslag (px) når man drar forbi første/siste dag. */
export const RUBBER_BAND_LIMIT_PX = 72;

export function clampOffset(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

export type SwipeAxis = 'x' | 'y' | null;

/**
 * Retningsvalg ved starten av en berøring. `null` = for tidlig å avgjøre.
 * Vertikalt (`'y'`) overlates til vanlig scroll; `'x'` er et sveip.
 */
export function resolveAxis(dx: number, dy: number, threshold = SWIPE_LOCK_PX): SwipeAxis {
  const ax = Math.abs(dx), ay = Math.abs(dy);
  if (ax < threshold && ay < threshold) return null;
  return ax > ay ? 'x' : 'y';
}

/** Dempet utslag (iOS-aktig): nærmer seg `limit` asymptotisk, aldri forbi. */
export function rubberBand(dx: number, limit = RUBBER_BAND_LIMIT_PX, c = 0.55): number {
  const a = Math.abs(dx);
  const stretched = (1 - 1 / ((a * c) / limit + 1)) * limit;
  return dx < 0 ? -stretched : stretched;
}

/**
 * Hvor langt innholdet skal forskyves for et drag på `dx`. Drag mot en
 * eksisterende dag følger fingeren 1:1 (klemt til ±width); drag mot en dag som
 * ikke finnes (før min / etter max) får gummistrikk-motstand.
 * dx < 0 = sveip mot venstre = neste dag.
 */
export function dragTranslate(dx: number, offset: number, min: number, max: number, width: number): number {
  const target = offset + (dx < 0 ? 1 : dx > 0 ? -1 : 0);
  if (target < min || target > max) return rubberBand(dx);
  return Math.max(-width, Math.min(width, dx));
}

/** Ny offset etter slipp. Samme offset = gli tilbake. */
export function settleTarget(o: {
  dx: number; velocity: number; width: number; offset: number; min: number; max: number;
}): number {
  const { dx, velocity, width, offset, min, max } = o;
  if (dx === 0) return offset;
  const passedDistance = Math.abs(dx) >= width * SWIPE_COMMIT_FRACTION;
  const flicked = Math.abs(velocity) >= SWIPE_FLICK_VELOCITY && Math.abs(dx) >= SWIPE_FLICK_MIN_PX
    && Math.sign(velocity) === Math.sign(dx);
  if (!passedDistance && !flicked) return offset;
  return clampOffset(offset + (dx < 0 ? 1 : -1), min, max);
}

/** Ms igjen til inaktivitets-tidsavbruddet utløper (≤ 0 = utløpt). */
export function idleRemaining(now: number, lastActivity: number, timeoutMs: number): number {
  return timeoutMs - (now - lastActivity);
}
