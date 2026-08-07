import { useState, useEffect, useRef } from 'react';
import { useFinance } from '../contexts/FinanceContext';
import { useHusGoal } from '../hooks/useHusGoal';
import { useTodo } from '../contexts/TodoContext';
import { useCountdown, type Countdown } from '../hooks/useCountdown';
import { useSnackbar } from '../contexts/SnackbarContext';
import { useWeeklyBucket } from '../hooks/useWeeklyBucket';
import { Btn, fmtKr, Ico } from '../components';
import { QuickAddBar } from '../QuickAdd';
import { navigate } from '../lib/navigate';
import { burst } from '../confetti';
import { bpFromCombined } from '../lib/buyingPower';
import { useBuyingPowerParams } from '../hooks/useBuyingPowerParams';
import type { CalEvent } from '../../api/kalender';

// ─── Helpers ────────────────────────────────────────────────────────────────

const NO_DAYS_SHORT   = ['søn','man','tir','ons','tor','fre','lør'];
const NO_MONTHS_SHORT = ['jan','feb','mar','apr','mai','jun','jul','aug','sep','okt','nov','des'];
const NO_MONTHS       = ['januar','februar','mars','april','mai','juni','juli','august','september','oktober','november','desember'];
const WEEK_LABELS     = ['Man','Tir','Ons','Tor','Fre','Lør','Søn'];

const SOURCE_COLOR: Record<string, string> = {
  andreas: '#4A80C4', taran: '#6B2FA0', felles: '#7AB394', todo: '#C9963A',
};
const PRIORITY_COLOR: Record<string, string> = {
  høy: '#C0392B', middels: '#C9963A', lav: 'var(--ink-4)',
};
const SOURCE_LABEL: Record<string, string> = {
  andreas: 'Andreas', taran: 'Taran', felles: 'Felles', todo: 'Gjøremål',
};

function localIso(d: Date): string {
  const y   = d.getFullYear();
  const m   = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function todayStr()    { return localIso(new Date()); }
function tomorrowStr() { const d = new Date(); d.setDate(d.getDate() + 1); return localIso(d); }
function offsetDays(n: number): string { const d = new Date(); d.setDate(d.getDate() + n); return localIso(d); }
// End of current ISO week (Monday–Sunday)
function endOfWeekStr(): string {
  const d = new Date();
  const dow = d.getDay(); // 0 = Sun, 1 = Mon, …
  d.setDate(d.getDate() + (dow === 0 ? 0 : 7 - dow));
  return localIso(d);
}

function daysUntil(iso: string): number {
  const t = new Date(); t.setHours(0,0,0,0);
  const d = new Date(iso + 'T00:00:00'); d.setHours(0,0,0,0);
  return Math.ceil((d.getTime() - t.getTime()) / 86400000);
}

function fmtRelDay(iso: string): string {
  const n = daysUntil(iso);
  if (n < 0)  return `${Math.abs(n)} dag${Math.abs(n) === 1 ? '' : 'er'} siden`;
  if (n === 0) return 'i dag';
  if (n === 1) return 'i morgen';
  if (n < 7)   return `om ${n} dager`;
  const [,m,d] = iso.split('-').map(Number);
  const dt = new Date(iso + 'T12:00:00');
  return `${NO_DAYS_SHORT[dt.getDay()]} ${d}. ${NO_MONTHS_SHORT[m-1]}`;
}

function fmtEventDate(iso: string): string {
  const t = todayStr(), tm = tomorrowStr();
  if (iso === t)  return 'I dag';
  if (iso === tm) return 'I morgen';
  const [,m,d] = iso.split('-').map(Number);
  const dt = new Date(iso + 'T12:00:00');
  return `${NO_DAYS_SHORT[dt.getDay()]} ${d}. ${NO_MONTHS_SHORT[m-1]}`;
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('no-NO', { hour: '2-digit', minute: '2-digit' });
}

function getNext7Days(): { iso: string; label: string; num: number }[] {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() + i);
    return { iso: localIso(d), label: WEEK_LABELS[(d.getDay() + 6) % 7], num: d.getDate() };
  });
}


function weekMonthLabel(): string {
  const today = new Date();
  return NO_MONTHS[today.getMonth()] + ' ' + today.getFullYear();
}

// ─── Types ──────────────────────────────────────────────────────────────────

interface AnyEvent {
  id: string;
  title: string;
  start: string;
  end?: string;
  allDay: boolean;
  source: string;
  color: string;
  who?: string;
  overdueSince?: string; // original deadline if mapped forward to today
}

// ─── Status chip ─────────────────────────────────────────────────────────────

