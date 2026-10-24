import { useEffect, useState } from 'react';
import { ScreenPopup, isCoarsePointer } from './ScreenPopup';
import { EMPTY_COUNTDOWN_DRAFT } from './shared';
import { PagerArrows } from './PagerArrows';
import { PagerDots } from './PagerDots';
import { useGrowOnlyHeight } from './popupPaging';
import type { Countdown } from '../../hooks/useCountdown';
import { clampIndex, daysBetween } from '../../lib/countdowns';
import { useSwipePager } from '../../lib/useSwipePager';

/** Samme grense som kortet: over dette antallet vises «2/9» i stedet for prikker. */
const MAX_DOTS = 6;

interface Props {
  /** Kommende nedtellinger, nærmest først — samme liste som kortet blar i. */
  countdowns: Countdown[];
  /** Nedtellingen kortet viste da det ble trykket på (indeks i `countdowns`). null = ny nedtelling (åpner direkte i redigering). */
  initialIndex: number | null;
  /** Dagens Oslo-dato, yyyy-mm-dd. */
  today: string;
  /** Bladning i popupen: kortet bak blar til samme indeks. */
  onNavigate: (index: number) => void;
  /** target = nedtellingen som redigeres, null = ny. */
  onSave: (target: Countdown | null, patch: { label: string; date: string }) => void;
  onDelete: (cd: Countdown) => void;
  onClose: () => void;
  isMobile: boolean;
}

