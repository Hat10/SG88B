import type React from 'react';
import { m } from './shared';

interface Props {
  canPrev: boolean;
  canNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  isMobile: boolean;
  /** aria-label for ‹ og › (default «Forrige dag» / «Neste dag»). */
  labels?: [string, string];
  /** I en popup: større trykkflate og lys farge på mørk bakgrunn. */
  popup?: boolean;
}

/**
 * ‹ › i etikettlinjen til et sveipbart kort (se useSwipePager). Negativ vertikal
 * marg så pilene aldri gjør linjen høyere. `data-no-swipe` + stopPropagation:
 * et trykk på pilene skal verken starte et sveip eller utløse kortets egen onClick.
 */
export function PagerArrows({ canPrev, canNext, onPrev, onNext, isMobile, labels = ['Forrige dag', 'Neste dag'], popup = false }: Props) {
  const arrow = (enabled: boolean): React.CSSProperties => popup ? {
    background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 6,
    width: 44, height: 36, padding: 0, fontSize: 24, lineHeight: '32px', color: 'rgba(207,224,239,0.75)',
    cursor: enabled ? 'pointer' : 'default', opacity: enabled ? 1 : 0.3,
  } : {
    background: 'transparent', border: 0, padding: '0 6px', height: 24, marginBlock: -8,
    lineHeight: '24px', fontSize: isMobile ? m.title : 20, color: 'var(--ink-4)',
    cursor: enabled ? 'pointer' : 'default', opacity: enabled ? 1 : 0.25,
  };
  return (
    <>
      <button data-no-swipe aria-label={labels[0]} disabled={!canPrev} onClick={e => { e.stopPropagation(); onPrev(); }} style={arrow(canPrev)}>‹</button>
      <button data-no-swipe aria-label={labels[1]} disabled={!canNext} onClick={e => { e.stopPropagation(); onNext(); }} style={arrow(canNext)}>›</button>
    </>
  );
}
