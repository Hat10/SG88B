import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useBoligflipping } from '../contexts/BoligflippingContext';
import { useConfirm } from '../contexts/ConfirmContext';
import { useScrollLock } from '../lib/useScrollLock';
import { fmtKr } from '../components';
import type { FlippingProject, FlippingCost } from '../data';

// ── Helpers ──────────────────────────────────────────────────────────────────
function formatNumberInput(value: string): string {
  return value.replace(/\D/g, '').replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}
function parseNumberInput(value: string): string {
  return value.replace(/\s/g, '');
}
const todayISO = () => new Date().toLocaleDateString('sv-SE'); // YYYY-MM-DD, local
function shiftISO(days: number) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toLocaleDateString('sv-SE');
}
function formatDate(iso: string) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('nb-NO', { day: '2-digit', month: 'short', year: 'numeric' });
}

// ── Icons (16×16, currentColor — matches the app's Ico set) ────────────────────
const I = {
  back: <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M9.5 3.5 5 8l4.5 4.5" /></svg>,
  plus: <svg width="13" height="13" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M6 2v8M2 6h8" /></svg>,
  trash: <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2"><path d="M3 4h10M6.5 4V2.8h3V4M5 4l.6 9h4.8L11 4" /></svg>,
  pencil: <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2"><path d="M11 2.5 13.5 5 6 12.5 3 13l.5-3z" /></svg>,
  tag: <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2"><path d="M2.5 2.5h5l6 6-5 5-6-6z" /><circle cx="5" cy="5" r="0.9" fill="currentColor" stroke="none" /></svg>,
  close: <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M4 4l8 8M12 4l-8 8" /></svg>,
  check: <svg width="13" height="13" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M2.5 6.5 5 9l4.5-5.5" /></svg>,
};

// ── Modal (portal to body + scroll lock + Esc, matching the Confirm dialog) ────
function Modal({ title, sub, onClose, children, maxWidth = 460 }: {
  title: string; sub?: string; onClose: () => void; children: React.ReactNode; maxWidth?: number;
}) {
  useScrollLock(true);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 2000,
        background: 'rgba(11,37,69,0.45)', backdropFilter: 'blur(3px)', WebkitBackdropFilter: 'blur(3px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
        animation: 'confirm-fade 0.15s ease both',
      }}
    >
      <div
        role="dialog" aria-modal="true" aria-label={title}
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--surface)', borderRadius: 14, width: '100%', maxWidth,
          border: '1px solid var(--line)', boxShadow: '0 16px 50px rgba(11,37,69,0.3)',
          maxHeight: '88vh', overflowY: 'auto',
          animation: 'confirm-pop 0.18s cubic-bezier(0.18,0.9,0.32,1.1) both',
        }}
      >
        <div style={{
          display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12,
          padding: '20px 22px 16px', borderBottom: '1px solid var(--line)',
        }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600, color: 'var(--ink)', letterSpacing: '-0.01em' }}>{title}</h2>
            {sub && <p style={{ margin: '4px 0 0', fontSize: 12.5, color: 'var(--ink-3)' }}>{sub}</p>}
          </div>
          <button className="btn ghost sm" onClick={onClose} aria-label="Lukk" style={{ padding: 6, marginRight: -4 }}>{I.close}</button>
        </div>
        <div style={{ padding: 22 }}>{children}</div>
      </div>
    </div>,
    document.body,
  );
}

// ── Field label ────────────────────────────────────────────────────────────────
function Label({ children }: { children: React.ReactNode }) {
  return (
    <label style={{
      fontFamily: 'var(--font-mono)', fontSize: 10, textTransform: 'uppercase',
      letterSpacing: '0.08em', color: 'var(--ink-3)',
    }}>{children}</label>
  );
}

