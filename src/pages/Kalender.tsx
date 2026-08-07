import { useState, useEffect } from 'react';
import { useTodo } from '../contexts/TodoContext';
import type { CalEvent } from '../../api/kalender';

// ─── Config ────────────────────────────────────────────────────────────────

const SOURCE_META = {
  andreas: { label: 'Andreas', color: '#4A80C4' },
  taran:   { label: 'Taran',   color: '#6B2FA0' },
  felles:  { label: 'Felles', color: '#7AB394' },
  todo:    { label: 'Gjøremål', color: '#C9963A' },
} as const;

const PRIORITY_COLORS = { høy: '#C0392B', middels: '#C9963A', lav: '#8A9BAD' } as const;

type Source = keyof typeof SOURCE_META;

interface AnyEvent {
  id: string; title: string; start: string; end?: string;
  allDay: boolean; source: Source; color: string; who?: string;
  overdue?: boolean;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

const NO_MONTHS       = ['Januar','Februar','Mars','April','Mai','Juni','Juli','August','September','Oktober','November','Desember'];
const NO_MONTHS_SHORT = ['jan','feb','mar','apr','mai','jun','jul','aug','sep','okt','nov','des'];
const NO_DAYS_SHORT   = ['søn','man','tir','ons','tor','fre','lør'];
const NO_DAYS_LONG    = ['søndag','mandag','tirsdag','onsdag','torsdag','fredag','lørdag'];
const WEEK_LABELS     = ['Man','Tir','Ons','Tor','Fre','Lør','Søn'];

function localDateStr(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function todayStr()    { return localDateStr(); }
function tomorrowStr() { const d = new Date(); d.setDate(d.getDate()+1); return localDateStr(d); }

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('no-NO', { hour: '2-digit', minute: '2-digit' });
}

function fmtDayLabel(iso: string, today: string, tomorrow: string, long = false): string {
  if (iso === today)    return 'I dag';
  if (iso === tomorrow) return 'I morgen';
  const d = new Date(iso + 'T12:00:00');
  const dayName = long ? NO_DAYS_LONG[d.getDay()] : NO_DAYS_SHORT[d.getDay()];
  const cap = dayName.charAt(0).toUpperCase() + dayName.slice(1);
  return `${cap} ${d.getDate()}. ${NO_MONTHS_SHORT[d.getMonth()]}`;
}

function getMonthGrid(year: number, month: number) {
  const cells: { date: Date; iso: string; inMonth: boolean }[] = [];
  const first = new Date(year, month, 1);
  const last  = new Date(year, month + 1, 0);
  const startDow = (first.getDay() + 6) % 7;
  for (let i = startDow - 1; i >= 0; i--) {
    const d = new Date(year, month, -i);
    cells.push({ date: d, iso: localDateStr(d), inMonth: false });
  }
  for (let d = 1; d <= last.getDate(); d++) {
    const date = new Date(year, month, d);
    cells.push({ date, iso: localDateStr(date), inMonth: true });
  }
  const rem = (7 - (cells.length % 7)) % 7;
  for (let i = 1; i <= rem; i++) {
    const d = new Date(year, month + 1, i);
    cells.push({ date: d, iso: localDateStr(d), inMonth: false });
  }
  return cells;
}

function sortEvents(events: AnyEvent[]): AnyEvent[] {
  return [...events].sort((a, b) => {
    if (a.allDay && !b.allDay) return -1;
    if (!a.allDay && b.allDay) return 1;
    return new Date(a.start).getTime() - new Date(b.start).getTime();
  });
}

function eventLabel(e: AnyEvent): string {
  if (e.source === 'todo') {
    const who = e.who ?? 'Felles';
    return e.overdue ? `Gjøremål · ${who} · forfalt` : `Gjøremål · ${who}`;
  }
  return e.who ?? SOURCE_META[e.source].label;
}

// ─── Shared event row ──────────────────────────────────────────────────────

function EventRow({ event, last = false, isToday = false }: { event: AnyEvent; last?: boolean; isToday?: boolean }) {
  const endTime = !event.allDay && event.end && fmtTime(event.end) !== fmtTime(event.start)
    ? fmtTime(event.end) : null;
  const isOverdueTodo = event.source === 'todo' && event.overdue;
  const bg = isOverdueTodo
    ? 'rgba(192,57,43,0.45)'
    : isToday ? 'rgba(120,120,120,0.08)' : 'transparent';
  return (
    <div style={{
      display: 'flex', gap: 0,
      padding: '11px 16px',
      borderBottom: last ? 'none' : '1px solid var(--line)',
      borderLeft: `3px solid ${event.color}`,
      background: bg,
    }}>
      <div style={{
        width: 52, flexShrink: 0,
        fontFamily: 'var(--font-mono)', fontSize: 11,
        color: 'var(--ink-4)', paddingTop: 1,
      }}>
        {event.allDay ? (
          <span style={{ fontSize: 10 }}>{event.source === 'todo' ? 'frist' : 'hele dagen'}</span>
        ) : (
          <>
            <div>{fmtTime(event.start)}</div>
            {endTime && <div style={{ opacity: 0.6, fontSize: 10 }}>{endTime}</div>}
          </>
        )}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--ink)', lineHeight: 1.35 }}>
          {event.title}
        </div>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: event.color, marginTop: 3 }}>
          {eventLabel(event)}
        </div>
      </div>
    </div>
  );
}

