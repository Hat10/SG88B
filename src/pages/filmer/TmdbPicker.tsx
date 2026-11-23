// Tittelfelt med TMDB-treff (plakat-miniatyr, tittel, år) rett under feltet.
//
// Treffene rendres INLINE i arkets vanlige flyt (ikke portal/position: fixed),
// slik at arket og lista scroller som én flate. En flytende liste utenfor arkets
// scroll-område ga på iPad «dobbel» scrolling (lista + arket/siden samtidig), og
// med tastaturet oppe ble den plassert etter visualViewport-målinger som raskt
// ble utdaterte. Alle bruksstedene ligger inne i et Sheet.
//
// Tastaturlogikk som i okonomi/shared.tsx: ↓/↑ velger i lista, Enter tar KUN et
// treff man bevisst har valgt (ellers egen tekst via onEnter), Esc lukker lista.
import { useEffect, useRef, useState } from 'react';
import { useTmdbSearch } from '../../lib/tmdbClient';
import { tmdbImg, type TmdbCandidate, type TmdbKind } from '../../lib/tmdb';

const MAX_ROWS = 8;
let nextId = 0;

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
  const blurRef = useRef<ReturnType<typeof setTimeout>>();
  const listRef = useRef<HTMLDivElement>(null);
  const [listId] = useState(() => `tmdb-picker-${++nextId}`);
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(-1);
  const { results, loading, error } = useTmdbSearch(value, kind, search && open);

  const rows = results.slice(0, MAX_ROWS);
  const hiSafe = hi < rows.length ? hi : -1;
  const showList = search && open && value.trim().length >= 2;

  useEffect(() => { setHi(-1); }, [results]);
  useEffect(() => () => clearTimeout(blurRef.current), []);

  // Tastaturvalget holdes synlig i arkets scroll-område.
  useEffect(() => {
    if (hiSafe < 0) return;
    listRef.current?.querySelector<HTMLElement>(`[data-idx="${hiSafe}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [hiSafe]);

  const pick = (c: TmdbCandidate) => {
    clearTimeout(blurRef.current);
    setOpen(false);
    setHi(-1);
    onPick(c);
  };

  return (
    <div>
      <input
        className="input"
        autoFocus={autoFocus}
        value={value}
        placeholder={placeholder}
        aria-label={ariaLabel}
        role={search ? 'combobox' : undefined}
        aria-expanded={search ? showList : undefined}
        aria-controls={search ? listId : undefined}
        aria-autocomplete={search ? 'list' : undefined}
        aria-activedescendant={showList && hiSafe >= 0 ? `${listId}-${hiSafe}` : undefined}
        autoComplete="off"
        onChange={e => { onChange(e.target.value); setOpen(true); setHi(-1); }}
        onFocus={() => { clearTimeout(blurRef.current); setOpen(true); }}
        // Liten forsinkelse: et klikk på et treff skal rekke å registreres først.
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
      {showList && (
        <div
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label="Treff på TMDB"
          // Hindrer at feltet mister fokus (og tastaturet lukkes) når man trykker i lista,
          // slik at første trykk på et treff velger det.
          onMouseDown={e => e.preventDefault()}
          style={{
            marginTop: 6, background: 'var(--surface)', border: '1px solid var(--line-2)',
            borderRadius: 9, padding: 4,
          }}
        >
          {rows.map((c, idx) => (
            <div
              key={`${c.kind}-${c.id}`}
              id={`${listId}-${idx}`}
              data-idx={idx}
              role="option"
              aria-selected={idx === hiSafe}
              onClick={() => pick(c)}
              onMouseEnter={() => setHi(idx)}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '6px 8px', borderRadius: 6, cursor: 'pointer',
                minHeight: 44, touchAction: 'manipulation', WebkitTapHighlightColor: 'transparent',
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
        </div>
      )}
    </div>
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
