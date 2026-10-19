import type React from 'react';
import { m, type ScreenSize } from './shared';
import { prefersReducedMotion } from '../../lib/useSwipePager';

// Ferskenfarget glød rundt sveipbare kort som IKKE viser dagens visning (offset > 0; for nedtelling: ikke den
// nærmeste). Én felles definisjon som alle sveipbare kort bruker.
//
// Gløden er en ren box-shadow (ingen border/outline/padding/margin på kortet), så kortets størrelse
// og plassering er upåvirket. Utstrekningen utledes av layoutens faktiske gap og når aldri lenger
// enn HALVEPARTEN av avstanden til nærmeste boks, så den aldri kan overlappe naboen.

/** Avstanden mellom boksene i Gangskjerm-layouten (rot-gap og alle grid-gap), per skjermstørrelse. */
export function layoutGap(size: ScreenSize): number {
  return size === 'mobile' ? m.gap : size === 'tablet' ? 8 : 24;
}

/**
 * En box-shadow `0 0 B S farge` har en synlig utstrekning på S + (blurens rekkevidde). Blur B gir en
 * Gauss-uskarphet med σ = B/2 (CSS-spesifikasjonen), og nettleserne (Skia) tegner den ut til 3σ = 1.5·B
 * fra spread-kanten — utenfor det er den eksakt 0. Hele den synlige utstrekningen er dermed:
 *   extent = spread + 1.5 · blur
 */
export const BLUR_REACH = 1.5;
/** Andel av utstrekningen som er solid «ring» (spread); resten er myk uskarphet. */
const SPREAD_SHARE = 0.4;

export interface GlowParams {
  /** Total synlig utstrekning utover kortets kant (px) = gap / 2. */
  extent: number;
  spread: number;
  blur: number;
}

export function glowParams(gap: number): GlowParams {
  const extent = gap / 2;
  // Rundes NED til 0,01 px (+ liten margin mot flyttallsstøy), så summen aldri overstiger `extent`.
  const down = (n: number) => Math.floor(n * 100 + 1e-6) / 100;
  const spread = down(extent * SPREAD_SHARE);
  // spread + 1.5·blur = extent  ⇒  blur = (extent − spread) / 1.5
  const blur = down((extent - spread) / BLUR_REACH);
  return { extent, spread, blur };
}

/** Utstrekningen (px) gløden kan lekke utenfor et kort i denne layouten — brukes til å gi plass i foreldre med overflow:hidden. */
export function glowBleed(size: ScreenSize): number {
  return glowParams(layoutGap(size)).extent;
}

// Egen variabel (styles.css), tidsstyrt lys/mørk: --swipe-glow (#BC6342 lys, #F0B49A mørk) — rolig fersken, ikke varselrødt.
// Styrken (dekningen) ligger i --swipe-glow-strength (også i styles.css), så den er lett å justere.
const GLOW_COLOR = 'color-mix(in srgb, var(--swipe-glow) var(--swipe-glow-strength), transparent)';
const GLOW_OFF = '0 0 0 0 transparent';

/** Stilen et sveipbart kort spres inn: `...swipeGlow(offset > 0, screenSize)`. */
export function swipeGlow(active: boolean, size: ScreenSize, reducedMotion: boolean = prefersReducedMotion()): React.CSSProperties {
  const { spread, blur } = glowParams(layoutGap(size));
  return {
    boxShadow: active ? `0 0 ${blur}px ${spread}px ${GLOW_COLOR}` : GLOW_OFF,
    // Myk inn-/utfading når kortet går fra/til dagens visning (også ved inaktivitets-nullstilling).
    transition: reducedMotion ? 'none' : 'box-shadow 280ms ease',
  };
}