// ─── Day detail panel (month view) ─────────────────────────────────────────

function DayPanel({ iso, events, today, tomorrow }: {
  iso: string; events: AnyEvent[]; today: string; tomorrow: string;
}) {
  const sorted   = sortEvents(events);
  const isToday  = iso === today;
  const label    = fmtDayLabel(iso, today, tomorrow, true);
  const d        = new Date(iso + 'T12:00:00');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: '16px 20px 14px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'baseline', gap: 10 }}>
        <span style={{ fontSize: 15, fontWeight: 600, color: isToday ? 'var(--accent)' : 'var(--ink)', textTransform: 'capitalize' }}>
          {label}
        </span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-4)' }}>
          {(isToday || iso === tomorrow)
            ? d.toLocaleDateString('nb-NO', { day: 'numeric', month: 'long', year: 'numeric' })
            : d.getFullYear()}
        </span>
      </div>
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {sorted.length === 0 ? (
          <div style={{ padding: '32px 20px', textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--ink-4)' }}>
            Ingen hendelser
          </div>
        ) : sorted.map((e, i) => (
          <EventRow key={e.id} event={e} last={i === sorted.length - 1} isToday={isToday} />
        ))}
      </div>
    </div>
  );
}

// ─── List view ─────────────────────────────────────────────────────────────

