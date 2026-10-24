import { useEffect, useState } from 'react';
import type React from 'react';
import { useScrollLock } from '../../lib/useScrollLock';
import { popupLayout } from '../../lib/keyboardViewport';

// ─── Quick-add popups (Gjøremål / Handleliste) ─────────────────────────────
// Samme mønster som Registrer trening (TreningQuickRegister): fast mørk
// «.card.dark»-kort på svart bakdrop, ikke det vanlige lys/mørk-temaet —
// Gangskjermen skal alltid se slik ut, uavhengig av appens theme-valg.

/** Det synlige området (visualViewport): krymper når skjermtastaturet åpnes, og offsetTop > 0 hvis Safari panorerer. */
function useVisualViewportBox() {
  const read = () => ({
    top: window.visualViewport?.offsetTop ?? 0,
    height: window.visualViewport?.height ?? window.innerHeight,
  });
  const [box, setBox] = useState(read);
  useEffect(() => {
    const vv = window.visualViewport;
    const update = () => setBox(prev => {
      const next = read();
      return prev.top === next.top && prev.height === next.height ? prev : next;
    });
    window.addEventListener('resize', update);
    vv?.addEventListener('resize', update);
    vv?.addEventListener('scroll', update);
    return () => {
      window.removeEventListener('resize', update);
      vv?.removeEventListener('resize', update);
      vv?.removeEventListener('scroll', update);
    };
  }, []);
  return box;
}

export const isCoarsePointer = () => window.matchMedia?.('(pointer: coarse)').matches === true;

/**
 * Modal for hurtig-registrering med tekstfelt. Plasseres etter visualViewport (ikke etter
 * Gangskjermens egen viewportH, som er frosset mens popupen er åpen): overlayet dekker alltid
 * nøyaktig det synlige området over tastaturet, så modalen med tekstfeltet er synlig uten scrolling.
 * På touch festes modalen øverst, slik at tekstfeltet er over tastaturet allerede før det åpnes og
 * Safari ikke panorerer siden for å vise det.
 */
export function ScreenPopup({ eyebrowText, title, onClose, width, isMobile = false, children, modalRef, modalProps, headerControls }: {
  eyebrowText: string; title: string; onClose: () => void; width: number; isMobile?: boolean;
  children: React.ReactNode;
  /** Ref til selve popup-kortet (f.eks. useGrowOnlyHeight). */
  modalRef?: React.Ref<HTMLDivElement>;
  /** Spres på popup-kortet, f.eks. useSwipePager sine containerProps (style flettes inn). */
  modalProps?: React.HTMLAttributes<HTMLDivElement> & { 'data-swipe-pager'?: string };
  /** Ekstra knapper til venstre for ✕ (f.eks. ‹ ›). */
  headerControls?: React.ReactNode;
}) {
  useScrollLock();
  const vv = useVisualViewportBox();
  const layout = popupLayout({ vvTop: vv.top, vvHeight: vv.height, coarse: isCoarsePointer(), isMobile });
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', top: layout.top, left: 0, right: 0, height: layout.height, zIndex: 200,
        background: 'rgba(0,0,0,0.78)', display: 'flex', alignItems: layout.alignItems, justifyContent: 'center',
        padding: `${layout.padding.top}px ${layout.padding.side}px ${layout.padding.side}px`, overflowY: 'auto',
      }}
    >
      <div
        {...modalProps}
        ref={modalRef}
        onClick={e => e.stopPropagation()}
        className="card dark skjerm-popup"
        style={{
          padding: isMobile ? '18px 16px' : '28px 32px', width, maxWidth: isMobile ? '100%' : 'calc(100vw - 48px)',
          maxHeight: layout.modalMaxHeight, overflowY: 'auto',
          ...modalProps?.style,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', ...(headerControls ? { gap: 12 } : {}) }}>
          <div style={headerControls ? { minWidth: 0 } : undefined}>
            <div className="card-eyebrow">{eyebrowText}</div>
            <div className="card-title" style={{ fontSize: 22, fontWeight: 300, marginTop: 6, letterSpacing: '-0.01em' }}>{title}</div>
          </div>
          {headerControls ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
              {headerControls}
              <CloseButton onClose={onClose} />
            </div>
          ) : <CloseButton onClose={onClose} />}
        </div>
        {children}
      </div>
    </div>
  );
}

function CloseButton({ onClose }: { onClose: () => void }) {
  return (
    <button
      onClick={onClose}
      style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 6, cursor: 'pointer', color: 'rgba(207,224,239,0.5)', fontSize: 18, padding: '4px 12px', lineHeight: 1.4 }}
    >✕</button>
  );
}
