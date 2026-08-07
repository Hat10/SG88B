import { type ReactNode, type CSSProperties, useState, useEffect } from 'react';
import { createPortal } from 'react-dom';

// ── Icons ────────────────────────────────────────────────────────────────────
export const Ico = {
  star: <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2"><path d="M8 2l1.8 4 4.2.4-3.2 2.8 1 4.2L8 11.2 4.2 13.4l1-4.2L2 6.4 6.2 6z"/></svg>,
  cal: <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2"><rect x="2" y="3" width="12" height="11" rx="1"/><path d="M2 6h12M5 2v3M11 2v3"/></svg>,
  plus: <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2"><path d="M6 2v8M2 6h8"/></svg>,
  check: <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M2.5 6.5L5 9l4.5-5.5"/></svg>,
} as const;

// ── Avatars ──────────────────────────────────────────────────────────────────
const WHO_INITIAL: Record<'M' | 'L', string> = { M: 'A', L: 'T' }; // Andreas, Taran

export function Avatar({ who, size = 'sm' }: { who: 'M' | 'L'; size?: 'sm' | 'lg' }) {
  const cls = 'avatar' + (size === 'lg' ? ' lg' : '') + (who === 'M' ? ' avatar-m' : ' avatar-l');
  return <div className={cls}>{WHO_INITIAL[who]}</div>;
}

export function Couple({ size = 'sm' }: { size?: 'sm' | 'lg' }) {
  return (
    <div className="couple">
      <Avatar who="M" size={size} />
      <Avatar who="L" size={size} />
    </div>
  );
}

// ── Card ─────────────────────────────────────────────────────────────────────
interface CardProps {
  eyebrow?: ReactNode;
  title?: ReactNode;
  action?: ReactNode;
  meta?: ReactNode;
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
}

export function Card({ eyebrow, title, action, meta, children, className = '', style }: CardProps) {
  return (
    <div className={'card ' + className} style={style}>
      {(eyebrow || title || action || meta) && (
        <div className="card-head">
          <div className="col" style={{ gap: 4 }}>
            {eyebrow && <div className="card-eyebrow">{eyebrow}</div>}
            {title && <h3 className="card-title">{title}</h3>}
          </div>
          <div className="row" style={{ gap: 8 }}>
            {meta && <div className="card-meta">{meta}</div>}
            {action}
          </div>
        </div>
      )}
      {children}
    </div>
  );
}

// ── Tag ──────────────────────────────────────────────────────────────────────
export function Tag({ children, kind = '', who }: { children?: ReactNode; kind?: string; who?: string }) {
  return (
    <span className={'tag ' + kind}>
      {who && <span className={'who ' + who} />}
      {children}
    </span>
  );
}

// ── Checkbox ─────────────────────────────────────────────────────────────────
export function Check({ on, onClick }: { on: boolean; onClick?: () => void }) {
  return <button className={'check' + (on ? ' on' : '')} onClick={onClick} aria-pressed={on} />;
}

// ── Button ───────────────────────────────────────────────────────────────────
interface BtnProps {
  children?: ReactNode;
  primary?: boolean;
  ghost?: boolean;
  sm?: boolean;
  onClick?: () => void;
  icon?: ReactNode;
  style?: CSSProperties;
}

export function Btn({ children, primary, ghost, sm, onClick, icon, style }: BtnProps) {
  const cls = 'btn' + (primary ? ' primary' : '') + (ghost ? ' ghost' : '') + (sm ? ' sm' : '');
  return (
    <button className={cls} onClick={onClick} style={style}>
      {icon && <span className="ico">{icon}</span>}
      {children}
    </button>
  );
}

// ── Tabs ─────────────────────────────────────────────────────────────────────
interface TabItem { id: string; label: ReactNode; count?: string | number }

export function Tabs({ items, value, onChange }: { items: TabItem[]; value: string; onChange: (id: string) => void }) {
  return (
    <div className="tabs">
      {items.map(it => (
        <button key={it.id} className={'tab' + (value === it.id ? ' active' : '')} onClick={() => onChange(it.id)}>
          {it.label}
          {it.count != null && (
            <span className="mono" style={{ opacity: 0.5, marginLeft: 6, fontSize: 10 }}>{it.count}</span>
          )}
        </button>
      ))}
    </div>
  );
}

// ── Format helpers ────────────────────────────────────────────────────────────
export const fmtKr = (n: number) => new Intl.NumberFormat('nb-NO').format(Math.round(n)) + ' kr';

// ── NumericInput ──────────────────────────────────────────────────────────────
// Shows formatted number (e.g. "1 234 567") when blurred.
// Accepts simple arithmetic expressions (e.g. "100000+50000") when focused —
// evaluates on blur or Enter.

