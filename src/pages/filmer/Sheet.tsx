// Felles byggeklosser for arkene på Filmer-siden: bunnark på mobil, sentrert modal på desktop.
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useScrollLock } from '../../lib/useScrollLock';

export function useIsMobile() {
  const [m, setM] = useState(() => window.innerWidth < 768);
  useEffect(() => {
    const f = () => setM(window.innerWidth < 768);
    window.addEventListener('resize', f);
    return () => window.removeEventListener('resize', f);
  }, []);
  return m;
}

export function Sheet({ eyebrow, title, onClose, children, width = 460 }: {
  eyebrow: string; title: string; onClose: () => void; children: React.ReactNode;
  /** Maks bredde på desktop (mobil: alltid bunnark i full bredde). */
  width?: number;
}) {
  useScrollLock();
  const isMobile = useIsMobile();
  return createPortal((
    <div role="dialog" aria-modal="true" aria-label={title} style={{
      position: 'fixed', inset: 0, zIndex: 400, display: 'flex',
      alignItems: isMobile ? 'flex-end' : 'center', justifyContent: 'center', padding: isMobile ? 0 : 20,
    }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(11,37,69,0.45)', animation: 'confirm-fade 0.18s ease both' }} />
      <div style={{
        position: 'relative', background: 'var(--surface)', width: '100%', maxWidth: isMobile ? '100%' : width,
        borderRadius: isMobile ? '16px 16px 0 0' : 12, maxHeight: isMobile ? '92dvh' : '86dvh',
        overflow: 'hidden', display: 'flex', flexDirection: 'column', boxShadow: '0 8px 40px rgba(11,37,69,0.22)',
        animation: `${isMobile ? 'quick-sheet-up' : 'confirm-pop'} 0.22s cubic-bezier(0.18,0.9,0.32,1.1) both`,
      }}>
        <div style={{ flexShrink: 0, borderBottom: '1px solid var(--line)' }}>
          {isMobile && (
            <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 10 }}>
              <div style={{ width: 36, height: 4, borderRadius: 2, background: 'var(--line-2)' }} />
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 20px' }}>
            <div style={{ minWidth: 0 }}>
              <div className="card-eyebrow">{eyebrow}</div>
              <h3 className="card-title" style={{ marginTop: 2, overflowWrap: 'anywhere' }}>{title}</h3>
            </div>
            <button onClick={onClose} aria-label="Lukk" style={{ background: 'transparent', border: '1px solid var(--line)', borderRadius: 6, minWidth: 44, minHeight: 44, display: 'grid', placeItems: 'center', fontSize: 18, color: 'var(--ink-3)', flexShrink: 0 }}>×</button>
          </div>
        </div>
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '16px 20px', paddingBottom: 'calc(20px + env(safe-area-inset-bottom, 0px))', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {children}
        </div>
      </div>
    </div>
  ), document.body);
}

export const Label = ({ children, hint }: { children: React.ReactNode; hint?: string }) => (
  <div className="card-eyebrow" style={{ marginBottom: 6 }}>{children}{hint && <span style={{ opacity: 0.5 }}> ({hint})</span>}</div>
);
