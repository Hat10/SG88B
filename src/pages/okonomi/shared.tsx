// Delte småkomponenter og konstanter for Økonomi-siden (Okonomi.tsx + ImportTab).
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useCategories } from '../../contexts/CategoryContext';
import type { Merchant } from '../../lib/import';
import { aliasKeyOf } from '../../lib/import';

// ─── Kilde-konstanter ─────────────────────────────────────────────────────────

export const SOURCE_LABEL: Record<string, string> = {
  bank_M:    '👨 DNB Mikkel',
  bank_L:    '👩 DNB Leah',
  revolut_M: '👨 Revolut Mikkel',
  revolut_L: '👩 Revolut Leah',
  trumf:     '💳 Trumf Visa (felles)',
  felles:    '✍️ Felles (manuelt)',
};
export const SOURCE_COLOR: Record<string, string> = {
  bank_M:    '#4A80C4',
  bank_L:    '#C97A8B',
  revolut_M: '#4A80C4',
  revolut_L: '#C97A8B',
  trumf:     '#7AB394',
  felles:    '#7AB394',
};

export function monthLabel(m: string) {
  const [y, mo] = m.split('-');
  const names = ['Jan','Feb','Mar','Apr','Mai','Jun','Jul','Aug','Sep','Okt','Nov','Des'];
  return `${names[parseInt(mo, 10) - 1]} ${y}`;
}

// 3-veis «hvem er utgiften» for bankrader
export const OWNERS: { id: 'bank_M' | 'bank_L' | 'felles'; emoji: string; label: string }[] = [
  { id: 'bank_M', emoji: '👨', label: 'Mikkel' },
  { id: 'bank_L', emoji: '👩', label: 'Leah' },
  { id: 'felles', emoji: '🤝', label: 'Felles' },
];
export function ownerOf(source: string): 'bank_M' | 'bank_L' | 'felles' {
  return source === 'bank_M' ? 'bank_M' : source === 'bank_L' ? 'bank_L' : 'felles';
}

export const CURRENCY_SYMBOL: Record<string, string> = {
  EUR: '€', USD: '$', GBP: '£', CHF: 'CHF', SEK: 'SEK', DKK: 'DKK', PLN: 'zł', JPY: '¥', THB: '฿',
};

// ─── Hva er forbruk, inntekt og sparing ───────────────────────────────────────
// Delt mellom Oversikt/Statistikk (Okonomi.tsx) og Investering-fanen, slik at
// «hva teller som hva» defineres nøyaktig ett sted.

/** Alt disse predikatene trenger å vite om en transaksjon. */
export interface TxLike { amount: number; category: string; kind?: string }

// Sparing (kind 'investment', med kategori som fallback for eldre rader) er en
// egen bøtte — verken forbruk eller inntekt.
export const isInvestment = (t: TxLike) => t.kind === 'investment' || t.category === 'investering';

// Kategorier som per definisjon ikke er forbruk. Penger inn her er inntekt —
// aldri en refusjon som skal motregnes i forbrukstallene. Uten dette havnet
// f.eks. Finn.no-salg og Ruter-refusjoner merket «Inntekt» som NEGATIVT forbruk
// i kategorien «Inntekt», som ga meningsløse tall i kategorioversikten.
export const NON_SPENDING_CATS = new Set(['inntekt', 'overføring']);

// Utgifter = penger ut PLUSS refusjoner (positive beløp som motregnes i butikkens
// kategori) — men aldri rader i en ikke-forbrukskategori.
export const isExpense = (t: TxLike) =>
  (t.amount < 0 || t.kind === 'refund') && !isInvestment(t) && !NON_SPENDING_CATS.has(t.category);

// Inntekt er penger inn som ikke er refusjon — pluss ALT i inntekts-/overførings-
// kategoriene, uansett fortegn, så en korreksjon der trekker fra inntekten i
// stedet for å forsvinne ut av regnskapet.
export const isIncome = (t: TxLike) =>
  !isInvestment(t)
  && (NON_SPENDING_CATS.has(t.category) || (t.amount > 0 && t.kind !== 'refund'));

// ─── CatTag ───────────────────────────────────────────────────────────────────

