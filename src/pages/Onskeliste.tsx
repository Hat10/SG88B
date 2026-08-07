import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useScrollLock } from '../lib/useScrollLock';
import { type ShoppingItem, type Priority, type PriceSource } from '../data';
import { useWish, type ListKey, type WishPatch } from '../contexts/WishContext';
import { useSnackbar } from '../contexts/SnackbarContext';
import { useConfirm } from '../contexts/ConfirmContext';
import { Card, Check, Tabs, fmtKr, Fab, SkeletonList } from '../components';
import { burst } from '../confetti';

type SortKey = 'date-desc' | 'date-asc' | 'priority-desc' | 'priority-asc';
type PriceMode = 'none' | 'manual' | 'prisjakt';

const LISTS: { key: ListKey; title: string; sub: string }[] = [
  { key: 'felles', title: '❤️ Felles',  sub: 'Ting vi ønsker sammen' },
  { key: 'andreas', title: '💙 Andreas', sub: 'Andreas sin ønskeliste' },
  { key: 'taran',   title: '💜 Taran',   sub: 'Tarans ønskeliste'      },
];

const PRIORITY_ORDER: Record<Priority, number> = { lav: 1, middels: 2, høy: 3 };
const PRIORITY_COLOR: Record<Priority, string> = { høy: '#D95F5F', middels: '#C9963A', lav: '#7AB394' };
const PRIORITY_BG:    Record<Priority, string> = { høy: 'rgba(217,95,95,0.1)', middels: 'rgba(201,150,58,0.1)', lav: 'rgba(122,179,148,0.1)' };

const SORT_LABELS: Record<SortKey, string> = {
  'date-desc': 'Nyeste først', 'date-asc': 'Eldste først',
  'priority-desc': 'Høy → Lav', 'priority-asc': 'Lav → Høy',
};
const SORT_CYCLE: SortKey[] = ['date-desc', 'date-asc', 'priority-desc', 'priority-asc'];

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('nb-NO', { day: 'numeric', month: 'short', year: 'numeric' });
}

function sorted(items: ShoppingItem[], sort: SortKey): ShoppingItem[] {
  return [...items].sort((a, b) => {
    if (sort === 'date-desc') return b.addedAt.localeCompare(a.addedAt);
    if (sort === 'date-asc')  return a.addedAt.localeCompare(b.addedAt);
    if (sort === 'priority-desc') return PRIORITY_ORDER[b.priority] - PRIORITY_ORDER[a.priority];
    return PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
  });
}

function ItemRow({ it, onToggle, onEdit, onRemove }: {
  it: ShoppingItem; onToggle: () => void; onEdit: () => void; onRemove: () => void;
}) {
  const checkRef = useRef<HTMLDivElement>(null);

  const handleToggle = () => {
    if (!it.on && checkRef.current) {
      const r = checkRef.current.getBoundingClientRect();
      burst(r.left + r.width / 2, r.top + r.height / 2);
    }
    onToggle();
  };

  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 10, padding: '12px 14px',
      background: it.on ? 'var(--surface-2)' : 'var(--bg)',
      borderRadius: 6, border: '1px solid var(--line)',
      borderLeft: `3px solid ${it.on ? 'var(--line)' : PRIORITY_COLOR[it.priority]}`,
      opacity: it.on ? 0.55 : 1,
    }}>
      <div ref={checkRef} style={{ paddingTop: 2 }}><Check on={it.on} onClick={handleToggle} /></div>

      <div style={{ flex: 1, minWidth: 0 }}>
        {/* Title row + action buttons */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--ink)', textDecoration: it.on ? 'line-through' : 'none', lineHeight: 1.3 }}>{it.t}</div>
            {it.note && (
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-4)', marginTop: 3 }}>{it.note}</div>
            )}
            {it.price !== undefined && (
              <div style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 600, color: 'var(--accent)' }}>{fmtKr(it.price)}</span>
                {it.priceSource === 'prisjakt' && it.priceUrl && (
                  <a href={it.priceUrl} target="_blank" rel="noopener noreferrer"
                    style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--accent)', textDecoration: 'none', opacity: 0.7 }}>
                    prisjakt ↗
                  </a>
                )}
                {it.priceSource === 'manual' && (
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--ink-4)' }}>manuelt</span>
                )}
              </div>
            )}
          </div>

          {/* Action buttons — big enough to tap */}
          <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
            <button onClick={onEdit} style={{
              background: 'transparent', border: '1px solid var(--line)', borderRadius: 6,
              padding: '6px 9px', cursor: 'pointer', fontSize: 13, color: 'var(--ink-4)',
              lineHeight: 1, minWidth: 40, minHeight: 40, display: 'grid', placeItems: 'center',
            }}>✎</button>
            <button onClick={onRemove} aria-label="Slett ønske" style={{
              background: 'transparent', border: '1px solid var(--line)', borderRadius: 6,
              padding: '6px 9px', cursor: 'pointer', fontSize: 15, color: 'var(--ink-4)',
              lineHeight: 1, minWidth: 40, minHeight: 40, display: 'grid', placeItems: 'center',
            }}>×</button>
          </div>
        </div>

        {/* Priority + date row — always at bottom, never overflows */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
          <span style={{
            fontSize: 9, fontFamily: 'var(--font-mono)', letterSpacing: '0.06em',
            padding: '2px 7px', borderRadius: 10,
            background: it.on ? 'var(--surface-2)' : PRIORITY_BG[it.priority],
            color: it.on ? 'var(--ink-4)' : PRIORITY_COLOR[it.priority],
            border: `1px solid ${it.on ? 'var(--line)' : PRIORITY_COLOR[it.priority]}`,
            textTransform: 'uppercase',
          }}>{it.priority}</span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--ink-4)' }}>
            {fmtDate(it.addedAt)}
          </span>
        </div>
      </div>
    </div>
  );
}

