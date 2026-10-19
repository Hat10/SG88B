import { useEffect, useRef, useState } from 'react';
import { shouldIgnoreViewportResize } from '../../lib/keyboardViewport';

export type SkjermScreenSize = 'mobile' | 'tablet' | 'desktop';

const sizeOf = (w: number): SkjermScreenSize => (w < 700 ? 'mobile' : w < 1400 ? 'tablet' : 'desktop');

/**
 * Bredde, synlig høyde og skjermstørrelse for Gangskjerm.
 *
 * iOS Safari's window.innerHeight/100vh includes space hidden behind the address bar.
 * visualViewport.height tracks what's actually visible right now, so it survives the
 * toolbar showing/hiding without a layout jump — more reliable across iPadOS versions
 * than the 100dvh unit alone.
 *
 * `freezeHeight`: mens en hurtig-popup med tekstfelt er åpen kommer skjermtastaturet opp og
 * visualViewport.height krymper — det er IKKE en størrelsesendring og skal ikke få layouten bak
 * (rot-containeren har height = viewportH) til å beregnes på nytt. Høyde-endringer ignoreres
 * derfor så lenge popupen er åpen; rotasjon/ekte resize (bredden endres) tas fortsatt imot.
 */
export function useSkjermViewport(freezeHeight: boolean) {
  const [winW, setWinW] = useState(() => window.innerWidth);
  const [viewportH, setViewportH] = useState(() => window.visualViewport?.height ?? window.innerHeight);
  const [screenSize, setScreenSize] = useState<SkjermScreenSize>(() => sizeOf(window.innerWidth));

  const freezeRef = useRef(freezeHeight);
  freezeRef.current = freezeHeight;
  const lastW = useRef(window.innerWidth);

  useEffect(() => {
    const handleResize = () => {
      const w = window.innerWidth;
      const widthChanged = w !== lastW.current;
      if (shouldIgnoreViewportResize({ popupOpen: freezeRef.current, widthChanged })) return;
      lastW.current = w;
      setWinW(w);
      // Rotasjon mens popupen (og dermed tastaturet) er åpen: visualViewport.height er da redusert av
      // tastaturet, men layout-høyden (innerHeight) er ikke det.
      setViewportH(freezeRef.current ? window.innerHeight : (window.visualViewport?.height ?? window.innerHeight));
      setScreenSize(sizeOf(w));  // iPad Pro 12.9" (portrait 1024 / landscape 1366) stays tablet; only 1400px+ is desktop
    };
    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', handleResize);
    window.visualViewport?.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('orientationchange', handleResize);
      window.visualViewport?.removeEventListener('resize', handleResize);
    };
  }, []);

  return { winW, viewportH, screenSize };
}
