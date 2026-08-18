import { useEffect, useRef } from 'react';

/**
 * Holder skjermen våken mens `active` er true (Handlemodus — man skal ikke
 * måtte låse opp telefonen på nytt for hver vare i butikken). Wake Lock-APIet
 * mangler støtte enkelte steder og kan avslå forespørselen (f.eks. lavt
 * batteri) — begge deler feiler stille her, siden dette kun er en bekvem-
 * melighet, ikke noe funksjonaliteten er avhengig av.
 *
 * visibilitychange-håndteringen er nødvendig fordi en wake lock automatisk
 * frigis av nettleseren når fanen skjules (bytter app, låser telefonen) — uten
 * dette ville skjermen forbli våken kun til FØRSTE gang brukeren forlot fanen.
 */
export function useWakeLock(active: boolean) {
  const sentinelRef = useRef<WakeLockSentinel | null>(null);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;

    const request = async () => {
      try {
        const sentinel = await navigator.wakeLock?.request('screen');
        if (!sentinel) return;
        if (cancelled) { void sentinel.release(); return; }
        sentinelRef.current = sentinel;
      } catch {
        // Ingen støtte, avslått av nettleseren, e.l. — hopp stille over.
      }
    };
    void request();

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible' && !sentinelRef.current) void request();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibilityChange);
      void sentinelRef.current?.release();
      sentinelRef.current = null;
    };
  }, [active]);
}