function StatusChip({
  icon,
  text,
  warn = false,
  onClick,
}: {
  icon: React.ReactNode;
  text: string;
  warn?: boolean;
  onClick?: () => void;
}) {
  const style: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '4px 10px',
    border: `1px solid ${warn ? 'var(--warn)' : 'var(--line-2)'}`,
    borderRadius: 6,
    background: warn ? 'rgba(201,122,59,0.07)' : 'transparent',
    fontFamily: 'var(--font-mono)',
    fontSize: 11,
    color: warn ? 'var(--warn)' : 'var(--ink-3)',
    letterSpacing: '0.03em',
    whiteSpace: 'nowrap',
    flexShrink: 0,
    cursor: onClick ? 'pointer' : 'default',
  };
  const inner = (
    <>
      <span style={{ color: warn ? 'var(--warn)' : 'var(--ink-4)', display: 'flex', alignItems: 'center' }}>{icon}</span>
      {text}
    </>
  );
  return onClick
    ? <button onClick={onClick} style={style}>{inner}</button>
    : <div style={style}>{inner}</div>;
}

// ─── Savings side ────────────────────────────────────────────────────────────

function SavingsPanel({
  houseSaved,
  houseGoal,
  housePct,
  houseLastMonth,
  houseLastYear,
  houseSinceStart,
  sparkData,
  isMobile,
}: {
  houseSaved: number;
  houseGoal: number;
  housePct: number;
  houseLastMonth: number;
  houseLastYear: number;
  houseSinceStart: number;
  sparkData: { m: string; v: number }[];
  isMobile: boolean;
}) {
  const n = sparkData.length;
  const sparkMin = n ? Math.min(...sparkData.map(h => h.v)) : 0;
  const sparkMax = n ? Math.max(...sparkData.map(h => h.v)) : 1;

  const cPW = 400; const cPH = 72; const cMT = 8; const cMB = 20; const cMR = 48;
  const cTW = cPW + cMR; const cTH = cPH + cMT + cMB;
  const hx  = (i: number) => n > 1 ? i * (cPW / (n - 1)) : 0;
  const hy  = (v: number) => cMT + cPH - ((v - sparkMin) / (sparkMax - sparkMin || 1)) * cPH;
  const histLine = sparkData.map((h, i) => `${i===0?'M':'L'}${hx(i).toFixed(1)},${hy(h.v).toFixed(1)}`).join(' ');
  const histArea = `${histLine} L${hx(n-1).toFixed(1)},${(cMT+cPH).toFixed(1)} L0,${(cMT+cPH).toFixed(1)} Z`;
  const gridKr   = [2500000, 5000000, 7500000, 10000000];
  const yearTicks = [
    { i: 0, label: 'Jan 24' }, { i: 6, label: 'Jul 24' }, { i: 12, label: 'Jan 25' },
    { i: 18, label: 'Jul 25' }, { i: 24, label: 'Jan 26' },
  ];

  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      {/* Eyebrow */}
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.1em', color: 'rgba(207,224,239,0.45)', marginBottom: 10, textTransform: 'uppercase' }}>
        Samlet kjøpekraft · Landsbydrømmen 🏡
      </div>

      {/* Big amount */}
      <div style={{ whiteSpace: 'nowrap', marginBottom: 6 }}>
        <span style={{ fontSize: isMobile ? 32 : 40, fontWeight: 400, letterSpacing: '-0.03em', lineHeight: 1, fontVariantNumeric: 'tabular-nums', color: 'rgba(207,224,239,1)' }}>
          {fmtKr(houseSaved)}
        </span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'rgba(207,224,239,0.35)', marginLeft: 8 }}>
          / {fmtKr(houseGoal)}
        </span>
      </div>

      {/* Percentage */}
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'rgba(207,224,239,0.4)', marginBottom: 10, letterSpacing: '0.06em' }}>
        {housePct.toFixed(2).replace('.', ',')}% AV MÅLET
      </div>

      {/* Progress bar */}
      <div style={{ position: 'relative', height: 4, background: 'rgba(255,255,255,0.1)', borderRadius: 2, marginBottom: 4 }}>
        <div style={{ width: Math.min(housePct, 100) + '%', height: '100%', background: 'rgba(207,224,239,0.6)', borderRadius: 2 }} />
        {[25, 50, 75].map(p => (
          <div key={p} style={{ position: 'absolute', left: p + '%', top: -2, width: 1, height: 8, background: 'rgba(255,255,255,0.13)' }} />
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 14 }}>
        {['0', '2,5 M', '5 M', '7,5 M', '10 M'].map((l, i) => (
          <span key={i} style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'rgba(207,224,239,0.25)' }}>{l}</span>
        ))}
      </div>

      {/* Deltas */}
      <div style={{ display: 'flex', gap: 0, paddingTop: 14, borderTop: '1px solid rgba(255,255,255,0.07)' }}>
        {[
          { label: isMobile ? 'Mnd' : 'Siste måned',   v: houseLastMonth  },
          { label: isMobile ? '12 mnd' : 'Siste 12 mnd', v: houseLastYear   },
          { label: 'Siden start',                         v: houseSinceStart },
        ].map(({ label, v }) => (
          <div key={label} style={{ flex: 1 }}>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.07em', color: 'rgba(207,224,239,0.4)', textTransform: 'uppercase', marginBottom: 3 }}>{label}</div>
            <div style={{
              fontSize: isMobile ? 14 : 17, fontWeight: 500, letterSpacing: '-0.02em',
              fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap',
              color: v > 0 ? '#7AB394' : v < 0 ? '#E07070' : 'rgba(207,224,239,0.5)',
            }}>
              {v > 0 ? '+' : ''}{fmtKr(v)}
            </div>
          </div>
        ))}
      </div>

      {/* Chart — desktop only */}
      {!isMobile && n >= 2 && (
        <div style={{ marginTop: 18, paddingTop: 18, borderTop: '1px solid rgba(255,255,255,0.07)' }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.07em', color: 'rgba(207,224,239,0.35)', textTransform: 'uppercase', marginBottom: 8 }}>
            Utvikling siden start
          </div>
          <svg viewBox={`0 0 ${cTW} ${cTH}`} style={{ width: '100%', display: 'block' }}>
            <defs>
              <linearGradient id="hGradDb" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#CFE0EF" stopOpacity="0.2" />
                <stop offset="100%" stopColor="#CFE0EF" stopOpacity="0" />
              </linearGradient>
            </defs>
            {gridKr.map(v => (
              <g key={v}>
                <line x1={0} y1={hy(v)} x2={cPW} y2={hy(v)} stroke="rgba(255,255,255,0.05)" strokeWidth="0.5" strokeDasharray="2 3" />
                <text x={cPW+6} y={hy(v)+3.5} fontFamily="var(--font-mono)" fontSize="7.5" fill="rgba(207,224,239,0.3)">
                  {(v/1000000).toFixed(1).replace('.',',')+' M'}
                </text>
              </g>
            ))}
            <path d={histArea} fill="url(#hGradDb)" />
            <path d={histLine} fill="none" stroke="#CFE0EF" strokeWidth="0.9" />
            {sparkData.map((h, i) => <circle key={i} cx={hx(i)} cy={hy(h.v)} r="1.2" fill="#CFE0EF" opacity="0.5" />)}
            <circle cx={hx(n-1)} cy={hy(sparkData[n-1].v)} r="2.2" fill="#CFE0EF" />
            {yearTicks.filter(t => t.i < n).map(t => (
              <text key={t.i} x={hx(t.i)} y={cTH-3} fontFamily="var(--font-mono)" fontSize="7.5" fill="rgba(207,224,239,0.3)"
                textAnchor={t.i===0?'start':t.i>=n-1?'end':'middle'}>
                {t.label}
              </text>
            ))}
          </svg>
        </div>
      )}
    </div>
  );
}

