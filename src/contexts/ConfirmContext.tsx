import { createContext, useContext, useState, useRef, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';

interface ConfirmOpts {
  title?: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;       // red confirm button (default true)
}
interface ConfirmState extends ConfirmOpts {
  id: number;
  resolve: (v: boolean) => void;
}

interface ConfirmCtx {
  /** Show a confirmation dialog. Resolves true if confirmed, false otherwise. */
  confirm: (opts?: ConfirmOpts) => Promise<boolean>;
}

const Ctx = createContext<ConfirmCtx>({ confirm: async () => true });
export const useConfirm = () => useContext(Ctx);

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<ConfirmState | null>(null);
  const idRef = useRef(0);
  const cancelBtnRef = useRef<HTMLButtonElement>(null);

  const confirm = useCallback((opts: ConfirmOpts = {}) => {
    return new Promise<boolean>(resolve => {
      setState({ id: ++idRef.current, resolve, ...opts });
    });
  }, []);

  const close = (val: boolean) => {
    setState(s => { s?.resolve(val); return null; });
  };

  useEffect(() => {
    if (!state) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(false); };
    document.addEventListener('keydown', onKey);
    const t = setTimeout(() => cancelBtnRef.current?.focus(), 30);
    return () => { document.removeEventListener('keydown', onKey); clearTimeout(t); };
  }, [state]);

  const danger = state ? state.danger !== false : true;

  return (
    <Ctx.Provider value={{ confirm }}>
      {children}
      {state && createPortal(
        <div
          onClick={() => close(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 2100,
            background: 'rgba(11,37,69,0.45)',
            backdropFilter: 'blur(2px)', WebkitBackdropFilter: 'blur(2px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
            animation: 'confirm-fade 0.15s ease both',
          }}
        >
          <div
            role="alertdialog"
            aria-modal="true"
            aria-label={state.title ?? 'Bekreft'}
            onClick={e => e.stopPropagation()}
            style={{
              background: 'var(--surface)', borderRadius: 14, width: '100%', maxWidth: 380,
              border: '1px solid var(--line)',
              boxShadow: '0 16px 50px rgba(11,37,69,0.3)',
              padding: '22px 22px 18px',
              animation: 'confirm-pop 0.18s cubic-bezier(0.18,0.9,0.32,1.1) both',
            }}
          >
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--ink)', letterSpacing: '-0.01em' }}>
              {state.title ?? 'Er du sikker?'}
            </h3>
            {state.message && (
              <p style={{ margin: '8px 0 0', fontSize: 13.5, lineHeight: 1.5, color: 'var(--ink-3)' }}>
                {state.message}
              </p>
            )}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20 }}>
              <button ref={cancelBtnRef} onClick={() => close(false)} className="btn ghost" style={{ padding: '8px 14px' }}>
                {state.cancelLabel ?? 'Avbryt'}
              </button>
              <button
                onClick={() => close(true)}
                style={{
                  border: 0, borderRadius: 6, padding: '8px 18px',
                  fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--font-sans)',
                  background: danger ? '#C0392B' : 'var(--ink)', color: '#fff',
                }}
              >
                {state.confirmLabel ?? 'Slett'}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </Ctx.Provider>
  );
}