function EditScreen({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useScrollLock();
  return createPortal((
    <div style={{
      position: 'fixed', inset: 0, zIndex: 301,
      background: 'var(--surface)',
      display: 'flex', flexDirection: 'column',
    }}>
      {/* Sticky header */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 1,
        background: 'var(--surface)', flexShrink: 0,
        borderBottom: '1px solid var(--line)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 12 }}>
          <div style={{ width: 36, height: 4, borderRadius: 2, background: 'var(--line-2)' }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 20px 12px' }}>
          <div>
            <div className="card-eyebrow">Rediger</div>
            <h3 className="card-title" style={{ marginTop: 2 }}>{title}</h3>
          </div>
          <button onClick={onClose} style={{
            background: 'transparent', border: '1px solid var(--line)', borderRadius: 6,
            cursor: 'pointer', fontSize: 16, color: 'var(--ink-3)',
            minWidth: 36, minHeight: 36, display: 'grid', placeItems: 'center',
          }}>×</button>
        </div>
      </div>
      {/* Scrollable content */}
      <div style={{
        flex: 1, overflowY: 'auto',
        padding: '20px',
        paddingBottom: 'calc(24px + env(safe-area-inset-bottom, 0px))',
      }}>
        {children}
      </div>
    </div>
  ), document.body);
}

export default function PageOnskeliste() {
  const { items, loading, add, toggle, update, patchPrice, remove } = useWish();
  const { notify } = useSnackbar();
  const { confirm } = useConfirm();

  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768);
  useEffect(() => {
    const update = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  const [tab,      setTab]      = useState<ListKey>('felles');
  const [sort,     setSort]     = useState<SortKey>('date-desc');
  const [showDone, setShowDone] = useState<Record<ListKey, boolean>>({ felles: false, andreas: false, taran: false });

  // Form
  const [addTarget, setAddTarget] = useState<ListKey>('felles');
  const [title,     setTitle]     = useState('');
  const [desc,      setDesc]      = useState('');
  const [priority,  setPriority]  = useState<Priority>('middels');
  const [editKey,   setEditKey]   = useState<{ id: string; list: ListKey } | null>(null);
  const [saving,    setSaving]    = useState(false);
  const [mobileAdd, setMobileAdd] = useState(false);

  // Price
  const [priceMode,   setPriceMode]   = useState<PriceMode>('none');
  const [priceManual, setPriceManual] = useState('');
  const [priceUrl,    setPriceUrl]    = useState('');
  const [fetched,     setFetched]     = useState<{ price: number; name?: string; offerCount?: number } | null>(null);
  const [fetching,    setFetching]    = useState(false);
  const [fetchError,  setFetchError]  = useState('');

  // Re-fetch Prisjakt prices on mount
  useEffect(() => {
    if (loading) return;
    (['felles', 'andreas', 'taran'] as ListKey[]).forEach(list => {
      items[list].forEach(it => {
        if (!it.id || it.priceSource !== 'prisjakt' || !it.priceUrl) return;
        const id = it.id; const url = it.priceUrl;
        fetch(`/api/price?url=${encodeURIComponent(url)}`)
          .then(r => r.ok ? r.json() : null)
          .then(data => { if (data?.price) patchPrice(id, data.price); })
          .catch(() => {});
      });
    });
  }, [loading]); // eslint-disable-line react-hooks/exhaustive-deps

  const resetForm = () => {
    setTitle(''); setDesc(''); setPriority('middels');
    setPriceMode('none'); setPriceManual(''); setPriceUrl(''); setFetched(null); setFetchError('');
  };

  const startEdit = (id: string, list: ListKey) => {
    const it = items[list].find(i => i.id === id);
    if (!it) return;
    setEditKey({ id, list });
    setAddTarget(list);
    setTitle(it.t);
    setDesc(it.note ?? '');
    setPriority(it.priority);
    if (it.price !== undefined) {
      if (it.priceSource === 'prisjakt') {
        setPriceMode('prisjakt'); setPriceUrl(it.priceUrl ?? ''); setFetched({ price: it.price });
      } else {
        setPriceMode('manual'); setPriceManual(String(it.price));
      }
    } else {
      setPriceMode('none');
    }
    setFetchError('');
    if (!isMobile) window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const cancelEdit = () => { setEditKey(null); setMobileAdd(false); resetForm(); };

  const handleToggle = (id: string, current: boolean) => { void toggle(id, current); };
  const handleRemove = async (item: ShoppingItem, list: ListKey) => {
    if (!await confirm({ title: 'Slett ønske?', message: `«${item.t}»`, confirmLabel: 'Slett' })) return;
    if (editKey?.id === item.id) cancelEdit();
    void remove(item.id!);
    notify('Ønske slettet', {
      actionLabel: 'Angre',
      onAction: () => void add(list, {
        t: item.t, note: item.note, on: item.on, who: item.who, priority: item.priority,
        addedAt: item.addedAt, price: item.price, priceUrl: item.priceUrl, priceSource: item.priceSource,
      }),
    });
  };

  const fetchPrice = async () => {
    if (!priceUrl.trim()) return;
    setFetching(true); setFetchError(''); setFetched(null);
    try {
      const res = await fetch(`/api/price?url=${encodeURIComponent(priceUrl.trim())}`);
      const data = await res.json();
      if (!res.ok) setFetchError(data.error ?? 'Noe gikk galt');
      else setFetched(data);
    } catch { setFetchError('Noe gikk galt'); }
    setFetching(false);
  };

  const buildPriceFields = (): Partial<WishPatch> => {
    if (priceMode === 'manual') {
      const p = parseInt(priceManual.replace(/\s/g, ''));
      return isNaN(p) ? {} : { price: p, priceSource: 'manual' as PriceSource };
    }
    if (priceMode === 'prisjakt' && fetched) {
      return { price: fetched.price, priceUrl: priceUrl.trim(), priceSource: 'prisjakt' as PriceSource };
    }
    return {};
  };

  const submit = async () => {
    if (!title.trim() || saving) return;
    // Chose Prisjakt but hasn't fetched a price yet — block so it isn't forgotten
    // (would otherwise save silently without a price).
    if (priceMode === 'prisjakt' && !fetched) {
      setFetchError('Trykk «Hent» for å hente prisen fra Prisjakt først – eller bytt til «Ingen» / «Manuell».');
      return;
    }
    setSaving(true);
    const pf = buildPriceFields();
    try {
      if (editKey) {
        await update(editKey.id, {
          t: title.trim(), note: desc.trim() || null, priority,
          price: pf.price ?? null,
          priceUrl: (pf.priceUrl as string | undefined) ?? null,
          priceSource: (pf.priceSource as PriceSource | undefined) ?? null,
        });
        cancelEdit();
      } else {
        const who = addTarget === 'andreas' ? 'M' as const : addTarget === 'taran' ? 'L' as const : 'f' as const;
        await add(addTarget, {
          t: title.trim(), note: desc.trim() || undefined,
          on: false, who, priority,
          addedAt: new Date().toISOString().slice(0, 10),
          price: pf.price as number | undefined,
          priceUrl: pf.priceUrl as string | undefined,
          priceSource: pf.priceSource as PriceSource | undefined,
        });
        resetForm();
      }
    } finally { setSaving(false); }
  };

  const btnStyle = (active: boolean, color?: string): React.CSSProperties => ({
    flex: 1, padding: '7px 0', borderRadius: 6, cursor: 'pointer',
    border: `1px solid ${active ? (color ?? 'var(--ink)') : 'var(--line-2)'}`,
    background: active ? (color ? `${color}18` : 'var(--ink)') : 'transparent',
    color: active ? (color ?? 'var(--surface)') : 'var(--ink-4)',
    fontFamily: 'var(--font-mono)', fontSize: 11,
  });

  const editItem = editKey ? items[editKey.list].find(i => i.id === editKey.id) : null;
  const remaining   = (k: ListKey) => items[k].filter(it => !it.on).length;
  const activeItems = sorted(items[tab].filter(it => !it.on), sort);
  const doneItems   = sorted(items[tab].filter(it =>  it.on), sort);

  // Shared form content (used both inline and in mobile bottom sheet)
  const formInner = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {!editKey && (
        <div>
          <div className="card-eyebrow" style={{ marginBottom: 6 }}>Legg til på</div>
          <div style={{ display: 'flex', gap: 6 }}>
            {LISTS.map(l => <button key={l.key} onClick={() => setAddTarget(l.key)} style={btnStyle(addTarget === l.key)}>{l.title}</button>)}
          </div>
        </div>
      )}

      <div>
        <div className="card-eyebrow" style={{ marginBottom: 4 }}>Tittel</div>
        <input className="input" placeholder="Hva ønsker du?" value={title}
          onChange={e => setTitle(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && void submit()}
          style={{ width: '100%' }} />
      </div>

      <div>
        <div className="card-eyebrow" style={{ marginBottom: 4 }}>Beskrivelse <span style={{ opacity: 0.5 }}>(valgfri)</span></div>
        <textarea className="input" placeholder="Merke, størrelse, lenke…" value={desc}
          onChange={e => setDesc(e.target.value)} rows={2}
          style={{ width: '100%', resize: 'vertical' }} />
      </div>

      <div>
        <div className="card-eyebrow" style={{ marginBottom: 6 }}>Prioritet</div>
        <div style={{ display: 'flex', gap: 6 }}>
          {(['lav', 'middels', 'høy'] as Priority[]).map(p => (
            <button key={p} onClick={() => setPriority(p)}
              style={{ ...btnStyle(priority === p, PRIORITY_COLOR[p]), textTransform: 'capitalize', fontWeight: priority === p ? 600 : 400 }}>
              {p}
            </button>
          ))}
        </div>
      </div>

      <div>
        <div className="card-eyebrow" style={{ marginBottom: 6 }}>Pris <span style={{ opacity: 0.5 }}>(valgfri)</span></div>
        <div style={{ display: 'flex', gap: 6, marginBottom: priceMode !== 'none' ? 8 : 0 }}>
          {(['none', 'manual', 'prisjakt'] as PriceMode[]).map(m => (
            <button key={m} onClick={() => { setPriceMode(m); setFetchError(''); }}
              style={{ ...btnStyle(priceMode === m), flex: m === 'prisjakt' ? 2 : 1, fontSize: 10 }}>
              {m === 'none' ? 'Ingen' : m === 'manual' ? 'Manuell' : 'Prisjakt'}
            </button>
          ))}
        </div>
        {priceMode === 'manual' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input className="input" placeholder="0" value={priceManual}
              onChange={e => setPriceManual(e.target.value)}
              style={{ flex: 1, fontVariantNumeric: 'tabular-nums' }} />
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--ink-3)' }}>kr</span>
          </div>
        )}
        {priceMode === 'prisjakt' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', gap: 6 }}>
              <input className="input" placeholder="https://prisjakt.no/produkt/..." value={priceUrl}
                onChange={e => { setPriceUrl(e.target.value); setFetched(null); setFetchError(''); }}
                onKeyDown={e => e.key === 'Enter' && void fetchPrice()}
                style={{ flex: 1, fontSize: 11 }} />
              <button onClick={() => void fetchPrice()} disabled={fetching || !priceUrl.trim()} className="btn primary"
                style={{ whiteSpace: 'nowrap', opacity: (!priceUrl.trim() || fetching) ? 0.5 : 1 }}>
                {fetching ? '...' : 'Hent'}
              </button>
            </div>
            {fetched && (
              <div style={{ padding: '8px 10px', background: 'rgba(122,179,148,0.1)', border: '1px solid rgba(122,179,148,0.4)', borderRadius: 6 }}>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 600, color: '#7AB394' }}>{fmtKr(fetched.price)}</div>
                {fetched.name && <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--ink-3)', marginTop: 2 }}>{fetched.name}</div>}
                {fetched.offerCount && <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--ink-4)', marginTop: 1 }}>billigste hos {fetched.offerCount} butikker</div>}
              </div>
            )}
            {fetchError && (
              <div style={{ padding: '7px 10px', background: 'rgba(217,95,95,0.08)', border: '1px solid rgba(217,95,95,0.3)', borderRadius: 6, fontFamily: 'var(--font-mono)', fontSize: 11, color: '#D95F5F' }}>
                {fetchError}
              </div>
            )}
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
        {editKey && <button onClick={cancelEdit} className="btn ghost" style={{ flex: 1, justifyContent: 'center' }}>Avbryt</button>}
        <button onClick={() => void submit()} className="btn primary"
          style={{ flex: 1, justifyContent: 'center', opacity: (!title.trim() || saving) ? 0.4 : 1 }}>
          {saving ? 'Lagrer…' : editKey ? 'Lagre endring' : `Legg til på ${LISTS.find(l => l.key === addTarget)!.title}`}
        </button>
      </div>
    </div>
  );

  return (
    <>
      <div className="grid grid-12">
        {/* Mobile: form is hidden behind a button (opens a full-screen sheet),
            like Ting vi vil gjøre / Gjøremål */}
        {isMobile && (
          <div className="col-12">
            <button onClick={() => { resetForm(); setAddTarget(tab); setMobileAdd(true); }}
              className="btn primary" style={{ width: '100%', justifyContent: 'center' }}>
              + Legg til ønske
            </button>
          </div>
        )}

        {/* Filter tabs — between form and list */}
        <div className="col-12">
          <Tabs
            items={LISTS.map(l => ({ id: l.key, label: l.title, count: String(remaining(l.key)) }))}
            value={tab}
            onChange={id => setTab(id as ListKey)}
          />
        </div>

        {/* List */}
        <div className={isMobile ? 'col-12' : 'col-8'}>
          <Card>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
              <div>
                <div className="card-eyebrow">{LISTS.find(l => l.key === tab)!.sub}</div>
                <h3 className="card-title" style={{ marginTop: 4 }}>{LISTS.find(l => l.key === tab)!.title}</h3>
              </div>
              <select value={sort} onChange={e => setSort(e.target.value as SortKey)}
                style={{ padding: '5px 10px', borderRadius: 6, cursor: 'pointer', background: 'var(--surface-2)', border: '1px solid var(--line)', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-3)', flexShrink: 0 }}>
                {SORT_CYCLE.map(s => <option key={s} value={s}>{SORT_LABELS[s]}</option>)}
              </select>
            </div>

            {loading && (
              <SkeletonList rows={5} />
            )}
            {!loading && activeItems.length === 0 && doneItems.length === 0 && (
              <div style={{ padding: '24px 0', textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--ink-4)' }}>Ingen ting på listen ennå</div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {activeItems.map(it => (
                <ItemRow key={it.id} it={it}
                  onToggle={() => handleToggle(it.id!, it.on)}
                  onEdit={() => startEdit(it.id!, tab)}
                  onRemove={() => handleRemove(it, tab)} />
              ))}
            </div>

            {doneItems.length > 0 && (
              <div style={{ marginTop: activeItems.length ? 16 : 0 }}>
                <button onClick={() => setShowDone(s => ({ ...s, [tab]: !s[tab] }))}
                  style={{ width: '100%', padding: '8px 0', background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 6, cursor: 'pointer', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-3)' }}>
                  {showDone[tab] ? '↑ Skjul fullførte' : `↓ Vis fullførte (${doneItems.length})`}
                </button>
                {showDone[tab] && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
                    {doneItems.map(it => (
                      <ItemRow key={it.id} it={it}
                        onToggle={() => handleToggle(it.id!, it.on)}
                        onEdit={() => startEdit(it.id!, tab)}
                        onRemove={() => handleRemove(it, tab)} />
                    ))}
                  </div>
                )}
              </div>
            )}
          </Card>
        </div>

        {/* Form — desktop only (mobile version rendered above) */}
        {!isMobile && (
          <div className="col-4">
            <Card eyebrow={editKey ? 'Rediger' : 'Legg til'} title={editKey ? (editItem?.t ?? '') : 'Ny ting'}>
              {formInner}
            </Card>
          </div>
        )}
      </div>

      {/* Mobile add — full-screen sheet */}
      {isMobile && !mobileAdd && !editKey && (
        <Fab onClick={() => { resetForm(); setMobileAdd(true); }} label="Legg til ønske" />
      )}

      {isMobile && mobileAdd && (
        <EditScreen title="✨ Nytt ønske" onClose={() => { setMobileAdd(false); resetForm(); }}>
          {formInner}
        </EditScreen>
      )}

      {/* Mobile edit — bottom sheet */}
      {isMobile && editKey && editItem && (
        <EditScreen title={editItem.t} onClose={cancelEdit}>
          {formInner}
        </EditScreen>
      )}
    </>
  );
}
