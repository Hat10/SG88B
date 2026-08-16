import { useState } from 'react';
import { useMatplan, type StapleItem } from '../../contexts/MatplanContext';
import { useConfirm } from '../../contexts/ConfirmContext';
import { Card } from '../../components';
import HandlelisteCard from './HandlelisteCard';
import UnitSelect from './UnitSelect';

const emptyStapleDraft = () => ({ name: '', amount: '', unit: '', intervalWeeks: '' });

const draftFromStaple = (s: StapleItem) => ({
  name: s.name,
  amount: s.amount == null ? '' : String(s.amount),
  unit: s.unit ?? '',
  intervalWeeks: s.intervalWeeks == null ? '' : String(s.intervalWeeks),
});

// Stigende intervall øverst (korteste/hyppigste frekvens først), varer uten
// definert frekvens (intervalWeeks null — ren referanse, se isStapleDue)
// nederst. Array.sort er stabil, så uavgjort beholder navnesorteringen fra
// spørringen (.order('name')) som sekundærsortering, uten ekstra kode her.
function sortStaples(items: StapleItem[]): StapleItem[] {
  return [...items].sort((a, b) => {
    if (a.intervalWeeks == null && b.intervalWeeks == null) return 0;
    if (a.intervalWeeks == null) return 1;
    if (b.intervalWeeks == null) return -1;
    return a.intervalWeeks - b.intervalWeeks;
  });
}

function StapleManager() {
  const { stapleItems, addStaple, updateStaple, removeStaple, restoreStaple } = useMatplan();
  const { confirm } = useConfirm();
  const [draft, setDraft] = useState(emptyStapleDraft());
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  // Mengde/enhet/intervall er valgfrie å oppgi — «Legg til kjøpsfrekvens»
  // holder dem skjult til man faktisk trenger dem, siden de fleste
  // basisvarer trolig bare trenger et navn.
  const [showFrequency, setShowFrequency] = useState(false);

  const startEdit = (s: StapleItem) => {
    setEditId(s.id);
    setDraft(draftFromStaple(s));
    setShowFrequency(s.amount != null || s.unit != null || s.intervalWeeks != null);
  };
  const cancelEdit = () => {
    setEditId(null);
    setDraft(emptyStapleDraft());
    setShowFrequency(false);
  };

  const submit = async () => {
    if (!draft.name.trim()) return;
    const payload = {
      name: draft.name.trim(),
      amount: draft.amount.trim() ? Number(draft.amount.replace(',', '.')) : null,
      unit: draft.unit.trim() || null,
      // Tomt Uker-felt ⇒ null ("ingen frekvens definert"), uansett om
      // kjøpsfrekvens-seksjonen er utvidet eller ikke — se StapleItem.
      intervalWeeks: draft.intervalWeeks.trim() ? Math.max(1, Number(draft.intervalWeeks)) : null,
    };
    if (editId) {
      await updateStaple(editId, payload);
    } else {
      await addStaple({ ...payload, lastBoughtAt: null, postponedUntil: null });
    }
    cancelEdit();
  };

  const handleRemove = async (s: StapleItem) => {
    if (!await confirm({ title: 'Slett basisvare?', message: `«${s.name}»`, confirmLabel: 'Slett' })) return;
    if (editId === s.id) cancelEdit();
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
          {sortStaples(stapleItems).map(s => (
            <div key={s.id} style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px',
              background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: 6,
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <span style={{ fontSize: 13, color: 'var(--ink)' }}>{s.name}</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--ink-4)', marginLeft: 8 }}>
                  {s.intervalWeeks != null ? `hver ${s.intervalWeeks}. uke` : 'ingen fast frekvens'}
                  {s.lastBoughtAt ? ` · sist kjøpt ${s.lastBoughtAt}` : ''}
                </span>
              </div>
              <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                <button onClick={() => startEdit(s)} aria-label="Rediger basisvare" style={{
                  background: 'transparent', border: '1px solid var(--line)', borderRadius: 6,
                  cursor: 'pointer', fontSize: 13, color: 'var(--ink-4)',
                  minWidth: 32, minHeight: 32, display: 'grid', placeItems: 'center',
                }}>✎</button>
                <button onClick={() => void handleRemove(s)} aria-label="Slett basisvare" style={{
                  background: 'transparent', border: '1px solid var(--line)', borderRadius: 6,
                  cursor: 'pointer', fontSize: 14, color: 'var(--ink-4)',
                  minWidth: 32, minHeight: 32, display: 'grid', placeItems: 'center',
                }}>×</button>
              </div>
            </div>
          ))}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
            {editId && (
              <div className="card-eyebrow">Redigerer «{draft.name}»</div>
            )}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <input className="input" placeholder="Navn (f.eks. Melk)" value={draft.name}
                onChange={e => setDraft(d => ({ ...d, name: e.target.value }))}
                onKeyDown={e => e.key === 'Enter' && void submit()}
                style={{ flex: 2, minWidth: 120 }} />
              {editId && <button onClick={cancelEdit} className="btn ghost sm">Avbryt</button>}
              <button onClick={() => void submit()} className="btn primary sm" disabled={!draft.name.trim()}
                style={{ opacity: !draft.name.trim() ? 0.4 : 1 }}>{editId ? 'Lagre endring' : '+ Legg til'}</button>
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
                <UnitSelect value={draft.unit} onChange={unit => setDraft(d => ({ ...d, unit }))} style={{ flex: 1, minWidth: 90 }} />
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
