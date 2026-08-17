import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useScrollLock } from '../lib/useScrollLock';
import { useTodo, type TodoEntry, type Priority, repeatLabel } from '../contexts/TodoContext';
import { useSnackbar } from '../contexts/SnackbarContext';
import { useConfirm } from '../contexts/ConfirmContext';
import { Check, Fab, SkeletonList } from '../components';
import RepeatPicker, { EMPTY_REPEAT, type RepeatState } from '../RepeatPicker';
import type { Who } from '../data';
import { burst } from '../confetti';

// ─── helpers ───────────────────────────────────────────────────────────────

const WHO_LABEL: Record<Who, string> = { f: 'Felles', M: 'Andreas', L: 'Taran' };
const WHO_COLOR: Record<Who, string> = { f: 'var(--good)', M: 'var(--accent)', L: 'var(--ink)' };

const PRI_COLOR: Record<Priority, string> = { høy: '#D95F5F', middels: '#C9963A', lav: 'var(--ink-4)' };
const PRI_ORDER: Record<Priority, number> = { høy: 0, middels: 1, lav: 2 };

function sortItems(items: TodoEntry[]): TodoEntry[] {
  return [...items].sort((a, b) => {
    if (a.overdue_days !== b.overdue_days) return b.overdue_days - a.overdue_days;
    const da = a.deadline ? new Date(a.deadline + 'T00:00:00') : null;
    const db = b.deadline ? new Date(b.deadline + 'T00:00:00') : null;
    if (da && db) {
      const diff = da.getTime() - db.getTime();
      if (diff !== 0) return diff;
    } else if (da) return -1;
    else if (db) return 1;
    return PRI_ORDER[a.priority] - PRI_ORDER[b.priority];
  });
}

function fmtDeadline(iso: string): { label: string; color: string } {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const d = new Date(iso); d.setHours(0, 0, 0, 0);
  const days = Math.round((d.getTime() - today.getTime()) / 86400000);
  if (days < 0)  return { label: `${Math.abs(days)}d over`, color: '#D95F5F' };
  if (days === 0) return { label: 'i dag', color: '#C9963A' };
  if (days === 1) return { label: 'i morgen', color: '#C9963A' };
  if (days <= 7)  return { label: `om ${days}d`, color: 'var(--ink-3)' };
  return {
    label: d.toLocaleDateString('no-NO', { day: 'numeric', month: 'short' }),
    color: 'var(--ink-4)',
  };
}

// ─── Time picker ───────────────────────────────────────────────────────────

const HOURS = Array.from({ length: 17 }, (_, i) => i + 6); // 06–22
const MINS  = [0, 15, 30, 45];
const pad2  = (n: number) => String(n).padStart(2, '0');