export function CatTag({ cat, confirmed, onClick }: { cat: string; confirmed: boolean; onClick?: () => void }) {
  const { colorOf, labelOf } = useCategories();
  const c = colorOf(cat);
  return (
    <span onClick={onClick} title={onClick ? 'Klikk for å endre' : undefined} style={{
      fontSize: 10, padding: '2px 7px', borderRadius: 10,
      background: c + '22', color: c, fontWeight: 600,
      cursor: onClick ? 'pointer' : 'default', whiteSpace: 'nowrap',
      border: confirmed ? `1px solid ${c}55` : `1px dashed ${c}88`,
    }}>
      {labelOf(cat)}
    </span>
  );
}

// ─── OwnerPicker ──────────────────────────────────────────────────────────────

export function OwnerPicker({ value, onChange }: {
  value: 'bank_M' | 'bank_L' | 'felles';
  onChange: (v: 'bank_M' | 'bank_L' | 'felles') => void;
}) {
  return (
    <div style={{
      display: 'inline-flex', borderRadius: 8, overflow: 'hidden',
      border: '1px solid var(--line)', background: 'var(--bg)',
    }}>
      {OWNERS.map((o, idx) => {
        const active = value === o.id;
        const c = SOURCE_COLOR[o.id];
        return (
          <button
            key={o.id}
            onClick={() => onChange(o.id)}
            title={o.label}
            style={{
              width: 33, padding: '4px 0', border: 'none', cursor: 'pointer',
              borderLeft: idx ? '1px solid var(--line)' : 'none',
              fontSize: 14, lineHeight: 1,
              background: active ? c + '2e' : 'transparent',
              boxShadow: active ? `inset 0 0 0 1.5px ${c}` : 'none',
              filter: active ? 'none' : 'grayscale(0.7) opacity(0.4)',
              transition: 'all .12s',
            }}
          >
            {o.emoji}
          </button>
        );
      })}
    </div>
  );
}

// ─── Ankret panel ─────────────────────────────────────────────────────────────
// Felles plassering for nedtrekk som rendres i portal (fixed) så de aldri klippes
// av kortets overflow. Snur oppover når det er lite plass under.

interface AnchorPos { top: number; left: number; width: number; up: boolean; maxH: number }

function useAnchoredPos(open: boolean, ref: React.RefObject<HTMLElement>, minWidth = 200): AnchorPos | null {
  const [pos, setPos] = useState<AnchorPos | null>(null);
  useEffect(() => {
    if (!open) return;
    const place = () => {
      const el = ref.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const spaceBelow = window.innerHeight - r.bottom - 10;
      const up = spaceBelow < 180 && r.top > spaceBelow;
      const maxH = Math.min(260, up ? r.top - 12 : spaceBelow);
      setPos({ top: up ? r.top - 4 : r.bottom + 4, left: r.left, width: Math.max(r.width, minWidth), up, maxH });
    };
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => { window.removeEventListener('scroll', place, true); window.removeEventListener('resize', place); };
  }, [open, ref, minWidth]);
  return pos;
}

// Rangering for fritekstsøk: eksakt → starter med → ord starter med → inni ordet.
// Uten den flyter tilfeldige midt-i-ordet-treff til toppen (f.eks. «ice» → «4Service»).
function matchRank(name: string, q: string): number {
  const n = name.toLowerCase();
  if (n === q) return 0;
  if (n.startsWith(q)) return 1;
  if (n.split(/[^\p{L}\p{N}]+/u).some(w => w.startsWith(q))) return 2;
  return n.includes(q) ? 3 : 4;
}

// ─── CategoryPicker ───────────────────────────────────────────────────────────
// Søkbar kategorivelger. Erstatter <select> med 20+ valg der man måtte lete seg
// nedover lista. Skriv for å filtrere, piltaster + Enter, Escape avbryter.

