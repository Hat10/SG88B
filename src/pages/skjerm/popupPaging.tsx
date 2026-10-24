import { useLayoutEffect, useRef } from 'react';
import type React from 'react';
import { PagerDots } from './PagerDots';

// Felles byggeklosser for popupene på Gangskjerm som blar mellom dager/nedtellinger
// sammen med kortet bak (se Skjerm.tsx og useSwipePager).

/**
 * Stabil popup-høyde mens man blar: popupen kan vokse (en lengre oppskrift), men krymper
 * ikke tilbake når man blar videre — så den ikke hopper opp og ned. Gjelder bare så lenge
 * popupen er åpen, og alltid innenfor popupens egen max-height (målt høyde kan aldri bli
 * større enn den). Ny bredde (rotasjon) nullstiller, siden max-height da kan ha endret seg,
 * og det gjør også en ny `resetKey` (f.eks. inn/ut av redigeringsmodus).
 */
export function useGrowOnlyHeight<T extends HTMLElement>(resetKey?: unknown) {
  const ref = useRef<T>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    let maxH = 0;
    const measure = () => {
      const h = el.getBoundingClientRect().height;
      if (h > maxH + 0.5) { maxH = h; el.style.minHeight = `${h}px`; }
    };
    const reset = () => { maxH = 0; el.style.minHeight = ''; measure(); };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    let lastW = window.innerWidth;
    const onResize = () => { if (window.innerWidth !== lastW) { lastW = window.innerWidth; reset(); } };
    window.addEventListener('resize', onResize);
    return () => { ro.disconnect(); window.removeEventListener('resize', onResize); el.style.minHeight = ''; };
  }, [resetKey]);
  return ref;
}

/** Lys-på-mørk knappestil, samme som ✕-knappen i popupene. Litt mindre på mobil. */
const navButton = (enabled: boolean, isMobile: boolean): React.CSSProperties => ({
  flex: '1 1 0', maxWidth: isMobile ? 170 : 240, minHeight: isMobile ? 40 : 48, padding: isMobile ? '8px 10px' : '10px 14px',
  background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8,
  color: '#E8EFF7', fontFamily: 'var(--font-mono)', fontSize: isMobile ? 13 : 15, fontWeight: 600, letterSpacing: '0.02em',
  cursor: enabled ? 'pointer' : 'default', opacity: enabled ? 1 : 0.3,
  touchAction: 'manipulation',
});

/**
 * «‹ Forrige dag» · prikker · «Neste dag ›» under grafen i vær- og nordlys-popupen.
 * Knapper i stedet for sveip, så trykk-og-dra på grafen fortsatt viser verdier.
 */
export function PopupDayNav({ index, count, onPrev, onNext, prevLabel, nextLabel, isMobile }: {
  index: number; count: number; onPrev: () => void; onNext: () => void;
  prevLabel: string; nextLabel: string; isMobile: boolean;
}) {
  const canPrev = index > 0, canNext = index < count - 1;
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: isMobile ? 8 : 12 }}>
      <button type="button" disabled={!canPrev} onClick={onPrev} style={navButton(canPrev, isMobile)}>‹ {prevLabel}</button>
      <PagerDots count={count} index={index} popup />
      <button type="button" disabled={!canNext} onClick={onNext} style={navButton(canNext, isMobile)}>{nextLabel} ›</button>
    </div>
  );
}

/**
 * Rolig melding der grafen ellers står (natt/dag uten timesdata). Samme høyde som grafen
 * (samme sideforhold som viewBox-en, eller grafens høyde ved minWidth 560 på mobil), så
 * popupen ikke endrer størrelse.
 */
export function ChartPlaceholder({ text, viewW, viewH, isMobile }: { text: string; viewW: number; viewH: number; isMobile: boolean }) {
  return (
    <div style={{
      ...(isMobile ? { height: Math.round(560 * viewH / viewW) } : { aspectRatio: `${viewW} / ${viewH}` }),
      display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: 16,
      border: '1px dashed rgba(255,255,255,0.1)', borderRadius: 8,
      fontFamily: 'var(--font-mono)', fontSize: 14, color: 'rgba(207,224,239,0.45)', lineHeight: 1.5,
    }}>
      {text}
    </div>
  );
}