function TimePicker({ value, onChange }: { value: string; onChange: (t: string) => void }) {
  const [open, setOpen]       = useState(false);
  const [selHour, setSelHour] = useState<number | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false); setSelHour(null);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const curH = value ? parseInt(value.slice(0, 2)) : null;
  const curM = value ? parseInt(value.slice(3, 5)) : null;

  const pick = (h: number, m: number) => { onChange(`${pad2(h)}:${pad2(m)}`); setOpen(false); setSelHour(null); };
  const clear = (e: React.MouseEvent) => { e.stopPropagation(); onChange(''); setOpen(false); setSelHour(null); };

  const chipBase: React.CSSProperties = {
    borderRadius: 5, cursor: 'pointer', fontFamily: 'var(--font-mono)',
    border: '1px solid var(--line)', background: 'transparent',
    color: 'var(--ink-3)', transition: 'border-color 80ms, background 80ms',
  };

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      {/* Trigger */}
      <button
        onClick={() => { setOpen(o => !o); if (!open) setSelHour(null); }}
        style={{
          width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          background: 'var(--bg)', border: '1px solid var(--line-2)', borderRadius: 6,
          padding: '8px 10px', cursor: 'pointer',
          fontFamily: 'var(--font-mono)', fontSize: 13,
          color: value ? 'var(--ink)' : 'var(--ink-4)',
        }}
      >
        <span>{value || 'Velg tid…'}</span>
        {value
          ? <span onClick={clear} style={{ fontSize: 16, opacity: 0.5, lineHeight: 1 }}>×</span>
          : <span style={{ fontSize: 10, opacity: 0.35, lineHeight: 1 }}>▾</span>
        }
      </button>

      {/* Dropdown */}
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 200,
          minWidth: 220,
          background: 'var(--surface)', border: '1px solid var(--line)',
          borderRadius: 8, padding: 14,
          boxShadow: '0 6px 24px rgba(11,37,69,0.13)',
        }}>
          {selHour === null ? (
            <>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--ink-4)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 10 }}>
                Velg time
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 5 }}>
                {HOURS.map(h => {
                  const active = curH === h;
                  return (
                    <button key={h} onClick={() => setSelHour(h)} style={{
                      ...chipBase,
                      padding: '5px 0', fontSize: 11,
                      border: `1px solid ${active ? 'var(--accent)' : 'var(--line)'}`,
                      background: active ? 'var(--accent-soft)' : 'transparent',
                      color: active ? 'var(--accent-deep)' : 'var(--ink-3)',
                      fontWeight: active ? 600 : 400,
                    }}>{pad2(h)}</button>
                  );
                })}
              </div>
            </>
          ) : (
            <>
              <button onClick={() => setSelHour(null)} style={{
                background: 'transparent', border: 0, cursor: 'pointer',
                color: 'var(--accent)', fontFamily: 'var(--font-mono)', fontSize: 11,
                padding: 0, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 4,
              }}>← {pad2(selHour)}:__</button>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6 }}>
                {MINS.map(m => {
                  const active = curH === selHour && curM === m;
                  return (
                    <button key={m} onClick={() => pick(selHour, m)} style={{
                      ...chipBase,
                      padding: '10px 0', fontSize: 14, fontWeight: 500,
                      border: `1px solid ${active ? 'var(--accent)' : 'var(--line-2)'}`,
                      background: active ? 'var(--accent-soft)' : 'var(--bg)',
                      color: active ? 'var(--accent-deep)' : 'var(--ink)',
                    }}>{pad2(selHour)}:{pad2(m)}</button>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Edit screen (mobile) ──────────────────────────────────────────────────

function EditScreen({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useScrollLock();
  return createPortal((
    <div style={{ position: 'fixed', inset: 0, zIndex: 301, background: 'var(--surface)', display: 'flex', flexDirection: 'column' }}>
      <div style={{ position: 'sticky', top: 0, zIndex: 1, background: 'var(--surface)', flexShrink: 0, borderBottom: '1px solid var(--line)' }}>
        <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 12 }}>
          <div style={{ width: 36, height: 4, borderRadius: 2, background: 'var(--line-2)' }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 20px 12px' }}>
          <div><div className="card-eyebrow">Rediger</div><h3 className="card-title" style={{ marginTop: 2 }}>{title}</h3></div>
          <button onClick={onClose} style={{ background: 'transparent', border: '1px solid var(--line)', borderRadius: 6, cursor: 'pointer', fontSize: 16, color: 'var(--ink-3)', minWidth: 36, minHeight: 36, display: 'grid', placeItems: 'center' }}>×</button>
        </div>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '20px', paddingBottom: 'calc(24px + env(safe-area-inset-bottom, 0px))' }}>
        {children}
      </div>
    </div>
  ), document.body);
}

// ─── List row ──────────────────────────────────────────────────────────────

function TodoRow({ item, onToggle, onEdit, onRemove }: {
  item: TodoEntry;
  onToggle: () => void; onEdit: () => void; onRemove: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const overdue = item.overdue_days > 0;
  const dl = item.deadline ? fmtDeadline(item.deadline) : null;
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
      display: 'flex', alignItems: 'stretch', gap: 0, padding: '10px 14px',
      borderBottom: '1px solid var(--line)', opacity: item.done ? 0.5 : 1,
      background: overdue && !item.done ? '#D95F5F08' : 'var(--surface)',
    }}>
      {/* Priority bar */}
      <div style={{ width: 3, borderRadius: 2, flexShrink: 0, marginRight: 12,
        background: item.done ? 'var(--line)' : overdue ? '#D95F5F' : PRI_COLOR[item.priority] }} />

      {/* Checkbox */}
      <div ref={checkRef} style={{ flexShrink: 0, marginRight: 12, display: 'flex', alignItems: 'flex-start', paddingTop: 2 }}>
        <Check on={item.done} onClick={handleToggle} />
      </div>

      {/* Content: title row + meta row */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 0 }}>

        {/* Row 1: title + action buttons */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
          {/* Tappable title area */}
          <div style={{ flex: 1, minWidth: 0, cursor: 'pointer' }} onClick={() => setExpanded(e => !e)}>
            <div style={{
              fontSize: 14, fontWeight: 500, color: 'var(--ink)', lineHeight: 1.4,
              textDecoration: item.done ? 'line-through' : 'none',
              textDecorationColor: 'var(--line-2)',
              ...(expanded
                ? { wordBreak: 'break-word' }
                : { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }),
            }}>
              {item.title}
            </div>
            {expanded && item.description && (
              <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 4, lineHeight: 1.45 }}>
                {item.description}
              </div>
            )}
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
            <button onClick={onEdit} aria-label="Rediger" style={{ background: 'transparent', border: '1px solid var(--line)', borderRadius: 5, minWidth: 40, minHeight: 40, display: 'grid', placeItems: 'center', cursor: 'pointer', fontSize: 12, color: 'var(--ink-4)' }}>✎</button>
            <button onClick={onRemove} aria-label="Slett gjøremål" style={{ background: 'transparent', border: '1px solid var(--line)', borderRadius: 5, minWidth: 40, minHeight: 40, display: 'grid', placeItems: 'center', cursor: 'pointer', fontSize: 15, color: 'var(--ink-4)' }}>×</button>
          </div>
        </div>

        {/* Row 2: meta — who, deadline/overdue, repeat, description snippet */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 5, flexWrap: 'wrap' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--ink-4)', whiteSpace: 'nowrap' }}>
            <span style={{ width: 5, height: 5, borderRadius: '50%', background: WHO_COLOR[item.who], display: 'inline-block', flexShrink: 0 }} />
            {WHO_LABEL[item.who]}
          </span>
          {overdue && !item.done && (
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: '#D95F5F', background: '#D95F5F18', padding: '2px 6px', borderRadius: 3, fontWeight: 600, whiteSpace: 'nowrap' }}>
              {item.overdue_days} dag{item.overdue_days === 1 ? '' : 'er'} forsinket
            </span>
          )}
          {!overdue && dl && (
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: dl.color, fontWeight: 500, whiteSpace: 'nowrap' }}>
              {dl.label}{item.time ? ` · kl. ${item.time}` : ''}
            </span>
          )}
          {item.repeat && !item.done && (
            <span title={repeatLabel(item)} style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--accent)', background: 'var(--accent-soft, #e8f0fb)', padding: '2px 6px', borderRadius: 3, whiteSpace: 'nowrap' }}>
              🔁 {repeatLabel(item)}
            </span>
          )}
          {item.description && !expanded && (
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--ink-4)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 160 }}>
              {item.description}
            </span>
          )}
        </div>

      </div>
    </div>
  );
}

