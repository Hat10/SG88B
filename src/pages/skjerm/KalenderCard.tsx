import { useMemo } from 'react';
import type React from 'react';
import type { CalEvent } from '../../../api/kalender';
import { m, type AnyEvent, type ScreenSize } from './shared';
import { swipeGlow } from './swipeGlow';
import { PagerArrows } from './PagerArrows';
import { addDaysLocal } from '../../lib/dagensMiddag';
import { dayLabel } from '../../lib/dayLabel';
import { useSwipePager } from '../../lib/useSwipePager';

// I dag t.o.m. i dag + 13 dager (14 dager). Ingen bakover i tid.
const MAX_DAYS_AHEAD = 13;

const SOURCE_LABEL: Record<string, string> = {
  andreas: 'Andreas', taran: 'Taran', felles: 'Felles', todo: 'Gjøremål',
};

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('no-NO', { hour: '2-digit', minute: '2-digit' });
}

interface Props {
  calEvents: CalEvent[];
  /** yyyy-mm-dd, samme «i dag» som resten av Gangskjerm. */
  today: string;
  /** Fra useIdleReset: endres → kortet glir tilbake til i dag. */
  resetSignal: number;
  isMobile: boolean;
  isTablet: boolean;
  screenSize: ScreenSize;
  cell: React.CSSProperties;
  eyebrow: React.CSSProperties;
}

// Kalender — i dag som standard; sveip (eller ‹ ›) blar fremover t.o.m. +13 dager.
export function KalenderCard({ calEvents, today, resetSignal, isMobile, isTablet, screenSize, cell, eyebrow }: Props) {
  const pager = useSwipePager({ max: MAX_DAYS_AHEAD, resetSignal });
  const { offset } = pager;
  const date = addDaysLocal(today, offset);
  const isToday = offset === 0;

  const events: AnyEvent[] = useMemo(() => calEvents
    .map(e => ({ ...e, source: e.source as string, overdueSince: undefined as string | undefined }))
    .filter(e => e.start.slice(0, 10) === date)
    .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime()),
  [calEvents, date]);

  const gap = isMobile ? 10 : screenSize === 'tablet' ? 6 : 14;
  return (
    <div
      {...pager.containerProps}
      style={{
        ...cell, minWidth: 0, ...(isTablet ? { minHeight: 0 } : {}),
        padding: isMobile ? m.pad : screenSize === 'tablet' ? '8px 10px' : screenSize === 'desktop' ? '20px 24px' : '16px 18px',
        display: 'flex', flexDirection: 'column',
        // Glød (box-shadow) når en annen dag enn i dag vises — felles stil i swipeGlow.ts.
        ...swipeGlow(!isToday, screenSize),
        ...pager.containerProps.style,
      }}
    >
      {/* Det som glir. Ellers nøytral: fyller kortet og bærer gap'en kortet tidligere hadde selv. */}
      <div ref={pager.contentRef} style={{ flex: 1, minHeight: 0, minWidth: 0, display: 'flex', flexDirection: 'column', gap }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={eyebrow}>Kalender · {dayLabel(offset, date)}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 2 : 4 }}>
            <PagerArrows canPrev={pager.canPrev} canNext={pager.canNext} onPrev={pager.prev} onNext={pager.next} isMobile={isMobile} />
            {/* «LIVE» gir bare mening for i dag — og gir plass til dato-etiketten i smale kort. */}
            {isToday && (
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: isMobile ? m.tiny : 13, fontWeight: 700, color: 'var(--good)', letterSpacing: '0.06em', marginLeft: isMobile ? 4 : 6 }}>● LIVE</div>
            )}
          </div>
        </div>

        {events.length === 0 ? (
          <div key={date} style={{ padding: isMobile ? '16px 0' : '20px 0', textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: isMobile ? m.mono : 15, color: 'var(--ink-4)' }}>
            {isToday ? 'Ingen hendelser i dag' : 'Ingenting i kalenderen'}
          </div>
        ) : (
          <div key={date} style={{ display: 'flex', flexDirection: 'column', ...(isTablet ? { flex: 1, minHeight: 0, overflowY: 'auto', overscrollBehavior: 'contain', WebkitOverflowScrolling: 'touch', ...pager.scrollAreaStyle } : {}) }}>
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
    </div>
  );
}