// ── Category picker — quick-pick pills + "ny kategori" ─────────────────────────
function CategoryPicker({ used, value, onChange }: {
  used: string[]; value: string; onChange: (c: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');

  // Only categories that have actually been used, plus a typed-in custom value
  // so it shows as a selected pill while adding.
  const options = [...used];
  if (value && !options.includes(value)) options.push(value);

  const commitNew = () => {
    const v = draft.trim();
    if (v) onChange(v);
    setDraft('');
    setAdding(false);
  };

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
      {options.map(cat => {
        const on = value === cat;
        return (
          <button
            key={cat} type="button" onClick={() => onChange(cat)}
            style={{
              padding: '6px 12px', borderRadius: 999, fontSize: 13, fontWeight: 500,
              border: `1px solid ${on ? 'var(--ink)' : 'var(--line-2)'}`,
              background: on ? 'var(--ink)' : 'var(--surface)',
              color: on ? 'var(--surface)' : 'var(--ink-2)',
              cursor: 'pointer', transition: 'all .12s', display: 'inline-flex', alignItems: 'center', gap: 5,
            }}
          >
            {on && I.check}{cat}
          </button>
        );
      })}
      {adding ? (
        <input
          className="input" autoFocus value={draft}
          placeholder="Ny kategori…"
          onChange={e => setDraft(e.target.value)}
          onBlur={commitNew}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commitNew(); } if (e.key === 'Escape') { setDraft(''); setAdding(false); } }}
          style={{ width: 150, padding: '6px 12px', borderRadius: 999, fontSize: 13 }}
        />
      ) : (
        <button
          type="button" onClick={() => setAdding(true)}
          style={{
            padding: '6px 12px', borderRadius: 999, fontSize: 13, fontWeight: 500,
            border: '1px dashed var(--line-2)', background: 'transparent', color: 'var(--ink-3)',
            cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5,
          }}
        >
          {I.plus} Ny
        </button>
      )}
    </div>
  );
}

// ── Date field — styled native input + quick chips ─────────────────────────────
function DateField({ value, onChange }: { value: string; onChange: (d: string) => void }) {
  const chip = (label: string, iso: string) => {
    const on = value === iso;
    return (
      <button
        type="button" onClick={() => onChange(iso)}
        style={{
          padding: '8px 12px', borderRadius: 8, fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap',
          border: `1px solid ${on ? 'var(--ink)' : 'var(--line-2)'}`,
          background: on ? 'var(--ink)' : 'var(--surface)',
          color: on ? 'var(--surface)' : 'var(--ink-2)', cursor: 'pointer', transition: 'all .12s',
        }}
      >{label}</button>
    );
  };
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
      {chip('I dag', todayISO())}
      {chip('I går', shiftISO(-1))}
      <input
        type="date" className="input" value={value}
        onChange={e => onChange(e.target.value)}
        style={{ width: 'auto', flex: '1 1 150px', minWidth: 140 }}
      />
    </div>
  );
}

// ── Inline-editable money value (click to edit, saves on blur/Enter) ───────────
function EditableMoney({ value, onSave, big, placeholder }: {
  value: number | null; onSave: (n: number | null) => void; big?: boolean; placeholder?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const commit = () => {
    const n = parseInt(parseNumberInput(draft)) || 0;
    onSave(n > 0 ? n : null);
    setEditing(false);
  };
  const fontSize = big ? 24 : 17;

  if (editing) {
    return (
      <input
        className="input" autoFocus inputMode="numeric"
        value={formatNumberInput(draft)} placeholder={placeholder}
        onChange={e => setDraft(parseNumberInput(e.target.value))}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false); }}
        style={{ maxWidth: 200, fontSize: 16, fontWeight: 600, padding: '6px 10px' }}
      />
    );
  }
  return (
    <button
      type="button"
      onClick={() => { setDraft(value ? String(value) : ''); setEditing(true); }}
      title="Klikk for å endre"
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 8, background: 'none', border: 0, padding: 0,
        cursor: 'pointer', fontSize, fontWeight: 600, letterSpacing: '-0.01em',
        fontVariantNumeric: 'tabular-nums', color: value != null && value > 0 ? 'var(--ink)' : 'var(--ink-4)',
      }}
    >
      {value != null && value > 0 ? fmtKr(value) : (placeholder ?? 'Legg til')}
      <span style={{ color: 'var(--ink-4)', display: 'inline-flex' }}>{I.pencil}</span>
    </button>
  );
}

