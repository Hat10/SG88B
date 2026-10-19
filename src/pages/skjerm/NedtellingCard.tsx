import type React from 'react';
import { m, EMPTY_COUNTDOWN_DRAFT, type ScreenSize } from './shared';
import type { Countdown } from '../../hooks/useCountdown';

interface Props {
  cd: Countdown | null;
  cdDays: number;
  cdLoading: boolean;
  cdEditing: boolean;
  cdDraft: { label: string; date: string };
  setCdDraft: React.Dispatch<React.SetStateAction<{ label: string; date: string }>>;
  setCdEditing: React.Dispatch<React.SetStateAction<boolean>>;
  onSave: () => void;
  onRemove: () => void;
  isMobile: boolean;
  screenSize: ScreenSize;
  cell: React.CSSProperties;
  eyebrow: React.CSSProperties;
}

// Nedtelling — viser nærmeste nedtelling, med ✎/× og inline-redigering.
export function NedtellingCard({ cd, cdDays, cdLoading, cdEditing, cdDraft, setCdDraft, setCdEditing, onSave, onRemove, isMobile, screenSize, cell, eyebrow }: Props) {
  return (
    <div style={{ ...cell, ...(isMobile ? { minWidth: 0 } : {}), padding: isMobile ? m.pad : screenSize === 'tablet' ? '10px 12px' : screenSize === 'desktop' ? '20px 22px' : '16px 18px', display: 'flex', flexDirection: 'column', gap: isMobile ? 8 : screenSize === 'tablet' ? 6 : 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={eyebrow}>Nedtelling</div>
        {cd && (
          <div style={{ display: 'flex', gap: 2 }}>
            <button onClick={() => { setCdDraft({ label: cd.label, date: cd.date }); setCdEditing(e => !e); }}
              aria-label="Rediger nedtelling"
              style={{ background:'transparent', border:0, cursor:'pointer', color:'var(--ink-4)', fontSize: isMobile ? m.body : 16, padding:'2px 4px', lineHeight:1 }}>✎</button>
            <button onClick={onRemove}
              aria-label="Fjern nedtelling"
              style={{ background:'transparent', border:0, cursor:'pointer', color:'var(--ink-4)', fontSize: isMobile ? m.body : 16, padding:'2px 4px', lineHeight:1 }}>×</button>
          </div>
        )}
      </div>

      {cdLoading ? (
        <div style={{ height: isMobile ? 64 : screenSize === 'tablet' ? 60 : 80 }} />
      ) : !cdEditing ? (
        cd && isMobile ? (
          <>
            <div style={{ fontSize: m.body, fontWeight: 400, color: 'var(--ink-2)', lineHeight: 1.3, overflowWrap: 'anywhere' }}>{cd.label}</div>
            <div style={{ fontSize: m.bigNum, fontWeight: 400, letterSpacing: '-0.04em', lineHeight: 0.9, fontVariantNumeric: 'tabular-nums' }}>
              {Math.max(0, cdDays)}
            </div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: m.mono, color: 'var(--ink-4)' }}>
              {cdDays <= 0 ? 'i dag!' : cdDays === 1 ? 'dag · i morgen' : 'dager'} · {new Date(cd.date + 'T12:00:00').toLocaleDateString('nb-NO', { day: 'numeric', month: 'long', year: 'numeric' })}
            </div>
          </>
        ) : cd ? (
          <>
            <div style={{ fontSize: screenSize === 'tablet' ? 16 : 20, fontWeight: 600, letterSpacing: '-0.01em', color: 'var(--ink-2)' }}>{cd.label}</div>
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
            onClick={() => { setCdDraft(EMPTY_COUNTDOWN_DRAFT); setCdEditing(true); }}
            style={{
              background: 'transparent', cursor: 'pointer', textAlign: 'left',
              border: '1px dashed var(--ink-4)', borderRadius: 6, padding: '10px 12px',
              color: 'var(--ink-4)', fontSize: isMobile ? 12 : 13,
            }}
          >+ Legg til nedtelling</button>
        )
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <input className="input" placeholder="Hva teller vi ned til?" value={cdDraft.label}
            onChange={e => setCdDraft(d => ({ ...d, label: e.target.value }))}
            onKeyDown={e => { if (e.key === 'Enter') onSave(); }} autoFocus />
          <input className="input" type="date" value={cdDraft.date}
            onChange={e => setCdDraft(d => ({ ...d, date: e.target.value }))} />
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={onSave} className="btn primary" style={{ flex: 1 }}>Lagre</button>
            <button onClick={() => setCdEditing(false)} className="btn ghost" style={{ flex: 1 }}>Avbryt</button>
          </div>
        </div>
      )}
    </div>
  );
}
