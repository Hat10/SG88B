// Tittelfelt med rullegardin av TMDB-treff (plakat-miniatyr, tittel, år).
// Tastaturlogikk som i okonomi/shared.tsx: ↓/↑ velger i lista, Enter tar KUN et
// treff man bevisst har valgt (ellers egen tekst via onEnter), Esc lukker lista.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTmdbSearch } from '../../lib/tmdbClient';
import { tmdbImg, type TmdbCandidate, type TmdbKind } from '../../lib/tmdb';

const MAX_ROWS = 8;

interface Pos { left: number; width: number; top: number; up: boolean; maxH: number }

export function TmdbPicker({
  value, onChange, kind, onPick, onEnter, search = true, autoFocus, placeholder, ariaLabel = 'Tittel',
}: {
  value: string;
  onChange: (v: string) => void;
  kind: TmdbKind;
  onPick: (c: TmdbCandidate) => void;
  /** Enter uten valgt treff (f.eks. lagre egen tekst). */
  onEnter?: () => void;
  /** false = vanlig tekstfelt (f.eks. når et treff allerede er valgt). */
  search?: boolean;
  autoFocus?: boolean;
  placeholder?: string;
  ariaLabel?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const blurRef = useRef<ReturnType<typeof setTimeout>>();
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(-1);
  const [pos, setPos] = useState<Pos | null>(null);
  const { results, loading, error } = useTmdbSearch(value, kind, search && open);

  const rows = results.slice(0, MAX_ROWS);
  const hiSafe = hi < rows.length ? hi : -1;
  const showList = search && open && value.trim().length >= 2;

  useEffect(() => { setHi(-1); }, [results]);
  useEffect(() => () => clearTimeout(blurRef.current), []);

  // Fast plassering under (eller over) feltet, innenfor det synlige området over tastaturet.
  useLayoutEffect(() => {
    if (!showList) return;
    const place = () => {
      const r = inputRef.current?.getBoundingClientRect();
      if (!r) return;
      const vvTop = window.visualViewport?.offsetTop ?? 0;
      const vvBottom = vvTop + (window.visualViewport?.height ?? window.innerHeight);
      const below = vvBottom - r.bottom - 8;
      const above = r.top - vvTop - 8;
      const up = below < 200 && above > below;
      setPos({
        left: r.left, width: r.width, up,
        top: up ? r.top - 4 : r.bottom + 4,
        maxH: Math.max(120, Math.min(360, up ? above : below)),
      });
    };
    place();
    // Arket åpnes med en skaler-animasjon; mål på nytt når den er ferdig.
    const settle = setTimeout(place, 260);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    window.visualViewport?.addEventListener('resize', place);
    window.visualViewport?.addEventListener('scroll', place);
    return () => {
      clearTimeout(settle);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      window.visualViewport?.removeEventListener('resize', place);
      window.visualViewport?.removeEventListener('scroll', place);
    };
  }, [showList]);

  const pick = (c: TmdbCandidate) => {
    clearTimeout(blurRef.current);
    setOpen(false);
    setHi(-1);
    onPick(c);
  };

  const listId = 'tmdb-picker-list';

  return (
    <>
      <input
        ref={inputRef}
        className="input"
        autoFocus={autoFocus}
        value={value}
        placeholder={placeholder}
        aria-label={ariaLabel}
        role={search ? 'combobox' : undefined}
        aria-expanded={search ? showList : undefined}
        aria-controls={search ? listId : undefined}
        aria-autocomplete={search ? 'list' : undefined}
        autoComplete="off"
        onChange={e => { onChange(e.target.value); setOpen(true); setHi(-1); }}
        onFocus={() => { clearTimeout(blurRef.current); setOpen(true); }}
        onBlur={() => { blurRef.current = setTimeout(() => setOpen(false), 140); }}
        onKeyDown={e => {
          if (e.key === 'ArrowDown' && showList) { e.preventDefault(); setHi(h => Math.min(h + 1, rows.length - 1)); }
          else if (e.key === 'ArrowUp' && showList) { e.preventDefault(); setHi(h => Math.max(h - 1, -1)); }
          else if (e.key === 'Enter') {
            e.preventDefault();
            if (showList && hiSafe >= 0) pick(rows[hiSafe]);
            else { setOpen(false); onEnter?.(); }
          } else if (e.key === 'Escape' && showList) { e.preventDefault(); e.stopPropagation(); setOpen(false); }
        }}
        style={{ minHeight: 44 }}
      />
      {showList && pos && createPortal(
        <div
          id={listId}
          role="listbox"
          // Hindrer at feltet mister fokus når man trykker i lista.
          onMouseDown={e => e.preventDefault()}
          style={{
            position: 'fixed', left: pos.left, width: pos.width, zIndex: 4000,
            top: pos.top, ...(pos.up ? { transform: 'translateY(-100%)' } : null),
            maxHeight: pos.maxH, overflowY: 'auto',
            background: 'var(--surface)', border: '1px solid var(--line-2)', borderRadius: 9,
            boxShadow: '0 10px 30px rgba(0,0,0,0.32)', padding: 4,
          }}
        >
          {rows.map((c, idx) => (
            <div
              key={`${c.kind}-${c.id}`}
              role="option"
              aria-selected={idx === hiSafe}
              onClick={() => pick(c)}
              onMouseEnter={() => setHi(idx)}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '6px 8px', borderRadius: 6, cursor: 'pointer',
                minHeight: 44,
                background: idx === hiSafe ? 'var(--accent-soft)' : 'transparent',
              }}
            >
              <Thumb path={c.posterPath} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {c.title}{c.year ? <span style={{ color: 'var(--ink-3)', fontWeight: 400 }}> ({c.year})</span> : null}
                </div>
                {c.originalTitle && c.originalTitle !== c.title && (
                  <div style={{ fontSize: 11, color: 'var(--ink-4)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.originalTitle}</div>
                )}
              </div>
            </div>
          ))}
          {loading && !rows.length && <Hint>Søker på TMDB…</Hint>}
          {!loading && error && <Hint>{error}. Du kan lagre uten kobling.</Hint>}
          {!loading && !error && !rows.length && <Hint>Ingen treff på TMDB{onEnter ? ' – du kan lagre uten kobling' : ''}.</Hint>}
          {onEnter && rows.length > 0 && (
            <div style={{ borderTop: '1px solid var(--line)', marginTop: 4, padding: '6px 8px 2px', fontSize: 11, color: 'var(--ink-3)' }}>
              {hiSafe >= 0
                ? <>Enter velger <b>{rows[hiSafe].title}</b></>
                : <>Velg et treff, eller lagre «{value.trim()}» uten TMDB-kobling</>}
            </div>
          )}
        </div>,
        document.body,
      )}
    </>
  );
}

const Hint = ({ children }: { children: React.ReactNode }) => (
  <div style={{ padding: '10px 8px', fontSize: 12, color: 'var(--ink-3)' }}>{children}</div>
);

function Thumb({ path }: { path: string | null }) {
  const src = tmdbImg(path, 'w92');
  return src
    ? <img src={src} alt="" loading="lazy" width={30} height={45} style={{ width: 30, height: 45, objectFit: 'cover', borderRadius: 3, flexShrink: 0, background: 'var(--chip)' }} />
    : <div aria-hidden style={{ width: 30, height: 45, borderRadius: 3, flexShrink: 0, background: 'var(--chip)', display: 'grid', placeItems: 'center', fontSize: 14 }}>🎬</div>;
}