// Popup for en nedtelling: visning → Rediger (tittel + dato) / Slett (to-trinns). Sveip (eller ‹ ›)
// blar mellom de kommende nedtellingene, i takt med kortet; av under redigering og «Bekreft sletting».
// Selve lagringen/slettingen gjøres av Skjerm (useCountdowns), her ligger bare skjemaet.
export function NedtellingPopup({ countdowns, initialIndex, today, onNavigate, onSave, onDelete, onClose, isMobile }: Props) {
  const isNew = initialIndex === null;
  const [editing, setEditing] = useState(isNew);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [draft, setDraft] = useState(EMPTY_COUNTDOWN_DRAFT);
  // Under redigering/sletting holdes nedtellingen fast på id, så en realtime-endring i lista
  // (en annen nedtelling legges til foran) aldri flytter Lagre/Slett over på en annen.
  const [lockedId, setLockedId] = useState<string | null>(null);

  const n = countdowns.length;
  const multi = !isNew && n >= 2;
  const busy = editing || confirmDelete;
  const pager = useSwipePager({
    max: Math.max(0, n - 1), initialOffset: initialIndex ?? 0, disabled: !multi || busy, onNavigate,
  });
  const { offset, goTo } = pager;
  // Sveipet ligger på hele popup-kortet; overflowX: hidden så glidningen ikke gir et vannrett rullefelt.
  const swipeProps = multi ? { ...pager.containerProps, style: { ...pager.containerProps.style, overflowX: 'hidden' as const } } : undefined;
  const shown = isNew ? null : countdowns[clampIndex(offset, n)] ?? null;
  const countdown = lockedId ? countdowns.find(c => c.id === lockedId) ?? shown : shown;

  // Lista endres mens popupen er åpen (realtime, sletting): hold indeksen gyldig, og lukk
  // hvis det ikke er noen nedtellinger igjen å vise.
  useEffect(() => {
    if (isNew) return;
    if (n === 0) { onClose(); return; }
    if (offset !== clampIndex(offset, n)) goTo(clampIndex(offset, n));
  }, [isNew, n, offset, goTo, onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (multi && !busy && e.key === 'ArrowLeft') pager.prev();
      else if (multi && !busy && e.key === 'ArrowRight') pager.next();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, multi, busy, pager]);

  const modalRef = useGrowOnlyHeight<HTMLDivElement>(editing);

  const startEdit = () => {
    if (!countdown) return;
    setLockedId(countdown.id);
    setDraft({ label: countdown.label, date: countdown.date });
    setEditing(true);
  };
  const cancelEdit = () => { setEditing(false); setLockedId(null); };
  const startDelete = () => { if (countdown) { setLockedId(countdown.id); setConfirmDelete(true); } };
  const cancelDelete = () => { setConfirmDelete(false); setLockedId(null); };

  const valid = draft.label.trim() !== '' && draft.date !== '';
  const save = () => { if (valid) onSave(isNew ? null : countdown, { label: draft.label.trim(), date: draft.date }); };
  const days = countdown ? daysBetween(today, countdown.date) : 0;
  const pad = isMobile ? 16 : 20;
  const field = { fontSize: 16, padding: '12px 14px' } as const; // 16px: iOS zoomer ikke inn på feltet

  return (
    <ScreenPopup
      eyebrowText="Nedtelling"
      title={countdown ? (editing ? 'Rediger nedtelling' : countdown.label) : 'Ny nedtelling'}
      onClose={onClose} width={420} isMobile={isMobile}
      modalRef={modalRef}
      modalProps={swipeProps}
      headerControls={multi ? (
        <PagerArrows canPrev={!busy && pager.canPrev} canNext={!busy && pager.canNext} onPrev={pager.prev} onNext={pager.next}
          isMobile={isMobile} labels={['Forrige nedtelling', 'Neste nedtelling']} popup />
      ) : undefined}
    >
      {editing ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: pad }}>
          {/* Ingen autofokus på touch: tastaturet ville dekket feltene. */}
          <input className="input skjerm-input" placeholder="Hva teller vi ned til?" value={draft.label}
            autoFocus={!isCoarsePointer()} style={field}
            onChange={e => setDraft(d => ({ ...d, label: e.target.value }))}
            onKeyDown={e => { if (e.key === 'Enter') save(); }} />
          <input className="input skjerm-input" type="date" aria-label="Dato" value={draft.date} style={field}
            onChange={e => setDraft(d => ({ ...d, date: e.target.value }))} />
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={save} className="btn primary" disabled={!valid}
              style={{ flex: 1, justifyContent: 'center', opacity: valid ? 1 : 0.5 }}>Lagre</button>
            <button onClick={isNew ? onClose : cancelEdit} className="btn ghost"
              style={{ flex: 1, justifyContent: 'center' }}>Avbryt</button>
          </div>
        </div>
      ) : countdown && (
        <div ref={pager.contentRef} style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: pad }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
              <span style={{ fontSize: isMobile ? 64 : 80, fontWeight: 300, letterSpacing: '-0.04em', lineHeight: 0.9, fontVariantNumeric: 'tabular-nums' }}>
                {Math.max(0, days)}
              </span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 18, fontWeight: 600, color: 'var(--ink-3)' }}>
                {days <= 0 ? '🎉 i dag!' : days === 1 ? 'dag · i morgen' : 'dager'}
              </span>
            </div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 15, color: 'var(--ink-3)', marginTop: 10 }}>
              {new Date(countdown.date + 'T12:00:00').toLocaleDateString('nb-NO', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {confirmDelete ? (
              <>
                <button onClick={() => onDelete(countdown)} className="btn"
                  style={{ flex: 1, justifyContent: 'center', background: '#C0392B', borderColor: '#C0392B', color: '#fff', fontWeight: 600 }}>
                  Bekreft sletting
                </button>
                <button onClick={cancelDelete} className="btn ghost" style={{ flex: 1, justifyContent: 'center' }}>Avbryt</button>
              </>
            ) : (
              <>
                <button onClick={startEdit} className="btn primary" style={{ flex: 1, justifyContent: 'center' }}>Rediger</button>
                <button onClick={startDelete} className="btn"
                  style={{ flex: 1, justifyContent: 'center', background: '#C0392B', borderColor: '#C0392B', color: '#fff', fontWeight: 600 }}>Slett</button>
              </>
            )}
          </div>
        </div>
      )}
      {multi && !editing && (
        <div style={{ marginTop: 16 }}>
          <PagerDots count={n} index={clampIndex(offset, n)} maxDots={MAX_DOTS} keys={countdowns.map(c => c.id)} popup />
        </div>
      )}
    </ScreenPopup>
  );
}
