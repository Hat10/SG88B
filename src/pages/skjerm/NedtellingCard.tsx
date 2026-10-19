import { useEffect } from 'react';
import type React from 'react';
import { m, type ScreenSize } from './shared';
import { PagerArrows } from './PagerArrows';
import { PagerDots } from './PagerDots';
import type { Countdown } from '../../hooks/useCountdown';
import { clampIndex, daysBetween } from '../../lib/countdowns';
import { useSwipePager } from '../../lib/useSwipePager';

/** Over dette antallet vises «2/9» i stedet for prikker. */
const MAX_DOTS = 6;

interface Props {
  /** Kommende nedtellinger, nærmest først (upcomingCountdowns). */
  countdowns: Countdown[];
  /** Dagens Oslo-dato, yyyy-mm-dd. */
  today: string;
  /** Fra useIdleReset: endres → kortet glir tilbake til nærmeste nedtelling. */
  resetSignal: number;
  loading: boolean;
  editing: boolean;
  draft: { label: string; date: string };
  setDraft: React.Dispatch<React.SetStateAction<{ label: string; date: string }>>;
  /** ✎: åpne/lukk redigering av den VISTE nedtellingen. */
  onToggleEdit: (cd: Countdown) => void;
  /** «+ Legg til nedtelling» (kun når listen er tom). */
  onAdd: () => void;
  onSave: () => void;
  onCancel: () => void;
  /** ×: fjern den VISTE nedtellingen. */
  onRemove: (cd: Countdown) => void;
  /** Nylig lagret endring: følg denne nedtellingen til den nye plassen i lista. */
  follow: { id: string; date: string } | null;
  onFollowed: () => void;
  isMobile: boolean;
  screenSize: ScreenSize;
  cell: React.CSSProperties;
  eyebrow: React.CSSProperties;
}

