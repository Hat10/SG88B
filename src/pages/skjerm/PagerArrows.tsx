import type React from 'react';
import { m } from './shared';

interface Props {
  canPrev: boolean;
  canNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  isMobile: boolean;
}

/**
 * ‹ › i etikettlinjen til et sveipbart kort (se useSwipePager). Negativ vertikal
 * marg så pilene aldri gjør linjen høyere. `data-no-swipe` + stopPropagation:
 * et trykk på pilene skal verken starte et sveip eller utløse kortets egen onClick.
 */
export function PagerArrows({ canPrev, canNext, onPrev, onNext, isMobile }: Props) {
  const arrow = (enabled: boolean): React.CSSProperties => ({
    background: 'transparent', border: 0, padding: '0 6px', height: 24, marginBlock: -8,
    lineHeight: '24px', fontSize: isMobile ? m.title : 20, color: 'var(--ink-4)',
    cursor: enabled ? 'pointer' : 'default', opacity: enabled ? 1 : 0.25,
  });
  return (
    <>
      <button data-no-swipe aria-label="Forrige dag" disabled={!canPrev} onClick={e => { e.stopPropagation(); onPrev(); }} style={arrow(canPrev)}>‹</button>
      <button data-no-swipe aria-label="Neste dag" disabled={!canNext} onClick={e => { e.stopPropagation(); onNext(); }} style={arrow(canNext)}>›</button>
    </>
  );
}
