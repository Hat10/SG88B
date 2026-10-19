import { useEffect, useRef, useState } from 'react';
import { idleRemaining } from './swipePager';

const ACTIVITY_EVENTS = ['pointerdown', 'pointermove', 'pointerup', 'touchstart', 'touchmove', 'wheel', 'keydown'] as const;

/**
 * Inaktivitetsteller for hele siden. Returnerer et tall som økes med 1 hver
 * gang `timeoutMs` har gått uten berøring/scroll/tastetrykk NOE sted på siden
 * — kort som skal hoppe tilbake til utgangsstillingen (useSwipePager) tar
 * tallet som `resetSignal`.
 *
 * Bevisst billig: ingen state-oppdatering ved aktivitet (kun et tidsstempel i
 * en ref), og kun ÉN setTimeout om gangen som sjekker forløpt tid når den
 * utløper og re-armer seg selv for resten hvis det har vært aktivitet i
 * mellomtiden. Eneste render er selve utløpet — ikke 1 Hz-tikket til `now`.
 *
 * `paused`: telleren står stille mens true (popup/modal/redigering åpen), og
 * starter på nytt med full tid når den blir false igjen.
 */
export function useIdleReset({ timeoutMs = 10_000, paused = false }: { timeoutMs?: number; paused?: boolean } = {}): number {
  const [tick, setTick] = useState(0);
  const lastActivity = useRef(Date.now());
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (paused) return;
    lastActivity.current = Date.now();

    const arm = (ms: number) => {
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(check, ms);
    };
    const check = () => {
      const left = idleRemaining(Date.now(), lastActivity.current, timeoutMs);
      if (left > 0) { arm(left); return; }
      timer.current = undefined;
      setTick(t => t + 1);
    };
    const onActivity = () => {
      lastActivity.current = Date.now();
      // Etter et utløp står ingen timer — første berøring starter neste periode.
      if (timer.current === undefined) arm(timeoutMs);
    };

    arm(timeoutMs);
    for (const ev of ACTIVITY_EVENTS) window.addEventListener(ev, onActivity, { passive: true, capture: true });
    // scroll bobler ikke — capture fanger også scroll i indre lister.
    window.addEventListener('scroll', onActivity, { passive: true, capture: true });
    return () => {
      window.clearTimeout(timer.current);
      timer.current = undefined;
      for (const ev of ACTIVITY_EVENTS) window.removeEventListener(ev, onActivity, { capture: true });
      window.removeEventListener('scroll', onActivity, { capture: true });
    };
  }, [paused, timeoutMs]);

  return tick;
}
