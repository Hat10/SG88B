import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { clampOffset, dragTranslate, resolveAxis, settleTarget, SWIPE_LOCK_PX } from './swipePager';

const SLIDE_MS = 200;
/** Glidestrekk utover kortbredden, så innholdet også forlater kortets padding. */
const SLIDE_PAD = 32;
const SLIDE_EASING = 'cubic-bezier(0.2, 0.8, 0.2, 1)';
/** Rett etter et sveip svelges klikk så de ikke treffer elementer under fingeren. */
const CLICK_SUPPRESS_MS = 350;

export const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

export interface SwipePagerOptions {
  /** Laveste offset (default 0 = i dag). */
  min?: number;
  /** Høyeste offset, f.eks. 13 = i dag + 13 dager. */
  max: number;
  /** Økes av useIdleReset; når verdien endres glir kortet tilbake til `min`. */
  resetSignal?: number;
  /** true → ingen sveip (f.eks. under redigering, eller når det bare finnes én side). */
  disabled?: boolean;
  /** Berøring som starter på treff mot denne selektoren starter ikke et sveip. */
  ignoreSelector?: string;
  /** Startside (default `min`), f.eks. dagen kortet viste da en popup ble åpnet. */
  initialOffset?: number;
  /** Kalles straks en bladning starter (før glidningen), med ny offset — for å holde et annet pager-kort i takt. */
  onNavigate?: (offset: number) => void;
}

/** Styring utenfra av et kort sin pager (popupen blar kortet bak seg, og nullstiller det ved lukking). */
export interface PagerHandle {
  goTo: (offset: number) => void;
}

/**
 * Sveip mellom «sider» (dager) i ett kort, med egen offset per kort.
 *
 *   const pager = useSwipePager({ max: 13, resetSignal });
 *   <div {...pager.containerProps} style={{ ...cardStyle, ...pager.containerProps.style }}>
 *     <div ref={pager.contentRef} style={…}>   // ← det som glir; ingen transform når det står stille
 *       … innhold for dag `pager.offset` …
 *       <ul style={{ overflowY: 'auto', ...pager.scrollAreaStyle }}>  // indre scroll-lister
 *     </div>
 *   </div>
 *
 * - `offset`: 0 = i dag. `goTo/next/prev` animerer (pil-knapper, tastatur osv.).
 * - `containerProps`: Pointer Events + `touch-action: pan-y` (vertikal scroll
 *   går til nettleseren) + `data-swipe-pager` (App.tsx sin sidemeny-sveip
 *   hopper over berøring som starter her).
 * - Horisontal bevegelse > SWIPE_LOCK_PX = sveip; innholdet følger fingeren,
 *   gummistrikk forbi første/siste side, glir på plass ved slipp. Et sveip
 *   utløser aldri klikk. prefers-reduced-motion: bytter side uten animasjon.
 * - Logikken (terskler, retningsvalg, klemming) ligger i swipePager.ts.
 */
