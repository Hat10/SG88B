import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useScrollLock } from '../lib/useScrollLock';
import { useBucket, type BucketEntry } from '../contexts/BucketContext';
import { useSnackbar } from '../contexts/SnackbarContext';
import { useConfirm } from '../contexts/ConfirmContext';
import { Check, Fab, SkeletonList } from '../components';
import type { Who } from '../data';
import { burst } from '../confetti';

// ─── helpers ───────────────────────────────────────────────────────────────

const WHO_LABEL: Record<Who, string> = { f: 'Felles', M: 'Mikkel', L: 'Leah' };
const WHO_COLOR: Record<Who, string> = { f: 'var(--good)', M: 'var(--accent)', L: 'var(--ink)' };

const CAT_PALETTE = [
  '#3B82B8','#7AB394','#C9963A','#D95F5F','#8B6EC9','#4A8A6E','#C97A3B','#5A6B82',
];
const catColor = (cats: string[], name: string) => CAT_PALETTE[cats.indexOf(name) % CAT_PALETTE.length] ?? 'var(--ink-4)';

// ─── Category management modal ─────────────────────────────────────────────

function CatModal({ categories, onAdd, onRename, onRemove, onClose }: {
  categories: string[];
  onAdd: (name: string) => Promise<void>;
  onRename: (oldName: string, newName: string) => Promise<void>;
  onRemove: (name: string) => Promise<void>;
  onClose: () => void;
}) {
  const [input, setInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<string | null>(null); // category being renamed
  const [editVal, setEditVal] = useState('');
  const { notify } = useSnackbar();
  const { confirm } = useConfirm();
  useScrollLock();

  const add = async () => {
    const name = input.trim();
    if (!name || categories.includes(name)) return;
    setSaving(true);
    await onAdd(name);
    setInput('');
    setSaving(false);
  };

  const saveRename = async (oldName: string) => {
    const name = editVal.trim();
    if (!name) return;
    if (name !== oldName && categories.includes(name)) { notify('Kategorien finnes allerede'); return; }
    if (name !== oldName) {
      await onRename(oldName, name);
      notify(`Kategori endret til «${name}»`);
    }
    setEditing(null);
  };

  return createPortal((
    <div style={{ position: 'fixed', inset: 0, zIndex: 302, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(11,37,69,0.45)' }} onClick={onClose} />
      <div style={{
        position: 'relative', background: 'var(--surface)', borderRadius: 12,
        width: '100%', maxWidth: 400, boxShadow: '0 8px 40px rgba(11,37,69,0.18)',
        display: 'flex', flexDirection: 'column', maxHeight: '80dvh', overflow: 'hidden',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 20px 12px', borderBottom: '1px solid var(--line)', flexShrink: 0 }}>
          <div>
            <div className="card-eyebrow">Innstillinger</div>
            <h3 className="card-title" style={{ marginTop: 2 }}>🏷️ Kategorier</h3>
          </div>
          <button onClick={onClose} style={{ background: 'transparent', border: '1px solid var(--line)', borderRadius: 6, minWidth: 32, minHeight: 32, display: 'grid', placeItems: 'center', cursor: 'pointer', fontSize: 16, color: 'var(--ink-3)' }}>×</button>
        </div>
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '12px 20px' }}>
          {categories.length === 0 && (
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--ink-4)', padding: '8px 0' }}>Ingen kategorier ennå</div>
          )}
          {categories.map(cat => (
            <div key={cat} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '8px 0', borderBottom: '1px solid var(--line)' }}>
              {editing === cat ? (
                <>
                  <input className="input" autoFocus value={editVal}
                    onChange={e => setEditVal(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') void saveRename(cat); if (e.key === 'Escape') setEditing(null); }}
                    style={{ flex: 1, minWidth: 0 }} />
                  <button onClick={() => void saveRename(cat)} className="btn primary sm" style={{ flexShrink: 0 }}>Lagre</button>
                  <button onClick={() => setEditing(null)} aria-label="Avbryt" style={{ background: 'transparent', border: '1px solid var(--line)', borderRadius: 4, padding: '5px 9px', cursor: 'pointer', fontSize: 13, color: 'var(--ink-4)', flexShrink: 0 }}>×</button>
                </>
              ) : (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: catColor(categories, cat), flexShrink: 0 }} />
                    <span style={{ fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cat}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                    <button onClick={() => { setEditing(cat); setEditVal(cat); }} aria-label={`Gi nytt navn til ${cat}`} style={{ background: 'transparent', border: '1px solid var(--line)', borderRadius: 4, padding: '5px 9px', cursor: 'pointer', fontSize: 13, color: 'var(--ink-4)' }}>✎</button>
                    <button onClick={async () => { if (!await confirm({ title: 'Slett kategori?', message: `«${cat}»`, confirmLabel: 'Slett' })) return; void onRemove(cat); notify('Kategori slettet', { actionLabel: 'Angre', onAction: () => void onAdd(cat) }); }} aria-label={`Slett kategori ${cat}`} style={{ background: 'transparent', border: '1px solid var(--line)', borderRadius: 4, padding: '5px 9px', cursor: 'pointer', fontSize: 13, color: 'var(--ink-4)' }}>×</button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
        <div style={{ padding: '12px 20px 20px', borderTop: '1px solid var(--line)', flexShrink: 0, display: 'flex', gap: 8 }}>
          <input className="input" placeholder="Ny kategori…" value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && void add()}
            style={{ flex: 1 }} />
          <button onClick={() => void add()} disabled={!input.trim() || saving} className="btn primary"
            style={{ opacity: !input.trim() ? 0.4 : 1 }}>Legg til</button>
        </div>
      </div>
    </div>
  ), document.body);
}

// ─── Full-screen edit screen (mobile) ──────────────────────────────────────

function EditScreen({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useScrollLock();
  return createPortal((
    <div style={{ position: 'fixed', inset: 0, zIndex: 301, background: 'var(--surface)', display: 'flex', flexDirection: 'column' }}>
      <div style={{ position: 'sticky', top: 0, zIndex: 1, background: 'var(--surface)', flexShrink: 0, borderBottom: '1px solid var(--line)' }}>
        <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 12 }}>
          <div style={{ width: 36, height: 4, borderRadius: 2, background: 'var(--line-2)' }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 20px 12px' }}>
          <div>
            <div className="card-eyebrow">Rediger</div>
            <h3 className="card-title" style={{ marginTop: 2 }}>{title}</h3>
          </div>
          <button onClick={onClose} style={{ background: 'transparent', border: '1px solid var(--line)', borderRadius: 6, cursor: 'pointer', fontSize: 16, color: 'var(--ink-3)', minWidth: 36, minHeight: 36, display: 'grid', placeItems: 'center' }}>×</button>
        </div>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '20px', paddingBottom: 'calc(24px + env(safe-area-inset-bottom, 0px))' }}>
        {children}
      </div>
    </div>
  ), document.body);
}

// ─── Item card ─────────────────────────────────────────────────────────────

function BucketCard({ item, catColor, onToggle, onEdit, onRemove }: {
  item: BucketEntry; catColor: string;
  onToggle: () => void; onEdit: () => void; onRemove: () => void;
}) {
  const checkRef = useRef<HTMLDivElement>(null);

  const handleToggle = () => {
    if (!item.done && checkRef.current) {
      const r = checkRef.current.getBoundingClientRect();
      burst(r.left + r.width / 2, r.top + r.height / 2);
    }
    onToggle();
  };

  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 8,
      padding: '16px', display: 'flex', flexDirection: 'column', gap: 10,
      opacity: item.done ? 0.55 : 1, borderTop: `3px solid ${item.done ? 'var(--line)' : catColor}`,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          {item.category && (
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.08em', color: item.done ? 'var(--ink-4)' : catColor, marginBottom: 4 }}>
              {item.category}
            </div>
          )}
          <div style={{ fontSize: 15, fontWeight: 600, lineHeight: 1.3, color: 'var(--ink)', textDecoration: item.done ? 'line-through' : 'none', textDecorationColor: 'var(--line-2)' }}>
            {item.title}
          </div>
          {item.description && (
            <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 4, lineHeight: 1.4, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
              {item.description}
            </div>
          )}
        </div>
        <div ref={checkRef}><Check on={item.done} onClick={handleToggle} /></div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: WHO_COLOR[item.who], flexShrink: 0 }} />
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--ink-3)' }}>{WHO_LABEL[item.who]}</span>
          {item.done && item.doneYear && (
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--ink-4)' }}>· ✓ {item.doneYear}</span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          <button onClick={onEdit} aria-label="Rediger" style={{ background: 'transparent', border: '1px solid var(--line)', borderRadius: 5, minWidth: 40, minHeight: 40, display: 'grid', placeItems: 'center', cursor: 'pointer', fontSize: 13, color: 'var(--ink-4)' }}>✎</button>
          <button onClick={onRemove} aria-label="Slett aktivitet" style={{ background: 'transparent', border: '1px solid var(--line)', borderRadius: 5, minWidth: 40, minHeight: 40, display: 'grid', placeItems: 'center', cursor: 'pointer', fontSize: 16, color: 'var(--ink-4)' }}>×</button>
        </div>
      </div>
    </div>
  );
}

