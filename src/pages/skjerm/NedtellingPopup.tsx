import { useEffect, useState } from 'react';
import { ScreenPopup, isCoarsePointer } from './ScreenPopup';
import { EMPTY_COUNTDOWN_DRAFT } from './shared';
import type { Countdown } from '../../hooks/useCountdown';
import { daysBetween } from '../../lib/countdowns';

interface Props {
  /** Nedtellingen som vises/redigeres. null = ny nedtelling (åpner direkte i redigering). */
  countdown: Countdown | null;
  /** Dagens Oslo-dato, yyyy-mm-dd. */
  today: string;
  onSave: (patch: { label: string; date: string }) => void;
  onDelete: (cd: Countdown) => void;
  onClose: () => void;
  isMobile: boolean;
}

// Popup for en nedtelling: visning → Rediger (tittel + dato) / Slett (to-trinns).
// Selve lagringen/slettingen gjøres av Skjerm (useCountdowns), her ligger bare skjemaet.
export function NedtellingPopup({ countdown, today, onSave, onDelete, onClose, isMobile }: Props) {
  const [editing, setEditing] = useState(countdown === null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [draft, setDraft] = useState(countdown ? { label: countdown.label, date: countdown.date } : EMPTY_COUNTDOWN_DRAFT);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const valid = draft.label.trim() !== '' && draft.date !== '';
  const save = () => { if (valid) onSave({ label: draft.label.trim(), date: draft.date }); };
  const days = countdown ? daysBetween(today, countdown.date) : 0;
  const pad = isMobile ? 16 : 20;
  const field = { fontSize: 16, padding: '12px 14px' } as const; // 16px: iOS zoomer ikke inn på feltet

  return (
    <ScreenPopup
      eyebrowText="Nedtelling"
      title={countdown ? (editing ? 'Rediger nedtelling' : countdown.label) : 'Ny nedtelling'}
      onClose={onClose} width={420} isMobile={isMobile}
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
            <button onClick={countdown ? () => setEditing(false) : onClose} className="btn ghost"
              style={{ flex: 1, justifyContent: 'center' }}>Avbryt</button>
          </div>
        </div>
      ) : countdown && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: pad }}>
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
                <button onClick={() => setConfirmDelete(false)} className="btn ghost" style={{ flex: 1, justifyContent: 'center' }}>Avbryt</button>
              </>
            ) : (
              <>
                <button onClick={() => setEditing(true)} className="btn primary" style={{ flex: 1, justifyContent: 'center' }}>Rediger</button>
                <button onClick={() => setConfirmDelete(true)} className="btn"
                  style={{ flex: 1, justifyContent: 'center', background: '#C0392B', borderColor: '#C0392B', color: '#fff', fontWeight: 600 }}>Slett</button>
              </>
            )}
          </div>
        </div>
      )}
    </ScreenPopup>
  );
}