// ── Project card ───────────────────────────────────────────────────────────────
function ProjectCard({ project, costs, onSelect, onDelete }: {
  project: FlippingProject; costs: FlippingCost[]; onSelect: () => void; onDelete: (id: string) => void;
}) {
  const { confirm } = useConfirm();
  const totalCosts = costs.filter(c => c.project_id === project.id).reduce((s, c) => s + c.amount, 0);
  const totalSum = project.purchase_price + totalCosts;
  const sold = project.sale_price != null && project.sale_price > 0;
  const profit = sold ? (project.sale_price as number) - totalSum : null;

  return (
    <div
      role="button" tabIndex={0} onClick={onSelect}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(); } }}
      className="card"
      style={{ gap: 0, padding: 0, cursor: 'pointer', overflow: 'hidden', transition: 'border-color .15s, transform .15s' }}
      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--accent)'; (e.currentTarget as HTMLElement).style.transform = 'translateY(-2px)'; }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--line)'; (e.currentTarget as HTMLElement).style.transform = 'none'; }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, padding: '16px 16px 12px' }}>
        <div style={{ minWidth: 0 }}>
          <h3 style={{ margin: 0, fontSize: 17, fontWeight: 600, letterSpacing: '-0.01em', color: 'var(--ink)', wordBreak: 'break-word' }}>
            {project.project_name}
          </h3>
          <span className="tag" style={{ marginTop: 7, background: sold ? 'var(--accent-soft)' : 'var(--chip)', color: sold ? 'var(--accent-deep)' : 'var(--ink-3)' }}>
            {sold ? 'Solgt' : 'Aktiv'}
          </span>
        </div>
        <button
          className="btn ghost sm" aria-label="Slett prosjekt"
          onClick={async e => {
            e.stopPropagation();
            if (await confirm({ title: 'Slett prosjekt?', message: `«${project.project_name}» og alle tilknyttede kostnader slettes. Dette kan ikke angres.`, confirmLabel: 'Slett' })) onDelete(project.id);
          }}
          style={{ padding: 6, color: 'var(--ink-4)', flexShrink: 0 }}
        >{I.trash}</button>
      </div>

      {/* Figures */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '12px 16px', borderTop: '1px solid var(--line)' }}>
        <Row label="Kjøpt" value={fmtKr(project.purchase_price)} />
        <Row label="Kostnader" value={fmtKr(totalCosts)} />
        <Row label="Totalt investert" value={fmtKr(totalSum)} strong />
      </div>

      {/* Profit footer */}
      {profit !== null && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '12px 16px', borderTop: '1px solid var(--line)',
          background: profit >= 0 ? 'color-mix(in oklab, var(--good) 12%, transparent)' : 'color-mix(in oklab, var(--danger) 12%, transparent)',
        }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--ink-3)' }}>
            {profit >= 0 ? 'Fortjeneste' : 'Tap'}
          </span>
          <span style={{ fontSize: 16, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: profit >= 0 ? 'var(--good)' : 'var(--danger)' }}>
            {profit >= 0 ? '+' : ''}{fmtKr(profit)}
          </span>
        </div>
      )}
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
      <span style={{ fontSize: 13, color: 'var(--ink-3)' }}>{label}</span>
      <span style={{ fontSize: strong ? 15 : 14, fontWeight: strong ? 700 : 500, color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>{value}</span>
    </div>
  );
}