// ─── Main page ─────────────────────────────────────────────────────────────

export default function PageBucket() {
  const { items, categories, loading, addItem, updateItem, toggleItem, removeItem, addCategory, renameCategory, removeCategory } = useBucket();
  const { notify } = useSnackbar();
  const { confirm } = useConfirm();

  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768);
  useEffect(() => {
    const update = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  const [catFilter,     setCatFilter]     = useState('alle');
  const [whoFilter,     setWhoFilter]     = useState<Who | 'alle'>('alle');
  const [manageCats,    setManageCats]    = useState(false);
  const [editId,        setEditId]        = useState<string | null>(null);
  const [mobileAdd,     setMobileAdd]     = useState(false);
  const [saving,        setSaving]        = useState(false);

  // Form state
  const [title,    setTitle]    = useState('');
  const [desc,     setDesc]     = useState('');
  const [cat,      setCat]      = useState('');
  const [who,      setWho]      = useState<Who>('f');

  const resetForm = () => { setTitle(''); setDesc(''); setCat(''); setWho('f'); };

  const startEdit = (id: string) => {
    const it = items.find(i => i.id === id);
    if (!it) return;
    setEditId(id);
    setTitle(it.title);
    setDesc(it.description ?? '');
    setCat(it.category);
    setWho(it.who);
    if (!isMobile) window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const cancelEdit = () => { setEditId(null); setMobileAdd(false); resetForm(); };

  const handleDelete = async (item: BucketEntry) => {
    if (!await confirm({ title: 'Slett aktivitet?', message: `«${item.title}»`, confirmLabel: 'Slett' })) return;
    if (editId === item.id) cancelEdit();
    void removeItem(item.id);
    notify('Aktivitet slettet', {
      actionLabel: 'Angre',
      onAction: () => void addItem({
        title: item.title, description: item.description, category: item.category,
        who: item.who, done: item.done, doneYear: item.doneYear,
      }),
    });
  };

  const submit = async () => {
    if (!title.trim() || !cat || saving) return;
    setSaving(true);
    try {
      if (editId) {
        await updateItem(editId, { title: title.trim(), description: desc.trim() || undefined, category: cat, who });
        cancelEdit();
      } else {
        await addItem({ title: title.trim(), description: desc.trim() || undefined, category: cat, who, done: false });
        resetForm();
      }
    } finally { setSaving(false); }
  };

  const baseFiltered = items
    .filter(it => catFilter === 'alle' || it.category === catFilter)
    .filter(it => whoFilter === 'alle' || it.who === whoFilter);
  const filtered = baseFiltered.filter(it => !it.done);
  const doneItems = baseFiltered.filter(it => it.done);
  const doneCount  = items.filter(i => i.done).length;
  const total = items.length;

  const btnStyle = (active: boolean): React.CSSProperties => ({
    padding: '5px 12px', borderRadius: 20, cursor: 'pointer', fontSize: 12, fontWeight: 500,
    border: active ? '0' : '1px solid var(--line-2)',
    background: active ? 'var(--ink)' : 'transparent',
    color: active ? 'var(--surface)' : 'var(--ink-3)',
    fontFamily: 'var(--font-mono)',
  });

  const whoStyle = (w: Who): React.CSSProperties => ({
    flex: 1, padding: '6px 0', borderRadius: 6, cursor: 'pointer', fontSize: 11,
    fontFamily: 'var(--font-mono)', border: `1px solid ${who === w ? WHO_COLOR[w] : 'var(--line-2)'}`,
    background: who === w ? `${WHO_COLOR[w]}18` : 'transparent',
    color: who === w ? WHO_COLOR[w] : 'var(--ink-4)',
  });

  const editItem = editId ? items.find(i => i.id === editId) : null;

  const formInner = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div>
        <div className="card-eyebrow" style={{ marginBottom: 4 }}>Tittel <span style={{ color: 'var(--warn)' }}>*</span></div>
        <input className="input" placeholder="🎯 Hva vil dere gjøre?" value={title}
          onChange={e => setTitle(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && void submit()}
          style={{ width: '100%' }} />
      </div>

      <div>
        <div className="card-eyebrow" style={{ marginBottom: 4 }}>Beskrivelse <span style={{ opacity: 0.5 }}>(valgfri)</span></div>
        <textarea className="input" placeholder="📝 Flere detaljer, notater, ønsker…" value={desc}
          onChange={e => setDesc(e.target.value)} rows={2}
          style={{ width: '100%', resize: 'vertical' }} />
      </div>

      <div>
        <div className="card-eyebrow" style={{ marginBottom: 4 }}>Kategori <span style={{ color: 'var(--warn)' }}>*</span></div>
        {categories.length === 0 ? (
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-4)', padding: '6px 0' }}>
            Legg til kategorier under "Kategorier ✎" først
          </div>
        ) : (
          <select className="input" value={cat} onChange={e => setCat(e.target.value)} style={{ width: '100%' }}>
            <option value="" disabled>Velg kategori…</option>
            {categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        )}
      </div>

      <div>
        <div className="card-eyebrow" style={{ marginBottom: 6 }}>Hvem</div>
        <div style={{ display: 'flex', gap: 6 }}>
          {(['f', 'M', 'L'] as Who[]).map(w => (
            <button key={w} onClick={() => setWho(w)} style={whoStyle(w)}>{WHO_LABEL[w]}</button>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
        {editId && <button onClick={cancelEdit} className="btn ghost" style={{ flex: 1, justifyContent: 'center' }}>Avbryt</button>}
        <button onClick={() => void submit()} className="btn primary"
          disabled={!title.trim() || !cat || saving}
          style={{ flex: 1, justifyContent: 'center', opacity: (!title.trim() || !cat || saving) ? 0.4 : 1 }}>
          {saving ? 'Lagrer…' : (title.trim() && !cat) ? 'Velg en kategori' : editId ? 'Lagre endring' : 'Legg til aktivitet'}
        </button>
      </div>
    </div>
  );

  return (
    <>
      {/* Mobile: add button + filter dropdowns */}
      {isMobile && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 4 }}>
          <button onClick={() => { resetForm(); setMobileAdd(true); }} className="btn primary" style={{ justifyContent: 'center' }}>
            + Legg til aktivitet
          </button>
          <div style={{ display: 'flex', gap: 8 }}>
            <select className="input" value={catFilter} onChange={e => setCatFilter(e.target.value)} style={{ flex: 1 }}>
              <option value="alle">Alle kategorier</option>
              {categories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <select className="input" value={whoFilter} onChange={e => setWhoFilter(e.target.value as Who | 'alle')} style={{ flex: 1 }}>
              <option value="alle">Alle</option>
              {(['f', 'M', 'L'] as Who[]).map(w => <option key={w} value={w}>{WHO_LABEL[w]}</option>)}
            </select>
            <button onClick={() => setManageCats(true)} className="btn ghost" style={{ flexShrink: 0, padding: '0 12px' }} title="Administrer kategorier">✎</button>
          </div>
        </div>
      )}

      {/* Desktop: filter chips */}
      {!isMobile && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ display: 'flex', gap: 6, overflowX: 'auto', flex: 1, paddingBottom: 2, scrollbarWidth: 'none' }}>
              <button style={{ ...btnStyle(catFilter === 'alle'), flexShrink: 0 }} onClick={() => setCatFilter('alle')}>
                Alle <span style={{ opacity: 0.5, marginLeft: 4 }}>{total}</span>
              </button>
              {categories.map(c => (
                <button key={c} style={{
                  ...btnStyle(catFilter === c), flexShrink: 0,
                  background: catFilter === c ? catColor(categories, c) : 'transparent',
                  border: catFilter === c ? '0' : `1px solid var(--line-2)`,
                }} onClick={() => setCatFilter(c)}>
                  {c}
                  <span style={{ opacity: 0.55, marginLeft: 4 }}>{items.filter(i => i.category === c).length}</span>
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
              {total > 0 && (
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--ink-4)' }}>
                  {doneCount} / {total} fullført
                </span>
              )}
              <button onClick={() => setManageCats(true)} className="btn ghost" style={{ flexShrink: 0 }}>
                🏷️ Kategorier ✎
              </button>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button style={{ ...btnStyle(whoFilter === 'alle'), flexShrink: 0 }} onClick={() => setWhoFilter('alle')}>Alle</button>
            {(['f', 'M', 'L'] as Who[]).map(w => (
              <button key={w} style={{
                ...btnStyle(whoFilter === w), flexShrink: 0,
                background: whoFilter === w ? WHO_COLOR[w] : 'transparent',
                border: whoFilter === w ? '0' : `1px solid var(--line-2)`,
              }} onClick={() => setWhoFilter(w)}>
                {WHO_LABEL[w]}
                <span style={{ opacity: 0.55, marginLeft: 4 }}>{items.filter(i => i.who === w).length}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-12">
        {/* Card grid */}
        <div className={isMobile ? 'col-12' : 'col-8'}>
          {loading && (
            <SkeletonList rows={6} />
          )}
          {!loading && filtered.length === 0 && doneItems.length === 0 && (
            <div style={{ padding: '40px 0', textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--ink-4)' }}>
              {catFilter === 'alle' && whoFilter === 'alle' ? 'Ingen aktiviteter ennå — legg til en!' : 'Ingen aktiviteter matcher filteret'}
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 14 }}>
            {filtered.map(item => (
              <BucketCard
                key={item.id} item={item}
                catColor={catColor(categories, item.category)}
                onToggle={() => void toggleItem(item.id, item.done)}
                onEdit={() => startEdit(item.id)}
                onRemove={() => handleDelete(item)}
              />
            ))}
          </div>

          {/* Done section */}
          {doneItems.length > 0 && (
            <div style={{ marginTop: 32 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                <div style={{ flex: 1, height: 1, background: 'var(--line)' }} />
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--ink-4)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                  Gjennomført · {doneItems.length}
                </span>
                <div style={{ flex: 1, height: 1, background: 'var(--line)' }} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 14 }}>
                {doneItems.map(item => (
                  <BucketCard
                    key={item.id} item={item}
                    catColor={catColor(categories, item.category)}
                    onToggle={() => void toggleItem(item.id, item.done)}
                    onEdit={() => startEdit(item.id)}
                    onRemove={() => handleDelete(item)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Inline form — desktop always visible */}
        {!isMobile && (
          <div className="col-4">
            <div className="card" style={{ position: 'sticky', top: 16 }}>
              <div className="card-eyebrow">{editId ? 'Rediger' : 'Legg til'}</div>
              <h3 className="card-title" style={{ marginTop: 4, marginBottom: 16 }}>
                {editId ? (editItem?.title ?? '') : 'Ny aktivitet'}
              </h3>
              {formInner}
            </div>
          </div>
        )}

      </div>

      {/* Mobile add screen */}
      {isMobile && !mobileAdd && !editId && (
        <Fab onClick={() => { resetForm(); setMobileAdd(true); }} label="Legg til aktivitet" />
      )}

      {isMobile && mobileAdd && (
        <EditScreen title="✨ Ny aktivitet" onClose={() => { setMobileAdd(false); resetForm(); }}>
          {formInner}
        </EditScreen>
      )}

      {/* Mobile edit screen */}
      {isMobile && editId && editItem && (
        <EditScreen title={editItem.title} onClose={cancelEdit}>
          {formInner}
        </EditScreen>
      )}

      {manageCats && (
        <CatModal
          categories={categories}
          onAdd={addCategory}
          onRename={renameCategory}
          onRemove={removeCategory}
          onClose={() => setManageCats(false)}
        />
      )}
    </>
  );
}