// Nedtelling — nærmeste først; sveip (eller ‹ ›) blar til neste kommende nedtelling.
// Med 0–1 nedtellinger er sveipet av og kortet ser ut som det alltid har gjort.
export function NedtellingCard({
  countdowns, today, resetSignal, loading, editing, draft, setDraft,
  onToggleEdit, onAdd, onSave, onCancel, onRemove, follow, onFollowed,
  isMobile, screenSize, cell, eyebrow,
}: Props) {
  const n = countdowns.length;
  const multi = n >= 2;
  const maxIdx = Math.max(0, n - 1);
  const pager = useSwipePager({ max: maxIdx, resetSignal, disabled: !multi || editing });
  const { offset, goTo } = pager;

  // Listen endres (realtime, sletting, redigering): hold indeksen gyldig.
  useEffect(() => {
    if (offset !== clampIndex(offset, n)) goTo(clampIndex(offset, n));
  }, [offset, n, goTo]);

  // Etter at en redigering er lagret flytter nedtellingen seg kanskje i lista — følg den.
  useEffect(() => {
    if (!follow) return;
    const idx = countdowns.findIndex(c => c.id === follow.id && c.date === follow.date);
    if (idx < 0) return;
    if (idx !== offset) goTo(idx);
    onFollowed();
  }, [follow, countdowns, offset, goTo, onFollowed]);

  const cd = countdowns[clampIndex(offset, n)] ?? null;
  const cdDays = cd ? daysBetween(today, cd.date) : 0;
  const isFirst = offset === 0;
  const gap = isMobile ? 8 : screenSize === 'tablet' ? 6 : 12;

  const btn: React.CSSProperties = { background: 'transparent', border: 0, cursor: 'pointer', color: 'var(--ink-4)', fontSize: isMobile ? m.body : 16, padding: '2px 4px', lineHeight: 1 };

  // Tittel på mobil: ved flere nedtellinger maks 2 linjer med ellipse, og plassen til
  // 2 linjer er reservert (usynlig strut) så kortet er like høyt uansett tittel.
  const mobileTitle: React.CSSProperties = { fontSize: m.body, fontWeight: 400, lineHeight: 1.3, overflowWrap: 'anywhere' };
  // Tablet/desktop: tittelen er én linje med ellipse ved flere nedtellinger.
  const wideTitle: React.CSSProperties = {
    fontSize: screenSize === 'tablet' ? 16 : 20, fontWeight: 600, letterSpacing: '-0.01em', color: 'var(--ink-2)',
    ...(multi ? { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } : {}),
  };

  return (
    <div
      {...(multi ? pager.containerProps : {})}
      style={{
        ...cell, ...(isMobile ? { minWidth: 0 } : {}),
        padding: isMobile ? m.pad : screenSize === 'tablet' ? '10px 12px' : screenSize === 'desktop' ? '20px 22px' : '16px 18px',
        display: 'flex', flexDirection: 'column',
        // Prikkene/telleren ligger absolutt nederst i kortets padding og gjør det ikke høyere.
        ...(multi ? { position: 'relative' } : {}),
        // Svak aksent på rammen når en annen enn den nærmeste vises (som Kalender/Middag).
        ...(multi && !isFirst ? { border: '1px solid color-mix(in srgb, var(--accent) 55%, var(--line))' } : {}),
        ...(multi ? pager.containerProps.style : {}),
      }}
    >
      {/* Det som glir. Ellers nøytral: bærer gap'en kortet tidligere hadde selv. */}
      <div ref={pager.contentRef} style={{ flex: 1, minHeight: 0, minWidth: 0, display: 'flex', flexDirection: 'column', gap }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={eyebrow}>Nedtelling</div>
          {cd && (
            <div style={{ display: 'flex', gap: 2 }}>
              {/* Ikke plass til piler i de smale 2-kolonne-kortene på mobil — der sveipes det. */}
              {multi && !isMobile && !editing && (
                <PagerArrows canPrev={pager.canPrev} canNext={pager.canNext} onPrev={pager.prev} onNext={pager.next} isMobile={isMobile} />
              )}
              <button onClick={() => onToggleEdit(cd)} aria-label="Rediger nedtelling" style={btn}>✎</button>
              <button onClick={() => onRemove(cd)} aria-label="Fjern nedtelling" style={btn}>×</button>
            </div>
          )}
        </div>

        {loading ? (
          <div style={{ height: isMobile ? 64 : screenSize === 'tablet' ? 60 : 80 }} />
        ) : !editing ? (
          cd && isMobile ? (
            <>
              {multi ? (
                <div style={{ display: 'grid' }}>
                  <div style={{ gridArea: '1 / 1', minWidth: 0, ...mobileTitle, color: 'var(--ink-2)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{cd.label}</div>
                  <div aria-hidden style={{ gridArea: '1 / 1', visibility: 'hidden', pointerEvents: 'none', ...mobileTitle }}>X<br />X</div>
                </div>
              ) : (
                <div style={{ ...mobileTitle, color: 'var(--ink-2)' }}>{cd.label}</div>
              )}
              <div style={{ fontSize: m.bigNum, fontWeight: 400, letterSpacing: '-0.04em', lineHeight: 0.9, fontVariantNumeric: 'tabular-nums' }}>
                {Math.max(0, cdDays)}
              </div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: m.mono, color: 'var(--ink-4)' }}>
                {cdDays <= 0 ? 'i dag!' : cdDays === 1 ? 'dag · i morgen' : 'dager'} · {new Date(cd.date + 'T12:00:00').toLocaleDateString('nb-NO', { day: 'numeric', month: 'long', year: 'numeric' })}
              </div>
            </>
          ) : cd ? (
            <>
              <div style={wideTitle}>{cd.label}</div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: screenSize === 'tablet' ? 6 : 8 }}>
                <span style={{ fontSize: screenSize === 'desktop' ? 80 : screenSize === 'tablet' ? 28 : 56, fontWeight: 300, letterSpacing: '-0.04em', lineHeight: 0.9, fontVariantNumeric: 'tabular-nums' }}>
                  {Math.max(0, cdDays)}
                </span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 18, fontWeight: 600, color: 'var(--ink-3)' }}>
                  {cdDays <= 0 ? '🎉' : 'dager'}
                </span>
              </div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 15, color: 'var(--ink-3)' }}>
                {new Date(cd.date).toLocaleDateString('nb-NO', { day: 'numeric', month: 'long', year: 'numeric' })}
              </div>
            </>
          ) : (
            <button
              onClick={onAdd}
              style={{
                background: 'transparent', cursor: 'pointer', textAlign: 'left',
                border: '1px dashed var(--ink-4)', borderRadius: 6, padding: '10px 12px',
                color: 'var(--ink-4)', fontSize: isMobile ? 12 : 13,
              }}
            >+ Legg til nedtelling</button>
          )
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <input className="input" placeholder="Hva teller vi ned til?" value={draft.label}
              onChange={e => setDraft(d => ({ ...d, label: e.target.value }))}
              onKeyDown={e => { if (e.key === 'Enter') onSave(); }} autoFocus />
            <input className="input" type="date" value={draft.date}
              onChange={e => setDraft(d => ({ ...d, date: e.target.value }))} />
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={onSave} className="btn primary" style={{ flex: 1 }}>Lagre</button>
              <button onClick={onCancel} className="btn ghost" style={{ flex: 1 }}>Avbryt</button>
            </div>
          </div>
        )}
      </div>

      {multi && !editing && !loading && (
        <PagerDots count={n} index={offset} maxDots={MAX_DOTS} keys={countdowns.map(c => c.id)} />
      )}
    </div>
  );
}
