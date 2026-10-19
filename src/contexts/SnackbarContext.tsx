import { createContext, useContext, useState, useRef, useCallback } from 'react';

interface SnackOpts {
  actionLabel?: string;
  onAction?: () => void;
  duration?: number;        // ms; defaults: 5000 with action, 3000 without
}
interface SnackState {
  id: number;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  duration: number;
}

interface SnackbarCtx {
  /** Show a snackbar. Pass `onAction` + `actionLabel` for an undo-style action. */
  notify: (message: string, opts?: SnackOpts) => void;
}

const Ctx = createContext<SnackbarCtx>({ notify: () => {} });
export const useSnackbar = () => useContext(Ctx);

export function SnackbarProvider({ children }: { children: React.ReactNode }) {
  const [snack, setSnack] = useState<SnackState | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const idRef = useRef(0);

  const clearTimer = () => { if (timer.current) { clearTimeout(timer.current); timer.current = null; } };

  const dismiss = useCallback(() => { clearTimer(); setSnack(null); }, []);

  const notify = useCallback((message: string, opts: SnackOpts = {}) => {
    clearTimer();
    const id = ++idRef.current;
    const duration = opts.duration ?? (opts.onAction ? 5000 : 3000);
    setSnack({ id, message, actionLabel: opts.actionLabel, onAction: opts.onAction, duration });
    timer.current = setTimeout(() => {
      setSnack(s => (s && s.id === id ? null : s));
      timer.current = null;
    }, duration);
  }, []);

  const runAction = () => {
    const fn = snack?.onAction;
    dismiss();
    fn?.();
  };

  return (
    <Ctx.Provider value={{ notify }}>
      {children}
      {snack && (
        <div
          role="status"
          aria-live="polite"
          key={snack.id}
          style={{
            position: 'fixed',
            left: '50%',
            bottom: 'calc(20px + env(safe-area-inset-bottom, 0px))',
            transform: 'translateX(-50%)',
            zIndex: 2000,
            maxWidth: 'calc(100vw - 32px)',
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            padding: '11px 14px 11px 18px',
            background: 'var(--ink)',
            color: 'var(--surface)',
            borderRadius: 10,
            boxShadow: '0 8px 30px rgba(11,37,69,0.35)',
            fontSize: 14,
            fontWeight: 500,
            overflow: 'hidden',
            animation: 'snack-in 0.22s cubic-bezier(0.18,0.9,0.32,1.1) both',
          }}
        >
          <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{snack.message}</span>
          {snack.actionLabel && snack.onAction && (
            <button
              onClick={runAction}
              style={{
                flexShrink: 0,
                background: 'transparent',
                border: 0,
                color: 'var(--accent-soft)',
                fontFamily: 'var(--font-mono)',
                fontSize: 13,
                fontWeight: 700,
                letterSpacing: '0.03em',
                padding: '4px 6px',
              }}
            >
              {snack.actionLabel}
            </button>
          )}
          <button
            onClick={dismiss}
            aria-label="Lukk"
            style={{
              flexShrink: 0, background: 'transparent', border: 0,
              color: 'var(--surface)', opacity: 0.5, fontSize: 16, lineHeight: 1, padding: '2px 4px',
            }}
          >×</button>
          {/* countdown bar */}
          <span
            aria-hidden
            style={{
              position: 'absolute', left: 0, bottom: 0, height: 2,
              background: 'var(--accent-soft)', opacity: 0.6,
              width: '100%', transformOrigin: 'left',
              animation: `snack-countdown ${snack.duration}ms linear both`,
            }}
          />
        </div>
      )}
    </Ctx.Provider>
  );
}