// ── Create-project modal ───────────────────────────────────────────────────────
function CreateProjectModal({ onClose, onCreate }: {
  onClose: () => void; onCreate: (name: string, price: number) => Promise<string>;
}) {
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const valid = name.trim() && price.trim();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    setSubmitting(true);
    try { await onCreate(name.trim(), parseInt(price)); onClose(); }
    finally { setSubmitting(false); }
  };

  return (
    <Modal title="Nytt prosjekt" sub="Registrer en bolig du skal pusse opp og selge" onClose={onClose}>
      <form onSubmit={submit} style={{ display: 'grid', gap: 18 }}>
        <div style={{ display: 'grid', gap: 7 }}>
          <Label>Prosjektnavn / adresse</Label>
          <input className="input" autoFocus placeholder="Olaf Schous vei 18" value={name} onChange={e => setName(e.target.value)} disabled={submitting} />
        </div>
        <div style={{ display: 'grid', gap: 7 }}>
          <Label>Kjøpspris</Label>
          <div style={{ position: 'relative' }}>
            <input className="input" inputMode="numeric" placeholder="3 500 000" value={formatNumberInput(price)} onChange={e => setPrice(parseNumberInput(e.target.value))} disabled={submitting} style={{ paddingRight: 34 }} />
            <span style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--ink-4)', pointerEvents: 'none' }}>kr</span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
          <button type="button" className="btn" onClick={onClose} disabled={submitting}>Avbryt</button>
          <button type="submit" className="btn primary" disabled={submitting || !valid} style={{ opacity: (submitting || !valid) ? 0.5 : 1 }}>
            {submitting ? 'Oppretter…' : 'Opprett prosjekt'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ── Categories manager modal ───────────────────────────────────────────────────
function CategoriesModal({ onClose, costs, updateCost, deleteCost }: {
  onClose: () => void; costs: FlippingCost[];
  updateCost: (id: string, u: Partial<FlippingCost>) => Promise<void>;
  deleteCost: (id: string) => Promise<void>;
}) {
  const { confirm } = useConfirm();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const stats = costs.reduce((acc: Record<string, { count: number; total: number }>, c) => {
    acc[c.category] = acc[c.category] || { count: 0, total: 0 };
    acc[c.category].count += 1;
    acc[c.category].total += c.amount;
    return acc;
  }, {});
  const categories = Object.entries(stats).map(([name, s]) => ({ name, ...s })).sort((a, b) => b.total - a.total);

  const rename = async (oldName: string) => {
    if (!editingName.trim() || editingName === oldName) { setEditingId(null); return; }
    setSubmitting(true);
    try {
      await Promise.all(costs.filter(c => c.category === oldName).map(c => updateCost(c.id, { category: editingName.trim() })));
      setEditingId(null); setEditingName('');
    } finally { setSubmitting(false); }
  };
  const remove = async (name: string) => {
    setSubmitting(true);
    try { await Promise.all(costs.filter(c => c.category === name).map(c => deleteCost(c.id))); }
    finally { setSubmitting(false); }
  };

  return (
    <Modal title="Kategorier" sub="Endre navn eller slett kostnadskategorier" onClose={onClose} maxWidth={520}>
      {categories.length === 0 ? (
        <div style={{ padding: '36px 20px', textAlign: 'center', background: 'var(--surface-2)', borderRadius: 10, border: '1px dashed var(--line-2)' }}>
          <p style={{ margin: 0, color: 'var(--ink-2)', fontSize: 14, fontWeight: 500 }}>Ingen kategorier ennå</p>
          <p style={{ margin: '6px 0 0', color: 'var(--ink-4)', fontSize: 12.5 }}>Legg til en kostnad — kategorien opprettes automatisk</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {categories.map(({ name, count, total }) => (
            <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', background: 'var(--surface-2)', borderRadius: 10, border: '1px solid var(--line)' }}>
              {editingId === name ? (
                <>
                  <input className="input" autoFocus value={editingName} onChange={e => setEditingName(e.target.value)} disabled={submitting}
                    onKeyDown={e => { if (e.key === 'Enter') rename(name); if (e.key === 'Escape') setEditingId(null); }} style={{ flex: 1 }} />
                  <button className="btn primary sm" onClick={() => rename(name)} disabled={submitting || !editingName.trim()}>Lagre</button>
                  <button className="btn sm" onClick={() => { setEditingId(null); setEditingName(''); }} disabled={submitting}>Avbryt</button>
                </>
              ) : (
                <>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--ink)' }}>{name}</div>
                    <div style={{ fontSize: 12, color: 'var(--ink-3)', fontVariantNumeric: 'tabular-nums' }}>
                      {count} kostnad{count !== 1 ? 'er' : ''} · {fmtKr(total)}
                    </div>
                  </div>
                  <button className="btn sm" onClick={() => { setEditingId(name); setEditingName(name); }} disabled={submitting} style={{ display: 'inline-flex', gap: 5, alignItems: 'center' }}>{I.pencil} Endre</button>
                  <button className="btn danger sm" disabled={submitting}
                    onClick={async () => { if (await confirm({ title: 'Slett kategori?', message: `«${name}» og alle ${count} kostnad${count !== 1 ? 'er' : ''} slettes. Dette kan ikke angres.`, confirmLabel: 'Slett' })) remove(name); }}
                    style={{ display: 'inline-flex', gap: 5, alignItems: 'center' }}>{I.trash}</button>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}

// ── Grid (project list) ──────────────────────────────────────────────────────────
function GridView({ projects, costs, onSelectProject, onCreateProject, onDeleteProject, loading }: {
  projects: FlippingProject[]; costs: FlippingCost[];
  onSelectProject: (id: string) => void;
  onCreateProject: (name: string, price: number) => Promise<string>;
  onDeleteProject: (id: string) => Promise<void>;
  loading: boolean;
}) {
  const [showCreate, setShowCreate] = useState(false);
  const [showCategories, setShowCategories] = useState(false);
  const { updateCost, deleteCost } = useBoligflipping();

  const totalInvested = projects.reduce((s, p) =>
    s + p.purchase_price + costs.filter(c => c.project_id === p.id).reduce((a, c) => a + c.amount, 0), 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18, paddingBottom: 24 }}>
      {showCreate && <CreateProjectModal onClose={() => setShowCreate(false)} onCreate={onCreateProject} />}
      {showCategories && <CategoriesModal onClose={() => setShowCategories(false)} costs={costs} updateCost={updateCost} deleteCost={deleteCost} />}

      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 20 }}>
          <div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--ink-3)' }}>Prosjekter</div>
            <div style={{ fontSize: 22, fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: 'var(--ink)' }}>{projects.length}</div>
          </div>
          <div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--ink-3)' }}>Totalt investert</div>
            <div style={{ fontSize: 22, fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: 'var(--ink)' }}>{fmtKr(totalInvested)}</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn" onClick={() => setShowCategories(true)} style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>{I.tag} Kategorier</button>
          <button className="btn primary" onClick={() => setShowCreate(true)} style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>{I.plus} Nytt prosjekt</button>
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--ink-3)' }}>Laster…</div>
      ) : projects.length === 0 ? (
        <div className="card" style={{ alignItems: 'center', textAlign: 'center', padding: '48px 24px', gap: 6 }}>
          <p style={{ margin: 0, fontSize: 15, fontWeight: 600, color: 'var(--ink)' }}>Ingen prosjekter ennå</p>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--ink-3)' }}>Legg til din første bolig for å spore kjøp, oppussing og salg.</p>
          <button className="btn primary" onClick={() => setShowCreate(true)} style={{ marginTop: 10, display: 'inline-flex', gap: 6, alignItems: 'center' }}>{I.plus} Nytt prosjekt</button>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
          {projects.map(p => (
            <ProjectCard key={p.id} project={p} costs={costs} onSelect={() => onSelectProject(p.id)} onDelete={onDeleteProject} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Cost form — handles both new costs and editing an existing one ───────────────
function CostForm({ usedCategories, initial, embedded, onCancel, onSave }: {
  usedCategories: string[];
  initial?: { category: string; description: string; amount: number; date: string };
  embedded?: boolean;
  onCancel: () => void;
  onSave: (category: string, description: string, amount: number, date: string) => Promise<void>;
}) {
  const isEdit = !!initial;
  const [category, setCategory] = useState(initial?.category ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [amount, setAmount] = useState(initial ? String(initial.amount) : '');
  const [date, setDate] = useState(initial?.date ?? todayISO());
  const [submitting, setSubmitting] = useState(false);
  const valid = category.trim() && description.trim() && amount.trim();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    setSubmitting(true);
    try {
      await onSave(category.trim(), description.trim(), parseInt(amount), date);
      onCancel();
    } finally { setSubmitting(false); }
  };

  return (
    <form onSubmit={submit} className={embedded ? undefined : 'card'}
      style={{ display: 'flex', flexDirection: 'column', gap: 18, background: 'var(--surface-2)', ...(embedded ? { padding: 16 } : {}) }}>
      <div style={{ display: 'grid', gap: 8 }}>
        <Label>Kategori</Label>
        <CategoryPicker used={usedCategories} value={category} onChange={setCategory} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14 }}>
        <div style={{ display: 'grid', gap: 8 }}>
          <Label>Beskrivelse</Label>
          <input className="input" placeholder="F.eks. Parkett stue + gang" value={description} onChange={e => setDescription(e.target.value)} disabled={submitting} />
        </div>
        <div style={{ display: 'grid', gap: 8 }}>
          <Label>Beløp</Label>
          <div style={{ position: 'relative' }}>
            <input className="input" inputMode="numeric" placeholder="0" value={formatNumberInput(amount)} onChange={e => setAmount(parseNumberInput(e.target.value))} disabled={submitting} style={{ paddingRight: 34 }} />
            <span style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--ink-4)', pointerEvents: 'none' }}>kr</span>
          </div>
        </div>
      </div>
      <div style={{ display: 'grid', gap: 8 }}>
        <Label>Dato</Label>
        <DateField value={date} onChange={setDate} />
      </div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', borderTop: '1px solid var(--line)', paddingTop: 16 }}>
        <button type="button" className="btn" onClick={onCancel} disabled={submitting}>Avbryt</button>
        <button type="submit" className="btn primary" disabled={submitting || !valid} style={{ opacity: (submitting || !valid) ? 0.5 : 1, display: 'inline-flex', gap: 6, alignItems: 'center' }}>
          {isEdit ? I.check : I.plus} {isEdit ? 'Lagre endringer' : 'Legg til kostnad'}
        </button>
      </div>
    </form>
  );
}

// ── Detail view (single project) ───────────────────────────────────────────────
function DetailView({ project, costs, onBack }: {
  project: FlippingProject; costs: FlippingCost[]; onBack: () => void;
}) {
  const { confirm } = useConfirm();
  const { updateProject, addCost, updateCost, deleteCost } = useBoligflipping();
  const [editingName, setEditingName] = useState(false);
  const [name, setName] = useState(project.project_name);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const projectCosts = costs.filter(c => c.project_id === project.id)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  const totalCosts = projectCosts.reduce((s, c) => s + c.amount, 0);
  const totalSum = project.purchase_price + totalCosts;
  const sold = project.sale_price != null && project.sale_price > 0;
  const profit = sold ? (project.sale_price as number) - totalSum : null;
  // Categories used across every project, so quick-pick works without retyping.
  const usedCategories = Array.from(new Set(costs.map(c => c.category))).sort();

  const breakdown = Object.entries(
    projectCosts.reduce((acc: Record<string, number>, c) => { acc[c.category] = (acc[c.category] || 0) + c.amount; return acc; }, {})
  ).sort((a, b) => b[1] - a[1]);
  const maxCat = breakdown.length ? breakdown[0][1] : 1;

  const saveName = async () => {
    if (name.trim() && name !== project.project_name) await updateProject(project.id, { project_name: name.trim() });
    setEditingName(false);
  };

  const eyebrow: React.CSSProperties = { fontFamily: 'var(--font-mono)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--ink-3)' };
  const statBox: React.CSSProperties = { flex: '1 1 150px', background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--radius-lg)', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 6 };
  const statVal: React.CSSProperties = { fontSize: 17, fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: 'var(--ink)' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18, paddingBottom: 24 }}>
      <button className="btn ghost" onClick={onBack} style={{ alignSelf: 'flex-start', display: 'inline-flex', gap: 6, alignItems: 'center', marginLeft: -8 }}>
        {I.back} Alle prosjekter
      </button>

      {/* Title row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        {editingName ? (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flex: 1 }}>
            <input className="input" autoFocus value={name} onChange={e => setName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') saveName(); if (e.key === 'Escape') { setName(project.project_name); setEditingName(false); } }}
              style={{ flex: 1, fontSize: 22, fontWeight: 600, maxWidth: 480 }} />
            <button className="btn primary" onClick={saveName} disabled={!name.trim()}>Lagre</button>
            <button className="btn" onClick={() => { setName(project.project_name); setEditingName(false); }}>Avbryt</button>
          </div>
        ) : (
          <>
            <button onClick={() => setEditingName(true)} title="Klikk for å endre navn"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 10, background: 'none', border: 0, padding: 0, cursor: 'pointer', textAlign: 'left' }}>
              <h2 style={{ margin: 0, fontSize: 'clamp(20px, 6vw, 26px)', fontWeight: 600, letterSpacing: '-0.02em', color: 'var(--ink)' }}>{project.project_name}</h2>
              <span style={{ color: 'var(--ink-4)', display: 'inline-flex' }}>{I.pencil}</span>
            </button>
            <span className="tag" style={{ background: sold ? 'var(--accent-soft)' : 'var(--chip)', color: sold ? 'var(--accent-deep)' : 'var(--ink-3)' }}>
              {sold ? 'Solgt' : 'Aktiv'}
            </span>
          </>
        )}
      </div>

      {/* KPI strip — wrapping bordered boxes (no empty cells on any width) */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
        <div style={statBox}>
          <span style={eyebrow}>Kjøpspris</span>
          <EditableMoney value={project.purchase_price} onSave={n => updateProject(project.id, { purchase_price: n ?? 0 })} />
        </div>
        <div style={statBox}>
          <span style={eyebrow}>Kostnader</span>
          <span style={statVal}>{fmtKr(totalCosts)}</span>
        </div>
        <div style={statBox}>
          <span style={eyebrow}>Totalt investert</span>
          <span style={{ ...statVal, fontWeight: 700 }}>{fmtKr(totalSum)}</span>
        </div>
        <div style={statBox}>
          <span style={eyebrow}>Salgspris</span>
          <EditableMoney value={project.sale_price} placeholder="Ikke solgt" onSave={n => updateProject(project.id, { sale_price: n })} />
        </div>
        <div style={{
          ...statBox,
          background: profit == null ? 'var(--surface)' : profit >= 0 ? 'color-mix(in oklab, var(--good) 14%, var(--surface))' : 'color-mix(in oklab, var(--danger) 14%, var(--surface))',
          borderColor: profit == null ? 'var(--line)' : profit >= 0 ? 'color-mix(in oklab, var(--good) 35%, var(--line))' : 'color-mix(in oklab, var(--danger) 35%, var(--line))',
        }}>
          <span style={eyebrow}>{profit != null && profit < 0 ? 'Tap' : 'Fortjeneste'}</span>
          <span style={{ ...statVal, fontWeight: 700, color: profit == null ? 'var(--ink-4)' : profit >= 0 ? 'var(--good)' : 'var(--danger)' }}>
            {profit == null ? '—' : (profit >= 0 ? '+' : '') + fmtKr(profit)}
          </span>
        </div>
      </div>

      {/* Category breakdown */}
      {breakdown.length > 0 && (
        <div className="card">
          <div className="section-h"><h3>Per kategori</h3><span className="meta">{fmtKr(totalCosts)}</span></div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {breakdown.map(([cat, amt]) => (
              <div key={cat} style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13 }}>
                  <span style={{ color: 'var(--ink-2)', fontWeight: 500 }}>{cat}</span>
                  <span style={{ color: 'var(--ink)', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{fmtKr(amt)}</span>
                </div>
                <div style={{ height: 6, borderRadius: 3, background: 'var(--chip)', overflow: 'hidden' }}>
                  {/* True proportion; a 3px floor keeps tiny values visible without inflating them */}
                  <div style={{ height: '100%', width: `max(3px, ${(amt / maxCat) * 100}%)`, background: 'var(--accent)', borderRadius: 3 }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Costs */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: 'var(--ink)' }}>
            Kostnader <span style={{ color: 'var(--ink-4)', fontWeight: 400 }}>· {projectCosts.length}</span>
          </h3>
          {!showForm && (
            <button className="btn primary" onClick={() => { setShowForm(true); setEditingId(null); }} style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>{I.plus} Legg til kostnad</button>
          )}
        </div>

        {showForm && (
          <CostForm
            usedCategories={usedCategories}
            onCancel={() => setShowForm(false)}
            onSave={(category, description, amount, date) => addCost(project.id, category, description, amount, date)}
          />
        )}

        {projectCosts.length === 0 && !showForm ? (
          <div className="card" style={{ alignItems: 'center', textAlign: 'center', padding: '36px 24px', gap: 4 }}>
            <p style={{ margin: 0, fontSize: 14, fontWeight: 500, color: 'var(--ink-2)' }}>Ingen kostnader registrert</p>
            <p style={{ margin: 0, fontSize: 12.5, color: 'var(--ink-4)' }}>Legg til materialer, håndverkere og annet du bruker på prosjektet.</p>
          </div>
        ) : projectCosts.length > 0 && (
          <div className="card" style={{ padding: 0, gap: 0 }}>
            {projectCosts.map((c, i) => (
              editingId === c.id ? (
                <div key={c.id} style={{ borderTop: i === 0 ? 0 : '1px solid var(--line)' }}>
                  <CostForm
                    embedded
                    usedCategories={usedCategories}
                    initial={{ category: c.category, description: c.description, amount: c.amount, date: c.date }}
                    onCancel={() => setEditingId(null)}
                    onSave={(category, description, amount, date) => updateCost(c.id, { category, description, amount, date })}
                  />
                </div>
              ) : (
                <div key={c.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '12px 16px', borderTop: i === 0 ? 0 : '1px solid var(--line)' }}>
                  <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 5 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10 }}>
                      <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--ink)', wordBreak: 'break-word', minWidth: 0 }}>{c.description}</span>
                      <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', flexShrink: 0 }}>{fmtKr(c.amount)}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-3)', fontVariantNumeric: 'tabular-nums' }}>{formatDate(c.date)}</span>
                      <span className="tag">{c.category}</span>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 2, flexShrink: 0, marginTop: 1 }}>
                    <button className="btn ghost sm" aria-label="Rediger kostnad" onClick={() => { setEditingId(c.id); setShowForm(false); }} style={{ padding: 6, color: 'var(--ink-4)' }}>{I.pencil}</button>
                    <button className="btn ghost sm" aria-label="Slett kostnad" onClick={async () => { if (await confirm({ title: 'Slett kostnad?', message: `«${c.description}» (${fmtKr(c.amount)}) slettes.`, confirmLabel: 'Slett' })) deleteCost(c.id); }} style={{ padding: 6, color: 'var(--ink-4)' }}>{I.trash}</button>
                  </div>
                </div>
              )
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────────
export default function PageBoligflipping() {
  const { projects, costs, loading, createProject, deleteProject } = useBoligflipping();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = projects.find(p => p.id === selectedId);

  if (selected) {
    return <DetailView project={selected} costs={costs} onBack={() => setSelectedId(null)} />;
  }
  return (
    <GridView
      projects={projects} costs={costs} loading={loading}
      onSelectProject={setSelectedId} onCreateProject={createProject} onDeleteProject={deleteProject}
    />
  );
}
