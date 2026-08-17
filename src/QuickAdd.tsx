import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useScrollLock } from './lib/useScrollLock';
import { useTodo, type Priority } from './contexts/TodoContext';
import { useSnackbar } from './contexts/SnackbarContext';
import { useConfirm } from './contexts/ConfirmContext';
import { navigate } from './lib/navigate';
import RepeatPicker, { EMPTY_REPEAT, type RepeatState } from './RepeatPicker';
import type { Who } from './data';

// ─── shared helpers ──────────────────────────────────────────────────────────

const WHO_LABEL: Record<Who, string> = { f: 'Felles', M: 'Andreas', L: 'Taran' };
const WHO_COLOR: Record<Who, string> = { f: 'var(--good)', M: 'var(--accent)', L: 'var(--ink)' };

const PRI_COLOR: Record<Priority, string> = { høy: '#D95F5F', middels: '#C9963A', lav: 'var(--ink-4)' };

function localIso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
const todayStr = () => localIso(new Date());
const tomorrowStr = () => { const d = new Date(); d.setDate(d.getDate() + 1); return localIso(d); };

// ─── modal shell (bottom sheet on mobile, centered card on desktop) ──────────

function QuickSheet({ eyebrow, title, isMobile, dirty, onClose, children }: {
  eyebrow: string;
  title: string;
  isMobile: boolean;
  dirty: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  useScrollLock();
  const { confirm } = useConfirm();

  // Guard accidental close (backdrop tap / ×) once the user has started filling in.
  const attemptClose = async () => {
    if (dirty && !await confirm({
      title: 'Forkaste utkast?',
      message: 'Du har begynt å fylle ut. Vil du forkaste det du har skrevet?',
      confirmLabel: 'Forkast',
      cancelLabel: 'Fortsett å redigere',
    })) return;
    onClose();
  };

  return createPortal((
    <div style={{
      position: 'fixed', inset: 0, zIndex: 400, display: 'flex',
      alignItems: isMobile ? 'flex-end' : 'center', justifyContent: 'center',
      padding: isMobile ? 0 : 20,
    }}>
      <div
        onClick={attemptClose}
        style={{ position: 'absolute', inset: 0, background: 'rgba(11,37,69,0.45)', animation: 'confirm-fade 0.18s ease both' }}
      />
      <div style={{
        position: 'relative', background: 'var(--surface)',
        width: '100%', maxWidth: isMobile ? '100%' : 460,
        borderRadius: isMobile ? '16px 16px 0 0' : 12,
        maxHeight: isMobile ? '92dvh' : '86dvh', overflow: 'hidden',
        display: 'flex', flexDirection: 'column',
        boxShadow: '0 8px 40px rgba(11,37,69,0.22)',
        animation: `${isMobile ? 'quick-sheet-up' : 'confirm-pop'} 0.22s cubic-bezier(0.18,0.9,0.32,1.1) both`,
      }}>
        {/* Header */}
        <div style={{ flexShrink: 0, borderBottom: '1px solid var(--line)' }}>
          {isMobile && (
            <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 10 }}>
              <div style={{ width: 36, height: 4, borderRadius: 2, background: 'var(--line-2)' }} />
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 20px' }}>
            <div>
              <div className="card-eyebrow">{eyebrow}</div>
              <h3 className="card-title" style={{ marginTop: 2 }}>{title}</h3>
            </div>
            <button onClick={attemptClose} aria-label="Lukk" style={{
              background: 'transparent', border: '1px solid var(--line)', borderRadius: 6,
              minWidth: 36, minHeight: 36, display: 'grid', placeItems: 'center',
              cursor: 'pointer', fontSize: 16, color: 'var(--ink-3)',
            }}>×</button>
          </div>
        </div>
        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '18px 20px', paddingBottom: 'calc(20px + env(safe-area-inset-bottom, 0px))' }}>
          {children}
        </div>
      </div>
    </div>
  ), document.body);
}

// ─── quick todo form ─────────────────────────────────────────────────────────

