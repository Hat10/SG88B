import { useState } from 'react';
import { useMatplan, INGREDIENT_UNITS, type StapleItem } from '../../contexts/MatplanContext';
import { useConfirm } from '../../contexts/ConfirmContext';
import { Card } from '../../components';
import HandlelisteCard from './HandlelisteCard';

const emptyStapleDraft = () => ({ name: '', amount: '', unit: '', intervalWeeks: '1' });

function StapleManager() {
  const { stapleItems, addStaple, removeStaple, restoreStaple } = useMatplan();
  const { confirm } = useConfirm();
  const [draft, setDraft] = useState(emptyStapleDraft());
  const [open, setOpen] = useState(false);
  // Mengde/enhet/intervall er valgfrie å oppgi — «Legg til kjøpsfrekvens»
  // holder dem skjult til man faktisk trenger dem, siden de fleste
  // basisvarer trolig bare trenger et navn.
  const [showFrequency, setShowFrequency] = useState(false);

  const submit = async () => {
    if (!draft.name.trim()) return;
    await addStaple({
      name: draft.name.trim(),
      amount: draft.amount.trim() ? Number(draft.amount.replace(',', '.')) : null,
      unit: draft.unit.trim() || null,
      intervalWeeks: Math.max(1, Number(draft.intervalWeeks) || 1),
      lastBoughtAt: null,
      postponedUntil: null,
    });
    setDraft(emptyStapleDraft());
    setShowFrequency(false);
  };

  const handleRemove = async (s: StapleItem) => {
    if (!await confirm({ title: 'Slett basisvare?', message: `«${s.name}»`, confirmLabel: 'Slett' })) return;
    await removeStaple(s.id);
  };

  return (
    <Card eyebrow="Basisvarer" title="Faste og sjeldne basisvarer" action={
      <button onClick={() => setOpen(o => !o)} className="btn ghost sm">{open ? 'Skjul' : 'Administrer'}</button>
    }>
      {!open && (
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-4)' }}>
          {stapleItems.length} basisvare{stapleItems.length === 1 ? '' : 'r'} definert
        </div>
      )}
      {open && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {stapleItems.map(s => (
            <div key={s.id} style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px',
              background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: 6,
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <span style={{ fontSize: 13, color: 'var(--ink)' }}>{s.name}</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--ink-4)', marginLeft: 8 }}>
                  hver {s.intervalWeeks}. uke{s.lastBoughtAt ? ` · sist kjøpt ${s.lastBoughtAt}` : ''}
                </span>
              </div>
              <button onClick={() => void handleRemove(s)} aria-label="Slett basisvare" style={{
                background: 'transparent', border: '1px solid var(--line)', borderRadius: 6,
                cursor: 'pointer', fontSize: 14, color: 'var(--ink-4)', flexShrink: 0,
                minWidth: 32, minHeight: 32, display: 'grid', placeItems: 'center',
              }}>×</button>
            </div>
          ))}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <input className="input" placeholder="Navn (f.eks. Melk)" value={draft.name}
                onChange={e => setDraft(d => ({ ...d, name: e.target.value }))}
                onKeyDown={e => e.key === 'Enter' && void submit()}
                style={{ flex: 2, minWidth: 120 }} />
              <button onClick={() => void submit()} className="btn primary sm" disabled={!draft.name.trim()}
                style={{ opacity: !draft.name.trim() ? 0.4 : 1 }}>+ Legg til</button>
            </div>

            {!showFrequency && (
              <button onClick={() => setShowFrequency(true)} className="btn ghost sm" style={{ alignSelf: 'flex-start' }}>
                + Legg til kjøpsfrekvens
              </button>
            )}

            {showFrequency && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <input className="input" placeholder="Mengde" inputMode="decimal" value={draft.amount}
                  onChange={e => setDraft(d => ({ ...d, amount: e.target.value }))} style={{ flex: 1, minWidth: 70 }} />
                <select className="input" value={draft.unit}
                  onChange={e => setDraft(d => ({ ...d, unit: e.target.value }))} style={{ flex: 1, minWidth: 90 }}>
                  <option value="">Enhet</option>
                  {INGREDIENT_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                </select>
                <input className="input" placeholder="Uker" inputMode="numeric" value={draft.intervalWeeks}
                  onChange={e => setDraft(d => ({ ...d, intervalWeeks: e.target.value.replace(/\D/g, '') }))}
                  style={{ flex: 1, minWidth: 60 }} />
              </div>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}

export default function DagligvarerTab() {
  return (
    <div className="grid grid-12">
      <div className="col-12"><HandlelisteCard /></div>
      <div className="col-12"><StapleManager /></div>
    </div>
  );
}
