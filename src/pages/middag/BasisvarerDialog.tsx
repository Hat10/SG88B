import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useScrollLock } from '../../lib/useScrollLock';
import { formatHandleukeRange, previewNames, varer, type BasisPlan } from '../../lib/basisvarer';

// Bekreftelse før «Legg til basisvarer for neste uke» (StapleManager på
// Handleliste-siden). Samme skall som QuickSheet i QuickAdd.tsx: ark nederst
// på mobil, sentrert kort på desktop, samme bakteppe/animasjoner. Esc og
// klikk utenfor = avbryt. `plan` er regnet ut av planBasisBatch() med samme
// logikk som selve innsettingen (addBasisBatch får nøyaktig dette objektet),
// så tallet i dialogen er tallet som faktisk blir lagt til.
export default function BasisvarerDialog({ plan, busy, onCancel, onConfirm }: {
  plan: BasisPlan;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  useScrollLock();
  const isMobile = window.innerWidth < 768;
  const cancelRef = useRef<HTMLButtonElement>(null);
  const n = plan.toAdd.length;
  const range = formatHandleukeRange(plan.weekStart);
  const { shown, rest } = previewNames(plan.toAdd.map(a => a.staple.name));

  // Via ref, så lytteren (og fokuset på Avbryt) settes opp én gang, ikke på
  // nytt ved hver re-render fra sanntidsoppdateringer mens dialogen er åpen.
  const cancelFn = useRef(onCancel);
  cancelFn.current = onCancel;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') cancelFn.current(); };
    document.addEventListener('keydown', onKey);
    const t = setTimeout(() => cancelRef.current?.focus(), 30);
    return () => { document.removeEventListener('keydown', onKey); clearTimeout(t); };
  }, []);

  const title = n ? 'Legge til basisvarer?' : 'Ingenting å legge til';

  return createPortal((
    <div style={{
      position: 'fixed', inset: 0, zIndex: 400, display: 'flex',
      alignItems: isMobile ? 'flex-end' : 'center', justifyContent: 'center',
      padding: isMobile ? 0 : 20,
    }}>
      <div
        onClick={onCancel}
        style={{ position: 'absolute', inset: 0, background: 'rgba(11,37,69,0.45)', animation: 'confirm-fade 0.18s ease both' }}
      />
      <div role="dialog" aria-modal="true" aria-label={title} style={{
        position: 'relative', background: 'var(--surface)',
        width: '100%', maxWidth: isMobile ? '100%' : 420,
        borderRadius: isMobile ? '16px 16px 0 0' : 12,
        maxHeight: isMobile ? '92dvh' : '86dvh', overflowY: 'auto',
        boxShadow: '0 8px 40px rgba(11,37,69,0.22)',
        animation: `${isMobile ? 'quick-sheet-up' : 'confirm-pop'} 0.22s cubic-bezier(0.18,0.9,0.32,1.1) both`,
        padding: '18px 20px',
        paddingBottom: isMobile ? 'calc(18px + env(safe-area-inset-bottom, 0px))' : 18,
      }}>
        {isMobile && (
          <div style={{ display: 'flex', justifyContent: 'center', marginTop: -8, marginBottom: 10 }}>
            <div style={{ width: 36, height: 4, borderRadius: 2, background: 'var(--line-2)' }} />
          </div>
        )}
        <div className="card-eyebrow">Basisvarer · {range}</div>
        <h3 className="card-title" style={{ marginTop: 2 }}>{title}</h3>

        {n > 0 ? (
          <>
            <p style={{ margin: '10px 0 0', fontSize: 13.5, lineHeight: 1.5, color: 'var(--ink-3)' }}>
              {varer(n)} blir lagt til handlelisten for neste handleuke ({range}).
            </p>
            <ul style={{ margin: '10px 0 0', paddingLeft: 18, fontSize: 13.5, lineHeight: 1.6, color: 'var(--ink)' }}>
              {shown.map((name, i) => <li key={i}>{name}</li>)}
              {rest > 0 && <li style={{ listStyle: 'none', marginLeft: -18, color: 'var(--ink-4)' }}>… og {rest} til</li>}
            </ul>
          </>
        ) : (
          <p style={{ margin: '10px 0 0', fontSize: 13.5, lineHeight: 1.5, color: 'var(--ink-3)' }}>
            Alle basisvarer står allerede på listen.
          </p>
        )}

        {n > 0 && plan.skipped.length > 0 && (
          <p style={{ margin: '10px 0 0', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-4)' }}>
            {varer(plan.skipped.length)} hoppes over fordi {plan.skipped.length === 1 ? 'den' : 'de'} allerede står på listen.
          </p>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20 }}>
          <button ref={cancelRef} onClick={onCancel} className="btn ghost" style={{ padding: '8px 14px' }}>
            {n ? 'Avbryt' : 'Lukk'}
          </button>
          {n > 0 && (
            <button onClick={onConfirm} disabled={busy} className="btn primary" style={{ padding: '8px 18px' }}>
              Legg til {n}
            </button>
          )}
        </div>
      </div>
    </div>
  ), document.body);
}