// ─── Countdown panel ─────────────────────────────────────────────────────────

const EMPTY_COUNTDOWN: Countdown = { label: '', date: '' };

function CountdownPanel({ dark = false }: { dark?: boolean }) {
  const { cd, save: saveCd, clear: clearCd, loading } = useCountdown();
  const { notify } = useSnackbar();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft]     = useState<Countdown>(cd ?? EMPTY_COUNTDOWN);

  useEffect(() => { if (!editing) setDraft(cd ?? EMPTY_COUNTDOWN); }, [cd, editing]);

  const save = () => {
    if (!draft.label.trim() || !draft.date) return;
    saveCd({ label: draft.label.trim(), date: draft.date });
    setEditing(false);
  };

  const remove = () => {
    const prev = cd;
    void clearCd();
    if (prev) notify('Nedtelling fjernet', { actionLabel: 'Angre', onAction: () => void saveCd(prev) });
  };

  const days = cd ? daysUntil(cd.date) : 0;

  const textPrimary   = dark ? 'rgba(207,224,239,0.9)' : 'var(--ink)';
  const textSecondary = dark ? 'rgba(207,224,239,0.45)' : 'var(--ink-4)';
  const textAccent    = dark ? 'rgba(207,224,239,1)' : 'var(--ink)';
  const btnStyle: React.CSSProperties = { background: 'transparent', border: 0, cursor: 'pointer', color: textSecondary, fontSize: 13, padding: '2px 4px', lineHeight: 1 };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', justifyContent: 'center' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.1em', color: textSecondary, textTransform: 'uppercase' }}>
          Nedtelling
        </div>
        {cd && (
          <div style={{ display: 'flex', gap: 2 }}>
            <button onClick={() => { setDraft(cd); setEditing(e => !e); }} style={btnStyle} aria-label="Rediger nedtelling">✎</button>
            <button onClick={remove} style={btnStyle} aria-label="Fjern nedtelling">×</button>
          </div>
        )}
      </div>

      {loading ? (
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: textSecondary }}>…</div>
      ) : !editing ? (
        cd ? (
          <>
            <div style={{ fontSize: 13, fontWeight: 400, color: textPrimary, marginBottom: 8, lineHeight: 1.3 }}>
              {cd.label}
            </div>
            <div style={{
              fontSize: 64, fontWeight: 400, letterSpacing: '-0.04em',
              lineHeight: 0.9, fontVariantNumeric: 'tabular-nums', color: textAccent,
              marginBottom: 10,
            }}>
              {Math.max(0, days)}
            </div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: textSecondary }}>
              {days <= 0 ? 'i dag!' : days === 1 ? 'dag · i morgen' : 'dager'} · {new Date(cd.date + 'T12:00:00').toLocaleDateString('nb-NO', { day: 'numeric', month: 'long', year: 'numeric' })}
            </div>
          </>
        ) : (
          <button
            onClick={() => { setDraft(EMPTY_COUNTDOWN); setEditing(true); }}
            style={{
              background: 'transparent', cursor: 'pointer', textAlign: 'left',
              border: `1px dashed ${textSecondary}`, borderRadius: 6, padding: '10px 12px',
              color: textSecondary, fontSize: 12,
            }}
          >+ Legg til nedtelling</button>
        )
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <input
            className="input"
            placeholder="Hva teller vi ned til?"
            value={draft.label}
            onChange={e => setDraft(d => ({ ...d, label: e.target.value }))}
            onKeyDown={e => { if (e.key === 'Enter') save(); }}
            autoFocus
            style={dark ? { background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.15)', color: 'rgba(207,224,239,0.9)' } : undefined}
          />
          <input
            className="input"
            type="date"
            value={draft.date}
            onChange={e => setDraft(d => ({ ...d, date: e.target.value }))}
            style={dark ? { background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.15)', color: 'rgba(207,224,239,0.9)' } : undefined}
          />
          <div style={{ display: 'flex', gap: 6 }}>
            <Btn primary onClick={save} style={{ flex: 1 }}>Lagre</Btn>
            <Btn ghost onClick={() => setEditing(false)} style={{ flex: 1 }}>Avbryt</Btn>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Week + upcoming section ──────────────────────────────────────────────────

function WeekSection({ allEvents }: { allEvents: AnyEvent[] }) {
  const today    = todayStr();
  const tomorrow = tomorrowStr();
  const weekDays = getNext7Days();

  const eventsByDay = new Map<string, AnyEvent[]>();
  for (const e of allEvents) {
    const k = e.start.slice(0,10);
    if (!eventsByDay.has(k)) eventsByDay.set(k, []);
    eventsByDay.get(k)!.push(e);
  }

  const in7 = offsetDays(7);

  const now = new Date();
  const upcoming = allEvents
    .filter(e => {
      const d = e.start.slice(0,10);
      if (d < today || d > in7) return false;
      // Keep timed events visible until they finish, not just until they start.
      // Events without an end (e.g. todos) fall back to their start time.
      if (!e.allDay) return new Date(e.end ?? e.start) > now;
      return true;
    })
    .sort((a, b) => {
      const aOvd = a.source === 'todo' && !!a.overdueSince ? 1 : 0;
      const bOvd = b.source === 'todo' && !!b.overdueSince ? 1 : 0;
      if (aOvd !== bOvd) return bOvd - aOvd;
      // Among overdue todos: longest overdue (earliest original deadline) first
      if (aOvd && bOvd) return a.overdueSince!.localeCompare(b.overdueSince!);
      return new Date(a.start).getTime() - new Date(b.start).getTime();
    })
    .slice(0, 8);

  return (
    <div>
      {/* Section header */}
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ fontWeight: 500, fontSize: 13, color: 'var(--ink-2)' }}>Denne uken</div>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--ink-4)' }}>{weekMonthLabel()}</div>
      </div>

      {/* Week strip */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 12 }}>
        {weekDays.map(w => {
          const isToday    = w.iso === today;
          const isTomorrow = w.iso === tomorrow;
          const events     = eventsByDay.get(w.iso) ?? [];
          return (
            <button key={w.iso} onClick={() => navigate('kalender')} title="Åpne kalender" style={{
              flex: 1, padding: '7px 4px 5px', borderRadius: 4, textAlign: 'center',
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, minHeight: 58,
              background: isToday ? 'var(--ink-fixed)' : isTomorrow ? 'var(--chip)' : 'transparent',
              border: isToday ? '0' : `1px solid ${isTomorrow ? 'var(--line-2)' : 'var(--line)'}`,
              font: 'inherit', cursor: 'pointer',
            }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.06em', color: isToday ? 'rgba(207,224,239,0.55)' : 'var(--ink-4)' }}>
                {w.label.toUpperCase()}
              </span>
              <span style={{ fontSize: 17, fontWeight: 500, fontVariantNumeric: 'tabular-nums', lineHeight: 1.2, color: isToday ? 'rgba(207,224,239,0.95)' : isTomorrow ? 'var(--ink-2)' : 'var(--ink-3)' }}>
                {w.num}
              </span>
              <div style={{ display: 'flex', gap: 2, justifyContent: 'center', minHeight: 5, marginTop: 1 }}>
                {events.slice(0,3).map((e, i) => (
                  <div key={i} style={{
                    width: 4, height: 4, borderRadius: '50%',
                    background: isToday ? 'rgba(207,224,239,0.6)' : e.color,
                  }} />
                ))}
              </div>
            </button>
          );
        })}
      </div>

      {/* Upcoming list */}
      {upcoming.length === 0 ? (
        <div style={{ padding: '16px 0', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-4)', textAlign: 'center' }}>
          Ingen hendelser denne uken
        </div>
      ) : upcoming.map((e, i) => {
        const dateKey = e.start.slice(0,10);
        const isT     = dateKey === today;
        const isTm    = dateKey === tomorrow;
        return (
          <div key={e.id} style={{
            display: 'flex', alignItems: 'flex-start', gap: 8,
            padding: isT ? '9px 8px' : '6px 8px',
            borderBottom: i < upcoming.length - 1 ? '1px solid var(--line)' : '0',
            borderLeft: `${isT ? 3 : 2}px solid ${e.color}`,
            borderRadius: 4,
            background: e.source === 'todo' && e.overdueSince
              ? 'rgba(192,57,43,0.45)'
              : isT ? 'rgba(120,120,120,0.08)' : 'transparent',
            opacity: !isT && !isTm ? 0.6 : 1,
          }}>
            <span style={{
              fontFamily: 'var(--font-mono)', fontSize: 10, width: 54, flexShrink: 0, letterSpacing: '0.03em',
              color: isT ? e.color : 'var(--ink-4)',
              fontWeight: isT ? 700 : 400,
              paddingTop: 2,
            }}>
              {fmtEventDate(dateKey)}
            </span>
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{
                fontSize: isT ? 14 : 13,
                fontWeight: isT ? 600 : isTm ? 500 : 400,
                color: isT ? 'var(--ink)' : 'var(--ink-2)',
              }}>
                {e.title}
              </span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: e.color, opacity: isT ? 1 : 0.75 }}>
                {e.source === 'todo'
                  ? e.overdueSince
                    ? `Gjøremål · ${e.who ?? 'Felles'} · forfalt ${fmtRelDay(e.overdueSince)}`
                    : `Gjøremål · ${e.who ?? 'Felles'}`
                  : (e.who ?? SOURCE_LABEL[e.source] ?? e.source)}
              </span>
            </div>
            {!e.allDay && (
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, flexShrink: 0, color: isT ? 'var(--ink-3)' : 'var(--ink-4)', paddingTop: 2 }}>
                {fmtTime(e.start)}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Todo section ─────────────────────────────────────────────────────────────

import type { TodoEntry } from '../contexts/TodoContext';

function TodoSection({ todos, onToggle }: { todos: TodoEntry[]; onToggle?: (id: string, done: boolean) => void }) {
  const today    = todayStr();
  const tomorrow = tomorrowStr();
  const weekEnd  = endOfWeekStr();

  const active = todos.filter(t => !t.done);

  const overdue     = active.filter(t => t.overdue_days > 0).slice(0, 3);
  const dueNow      = active.filter(t => t.overdue_days === 0 && (t.deadline === today || t.deadline === tomorrow)).slice(0, 3);
  const dueThisWeek = active.filter(t => t.deadline && t.deadline > tomorrow && t.deadline <= weekEnd).slice(0, 2);

  const totalActive = active.length;
  const shownCount  = overdue.length + dueNow.length + dueThisWeek.length;

  function TodoRow({ todo, warn = false }: { todo: TodoEntry; warn?: boolean }) {
    const btnRef = useRef<HTMLButtonElement>(null);
    const handleClick = () => {
      if (!todo.done && btnRef.current) {
        const r = btnRef.current.getBoundingClientRect();
        burst(r.left + r.width / 2, r.top + r.height / 2);
      }
      onToggle?.(todo.id, todo.done);
    };
    return (
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '6px 0',
        borderBottom: '1px solid var(--line)',
      }}>
        <button
          ref={btnRef}
          onClick={handleClick}
          style={{
            width: 16, height: 16, borderRadius: 4, flexShrink: 0,
            border: `1.5px solid ${warn ? 'var(--warn)' : 'var(--line-2)'}`,
            background: 'transparent', cursor: 'pointer', padding: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        />
        <span style={{ flex: 1, fontSize: 13, color: warn ? 'var(--warn)' : 'var(--ink-2)' }}>
          {todo.title}
        </span>
        {todo.deadline && (
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: warn ? 'var(--warn)' : 'var(--ink-4)', flexShrink: 0 }}>
            {fmtRelDay(todo.deadline)}
          </span>
        )}
      </div>
    );
  }

  const allClear = overdue.length === 0 && dueNow.length === 0 && dueThisWeek.length === 0;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ fontWeight: 500, fontSize: 13, color: 'var(--ink-2)' }}>Gjøremål</div>
        {totalActive > 0 && (
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--ink-4)' }}>
            {totalActive} aktive
          </div>
        )}
      </div>

      {allClear ? (
        <div style={{ padding: '24px 0', textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-4)' }}>
          Alt i orden ✓
        </div>
      ) : (
        <>
          {overdue.length > 0 && (
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.08em', color: 'var(--warn)', textTransform: 'uppercase', marginBottom: 4 }}>
                Forfalt
              </div>
              {overdue.map(t => <TodoRow key={t.id} todo={t} warn />)}
            </div>
          )}

          {dueNow.length > 0 && (
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.08em', color: 'var(--ink-4)', textTransform: 'uppercase', marginBottom: 4 }}>
                I dag / i morgen
              </div>
              {dueNow.map(t => <TodoRow key={t.id} todo={t} />)}
            </div>
          )}

          {dueThisWeek.length > 0 && (
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.08em', color: 'var(--ink-4)', textTransform: 'uppercase', marginBottom: 4 }}>
                Denne uken
              </div>
              {dueThisWeek.map(t => <TodoRow key={t.id} todo={t} />)}
            </div>
          )}

          {totalActive > shownCount && (
            <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--ink-4)' }}>
                +{totalActive - shownCount} til
              </span>
              <button style={{
                background: 'transparent', border: 0, cursor: 'pointer',
                fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--accent)',
                padding: 0, textDecoration: 'none',
              }}>
                Vis alle →
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Mobile-specific components ──────────────────────────────────────────────

function MobileSavingsMini({ houseSaved, housePct, houseLastMonth }: {
  houseSaved: number; housePct: number; houseLastMonth: number;
}) {
  return (
    <div style={{ height: '100%', padding: '16px', background: 'var(--ink-fixed)', borderRadius: 8, display: 'flex', flexDirection: 'column', gap: 0 }}>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.08em', color: 'rgba(207,224,239,0.4)', textTransform: 'uppercase', marginBottom: 8 }}>
        Kjøpekraft 🏡
      </div>
      <div style={{ fontSize: 22, fontWeight: 400, letterSpacing: '-0.03em', color: 'rgba(207,224,239,0.95)', fontVariantNumeric: 'tabular-nums', lineHeight: 1.1, marginBottom: 3 }}>
        {fmtKr(houseSaved)}
      </div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'rgba(207,224,239,0.35)' }}>
        {housePct.toFixed(1).replace('.', ',')}%
      </div>
      <div style={{ flex: 1 }} />
      <div style={{ height: 3, background: 'rgba(255,255,255,0.1)', borderRadius: 2, marginBottom: 8 }}>
        <div style={{ width: Math.min(housePct, 100) + '%', height: '100%', background: 'rgba(207,224,239,0.5)', borderRadius: 2 }} />
      </div>
      {houseLastMonth !== 0 && (
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: houseLastMonth > 0 ? '#7AB394' : '#E07070' }}>
          {houseLastMonth > 0 ? '+' : ''}{fmtKr(houseLastMonth)} mnd
        </div>
      )}
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

// ── Weekly "ting vi vil gjøre" reminder (shared across all devices) ──────────
// Same item everywhere, rolls to a fresh random one the night into Monday.
// `dark` renders bare content for the dark hero column; ellers et eget kort.
function BucketReminder({ dark = false }: { dark?: boolean }) {
  const { item } = useWeeklyBucket();
  if (!item) return null;
  const who = item.who === 'M' ? 'Andreas' : item.who === 'L' ? 'Taran' : 'vi';
  const secondary = dark ? 'rgba(207,224,239,0.45)' : 'var(--ink-4)';
  const primary   = dark ? 'rgba(207,224,239,0.9)' : 'var(--ink)';

  const inner = (
    <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', height: '100%', gap: 6 }}>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.1em', color: secondary, textTransform: 'uppercase' }}>
        🎯 Ting vi vil gjøre
      </div>
      <div style={{ fontFamily: 'var(--font-serif)', fontStyle: 'italic', fontSize: 17, lineHeight: 1.35, color: primary }}>
        {item.title}
      </div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: secondary }}>
        noe {who} vil gjøre
      </div>
    </div>
  );

  if (dark) return inner;
  return (
    <div style={{ padding: '16px', background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 8 }}>
      {inner}
    </div>
  );
}

