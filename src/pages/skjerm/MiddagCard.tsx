import type React from 'react';
import { m, type ScreenSize } from './shared';

interface Props {
  recipeName: string | undefined;
  mealDays: number;
  onOpen: () => void;
  isMobile: boolean;
  screenSize: ScreenSize;
  cell: React.CSSProperties;
  eyebrow: React.CSSProperties;
}

// Dagens middag — fra ukeplanen (Middag → Ukeplan). Kompakt, kun navn —
// trykk åpner en modal med full oppskrift (ingredienser/fremgangsmåte/koketid).
export function MiddagCard({ recipeName, mealDays, onOpen, isMobile, screenSize, cell, eyebrow }: Props) {
  return (
    <button
      onClick={onOpen}
      style={{
        ...cell, width: '100%', textAlign: 'left', font: 'inherit', color: 'inherit',
        cursor: recipeName ? 'pointer' : 'default',
        padding: isMobile ? m.pad : screenSize === 'tablet' ? '8px 12px' : screenSize === 'desktop' ? '14px 20px' : '12px 16px',
        display: 'flex', flexDirection: 'column', gap: isMobile ? 6 : screenSize === 'tablet' ? 3 : 4, ...(isMobile ? { minWidth: 0 } : {}),
      }}
    >
      <div style={eyebrow}>🍽️ Dagens middag</div>
      {recipeName ? (
        <div style={{ fontSize: isMobile ? m.title : screenSize === 'desktop' ? 20 : screenSize === 'tablet' ? 13 : 17, fontWeight: 600, color: 'var(--ink-2)', letterSpacing: '-0.01em', ...(isMobile ? { overflowWrap: 'anywhere' } : { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }) }}>
          {recipeName}
          {mealDays > 1 && (
            <span style={{ marginLeft: 8, fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 400, color: 'var(--ink-4)', letterSpacing: 0 }}>
              ×{mealDays} dager
            </span>
          )}
        </div>
      ) : (
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: isMobile ? m.mono : 13, color: 'var(--ink-4)' }}>Ingen middag planlagt i dag</div>
      )}
    </button>
  );
}