export function CategoryPicker({ value, options, onChange, onClose, variant = 'chip', autoOpen, confirmed }: {
  value: string;
  options: string[];
  onChange: (key: string) => void;
  onClose?: () => void;
  variant?: 'chip' | 'field';
  autoOpen?: boolean;
  confirmed?: boolean;
}) {
  const { colorOf, labelOf } = useCategories();
  const [open, setOpen] = useState(!!autoOpen);
  const [q, setQ]       = useState('');
  const [hi, setHi]     = useState(0);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const panelRef  = useRef<HTMLDivElement>(null);
  const inputRef  = useRef<HTMLInputElement>(null);
  const pos = useAnchoredPos(open, anchorRef, 230);

  const query = q.trim().toLowerCase();
  // Lukket liste: filtrer på det brukeren faktisk ser (etiketten)
  const list = (query
    ? options
        .map(k => ({ k, r: matchRank(labelOf(k), query) }))
        .filter(x => x.r < 4)
        .sort((a, b) => a.r - b.r || labelOf(a.k).localeCompare(labelOf(b.k), 'nb'))
        .map(x => x.k)
    : options);
  // Lukket liste ⇒ det er riktig å ha et treff forhåndsvalgt (i motsetning til
  // butikkboksen, der Enter må kunne beholde din egen tekst)
  const hiSafe = list.length ? Math.min(hi, list.length - 1) : -1;

  const shut = () => { setOpen(false); setQ(''); setHi(0); onClose?.(); };
  const pick = (k: string) => { onChange(k); setOpen(false); setQ(''); setHi(0); onClose?.(); };

  // Panelet monteres først når `pos` er beregnet (én render etter at open blir true),
  // så fokus må vente på pos — ellers er inputRef fortsatt null og søkefeltet dødt.
  useEffect(() => { if (open && pos) inputRef.current?.focus(); }, [open, pos]);
  // Klikk utenfor lukker uten å endre noe
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || anchorRef.current?.contains(t)) return;
      shut();
    };
    document.addEventListener('mousedown', onDown, true);
    return () => document.removeEventListener('mousedown', onDown, true);
  }, [open]);   // eslint-disable-line react-hooks/exhaustive-deps

  const color = colorOf(value);
  return (
    <>
      <button
        ref={anchorRef}
        onClick={() => (open ? shut() : setOpen(true))}
        title="Klikk for å endre kategori"
        style={variant === 'chip' ? {
          fontSize: 10, padding: '2px 7px', borderRadius: 10, background: color + '22', color,
          fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap', maxWidth: '100%',
          overflow: 'hidden', textOverflow: 'ellipsis',
          border: confirmed ? `1px solid ${color}55` : `1px dashed ${color}88`,
        } : {
          display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 12, padding: '5px 9px',
          borderRadius: 7, border: '1px solid var(--line)', background: 'var(--card)',
          color: 'var(--fg)', cursor: 'pointer', maxWidth: '100%',
        }}
      >
        {variant === 'field' && <i style={{ width: 9, height: 9, borderRadius: 2, background: color, flexShrink: 0 }} />}
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{labelOf(value)}</span>
        {variant === 'field' && <span style={{ color: 'var(--muted)', fontSize: 10 }}>▾</span>}
      </button>

      {open && pos && createPortal(
        <div
          ref={panelRef}
          style={{
            position: 'fixed', left: pos.left, width: pos.width, zIndex: 4000,
            top: pos.top, ...(pos.up ? { transform: 'translateY(-100%)' } : null),
            background: 'var(--surface)', border: '1px solid var(--line-2)', borderRadius: 9,
            boxShadow: '0 10px 30px rgba(0,0,0,0.32)', padding: 4,
            display: 'flex', flexDirection: 'column', maxHeight: pos.maxH,
          }}
        >
          <input
            ref={inputRef}
            value={q}
            placeholder="Søk kategori…"
            onChange={e => { setQ(e.target.value); setHi(0); }}
            onKeyDown={e => {
              if (e.key === 'ArrowDown')    { e.preventDefault(); setHi(h => Math.min(h + 1, list.length - 1)); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setHi(h => Math.max(h - 1, 0)); }
              else if (e.key === 'Enter')   { e.preventDefault(); if (hiSafe >= 0) pick(list[hiSafe]); }
              else if (e.key === 'Escape')  { e.preventDefault(); shut(); }
            }}
            style={{
              fontSize: 12.5, padding: '6px 8px', margin: '2px 2px 6px', borderRadius: 6,
              border: '1px solid var(--line)', background: 'var(--bg)', color: 'var(--fg)', minWidth: 0,
            }}
          />
          <div style={{ overflowY: 'auto', minHeight: 0 }}>
            {list.map((k, idx) => {
              const c = colorOf(k);
              return (
                <div
                  key={k}
                  onMouseDown={e => { e.preventDefault(); pick(k); }}
                  onMouseEnter={() => setHi(idx)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8, padding: '6px 9px',
                    borderRadius: 6, cursor: 'pointer',
                    background: idx === hiSafe ? 'var(--accent-soft)' : 'transparent',
                  }}
                >
                  <i style={{ width: 9, height: 9, borderRadius: 2, background: c, flexShrink: 0 }} />
                  <span style={{ fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {labelOf(k)}
                  </span>
                  {k === value && <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--muted)' }}>✓</span>}
                </div>
              );
            })}
            {list.length === 0 && (
              <div style={{ padding: '8px 9px', fontSize: 12, color: 'var(--muted)' }}>Ingen kategori matcher «{q.trim()}»</div>
            )}
          </div>
        </div>,
        document.body
      )}
    </>
  );
}

