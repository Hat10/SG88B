import { useEffect } from 'react';

/**
 * Locks body scroll while active. Works on iOS Safari (position:fixed trick)
 * and Android/desktop (overflow:hidden). Restores scroll position on cleanup.
 */
export function useScrollLock(active = true) {
  useEffect(() => {
    if (!active) return;
    const y = window.scrollY;
    const body = document.body;
    body.style.overflow = 'hidden';
    body.style.position = 'fixed';
    body.style.top = `-${y}px`;
    body.style.width = '100%';
    return () => {
      body.style.overflow = '';
      body.style.position = '';
      body.style.top = '';
      body.style.width = '';
      window.scrollTo(0, y);
    };
  }, [active]);
}