// ─── Main page ─────────────────────────────────────────────────────────────

export default function PageGjoremal() {
  const { items, loading, addItem, updateItem, toggleItem, removeItem } = useTodo();
  const { notify } = useSnackbar();
  const { confirm } = useConfirm();

  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768);
  useEffect(() => {
    const update = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  const [whoFilter,  setWhoFilter]  = useState<Who | 'alle'>('alle');
  const [editId,     setEditId]     = useState<string | null>(null);
  const [mobileAdd,  setMobileAdd]  = useState(false);
  const [showAllDone, setShowAllDone] = useState(false);
  const [saving,     setSaving]     = useState(false);

  const [title,    setTitle]    = useState('');
  const [desc,     setDesc]     = useState('');
  const [who,      setWho]      = useState<Who>('f');
  const [priority, setPriority] = useState<Priority>('middels');
  const [deadline, setDeadline] = useState('');
  const [time,     setTime]     = useState('');
  const [repeatState, setRepeatState] = useState<RepeatState>(EMPTY_REPEAT);

  const resetForm = () => { setTitle(''); setDesc(''); setWho('f'); setPriority('middels'); setDeadline(''); setTime(''); setRepeatState(EMPTY_REPEAT); };

  const startEdit = (id: string) => {
    const it = items.find(i => i.id === id);
    if (!it) return;
    setEditId(id);
    setTitle(it.title);
    setDesc(it.description ?? '');
    setWho(it.who);
    setPriority(it.priority);
    setDeadline(it.deadline ?? '');
    setTime(it.time ?? '');
    setRepeatState({ repeat: it.repeat ?? '', repeatInterval: it.repeatInterval ?? 1, repeatUnit: it.repeatUnit ?? 'day' });
    if (!isMobile) window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const cancelEdit = () => { setEditId(null); setMobileAdd(false); resetForm(); };

  const handleDelete = async (item: TodoEntry) => {
    if (!await confirm({ title: 'Slett gjøremål?', message: `«${item.title}»`, confirmLabel: 'Slett' })) return;
    if (editId === item.id) cancelEdit();
    void removeItem(item.id);
    notify('Gjøremål slettet', {
      actionLabel: 'Angre',
      onAction: () => void addItem({
        title: item.title, description: item.description,
        who: item.who, priority: item.priority, deadline: item.deadline, time: item.time,
        done: item.done, doneYear: item.doneYear, doneAt: item.doneAt,
        overdue_days: item.overdue_days, repeat: item.repeat,
        repeatInterval: item.repeatInterval, repeatUnit: item.repeatUnit,
      }),
    });
  };

  const submit = async () => {
    if (!title.trim() || !deadline || saving) return;
    setSaving(true);
    try {
      const payload = {
        title: title.trim(), description: desc.trim() || undefined, who, priority,
        deadline: deadline || undefined, time: time || undefined, done: false, overdue_days: 0,
        repeat: (repeatState.repeat || undefined) as TodoEntry['repeat'],
        repeatInterval: repeatState.repeat === 'custom' ? repeatState.repeatInterval : undefined,
        repeatUnit: repeatState.repeat === 'custom' ? repeatState.repeatUnit : undefined,
      };
      if (editId) { await updateItem(editId, payload); cancelEdit(); }
      else        { await addItem(payload); resetForm(); }
    } finally { setSaving(false); }
  };

  const baseFiltered = items
    .filter(it => whoFilter === 'alle' || it.who === whoFilter);
  const active    = sortItems(baseFiltered.filter(it => !it.done));
  const doneItems = baseFiltered
    .filter(it => it.done)
    .sort((a, b) => {
      if (a.doneAt && b.doneAt) return b.doneAt.localeCompare(a.doneAt);
      if (a.doneAt) return -1;
      if (b.doneAt) return 1;
      return 0;
    });
  const total     = items.length;
  const doneCount = items.filter(i => i.done).length;

  const btnStyle = (on: boolean): React.CSSProperties => ({
    padding: '5px 12px', borderRadius: 20, cursor: 'pointer', fontSize: 12, fontWeight: 500,
    border: on ? '0' : '1px solid var(--line-2)',
    background: on ? 'var(--ink)' : 'transparent',
    color: on ? 'var(--surface)' : 'var(--ink-3)',
    fontFamily: 'var(--font-mono)',
  });

  const priStyle = (p: Priority): React.CSSProperties => ({
    flex: 1, padding: '6px 0', borderRadius: 6, cursor: 'pointer', fontSize: 11,
    fontFamily: 'var(--font-mono)', border: `1px solid ${priority === p ? PRI_COLOR[p] : 'var(--line-2)'}`,
    background: priority === p ? `${PRI_COLOR[p]}18` : 'transparent',
    color: priority === p ? PRI_COLOR[p] : 'var(--ink-4)',
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
        <div className="card-eyebrow" style={{ marginBottom: 4 }}>Tittel</div>
        <input className="input" placeholder="Hva må gjøres?" value={title}
          onChange={e => setTitle(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && void submit()}
          style={{ width: '100%' }} />
      </div>

      <div>
        <div className="card-eyebrow" style={{ marginBottom: 4 }}>Beskrivelse <span style={{ opacity: 0.5 }}>(valgfri)</span></div>
        <textarea className="input" placeholder="Flere detaljer…" value={desc}
          onChange={e => setDesc(e.target.value)} rows={2}
          style={{ width: '100%', resize: 'vertical' }} />
      </div>

      {/* Row 1: Tidsfrist + Klokkeslett */}
      <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: 10 }}>
        <div style={{ flex: 1 }}>
          <div className="card-eyebrow" style={{ marginBottom: 4 }}>Tidsfrist <span style={{ color: 'var(--warn)' }}>*</span></div>
          <input className="input" type="date" value={deadline}
            onChange={e => { setDeadline(e.target.value); if (!e.target.value) { setTime(''); setRepeatState(EMPTY_REPEAT); } }}
            style={{ width: '100%' }} />
        </div>
        <div style={{ flex: 1 }}>
          <div className="card-eyebrow" style={{ marginBottom: 4 }}>Klokkeslett <span style={{ opacity: 0.5 }}>(valgfri)</span></div>
          {isMobile ? (
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input className="input" type="time" value={time} onChange={e => setTime(e.target.value)}
                disabled={!deadline}
                style={{ flex: 1, fontFamily: 'var(--font-mono)', opacity: deadline ? 1 : 0.35 }} />
              {time && (
                <button onClick={() => setTime('')} style={{ background: 'transparent', border: '1px solid var(--line)', borderRadius: 6, width: 36, height: 36, display: 'grid', placeItems: 'center', cursor: 'pointer', fontSize: 16, color: 'var(--ink-4)', flexShrink: 0 }}>×</button>
              )}
            </div>
          ) : (
            <div style={{ opacity: deadline ? 1 : 0.35, pointerEvents: deadline ? 'auto' : 'none' }}>
              <TimePicker value={time} onChange={setTime} />
            </div>
          )}
        </div>
      </div>

      {/* Row 2: Gjentas */}
      <div>
        <div className="card-eyebrow" style={{ marginBottom: 4 }}>Gjentas <span style={{ opacity: 0.5 }}>(valgfri)</span></div>
        <div style={{ opacity: deadline ? 1 : 0.35, pointerEvents: deadline ? 'auto' : 'none' }}>
          <RepeatPicker value={repeatState} onChange={setRepeatState} disabled={!deadline} />
        </div>
        {editId && repeatState.repeat && (
          <button
            onClick={() => setRepeatState(EMPTY_REPEAT)}
            style={{
              marginTop: 6, background: 'transparent', border: 'none', padding: 0,
              cursor: 'pointer', fontFamily: 'var(--font-mono)', fontSize: 10,
              color: '#D95F5F', textDecoration: 'underline',
            }}
          >
            Avslutt gjentakelse
          </button>
        )}
      </div>

      <div>
        <div className="card-eyebrow" style={{ marginBottom: 6 }}>Prioritet</div>
        <div style={{ display: 'flex', gap: 6 }}>
          {(['høy', 'middels', 'lav'] as Priority[]).map(p => (
            <button key={p} onClick={() => setPriority(p)} style={priStyle(p)}>
              {p.charAt(0).toUpperCase() + p.slice(1)}
            </button>
          ))}
        </div>
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
          disabled={!title.trim() || !deadline || saving}
          style={{ flex: 1, justifyContent: 'center', opacity: (!title.trim() || !deadline || saving) ? 0.4 : 1 }}>
          {saving ? 'Lagrer…' : !deadline ? 'Velg en tidsfrist' : editId ? 'Lagre endring' : 'Legg til gjøremål'}
        </button>
      </div>
    </div>
  );

  const list = (items: TodoEntry[]) => (
    <div style={{ border: '1px solid var(--line)', borderRadius: 8, overflow: 'hidden' }}>
      {items.map(item => (
        <TodoRow
          key={item.id} item={item}
          onToggle={() => void toggleItem(item.id, item.done)}
          onEdit={() => startEdit(item.id)}
          onRemove={() => handleDelete(item)}
        />
      ))}
    </div>
  );

  return (
    <>
      {/* Mobile toolbar */}
      {isMobile && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 4 }}>
          <button onClick={() => { resetForm(); setMobileAdd(true); }} className="btn primary" style={{ justifyContent: 'center' }}>
            + Legg til gjøremål
          </button>
          <select className="input" value={whoFilter} onChange={e => setWhoFilter(e.target.value as Who | 'alle')} style={{ width: '100%' }}>
            <option value="alle">Alle</option>
            {(['f', 'M', 'L'] as Who[]).map(w => <option key={w} value={w}>{WHO_LABEL[w]}</option>)}
          </select>
        </div>
      )}

      {/* Desktop filter bar */}
      {!isMobile && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <div style={{ display: 'flex', gap: 6, flex: 1, flexWrap: 'wrap' }}>
            <button style={{ ...btnStyle(whoFilter === 'alle'), flexShrink: 0 }} onClick={() => setWhoFilter('alle')}>
              Alle <span style={{ opacity: 0.5, marginLeft: 4 }}>{total}</span>
            </button>
            {(['f', 'M', 'L'] as Who[]).map(w => (
              <button key={w} style={{
                ...btnStyle(whoFilter === w), flexShrink: 0,
                background: whoFilter === w ? WHO_COLOR[w] : 'transparent',
                border: whoFilter === w ? '0' : '1px solid var(--line-2)',
              }} onClick={() => setWhoFilter(w)}>
                {WHO_LABEL[w]}
                <span style={{ opacity: 0.55, marginLeft: 4 }}>{items.filter(i => i.who === w).length}</span>
              </button>
            ))}
          </div>
          {total > 0 && (
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--ink-4)', flexShrink: 0 }}>
              {doneCount} / {total} fullført
            </span>
          )}
        </div>
      )}

      <div className="grid grid-12">
        <div className={isMobile ? 'col-12' : 'col-8'}>
          {loading && (
            <SkeletonList rows={7} />
          )}
          {!loading && active.length === 0 && doneItems.length === 0 && (
            <div style={{ padding: '40px 0', textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--ink-4)' }}>
              {whoFilter === 'alle' ? 'Ingen gjøremål ennå — legg til et!' : 'Ingen gjøremål matcher filteret'}
            </div>
          )}

          {active.length > 0 && list(active)}

          {doneItems.length > 0 && (
            <div style={{ marginTop: 24 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                <div style={{ flex: 1, height: 1, background: 'var(--line)' }} />
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--ink-4)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                  Fullført · {doneItems.length}
                </span>
                <div style={{ flex: 1, height: 1, background: 'var(--line)' }} />
              </div>
              {list(showAllDone ? doneItems : doneItems.slice(0, 5))}
              {doneItems.length > 5 && (
                <button
                  onClick={() => setShowAllDone(v => !v)}
                  style={{
                    marginTop: 10, width: '100%', padding: '8px 0',
                    background: 'transparent', border: '1px solid var(--line-2)',
                    borderRadius: 8, cursor: 'pointer', fontSize: 12,
                    fontFamily: 'var(--font-mono)', color: 'var(--ink-4)',
                  }}
                >
                  {showAllDone ? 'Vis færre' : `Vis ${doneItems.length - 5} til`}
                </button>
              )}
            </div>
          )}
        </div>

        {!isMobile && (
          <div className="col-4">
            <div className="card" style={{ position: 'sticky', top: 16 }}>
              <div className="card-eyebrow">{editId ? 'Rediger' : 'Legg til'}</div>
              <h3 className="card-title" style={{ marginTop: 4, marginBottom: 16 }}>
                {editId ? (editItem?.title ?? '') : 'Nytt gjøremål'}
              </h3>
              {formInner}
            </div>
          </div>
        )}
      </div>

      {isMobile && !mobileAdd && !editId && (
        <Fab onClick={() => { resetForm(); setMobileAdd(true); }} label="Legg til gjøremål" />
      )}

      {isMobile && mobileAdd && (
        <EditScreen title="Nytt gjøremål" onClose={() => { setMobileAdd(false); resetForm(); }}>
          {formInner}
        </EditScreen>
      )}

      {isMobile && editId && editItem && (
        <EditScreen title={editItem.title} onClose={cancelEdit}>
          {formInner}
        </EditScreen>
      )}
    </>
  );
}