export function useSwipePager({
  min = 0, max, resetSignal, disabled = false, ignoreSelector = 'input,select,textarea,[data-no-swipe]',
  initialOffset, onNavigate,
}: SwipePagerOptions) {
  const [offset, setOffset] = useState(() => clampOffset(initialOffset ?? min, min, max));
  const offsetRef = useRef(offset);
  const contentRef = useRef<HTMLDivElement>(null);

  const drag = useRef<{
    id: number; x0: number; y0: number; axis: 'x' | 'y' | null;
    lastX: number; lastT: number; vel: number; width: number;
  } | null>(null);
  const timers = useRef<number[]>([]);
  const enterDir = useRef<0 | 1 | -1>(0);
  const suppressUntil = useRef(0);
  const onNavigateRef = useRef(onNavigate);
  onNavigateRef.current = onNavigate;

  const later = (fn: () => void, ms: number) => { timers.current.push(window.setTimeout(fn, ms)); };
  const cancelTimers = () => { timers.current.forEach(window.clearTimeout); timers.current = []; };
  useEffect(() => () => cancelTimers(), []);

  const place = (el: HTMLElement, px: number, ms: number) => {
    el.style.transition = ms > 0 ? `transform ${ms}ms ${SLIDE_EASING}` : 'none';
    el.style.transform = `translateX(${px}px)`;
  };
  const clear = (el: HTMLElement | null) => { if (el) { el.style.transition = ''; el.style.transform = ''; } };
  const commit = (to: number) => { offsetRef.current = to; setOffset(to); };

  const goTo = useCallback((target: number, fromDx = 0) => {
    const el = contentRef.current;
    const cur = offsetRef.current;
    const to = clampOffset(target, min, max);
    cancelTimers();
    enterDir.current = 0;
    const animate = !!el && el.offsetWidth > 0 && !prefersReducedMotion();

    if (to === cur) { // gli tilbake etter et drag som ikke bladde
      if (el && animate && fromDx !== 0) {
        place(el, 0, SLIDE_MS);
        later(() => clear(el), SLIDE_MS + 30);
      } else clear(el);
      return;
    }
    onNavigateRef.current?.(to);
    if (!el || !animate) { clear(el); commit(to); return; }

    // Ut på den ene siden, bytt innhold, inn fra den andre (se useLayoutEffect under).
    const dir = to > cur ? 1 : -1;
    place(el, -dir * (el.offsetWidth + SLIDE_PAD), SLIDE_MS);
    later(() => { enterDir.current = dir; commit(to); }, SLIDE_MS);
  }, [min, max]);

  // Kjører før paint etter at nytt innhold er rendret: plasser det utenfor
  // på motsatt side og glid det inn. Uten innsvinget (enterDir 0) er dette en no-op.
  useLayoutEffect(() => {
    const dir = enterDir.current;
    enterDir.current = 0;
    const el = contentRef.current;
    if (!dir || !el) return;
    place(el, dir * (el.offsetWidth + SLIDE_PAD), 0);
    void el.offsetWidth; // tving reflow så overgangen starter fra utgangsstillingen
    place(el, 0, SLIDE_MS);
    later(() => clear(el), SLIDE_MS + 30);
  }, [offset]);

  const lastSignal = useRef(resetSignal);
  useEffect(() => {
    if (resetSignal === lastSignal.current) return;
    lastSignal.current = resetSignal;
    if (offsetRef.current !== min) goTo(min);
  }, [resetSignal, goTo, min]);

  const onPointerDown = (e: React.PointerEvent<HTMLElement>) => {
    if (disabled || drag.current) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (ignoreSelector && (e.target as Element).closest?.(ignoreSelector)) return;
    const el = contentRef.current;
    // Midt i en glidning: la den bli ferdig i stedet for å starte et nytt drag oppå.
    if (el && (el.style.transform !== '')) return;
    drag.current = {
      id: e.pointerId, x0: e.clientX, y0: e.clientY, axis: null,
      lastX: e.clientX, lastT: e.timeStamp, vel: 0, width: el?.offsetWidth ?? 0,
    };
  };

  const onPointerMove = (e: React.PointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.id) return;
    const dx = e.clientX - d.x0, dy = e.clientY - d.y0;
    if (d.axis === null) {
      const axis = resolveAxis(dx, dy);
      if (axis === null) return;
      if (axis === 'y') { drag.current = null; return; } // vanlig scroll
      d.axis = 'x';
      d.x0 += Math.sign(dx) * SWIPE_LOCK_PX; // unngå et hopp på terskelen når draget tar over
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* ikke kritisk */ }
      e.currentTarget.style.userSelect = 'none';
    }
    const dtx = e.clientX - d.x0;
    const dt = e.timeStamp - d.lastT;
    if (dt > 0) d.vel = 0.7 * ((e.clientX - d.lastX) / dt) + 0.3 * d.vel;
    d.lastX = e.clientX; d.lastT = e.timeStamp;
    const el = contentRef.current;
    if (el) place(el, dragTranslate(dtx, offsetRef.current, min, max, d.width), 0);
  };

  const finish = (e: React.PointerEvent<HTMLElement>, cancelled: boolean) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.id) return;
    drag.current = null;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    e.currentTarget.style.userSelect = '';
    if (d.axis !== 'x') return; // vanlig trykk — la klikket gå sin vei
    suppressUntil.current = performance.now() + CLICK_SUPPRESS_MS;
    const dx = e.clientX - d.x0;
    const stale = e.timeStamp - d.lastT > 80; // fingeren sto stille før slipp = ingen flikk
    const target = cancelled ? offsetRef.current : settleTarget({
      dx, velocity: stale ? 0 : d.vel, width: d.width, offset: offsetRef.current, min, max,
    });
    goTo(target, dx || 1);
  };

  const onClickCapture = (e: React.MouseEvent<HTMLElement>) => {
    if (performance.now() < suppressUntil.current) {
      suppressUntil.current = 0;
      e.preventDefault();
      e.stopPropagation();
    }
  };

  return {
    offset,
    goTo,
    next: () => goTo(offsetRef.current + 1),
    prev: () => goTo(offsetRef.current - 1),
    canPrev: offset > min,
    canNext: offset < max,
    contentRef,
    /**
     * Spres på hver indre scroll-container (overflow: auto/scroll) i kortet.
     * touch-action arves bare opp til nærmeste scroll-container, så uten denne
     * gjelder ikke kortets pan-y inne i en scrollbar liste, og nettleseren tar
     * horisontale drag der i stedet for å gi dem til sveipet.
     */
    scrollAreaStyle: { touchAction: 'pan-y' } as React.CSSProperties,
    containerProps: {
      onPointerDown,
      onPointerMove,
      onPointerUp: (e: React.PointerEvent<HTMLElement>) => finish(e, false),
      onPointerCancel: (e: React.PointerEvent<HTMLElement>) => finish(e, true),
      onClickCapture,
      'data-swipe-pager': '',
      style: { touchAction: 'pan-y' } as React.CSSProperties,
    },
  };
}
