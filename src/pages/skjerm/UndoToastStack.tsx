import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { boughtMessage, UNDO_TOAST_LEAVE_MS, UNDO_TOAST_MS, type UndoToast } from '../../lib/groceryUndo';

// ─── Angre-meldinger for handlelisten på Gangskjerm ─────────────────────────
// Stabel nederst midt på skjermen: eldst øverst, nyest nederst. position: fixed
// (via portal til body), så den aldri påvirker layout/høyde — heller ikke i
// tablet-modus med låst høyde. Hver melding har sin egen timer. Stil som den
// delte snackbaren (SnackbarContext) så lyst/mørkt tema følger appen.

function Item({ toast, onExpire, onRemoved, onUndo }: {
  toast: UndoToast;
  onExpire: (id: string) => void;
  onRemoved: (id: string) => void;
  onUndo: (t: UndoToast) => void;
}) {
  // Egen frist per melding — uavhengig av de andre.
  useEffect(() => {
    if (toast.leaving) return;
    const t = window.setTimeout(() => onExpire(toast.id), Math.max(0, toast.expiresAt - Date.now()));
    return () => window.clearTimeout(t);
  }, [toast.id, toast.leaving, toast.expiresAt, onExpire]);

  // Etter utgangsanimasjonen fjernes raden fra stabelen.
  useEffect(() => {
    if (!toast.leaving) return;
    const t = window.setTimeout(() => onRemoved(toast.id), UNDO_TOAST_LEAVE_MS);
    return () => window.clearTimeout(t);
  }, [toast.id, toast.leaving, onRemoved]);

  return (
    <div className={`undo-toast-slot${toast.leaving ? ' undo-toast-leaving' : ''}`}>
      <div
        role="status"
        style={{
          position: 'relative', overflow: 'hidden',
          display: 'flex', alignItems: 'center', gap: 14,
          padding: '4px 4px 4px 18px',
          background: 'var(--ink)', color: 'var(--surface)',
          borderRadius: 10, boxShadow: '0 8px 30px rgba(11,37,69,0.35)',
          fontSize: 15, fontWeight: 500,
          maxWidth: 'calc(100vw - 32px)',
          pointerEvents: 'auto',
        }}
      >
        <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{boughtMessage(toast.label)}</span>
        <button
          onClick={() => onUndo(toast)}
          disabled={toast.leaving}
          style={{
            flexShrink: 0, background: 'transparent', border: 0,
            color: 'var(--accent-soft)', fontFamily: 'var(--font-mono)',
            fontSize: 15, fontWeight: 700, letterSpacing: '0.03em',
            padding: '12px 14px', minHeight: 44, minWidth: 44,
          }}
        >Angre</button>
        <span
          aria-hidden
          className="undo-toast-bar"
          style={{
            position: 'absolute', left: 0, bottom: 0, height: 2, width: '100%',
            background: 'var(--accent-soft)', opacity: 0.6, transformOrigin: 'left',
            animation: `snack-countdown ${UNDO_TOAST_MS}ms linear both`,
          }}
        />
      </div>
    </div>
  );
}

export default function UndoToastStack({ toasts, onExpire, onRemoved, onUndo }: {
  toasts: UndoToast[];
  onExpire: (id: string) => void;
  onRemoved: (id: string) => void;
  onUndo: (t: UndoToast) => void;
}) {
  if (toasts.length === 0) return null;
  return createPortal(
    <div
      aria-live="polite"
      style={{
        position: 'fixed', left: 0, right: 0,
        bottom: 'calc(12px + env(safe-area-inset-bottom, 0px))',
        zIndex: 2000, pointerEvents: 'none',
        display: 'flex', flexDirection: 'column', alignItems: 'center',
      }}
    >
      {toasts.map(t => <Item key={t.id} toast={t} onExpire={onExpire} onRemoved={onRemoved} onUndo={onUndo} />)}
    </div>,
    document.body,
  );
}