// ─── MerchantCombobox ─────────────────────────────────────────────────────────
// Autocomplete mot butikkregisteret. Dropdownen rendres i en portal (fixed),
// så den aldri klippes av kortets overflow.

export function MerchantCombobox({ initial, placeholder, options, autoFocus, accent, onCommit, onCancel }: {
  initial?: string;
  placeholder?: string;
  options: Merchant[];
  autoFocus?: boolean;
  accent?: boolean;
  onCommit: (name: string, matched?: Merchant) => void;
  onCancel?: () => void;
}) {
  const [text, setText]   = useState(initial ?? '');
  const [open, setOpen]   = useState(false);
  // −1 = ingenting valgt i lista → Enter bruker det du har skrevet. Et treff må
  // velges bevisst (piltast eller klikk) før Enter kan bytte det ut.
  const [hi, setHi]       = useState(-1);
  // Musepeking skal bare markere visuelt, ikke stille om hva Enter gjør
  const [hover, setHover] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  // Sperre mot dobbel commit innenfor ÉN redigeringsrunde (Enter som så trigger
  // blur). Den MÅ nullstilles når brukeren tar boksen i bruk igjen — ellers blir
  // en boks som ikke unmountes ved commit permanent død.
  const doneRef  = useRef(false);
  const blurRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const textRef  = useRef(text);
  textRef.current = text;

  const q = text.trim().toLowerCase();
  const filtered = (q
    ? options
        .map(o => ({ o, r: matchRank(o.name, q) }))
        .filter(x => x.r < 4)
        .sort((a, b) => a.r - b.r || a.o.name.length - b.o.name.length || a.o.name.localeCompare(b.o.name, 'nb'))
        .map(x => x.o)
    : options
  ).slice(0, 8);
  // Hold markøren innenfor lista når filteret krymper, så Enter aldri peker i løse lufta
  const hiSafe = hi >= 0 && hi < filtered.length ? hi : -1;
  // Nøyaktig hva Enter kommer til å gjøre — vises nederst i lista
  const enterPicks = hiSafe >= 0 ? filtered[hiSafe].name : text.trim();

  const cancelBlur = () => {
    if (blurRef.current !== null) { clearTimeout(blurRef.current); blurRef.current = null; }
  };
  // Gjør boksen brukbar igjen: avbryt ventende blur-commit og løft sperren
  const rearm = () => { cancelBlur(); doneRef.current = false; };
  // En ventende blur-commit må aldri fyre etter at komponenten er borte
  useEffect(() => cancelBlur, []);

  const pos = useAnchoredPos(open, inputRef);

  const finish = (name: string | null) => {
    if (doneRef.current) return;
    doneRef.current = true;
    cancelBlur();
    setOpen(false);
    const trimmed = (name ?? '').trim();
    if (trimmed) {
      const matched = options.find(o => o.name.toLowerCase() === trimmed.toLowerCase() || aliasKeyOf(o.name) === aliasKeyOf(trimmed));
      onCommit(trimmed, matched);
    } else {
      onCancel?.();
    }
  };

  // Escape skal ALLTID komme brukeren ut — også når det ikke finnes noen
  // onCancel å kalle. Da lukkes lista og teksten settes tilbake til utgangspunktet.
  const escape = () => {
    cancelBlur();
    doneRef.current = false;
    setOpen(false);
    setText(initial ?? '');
    inputRef.current?.blur();
    onCancel?.();
  };

  return (
    <>
      <input
        ref={inputRef}
        autoFocus={autoFocus}
        value={text}
        placeholder={placeholder}
        onChange={e => { rearm(); setText(e.target.value); setOpen(true); setHi(-1); }}
        onFocus={() => { rearm(); setOpen(true); }}
        onBlur={() => { cancelBlur(); blurRef.current = setTimeout(() => finish(textRef.current), 140); }}
        onKeyDown={e => {
          // Pil ned går inn i lista; pil opp forbi toppen går tilbake til din egen tekst (−1)
          if (e.key === 'ArrowDown')      { e.preventDefault(); rearm(); setOpen(true); setHi(h => Math.min(h + 1, filtered.length - 1)); }
          else if (e.key === 'ArrowUp')   { e.preventDefault(); rearm(); setHi(h => Math.max(h - 1, -1)); }
          // Enter tar KUN et listetreff hvis du bevisst har valgt ett — ellers din egen tekst.
          // (finish() kobler uansett mot en eksisterende butikk ved eksakt navnetreff.)
          else if (e.key === 'Enter')     { e.preventDefault(); cancelBlur(); finish(open && hiSafe >= 0 ? filtered[hiSafe].name : text); }
          else if (e.key === 'Escape')    { e.preventDefault(); escape(); }
        }}
        style={{
          fontSize: 12, padding: '3px 7px', borderRadius: 5, width: '100%', minWidth: 0,
          border: `1px solid ${accent ? 'var(--accent)' : 'var(--line)'}`, background: 'var(--card)',
        }}
      />
      {open && filtered.length > 0 && pos && createPortal(
        <div
          onMouseDown={e => e.preventDefault()}
          style={{
            position: 'fixed', left: pos.left, width: pos.width, zIndex: 4000,
            top: pos.top, ...(pos.up ? { transform: 'translateY(-100%)' } : null),
            maxHeight: pos.maxH, overflowY: 'auto',
            background: 'var(--surface)', border: '1px solid var(--line-2)', borderRadius: 9,
            boxShadow: '0 10px 30px rgba(0,0,0,0.32)', padding: 4,
          }}
        >
          {filtered.map((o, idx) => (
            <div
              key={o.id}
              onMouseDown={e => { e.preventDefault(); rearm(); finish(o.name); }}
              onMouseEnter={() => setHover(idx)}
              onMouseLeave={() => setHover(h => h === idx ? -1 : h)}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
                padding: '7px 9px', borderRadius: 6, cursor: 'pointer',
                // Tastaturvalget markeres tydeligst; musepeking er bare et lett hint
                background: idx === hiSafe ? 'var(--accent-soft)'
                  : idx === hover ? 'var(--bg)' : 'transparent',
                outline: idx === hiSafe ? '1px solid var(--accent)' : 'none', outlineOffset: -1,
              }}
            >
              <span style={{ fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.name}</span>
              <CatTag cat={o.category} confirmed />
            </div>
          ))}
          {/* Gjør det utvetydig hva Enter gjør akkurat nå */}
          {enterPicks && (
            <div style={{
              borderTop: '1px solid var(--line)', marginTop: 4, paddingTop: 6, padding: '6px 9px 2px',
              fontSize: 11, color: 'var(--muted)', display: 'flex', alignItems: 'baseline', gap: 6,
            }}>
              <kbd style={{
                fontFamily: 'var(--font-mono)', fontSize: 10, border: '1px solid var(--line-2)',
                borderRadius: 3, padding: '0 4px', color: 'var(--ink)',
              }}>Enter</kbd>
              {hiSafe >= 0
                ? <span>velger <strong style={{ color: 'var(--ink)' }}>{filtered[hiSafe].name}</strong></span>
                : <span>bruker <strong style={{ color: 'var(--ink)' }}>«{enterPicks}»</strong> · ↓ for å velge fra lista</span>}
            </div>
          )}
        </div>,
        document.body
      )}
    </>
  );
}