function ListView({ byDate, today, tomorrow, isMobile }: {
  byDate: Map<string, AnyEvent[]>; today: string; tomorrow: string; isMobile: boolean;
}) {
  // Include past dates that have at least one overdue (undone) todo
  const allDates  = [...byDate.keys()].sort();
  const pastDates = allDates.filter(d => d < today && (byDate.get(d) ?? []).some(e => e.source === 'todo' && e.overdue));
  const futureDates = allDates.filter(d => d >= today);
  const sortedDates = [...pastDates, ...futureDates];

  if (sortedDates.length === 0) {
    return (
      <div style={{ padding: '60px 0', textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--ink-4)' }}>
        Ingen kommende hendelser
      </div>
    );
  }

  // Group by month for visual separation
  let lastMonth = '';
  let shownOverdueHeader = false;
  let shownUpcomingHeader = false;
  const hasPast = pastDates.length > 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      {sortedDates.map(date => {
        const isPast    = date < today;
        const events    = sortEvents(byDate.get(date)!.filter(e => !isPast || (e.source === 'todo' && e.overdue)));
        if (events.length === 0) return null;
        const isToday   = date === today;
        const isTomorrow = date === tomorrow;
        const d         = new Date(date + 'T12:00:00');
        const monthKey  = `${d.getFullYear()}-${d.getMonth()}`;
        const showMonth = !isPast && monthKey !== lastMonth;
        if (!isPast) lastMonth = monthKey;

        // Section headers
        const showOverdueHeader = isPast && !shownOverdueHeader && (shownOverdueHeader = true, true);
        const showUpcomingHeader = !isPast && hasPast && !shownUpcomingHeader && (shownUpcomingHeader = true, true);

        return (
          <div key={date}>
            {/* Overdue section header */}
            {showOverdueHeader && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: isMobile ? '0 0 10px' : '0 0 12px' }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#C0392B' }}>
                  Forfalt
                </span>
                <div style={{ flex: 1, height: 1, background: 'rgba(192,57,43,0.25)' }} />
              </div>
            )}

            {/* Upcoming section header (after overdue block) */}
            {showUpcomingHeader && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: isMobile ? '16px 0 10px' : '20px 0 12px' }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>
                  Kommende
                </span>
                <div style={{ flex: 1, height: 1, background: 'var(--line)' }} />
              </div>
            )}

            {/* Month separator */}
            {showMonth && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: isMobile ? '20px 0 8px' : '24px 0 10px',
              }}>
                <span style={{
                  fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700,
                  letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-4)',
                }}>
                  {NO_MONTHS[d.getMonth()]} {d.getFullYear()}
                </span>
                <div style={{ flex: 1, height: 1, background: 'var(--line)' }} />
              </div>
            )}

            {/* Date section */}
            <div style={{ display: 'flex', gap: isMobile ? 12 : 16, marginBottom: 4 }}>
              {/* Date column */}
              <div style={{
                width: isMobile ? 42 : 52, flexShrink: 0, paddingTop: 2,
                display: 'flex', flexDirection: 'column', alignItems: 'center',
              }}>
                <div style={{
                  width: isMobile ? 34 : 40, height: isMobile ? 34 : 40,
                  borderRadius: '50%',
                  background: isToday ? 'var(--ink-fixed)' : isPast ? 'rgba(192,57,43,0.12)' : isTomorrow ? 'var(--chip)' : 'transparent',
                  border: isTomorrow ? '1px solid var(--line-2)' : isPast ? '1px solid rgba(192,57,43,0.3)' : 'none',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                  gap: 0,
                }}>
                  <span style={{
                    fontFamily: 'var(--font-mono)', fontSize: 8, letterSpacing: '0.06em',
                    textTransform: 'uppercase', lineHeight: 1,
                    color: isToday ? 'rgba(207,224,239,0.6)' : isPast ? 'rgba(192,57,43,0.7)' : isTomorrow ? 'var(--ink-3)' : 'var(--ink-4)',
                  }}>
                    {NO_DAYS_SHORT[d.getDay()].toUpperCase()}
                  </span>
                  <span style={{
                    fontSize: isMobile ? 15 : 17, fontWeight: 600,
                    fontVariantNumeric: 'tabular-nums', lineHeight: 1.2,
                    color: isToday ? 'rgba(207,224,239,0.95)' : isPast ? '#C0392B' : 'var(--ink-2)',
                  }}>
                    {d.getDate()}
                  </span>
                </div>
              </div>

              {/* Events */}
              <div style={{
                flex: 1, minWidth: 0,
                background: 'var(--surface)', border: '1px solid var(--line)',
                borderRadius: 8, overflow: 'hidden',
                marginBottom: 8,
              }}>
                {events.map((e, i) => (
                  <EventRow key={e.id} event={e} last={i === events.length - 1} isToday={isToday} />
                ))}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Month grid ────────────────────────────────────────────────────────────