function QuickTodoForm({ isMobile, onClose, onDirtyChange }: {
  isMobile: boolean; onClose: () => void; onDirtyChange: (dirty: boolean) => void;
}) {
  const { addItem } = useTodo();
  const { notify } = useSnackbar();

  const [initialDeadline] = useState(todayStr);
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [deadline, setDeadline] = useState(initialDeadline);
  const [time, setTime] = useState('');
  const [repeatState, setRepeatState] = useState<RepeatState>(EMPTY_REPEAT);
  const [who, setWho] = useState<Who>('f');
  const [priority, setPriority] = useState<Priority>('middels');
  const [saving, setSaving] = useState(false);

  // Report "has the user started filling in?" up to the sheet, for the discard guard.
  const dirty = !!title.trim() || !!desc.trim() || !!time || !!repeatState.repeat
    || who !== 'f' || priority !== 'middels' || deadline !== initialDeadline;
  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);

  // Time and repeat need a deadline to anchor to — clear them when it's removed.
  const changeDeadline = (val: string) => {
    setDeadline(val);
    if (!val) { setTime(''); setRepeatState(EMPTY_REPEAT); }
  };

  const submit = async () => {
    if (!title.trim() || !deadline || saving) return;
    setSaving(true);
    try {
      await addItem({
        title: title.trim(),
        description: desc.trim() || undefined,
        who, priority,
        deadline,
        time: time || undefined,
        repeat: repeatState.repeat || undefined,
        repeatInterval: repeatState.repeat === 'custom' ? repeatState.repeatInterval : undefined,
        repeatUnit: repeatState.repeat === 'custom' ? repeatState.repeatUnit : undefined,
        done: false, overdue_days: 0,
      });
      notify('Gjøremål lagt til', { actionLabel: 'Åpne', onAction: () => navigate('gjoremal') });
      onClose();
    } finally { setSaving(false); }
  };

  const dlChip = (label: string, val: string) => {
    const active = deadline === val;
    return (
      <button key={label} onClick={() => changeDeadline(val)} style={{
        flex: 1, padding: '7px 0', borderRadius: 6, cursor: 'pointer', fontSize: 12,
        fontFamily: 'var(--font-mono)',
        border: `1px solid ${active ? 'var(--accent)' : 'var(--line-2)'}`,
        background: active ? 'var(--accent-soft)' : 'transparent',
        color: active ? 'var(--accent-deep)' : 'var(--ink-4)',
        fontWeight: active ? 600 : 400,
      }}>{label}</button>
    );
  };

  const gated: React.CSSProperties = deadline
    ? {}
    : { opacity: 0.4, pointerEvents: 'none' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <div className="card-eyebrow" style={{ marginBottom: 4 }}>Hva må gjøres?</div>
        <input className="input" placeholder="Nytt gjøremål…" value={title} autoFocus={!isMobile}
          onChange={e => setTitle(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && void submit()}
          style={{ width: '100%' }} />
      </div>

      <div>
        <div className="card-eyebrow" style={{ marginBottom: 4 }}>Beskrivelse <span style={{ opacity: 0.5 }}>(valgfri)</span></div>
        <textarea className="input" placeholder="Flere detaljer…" value={desc} rows={2}
          onChange={e => setDesc(e.target.value)}
          style={{ width: '100%', resize: 'vertical' }} />
      </div>

      <div>
        <div className="card-eyebrow" style={{ marginBottom: 6 }}>Tidsfrist <span style={{ color: 'var(--warn)' }}>*</span></div>
        <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
          {dlChip('I dag', todayStr())}
          {dlChip('I morgen', tomorrowStr())}
        </div>
        <input className="input" type="date" value={deadline}
          onChange={e => changeDeadline(e.target.value)}
          style={{ width: '100%' }} />
      </div>

      {/* Klokkeslett + gjentakelse — krever tidsfrist, som på full-siden */}
      <div style={{ display: 'flex', gap: 10, ...gated }}>
        <div style={{ flex: 1 }}>
          <div className="card-eyebrow" style={{ marginBottom: 4 }}>Klokkeslett <span style={{ opacity: 0.5 }}>(valgfri)</span></div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input className="input" type="time" value={time} disabled={!deadline}
              onChange={e => setTime(e.target.value)}
              style={{ flex: 1, fontFamily: 'var(--font-mono)' }} />
            {time && (
              <button onClick={() => setTime('')} aria-label="Fjern klokkeslett" style={{
                background: 'transparent', border: '1px solid var(--line)', borderRadius: 6,
                width: 36, height: 36, display: 'grid', placeItems: 'center', cursor: 'pointer',
                fontSize: 16, color: 'var(--ink-4)', flexShrink: 0,
              }}>×</button>
            )}
          </div>
        </div>
      </div>

      <div style={gated}>
        <div className="card-eyebrow" style={{ marginBottom: 4 }}>Gjentas <span style={{ opacity: 0.5 }}>(valgfri)</span></div>
        <RepeatPicker value={repeatState} onChange={setRepeatState} disabled={!deadline} />
      </div>

      <div>
        <div className="card-eyebrow" style={{ marginBottom: 6 }}>Prioritet</div>
        <div style={{ display: 'flex', gap: 6 }}>
          {(['høy', 'middels', 'lav'] as Priority[]).map(p => {
            const on = priority === p;
            return (
              <button key={p} onClick={() => setPriority(p)} style={{
                flex: 1, padding: '7px 0', borderRadius: 6, cursor: 'pointer', fontSize: 12,
                fontFamily: 'var(--font-mono)',
                border: `1px solid ${on ? PRI_COLOR[p] : 'var(--line-2)'}`,
                background: on ? `${PRI_COLOR[p]}18` : 'transparent',
                color: on ? PRI_COLOR[p] : 'var(--ink-4)',
              }}>{p.charAt(0).toUpperCase() + p.slice(1)}</button>
            );
          })}
        </div>
      </div>

      <div>
        <div className="card-eyebrow" style={{ marginBottom: 6 }}>Hvem</div>
        <div style={{ display: 'flex', gap: 6 }}>
          {(['f', 'M', 'L'] as Who[]).map(w => {
            const on = who === w;
            return (
              <button key={w} onClick={() => setWho(w)} style={{
                flex: 1, padding: '7px 0', borderRadius: 6, cursor: 'pointer', fontSize: 12,
                fontFamily: 'var(--font-mono)',
                border: `1px solid ${on ? WHO_COLOR[w] : 'var(--line-2)'}`,
                background: on ? `${WHO_COLOR[w]}18` : 'transparent',
                color: on ? WHO_COLOR[w] : 'var(--ink-4)',
              }}>{WHO_LABEL[w]}</button>
            );
          })}
        </div>
      </div>

      <button onClick={() => void submit()} className="btn primary"
        disabled={!title.trim() || !deadline || saving}
        style={{ justifyContent: 'center', marginTop: 2, opacity: (!title.trim() || !deadline || saving) ? 0.4 : 1 }}>
        {saving ? 'Lagrer…' : !deadline ? 'Velg en tidsfrist' : 'Legg til gjøremål'}
      </button>
    </div>
  );
}

