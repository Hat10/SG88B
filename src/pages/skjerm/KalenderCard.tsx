import type React from 'react';
import { m, type AnyEvent, type ScreenSize } from './shared';

const SOURCE_LABEL: Record<string, string> = {
  andreas: 'Andreas', taran: 'Taran', felles: 'Felles', todo: 'Gjøremål',
};

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('no-NO', { hour: '2-digit', minute: '2-digit' });
}

interface Props {
  events: AnyEvent[];
  isMobile: boolean;
  isTablet: boolean;
  screenSize: ScreenSize;
  cell: React.CSSProperties;
  eyebrow: React.CSSProperties;
}

// Kalender — kun i dag, ikke kommende dager
export function KalenderCard({ events, isMobile, isTablet, screenSize, cell, eyebrow }: Props) {
  return (
    <div style={{ ...cell, minWidth: 0, ...(isTablet ? { minHeight: 0 } : {}), padding: isMobile ? m.pad : screenSize === 'tablet' ? '8px 10px' : screenSize === 'desktop' ? '20px 24px' : '16px 18px', display: 'flex', flexDirection: 'column', gap: isMobile ? 10 : screenSize === 'tablet' ? 6 : 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={eyebrow}>Kalender · i dag</div>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: isMobile ? m.tiny : 13, fontWeight: 700, color: 'var(--good)', letterSpacing: '0.06em' }}>● LIVE</div>
      </div>

      {events.length === 0 ? (
        <div style={{ padding: isMobile ? '16px 0' : '20px 0', textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: isMobile ? m.mono : 15, color: 'var(--ink-4)' }}>
          Ingen hendelser i dag
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', ...(isTablet ? { flex: 1, minHeight: 0, overflowY: 'auto', overscrollBehavior: 'contain', WebkitOverflowScrolling: 'touch' } : {}) }}>
          {events.map((e, i) => (
            <div key={e.id} style={{
              display: 'flex', alignItems: 'center', gap: isMobile ? m.rowGap : 14,
              padding: isMobile ? m.rowPad : '11px 10px',
              borderBottom: i < events.length - 1 ? '1px solid var(--line)' : '0',
              borderLeft: `3px solid ${e.color}`,
              background: 'rgba(120,120,120,0.08)',
              borderRadius: 4, marginBottom: 1,
            }}>
              {!e.allDay && (
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: isMobile ? m.mono : 15, fontWeight: 600, flexShrink: 0, color: 'var(--ink-3)' }}>
                  {fmtTime(e.start)}
                </span>
              )}
              <span style={{ flex: 1, minWidth: 0, fontSize: isMobile ? m.title : 18, fontWeight: 600, ...(isMobile ? { overflowWrap: 'anywhere' } : { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }) }}>
                {e.title}
              </span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: isMobile ? m.tiny : 13, fontWeight: 600, color: e.color, flexShrink: 1, minWidth: 0, maxWidth: '40%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {e.who ?? SOURCE_LABEL[e.source] ?? e.source}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