function MonthGrid({ viewYear, viewMonth, today, selected, onSelect, onPrev, onNext, byDate, isMobile }: {
  viewYear: number; viewMonth: number;
  today: string; selected: string;
  onSelect: (iso: string) => void;
  onPrev: () => void; onNext: () => void;
  byDate: Map<string, AnyEvent[]>;
  isMobile: boolean;
}) {
  const grid   = getMonthGrid(viewYear, viewMonth);
  const navBtn: React.CSSProperties = {
    background: 'transparent', border: '1px solid var(--line)', borderRadius: 6,
    width: 32, height: 32, display: 'grid', placeItems: 'center',
    cursor: 'pointer', fontSize: 16, color: 'var(--ink-3)',
  };

  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 10, overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', borderBottom: '1px solid var(--line)' }}>
        <button style={navBtn} onClick={onPrev}>‹</button>
        <span style={{ fontWeight: 600, fontSize: 15, letterSpacing: '-0.01em' }}>
          {NO_MONTHS[viewMonth]} {viewYear}
        </span>
        <button style={navBtn} onClick={onNext}>›</button>
      </div>

      {/* Weekday labels */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', borderBottom: '1px solid var(--line)' }}>
        {WEEK_LABELS.map(d => (
          <div key={d} style={{
            textAlign: 'center', padding: '7px 0',
            fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.05em',
            color: 'var(--ink-4)', textTransform: 'uppercase',
          }}>{d}</div>
        ))}
      </div>

      {/* Day cells */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)' }}>
        {grid.map(({ iso, date, inMonth }, idx) => {
          const isToday    = iso === today;
          const isSelected = iso === selected;
          const events     = byDate.get(iso) ?? [];
          const isLastRow  = idx >= grid.length - 7;
          return (
            <div
              key={iso}
              onClick={() => onSelect(iso)}
              style={{
                padding: '6px 4px 5px',
                borderRight: (idx + 1) % 7 === 0 ? 'none' : '1px solid var(--line)',
                borderBottom: isLastRow ? 'none' : '1px solid var(--line)',
                minHeight: isMobile ? 50 : 62,
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                cursor: 'pointer',
                background: isSelected && !isToday ? 'var(--chip)' : 'transparent',
                transition: 'background 80ms',
              }}
            >
              <div style={{
                width: 26, height: 26, borderRadius: '50%',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: isToday ? 'var(--ink-fixed)' : 'transparent',
                border: isSelected && !isToday ? '1.5px solid var(--ink-3)' : 'none',
                fontSize: 13, fontWeight: isToday || isSelected ? 600 : 400,
                color: isToday ? 'rgba(207,224,239,0.95)' : 'var(--ink-2)',
                opacity: inMonth ? 1 : 0.28,
              }}>
                {date.getDate()}
              </div>
              {events.length > 0 && (
                <div style={{ display: 'flex', gap: 2, justifyContent: 'center', flexWrap: 'wrap', maxWidth: 32 }}>
                  {events.slice(0, 4).map((e, i) => (
                    <div key={i} style={{ width: 5, height: 5, borderRadius: '50%', background: e.color, opacity: inMonth ? 1 : 0.4 }} />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Legend ────────────────────────────────────────────────────────────────
//
// Andreas/Taran/Felles-prikkene er også filterknapper: klikk skjuler/viser
// den kalenderkilden. Gjøremål er alltid synlig — bare de tre kalenderkildene
// kan skjules.

const CAL_SOURCES: Source[] = ['andreas', 'taran', 'felles'];

function Legend({ hidden, onToggle }: { hidden: Set<Source>; onToggle: (key: Source) => void }) {
  return (
    <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 12, paddingLeft: 2 }}>
      {CAL_SOURCES.map(key => {
        const on = !hidden.has(key);
        return (
          <button
            key={key}
            onClick={() => onToggle(key)}
            aria-pressed={on}
            title={on ? `Skjul ${SOURCE_META[key].label}` : `Vis ${SOURCE_META[key].label}`}
            style={{
              display: 'flex', alignItems: 'center', gap: 5,
              background: 'transparent', border: 0, padding: 0, cursor: 'pointer',
              opacity: on ? 1 : 0.4,
            }}
          >
            <div style={{ width: 7, height: 7, borderRadius: '50%', background: SOURCE_META[key].color }} />
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-3)', textDecoration: on ? 'none' : 'line-through' }}>
              {SOURCE_META[key].label}
            </span>
          </button>
        );
      })}
      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
        <div style={{ display: 'flex', gap: 2 }}>
          {([['høy', 'Høy'], ['middels', 'Middels'], ['lav', 'Lav']] as const).map(([pri]) => (
            <div key={pri} style={{ width: 7, height: 7, borderRadius: '50%', background: PRIORITY_COLORS[pri] }} />
          ))}
        </div>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-3)' }}>Gjøremål</span>
      </div>
    </div>
  );
}

// ─── View toggle ───────────────────────────────────────────────────────────

type View = 'month' | 'list';

function ViewToggle({ view, onChange }: { view: View; onChange: (v: View) => void }) {
  const btn = (v: View, label: string) => (
    <button
      onClick={() => onChange(v)}
      style={{
        padding: '5px 14px', borderRadius: 6, fontSize: 12, fontWeight: 500,
        fontFamily: 'var(--font-mono)', cursor: 'pointer',
        background: view === v ? 'var(--ink)' : 'transparent',
        color: view === v ? 'var(--surface)' : 'var(--ink-3)',
        border: view === v ? '1px solid var(--ink)' : '1px solid var(--line-2)',
        transition: 'all 120ms',
      }}
    >{label}</button>
  );
  return (
    <div style={{ display: 'flex', gap: 6 }}>
      {btn('list',  'Liste')}
      {btn('month', 'Måned')}
    </div>
  );
}

// ─── Page ──────────────────────────────────────────────────────────────────

export default function PageKalender() {
  const [calEvents, setCalEvents] = useState<CalEvent[]>([]);
  const [loading, setLoading]     = useState(true);
  const { items: todos } = useTodo();
  const [isMobile, setIsMobile]   = useState(() => window.innerWidth < 768);
  const [view, setView]           = useState<View>('list');
  const [hiddenSources, setHiddenSources] = useState<Set<Source>>(() => {
    try {
      const raw = localStorage.getItem('felles_kalender_hidden');
      return raw ? new Set(JSON.parse(raw) as Source[]) : new Set();
    } catch { return new Set(); }
  });
  const toggleSource = (key: Source) => setHiddenSources(prev => {
    const next = new Set(prev);
    next.has(key) ? next.delete(key) : next.add(key);
    try { localStorage.setItem('felles_kalender_hidden', JSON.stringify([...next])); } catch { /* ignore */ }
    return next;
  });

  const today    = todayStr();
  const tomorrow = tomorrowStr();
  const now      = new Date();
  const [viewYear,  setViewYear]  = useState(now.getFullYear());
  const [viewMonth, setViewMonth] = useState(now.getMonth());
  const [selected,  setSelected]  = useState(today);

  useEffect(() => {
    const update = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  useEffect(() => {
    fetch('/api/kalender')
      .then(r => r.json())
      .then((data: CalEvent[] | { error: string }) => {
        if (Array.isArray(data)) setCalEvents(data);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const WHO_LABEL: Record<string, string> = { f: 'Felles', M: 'Andreas', L: 'Taran' };
  const p2 = (n: number) => String(n).padStart(2, '0');
  const todoEvents: AnyEvent[] = todos
    .filter(t => !t.done && t.deadline)
    .map(t => {
      // overdue_days > 0 means deadline was moved to today by rollover; reconstruct original date
      const isOverdue = t.overdue_days > 0;
      const timed = !!t.time && !isOverdue;
      let start: string;
      let end: string | undefined;
      if (isOverdue) {
        const d = new Date(today + 'T00:00:00');
        d.setDate(d.getDate() - t.overdue_days);
        start = `${d.getFullYear()}-${p2(d.getMonth()+1)}-${p2(d.getDate())}`;
      } else {
        start = timed ? `${t.deadline}T${t.time}:00` : t.deadline!;
        if (timed) {
          const endDate = new Date(`${t.deadline}T${t.time}:00`);
          endDate.setHours(endDate.getHours() + 1);
          end = `${endDate.getFullYear()}-${p2(endDate.getMonth()+1)}-${p2(endDate.getDate())}T${p2(endDate.getHours())}:${p2(endDate.getMinutes())}:00`;
        }
      }
      return {
        id: `todo-${t.id}`, title: t.title, start, end,
        allDay: isOverdue || !timed, source: 'todo' as Source,
        color: PRIORITY_COLORS[t.priority] ?? PRIORITY_COLORS.lav,
        who: t.who !== 'f' ? WHO_LABEL[t.who] : undefined,
        overdue: isOverdue,
      };
    });

  const allEvents: AnyEvent[] = [
    ...calEvents.filter(e => !hiddenSources.has(e.source as Source)).map(e => ({ ...e, source: e.source as Source })),
    ...todoEvents,
  ];

  const byDate = new Map<string, AnyEvent[]>();
  for (const e of allEvents) {
    const k = e.start.slice(0, 10);
    if (!byDate.has(k)) byDate.set(k, []);
    byDate.get(k)!.push(e);
  }

  const prevMonth = () => {
    if (viewMonth === 0) { setViewYear(y => y - 1); setViewMonth(11); }
    else setViewMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (viewMonth === 11) { setViewYear(y => y + 1); setViewMonth(0); }
    else setViewMonth(m => m + 1);
  };

  // When selecting a day in month view, jump to that month if needed
  const handleSelect = (iso: string) => {
    setSelected(iso);
    const d = new Date(iso + 'T12:00:00');
    setViewYear(d.getFullYear());
    setViewMonth(d.getMonth());
  };

  if (loading) {
    return (
      <div style={{ padding: '60px 0', textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--ink-4)' }}>
        Henter kalender…
      </div>
    );
  }

  // ── Mobile ──
  if (isMobile) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <ViewToggle view={view} onChange={setView} />

        {view === 'month' && (
          <>
            <MonthGrid
              viewYear={viewYear} viewMonth={viewMonth}
              today={today} selected={selected}
              onSelect={handleSelect} onPrev={prevMonth} onNext={nextMonth}
              byDate={byDate} isMobile={true}
            />
            <Legend hidden={hiddenSources} onToggle={toggleSource} />
            <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 10, overflow: 'hidden' }}>
              <DayPanel iso={selected} events={byDate.get(selected) ?? []} today={today} tomorrow={tomorrow} />
            </div>
          </>
        )}

        {view === 'list' && (
          <>
            <Legend hidden={hiddenSources} onToggle={toggleSource} />
            <ListView byDate={byDate} today={today} tomorrow={tomorrow} isMobile={true} />
          </>
        )}
      </div>
    );
  }

  // ── Desktop ──
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <ViewToggle view={view} onChange={setView} />

      {view === 'month' && (
        <div className="grid grid-12" style={{ rowGap: 0 }}>
          <div className="col-7">
            <MonthGrid
              viewYear={viewYear} viewMonth={viewMonth}
              today={today} selected={selected}
              onSelect={handleSelect} onPrev={prevMonth} onNext={nextMonth}
              byDate={byDate} isMobile={false}
            />
            <Legend hidden={hiddenSources} onToggle={toggleSource} />
          </div>
          <div className="col-5">
            <div style={{
              background: 'var(--surface)', border: '1px solid var(--line)',
              borderRadius: 10, overflow: 'hidden',
              position: 'sticky', top: 16, marginLeft: 8,
            }}>
              <DayPanel iso={selected} events={byDate.get(selected) ?? []} today={today} tomorrow={tomorrow} />
            </div>
          </div>
        </div>
      )}

      {view === 'list' && (
        <div className="grid grid-12">
          <div className="col-8">
            <ListView byDate={byDate} today={today} tomorrow={tomorrow} isMobile={false} />
          </div>
          <div className="col-4">
            <div style={{ position: 'sticky', top: 16 }}>
              <Legend hidden={hiddenSources} onToggle={toggleSource} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