// ─── the bar ─────────────────────────────────────────────────────────────────

type Kind = 'todo' | null;

/**
 * Quick-add shortcut ("Nytt gjøremål") that opens a compact modal — a bottom
 * sheet on mobile, a centered card on desktop. Renders as a fragment of a
 * button (+ the active modal); the parent owns the layout.
 */
export function QuickAddBar({ isMobile }: { isMobile: boolean }) {
  const [open, setOpen] = useState<Kind>(null);
  const [dirty, setDirty] = useState(false);

  const close = () => { setDirty(false); setOpen(null); };

  const btnStyle: React.CSSProperties = {
    flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
    padding: isMobile ? '12px 10px' : '9px 14px',
    borderRadius: 8, cursor: 'pointer',
    border: '1px solid var(--line-2)', background: 'var(--surface)',
    color: 'var(--ink-2)', fontSize: isMobile ? 13 : 12.5, fontWeight: 600,
    fontFamily: 'inherit', whiteSpace: 'nowrap',
  };

  return (
    <>
      <button onClick={() => setOpen('todo')} style={btnStyle}>
        <span style={{ fontSize: 15, lineHeight: 1 }}>✅</span> Nytt gjøremål
      </button>

      {open === 'todo' && (
        <QuickSheet eyebrow="Snarvei" title="Nytt gjøremål" isMobile={isMobile} dirty={dirty} onClose={close}>
          <QuickTodoForm isMobile={isMobile} onClose={close} onDirtyChange={setDirty} />
        </QuickSheet>
      )}
    </>
  );
}