export default function PageDashboard() {
  const { finance }     = useFinance();
  const { goal: houseGoalFromDB } = useHusGoal();
  const { items: todos, toggleItem } = useTodo();
  const { cd } = useCountdown();
  const { params: bpParams } = useBuyingPowerParams();
  const [calEvents, setCalEvents] = useState<CalEvent[]>([]);
  const [winW, setWinW] = useState(window.innerWidth);

  useEffect(() => {
    const update = () => setWinW(window.innerWidth);
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  const isMobile = winW < 768;
  // The desktop hero is a 3-column flex; below ~1180px it gets too tight and the
  // savings figure collides with the countdown — so stack it there instead.
  const heroStacked = !isMobile && winW < 1180;

  useEffect(() => {
    const doFetch = () => {
      fetch('/api/kalender')
        .then(r => r.json())
        .then((data: CalEvent[] | { error: string }) => {
          if (Array.isArray(data)) setCalEvents(data);
        })
        .catch(() => {});
    };
    doFetch();
    const id = setInterval(doFetch, 5 * 60 * 1000);
    return () => clearInterval(id);
  }, []);

  // ── Derived data ──
  const today    = todayStr();
  const WHO: Record<string, string> = { f: 'Felles', M: 'Andreas', L: 'Taran' };

  const todoEvents: AnyEvent[] = todos
    .filter(t => !t.done && t.deadline)
    .map(t => {
      // Overdue if the cron rolled it (overdue_days > 0), the deadline date is past, OR it has
      // a time today that has already passed — so timed todos stay (red) instead of vanishing
      // the instant their time ticks by.
      const overdue = t.overdue_days > 0
        || t.deadline! < today
        || (!!t.time && new Date(`${t.deadline}T${t.time}:00`) < new Date());
      const timed   = !!t.time && !overdue;
      const start   = overdue ? today : timed ? `${t.deadline}T${t.time}:00` : t.deadline!;
      // Original due date is invariant under rollover: deadline - overdue_days.
      // Don't derive it from `today`: between local midnight and the cron (≈01:05 Oslo)
      // the stored overdue_days is still yesterday's count, so `today - overdue_days`
      // under-reports by a day and ties the sort (pushing newly-overdue items above
      // ones that have been overdue longer).
      const overdueSince = !overdue ? undefined : (() => {
        const d = new Date(t.deadline! + 'T00:00:00');
        d.setDate(d.getDate() - t.overdue_days);
        return localIso(d);
      })();
      return {
        id: `todo-${t.id}`,
        title: t.title,
        start,
        allDay: overdue || !timed,
        source: 'todo',
        color: PRIORITY_COLOR[t.priority] ?? SOURCE_COLOR.todo,
        who: t.who !== 'f' ? WHO[t.who] : undefined,
        overdueSince,
      };
    });

  const allEvents: AnyEvent[] = [
    ...calEvents.map(e => ({ ...e, source: e.source as string })),
    ...todoEvents,
  ];

  // ── Savings data ──
  const bpHistory = finance.M.map((em, i) => {
    const el = finance.L.length > 0 ? finance.L[Math.min(i, finance.L.length - 1)] : null;
    return { m: em.month, v: bpFromCombined(em, el, bpParams).maxPurchase };
  });

  const houseGoal       = houseGoalFromDB;
  const houseSaved      = bpHistory.length ? bpHistory[bpHistory.length - 1].v : 0;
  const housePct        = houseSaved > 0 ? (houseSaved / houseGoal) * 100 : 0;
  const houseLastMonth  = bpHistory.length >= 2  ? houseSaved - bpHistory[bpHistory.length - 2].v : 0;
  const houseLastYear   = bpHistory.length >= 13 ? houseSaved - bpHistory[bpHistory.length - 13].v : 0;
  const houseSinceStart = bpHistory.length >= 2  ? houseSaved - bpHistory[0].v : 0;

  // ── Status chips data ──
  const overdueTodos = todos.filter(t => !t.done && t.overdue_days > 0);
  const dueTodayTodos = todos.filter(t => !t.done && t.overdue_days === 0 && t.deadline === today);
  const urgentCount = overdueTodos.length + dueTodayTodos.length;

  const nextCalEvent = allEvents
    .filter(e => e.start.slice(0,10) >= today)
    .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())[0];

  const cdDays = cd ? daysUntil(cd.date) : 0;

  // ── Mobile layout ──
  if (isMobile) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>

        {/* Snarveier: legg til gjøremål / rating */}
        <div style={{ display: 'flex', gap: 10 }}>
          <QuickAddBar isMobile />
        </div>

        {/* Kompakt stats: sparing + nedtelling */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <button onClick={() => navigate('hus')} aria-label="Åpne Landsbydrømmen"
            style={{ display: 'block', width: '100%', textAlign: 'left', background: 'transparent', border: 0, padding: 0, font: 'inherit', color: 'inherit', cursor: 'pointer' }}>
            <MobileSavingsMini
              houseSaved={houseSaved}
              housePct={housePct}
              houseLastMonth={houseLastMonth}
            />
          </button>
          <div style={{ padding: '16px', background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 8 }}>
            <CountdownPanel dark={false} />
          </div>
        </div>

        {/* Ting vi vil gjøre */}
        <BucketReminder />

        {/* Denne uken */}
        <div style={{ paddingTop: 4, borderTop: '1px solid var(--line)' }}>
          <WeekSection allEvents={allEvents} />
        </div>

        {/* Gjøremål */}
        <div style={{ paddingTop: 4, borderTop: '1px solid var(--line)' }}>
          <TodoSection todos={todos} onToggle={toggleItem} />
        </div>

      </div>
    );
  }

  // ── Desktop layout ──
  const savingsEl = (
    <button onClick={() => navigate('hus')} aria-label="Åpne Landsbydrømmen"
      style={{ display: 'block', width: '100%', textAlign: 'left', background: 'transparent', border: 0, padding: 0, font: 'inherit', color: 'inherit', cursor: 'pointer' }}>
      <SavingsPanel
        houseSaved={houseSaved} houseGoal={houseGoal} housePct={housePct}
        houseLastMonth={houseLastMonth} houseLastYear={houseLastYear}
        houseSinceStart={houseSinceStart} sparkData={bpHistory} isMobile={false}
      />
    </button>
  );

  return (
    <div className="grid grid-12" style={{ rowGap: 24 }}>

      {/* Status-strip */}
      <div className="col-12">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          {urgentCount > 0 && (
            <StatusChip
              icon={Ico.check}
              text={`${urgentCount} frist${urgentCount === 1 ? '' : 'er'}${overdueTodos.length > 0 ? ' · forfalt' : ' · i dag'}`}
              warn={overdueTodos.length > 0}
              onClick={() => navigate('gjoremal')}
            />
          )}
          {nextCalEvent && (
            <StatusChip
              icon={Ico.cal}
              text={`${nextCalEvent.title} · ${fmtRelDay(nextCalEvent.start.slice(0,10))}`}
              onClick={() => navigate('kalender')}
            />
          )}
          {cd && (
            <StatusChip
              icon={Ico.star}
              text={`${Math.max(0, cdDays)} dager til ${cd.label}`}
              onClick={() => navigate('kalender')}
            />
          )}
          {/* Snarveier: legg til gjøremål / rating */}
          <div style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
            <QuickAddBar isMobile={false} />
          </div>
        </div>
      </div>

      {/* Mørk hero: sparing (2/4) + nedtelling (1/4) + notis (1/4).
          Below ~1180px it stacks: savings on top, countdown + note in a row beneath. */}
      <div className="col-12">
        <div className="card dark" style={{ padding: 28, display: 'flex', flexDirection: heroStacked ? 'column' : 'row', alignItems: 'stretch', gap: 0 }}>
          {heroStacked ? (
            <>
              <div style={{ minWidth: 0 }}>{savingsEl}</div>
              <div style={{ height: 1, background: 'rgba(255,255,255,0.07)', margin: '22px 0' }} />
              <div style={{ display: 'flex', alignItems: 'stretch', gap: 0 }}>
                <div style={{ flex: '1 1 0', minWidth: 0, paddingRight: 24 }}>
                  <CountdownPanel dark={true} />
                </div>
                <div style={{ width: 1, background: 'rgba(255,255,255,0.07)', flexShrink: 0 }} />
                <div style={{ flex: '1 1 0', minWidth: 0, paddingLeft: 24, display: 'flex' }}>
                  <BucketReminder dark />
                </div>
              </div>
            </>
          ) : (
            <>
              <div style={{ flex: '2 1 0', minWidth: 0, paddingRight: 28 }}>{savingsEl}</div>
              <div style={{ width: 1, background: 'rgba(255,255,255,0.07)', flexShrink: 0 }} />
              <div style={{ flex: '1 1 0', minWidth: 0, paddingLeft: 28, paddingRight: 20 }}>
                <CountdownPanel dark={true} />
              </div>
              <div style={{ width: 1, background: 'rgba(255,255,255,0.07)', flexShrink: 0 }} />
              <div style={{ flex: '1 1 0', minWidth: 0, paddingLeft: 20, display: 'flex' }}>
                <BucketReminder dark />
              </div>
            </>
          )}
        </div>
      </div>

      {/* Denne uken */}
      <div className="col-7">
        <WeekSection allEvents={allEvents} />
      </div>

      {/* Gjøremål */}
      <div className="col-5">
        <TodoSection todos={todos} onToggle={toggleItem} />
      </div>

    </div>
  );
}