// Safe arithmetic evaluator for money inputs — supports + - * / and parentheses.
// Replaces an earlier `new Function(...)` eval. Anything it can't parse returns null
// (the caller then keeps the prior value), so odd input can never become a wrong number.
function evalExpr(s: string): number | null {
  const clean = s.trim().replace(/\s/g, '').replace(/,/g, '.');
  if (!clean || !/^[\d+\-*/().]+$/.test(clean)) return null;

  let i = 0;
  const peek = () => clean[i];

  const parseExpr = (): number => {
    let v = parseTerm();
    while (peek() === '+' || peek() === '-') {
      const op = clean[i++];
      v = op === '+' ? v + parseTerm() : v - parseTerm();
    }
    return v;
  };
  const parseTerm = (): number => {
    let v = parseFactor();
    while (peek() === '*' || peek() === '/') {
      const op = clean[i++];
      v = op === '*' ? v * parseFactor() : v / parseFactor();
    }
    return v;
  };
  const parseFactor = (): number => {
    if (peek() === '+') { i++; return parseFactor(); }
    if (peek() === '-') { i++; return -parseFactor(); }
    if (peek() === '(') {
      i++;
      const v = parseExpr();
      if (clean[i++] !== ')') throw new Error('unbalanced');
      return v;
    }
    let num = '';
    while (i < clean.length && /[\d.]/.test(clean[i])) num += clean[i++];
    const n = parseFloat(num);
    if (!isFinite(n)) throw new Error('bad number');
    return n;
  };

  try {
    const v = parseExpr();
    if (i !== clean.length) return null; // trailing garbage → invalid
    return isFinite(v) ? Math.round(v) : null;
  } catch { return null; }
}

function fmtNumDisplay(s: string): string {
  if (s === '' || s === '0') return s;
  const n = parseInt(s.replace(/\s/g, ''));
  if (isNaN(n)) return s;
  return new Intl.NumberFormat('nb-NO', { maximumFractionDigits: 0 }).format(n);
}

interface NumericInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'> {
  value: string;
  onChange: (v: string) => void;
}

export function NumericInput({ value, onChange, onKeyDown, ...rest }: NumericInputProps) {
  const [focused, setFocused] = useState(false);
  const isZero = value === '' || value === '0';
  const [draft, setDraft] = useState(isZero ? '' : value);

  useEffect(() => { if (!focused) setDraft(isZero ? '' : value); }, [value, focused]);

  const commit = (raw: string): string => {
    if (!raw.trim()) { onChange('0'); return '0'; }
    const n = evalExpr(raw);
    if (n !== null) { onChange(String(n)); return String(n); }
    return value || '0';
  };

  const showKr = focused ? draft !== '' : !isZero;

  return (
    <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
      <input
        {...rest}
        placeholder={rest.placeholder ?? '0'}
        style={{ ...rest.style, width: '100%', paddingRight: showKr ? '2.4em' : undefined }}
        value={focused ? draft : (isZero ? '' : fmtNumDisplay(value))}
        onChange={e => setDraft(e.target.value)}
        onFocus={() => { setFocused(true); setDraft(isZero ? '' : value); }}
        onBlur={() => { setFocused(false); commit(draft); }}
        onKeyDown={e => {
          if (e.key === 'Enter') {
            const evaled = commit(draft);
            setDraft(evaled === '0' ? '' : evaled);
            setFocused(false);
          }
          onKeyDown?.(e);
        }}
      />
      {showKr && (
        <span style={{
          position: 'absolute', right: '10px',
          fontFamily: 'var(--font-mono)', fontSize: '0.85em',
          color: 'var(--ink-4)', pointerEvents: 'none', userSelect: 'none',
        }}>kr</span>
      )}
    </div>
  );
}

// ── Loading skeletons ─────────────────────────────────────────────────────────
export function Skeleton({ h = 14, w = '100%', radius = 6, style }: { h?: number | string; w?: number | string; radius?: number; style?: CSSProperties }) {
  return <div aria-hidden style={{ height: h, width: w, borderRadius: radius, background: 'var(--chip)', animation: 'skeleton-pulse 1.4s ease-in-out infinite', ...style }} />;
}

export function SkeletonList({ rows = 5 }: { rows?: number }) {
  return (
    <div role="status" aria-label="Laster…" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', border: '1px solid var(--line)', borderRadius: 8 }}>
          <Skeleton h={18} w={18} radius={4} />
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 7 }}>
            <Skeleton h={13} w={`${55 + ((i * 13) % 35)}%`} />
            <Skeleton h={9} w={`${28 + ((i * 17) % 24)}%`} />
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Floating action button (mobile quick-add, within thumb reach) ─────────────
export function Fab({ onClick, label = 'Legg til' }: { onClick: () => void; label?: string }) {
  // Portal to <body> so a transformed ancestor (the page) can't capture the fixed positioning.
  return createPortal(
    <button onClick={onClick} aria-label={label} title={label} style={{
      position: 'fixed', zIndex: 150,
      right: 'calc(18px + env(safe-area-inset-right, 0px))',
      bottom: 'calc(18px + env(safe-area-inset-bottom, 0px))',
      width: 56, height: 56, borderRadius: '50%', border: 0,
      background: 'var(--ink)', color: 'var(--surface)',
      fontSize: 28, lineHeight: 1, cursor: 'pointer',
      display: 'grid', placeItems: 'center',
      boxShadow: '0 6px 22px rgba(11,37,69,0.35)',
    }}>+</button>,
    document.body,
  );
}
