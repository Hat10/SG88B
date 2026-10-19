import type React from 'react';
import { m, AURORA_COLOR, AURORA_LABEL, type AuroraData, type ScreenSize } from './shared';

interface Props {
  aurora: AuroraData | null;
  auroraError: boolean;
  /** Klikk på kortet (åpner/lukker timegrafen). */
  onToggle: () => void;
  isMobile: boolean;
  screenSize: ScreenSize;
  cell: React.CSSProperties;
  eyebrow: React.CSSProperties;
}

// Nordlys — Kp-indeks fra NOAA kombinert med skydekke fra Yr/met.no for Bodø. Ren
// heuristikk, ikke et offisielt varsel — se api/nordlys.ts for poengmodellen.
export function NordlysCard({ aurora, auroraError, onToggle, isMobile, screenSize, cell, eyebrow }: Props) {
  return (
    <div
      onClick={onToggle}
      style={{
        ...cell, padding: isMobile ? m.pad : screenSize === 'tablet' ? '10px 12px' : screenSize === 'desktop' ? '20px 22px' : '16px 18px',
        display: 'flex', flexDirection: 'column', gap: isMobile ? 6 : screenSize === 'tablet' ? 6 : 12, cursor: 'default',
        // Eneste kort i tredje rad på mobil — full bredde i stedet for et tomt hull ved siden av.
        ...(isMobile ? { gridColumn: '1 / -1', minWidth: 0 } : {}),
      }}>
      <div style={eyebrow}>🌌 Nordlys · Bodø</div>

      {auroraError && (
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: isMobile ? m.mono : 13, color: 'var(--ink-4)' }}>Utilgjengelig akkurat nå</div>
      )}
      {!auroraError && !aurora && (
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: isMobile ? m.mono : 15, color: 'var(--ink-4)' }}>…</div>
      )}
      {!auroraError && aurora && (
        <>
          <div style={{ fontSize: isMobile ? m.title : screenSize === 'desktop' ? 22 : screenSize === 'tablet' ? 14 : 18, fontWeight: 600, letterSpacing: '-0.01em', color: AURORA_COLOR[aurora.probability] }}>
            {AURORA_LABEL[aurora.probability]}
          </div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: isMobile ? m.mono : 12, color: 'var(--ink-4)' }}>
            Kp {aurora.kp} · {aurora.cloudCover}% skydekke
          </div>
        </>
      )}
    </div>
  );
}
