import type React from 'react';
import { m, AURORA_COLOR, AURORA_LABEL, type AuroraData, type ScreenSize } from './shared';
import { PagerArrows } from './PagerArrows';
import { PagerDots } from './PagerDots';
import { dateLabel } from '../../lib/dayLabel';
import { useSwipePager } from '../../lib/useSwipePager';

interface Props {
  aurora: AuroraData | null;
  auroraError: boolean;
  /** Fra useIdleReset: endres → kortet glir tilbake til «nå». */
  resetSignal: number;
  /** Klikk på kortet. 0 = «nå» (20-timers-grafen), 1–2 = grafen for den natten. */
  onToggle: (offset: number) => void;
  isMobile: boolean;
  screenSize: ScreenSize;
  cell: React.CSSProperties;
  eyebrow: React.CSSProperties;
}

/** Klokkeslett (Oslo) for en ISO-tid, f.eks. «22:00». */
const osloClock = (iso: string) =>
  new Date(iso).toLocaleTimeString('nb-NO', { timeZone: 'Europe/Oslo', hour: '2-digit', minute: '2-digit' });

// Nordlys — Kp-indeks fra NOAA kombinert med skydekke fra Yr/met.no for Bodø. Ren
// heuristikk, ikke et offisielt varsel — se api/nordlys.ts for poengmodellen.
// Offset 0 = nå-verdiene (som alltid); offset 1–2 = beste mørke time i morgen kveld /
// overmorgen kveld (`aurora.daily`). Sveip (eller ‹ ›) blar.
export function NordlysCard({ aurora, auroraError, resetSignal, onToggle, isMobile, screenSize, cell, eyebrow }: Props) {
  const daily = aurora?.daily ?? [];
  const multi = !auroraError && daily.length >= 2;
  const pager = useSwipePager({ max: Math.max(0, daily.length - 1), resetSignal, disabled: !multi });
  const offset = multi ? Math.min(pager.offset, daily.length - 1) : 0;
  const night = offset > 0 ? daily[offset] : null;
  const gap = isMobile ? 6 : screenSize === 'tablet' ? 6 : 12;

  const headline: React.CSSProperties = {
    fontSize: isMobile ? m.title : screenSize === 'desktop' ? 22 : screenSize === 'tablet' ? 14 : 18,
    fontWeight: 600, letterSpacing: '-0.01em',
  };
  const detail: React.CSSProperties = { fontFamily: 'var(--font-mono)', fontSize: isMobile ? m.mono : 12, color: 'var(--ink-4)' };

  // Overskrift + detaljlinje for en natt (offset 1–2).
  const nightText = (() => {
    if (!night) return null;
    if (night.status === 'tooLight') return { color: 'var(--ink-4)', title: 'For lyst for nordlys', line: 'Ingen mørke timer denne natten' };
    if (night.status === 'incomplete') return { color: 'var(--ink-4)', title: 'Usikkert varsel', line: 'For lite data for denne natten' };
    const b = night.best;
    if (!b) return { color: 'var(--ink-4)', title: 'Usikkert varsel', line: 'For lite data for denne natten' };
    return {
      color: AURORA_COLOR[b.chance], title: AURORA_LABEL[b.chance],
      line: `Kp ${Math.round(b.kp * 10) / 10} · best ca. ${osloClock(b.time)} · ${b.cloudCover} % skyer`,
    };
  })();

  const label = night ? (offset === 1 ? 'I morgen' : dateLabel(night.date)) : null;

  return (
    <div
      {...(multi ? pager.containerProps : {})}
      onClick={() => onToggle(offset)}
      style={{
        ...cell, padding: isMobile ? m.pad : screenSize === 'tablet' ? '10px 12px' : screenSize === 'desktop' ? '20px 22px' : '16px 18px',
        display: 'flex', flexDirection: 'column', cursor: 'default',
        // Eneste kort i tredje rad på mobil — full bredde i stedet for et tomt hull ved siden av.
        ...(isMobile ? { gridColumn: '1 / -1', minWidth: 0 } : {}),
        // Prikkene ligger absolutt nederst i kortets padding og gjør det ikke høyere.
        ...(multi ? { position: 'relative' } : {}),
        // Svak aksent på rammen når en annen natt enn «nå» vises (som Kalender/Middag/Nedtelling).
        ...(multi && offset > 0 ? { border: '1px solid color-mix(in srgb, var(--accent) 55%, var(--line))' } : {}),
        ...(multi ? pager.containerProps.style : {}),
      }}>
      {/* Det som glir. Ellers nøytral: bærer gap'en kortet tidligere hadde selv. */}
      <div ref={pager.contentRef} style={{ flex: 1, minHeight: 0, minWidth: 0, display: 'flex', flexDirection: 'column', gap }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4 }}>
          <div style={night ? { ...eyebrow, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } : eyebrow}>
            🌌 Nordlys · {label ?? 'Bodø'}
          </div>
          {/* Som de andre sveipbare kortene: ingen piler på mobil — der sveipes det. */}
          {multi && !isMobile && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
              <PagerArrows canPrev={pager.canPrev} canNext={pager.canNext} onPrev={pager.prev} onNext={pager.next} isMobile={isMobile} />
            </div>
          )}
        </div>

        {night && nightText ? (
          <>
            <div style={{ ...headline, color: nightText.color }}>{nightText.title}</div>
            <div style={{ ...detail, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{nightText.line}</div>
          </>
        ) : (
          <>
            {auroraError && (
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: isMobile ? m.mono : 13, color: 'var(--ink-4)' }}>Utilgjengelig akkurat nå</div>
            )}
            {!auroraError && !aurora && (
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: isMobile ? m.mono : 15, color: 'var(--ink-4)' }}>…</div>
            )}
            {!auroraError && aurora && (
              <>
                <div style={{ ...headline, color: AURORA_COLOR[aurora.probability] }}>
                  {AURORA_LABEL[aurora.probability]}
                </div>
                <div style={detail}>
                  Kp {aurora.kp} · {aurora.cloudCover}% skydekke
                </div>
              </>
            )}
          </>
        )}
      </div>

      {multi && <PagerDots count={daily.length} index={offset} />}
    </div>
  );
}
