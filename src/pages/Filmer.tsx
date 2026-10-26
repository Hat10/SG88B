import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useScrollLock } from '../lib/useScrollLock';
import { useAuth } from '../contexts/AuthContext';
import { trainerFromEmail } from '../contexts/TreningContext';
import { useMovies } from '../contexts/MovieContext';
import { useSnackbar } from '../contexts/SnackbarContext';
import { Fab, Tabs, Tag, SkeletonList } from '../components';
import { burst } from '../confetti';
import {
  WHO_NAME, applyFilters, avgRating, eligibleForTonight, findDuplicate, isWatched, missingRatings,
  nextRating, normalizeTitle, pickRandom, sortMovies,
  type KindFilter, type Movie, type MovieKind, type MovieSort, type MovieTab, type MovieWho,
  type MustFilter, type Presence,
} from '../lib/movies';

// ─── helpers ───────────────────────────────────────────────────────────────

const KIND_LABEL: Record<MovieKind, string> = { film: 'Film', serie: 'Serie' };
const WHOS: MovieWho[] = ['M', 'L'];

const MUST_FILTERS: { id: MustFilter; label: string }[] = [
  { id: 'all', label: 'Alle' },
  { id: 'both', label: 'Begge obligatoriske' },
  { id: 'onlyM', label: 'Kun Andreas obligatorisk' },
  { id: 'onlyL', label: 'Kun Taran obligatorisk' },
  { id: 'none', label: 'Ingen obligatoriske' },
];

const SORTS: Record<MovieTab, { id: MovieSort; label: string }[]> = {
  want: [{ id: 'added', label: 'Nylig lagt til' }, { id: 'alpha', label: 'Alfabetisk' }],
  seen: [
    { id: 'seen', label: 'Nylig sett' }, { id: 'rating', label: 'Høyest rating' },
    { id: 'added', label: 'Nylig lagt til' }, { id: 'alpha', label: 'Alfabetisk' },
  ],
};

const pad = (n: number) => String(n).padStart(2, '0');
const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
// 'YYYY-MM-DD' tolkes lokalt (ikke som UTC) så datoen ikke skifter en dag.
const fmtDate = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('nb-NO', { day: 'numeric', month: 'short', year: 'numeric' });
};
const fmtAvg = (n: number) => n.toLocaleString('nb-NO', { minimumFractionDigits: 0, maximumFractionDigits: 1 });

function useIsMobile() {
  const [m, setM] = useState(() => window.innerWidth < 768);
  useEffect(() => {
    const f = () => setM(window.innerWidth < 768);
    window.addEventListener('resize', f);
    return () => window.removeEventListener('resize', f);
  }, []);
  return m;
}

// ─── small controls ────────────────────────────────────────────────────────

function MustChip({ who, on, onClick }: { who: MovieWho; on: boolean; onClick: () => void }) {
  const name = WHO_NAME[who];
  return (
    <button type="button" className={'mv-must' + (on ? ' on' : '')} onClick={onClick}
      aria-pressed={on} aria-label={`${name} må være med: ${on ? 'på' : 'av'}`}>
      <b>{name}</b>
      <span>{on ? 'Må være med' : 'Trenger ikke'}</span>
    </button>
  );
}

function Stars({ who, value, onChange }: { who: MovieWho; value: number | null; onChange: (v: number | null) => void }) {
  const name = WHO_NAME[who];
  return (
    <div className="mv-stars" role="group" aria-label={`Rating fra ${name}`}>
      {[1, 2, 3, 4, 5].map(n => (
        <button key={n} type="button" className={'mv-star' + (value != null && n <= value ? ' on' : '')}
          aria-pressed={value === n}
          aria-label={value === n ? `${name}: ${n} av 5 stjerner, trykk for å fjerne` : `${name}: ${n} av 5 stjerner`}
          onClick={() => onChange(nextRating(value, n))}>★</button>
      ))}
    </div>
  );
}

function Sheet({ eyebrow, title, onClose, children }: {
  eyebrow: string; title: string; onClose: () => void; children: React.ReactNode;
}) {
  useScrollLock();
  const isMobile = useIsMobile();
  return createPortal((
    <div role="dialog" aria-modal="true" aria-label={title} style={{
      position: 'fixed', inset: 0, zIndex: 400, display: 'flex',
      alignItems: isMobile ? 'flex-end' : 'center', justifyContent: 'center', padding: isMobile ? 0 : 20,
    }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(11,37,69,0.45)', animation: 'confirm-fade 0.18s ease both' }} />
      <div style={{
        position: 'relative', background: 'var(--surface)', width: '100%', maxWidth: isMobile ? '100%' : 460,
        borderRadius: isMobile ? '16px 16px 0 0' : 12, maxHeight: isMobile ? '92dvh' : '86dvh',
        overflow: 'hidden', display: 'flex', flexDirection: 'column', boxShadow: '0 8px 40px rgba(11,37,69,0.22)',
        animation: `${isMobile ? 'quick-sheet-up' : 'confirm-pop'} 0.22s cubic-bezier(0.18,0.9,0.32,1.1) both`,
      }}>
        <div style={{ flexShrink: 0, borderBottom: '1px solid var(--line)' }}>
          {isMobile && (
            <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 10 }}>
              <div style={{ width: 36, height: 4, borderRadius: 2, background: 'var(--line-2)' }} />
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 20px' }}>
            <div style={{ minWidth: 0 }}>
              <div className="card-eyebrow">{eyebrow}</div>
              <h3 className="card-title" style={{ marginTop: 2, overflowWrap: 'anywhere' }}>{title}</h3>
            </div>
            <button onClick={onClose} aria-label="Lukk" style={{ background: 'transparent', border: '1px solid var(--line)', borderRadius: 6, minWidth: 44, minHeight: 44, display: 'grid', placeItems: 'center', fontSize: 18, color: 'var(--ink-3)', flexShrink: 0 }}>×</button>
          </div>
        </div>
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '16px 20px', paddingBottom: 'calc(20px + env(safe-area-inset-bottom, 0px))', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {children}
        </div>
      </div>
    </div>
  ), document.body);
}

const Label = ({ children, hint }: { children: React.ReactNode; hint?: string }) => (
  <div className="card-eyebrow" style={{ marginBottom: 6 }}>{children}{hint && <span style={{ opacity: 0.5 }}> ({hint})</span>}</div>
);

function KindPicker({ value, onChange }: { value: MovieKind; onChange: (k: MovieKind) => void }) {
  return (
    <div className="mv-chips">
      {(['film', 'serie'] as MovieKind[]).map(k => (
        <button key={k} type="button" className={'mv-chip' + (value === k ? ' on' : '')} aria-pressed={value === k}
          style={{ minHeight: 44, flex: 1, justifyContent: 'center' }} onClick={() => onChange(k)}>{KIND_LABEL[k]}</button>
      ))}
    </div>
  );
}

/** Stopp-varsel: tittelen finnes allerede (unik indeks), ingen «legg til likevel». */
function DuplicateStop({ dup, onGo }: { dup: Movie | null; onGo?: (m: Movie) => void }) {
  return (
    <div className="mv-stop" role="alert">
      <div>
        {dup
          ? <>«{dup.title}» finnes allerede i <b>{isWatched(dup) ? 'Sett' : 'Vil se'}</b>.</>
          : <>Tittelen finnes allerede (noen la den inn akkurat nå).</>}
      </div>
      {dup && onGo && <button type="button" className="btn" style={{ minHeight: 44, justifyContent: 'center' }} onClick={() => onGo(dup)}>Gå til tittelen</button>}
    </div>
  );
}

// ─── sheets ────────────────────────────────────────────────────────────────

function AddSheet({ onClose, onGo }: { onClose: () => void; onGo: (m: Movie) => void }) {
  const { movies, add } = useMovies();
  const { session } = useAuth();
  const { notify } = useSnackbar();
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<MovieKind>('film');
  const [must, setMust] = useState<Record<MovieWho, boolean>>({ M: false, L: false });
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [serverDup, setServerDup] = useState(false);

  const clean = normalizeTitle(title);
  const dup = useMemo(() => findDuplicate(movies, clean, kind), [movies, clean, kind]);
  useEffect(() => { setServerDup(false); }, [clean, kind]);
  const blocked = !!dup || serverDup;

  const submit = async () => {
    if (!clean || blocked || saving) return;
    setSaving(true);
    const r = await add({
      title: clean, kind, mustM: must.M, mustL: must.L,
      note: note.trim() || null, addedBy: trainerFromEmail(session?.user?.email),
    });
    setSaving(false);
    if (r.status === 'ok') { notify(`«${clean}» lagt til`); onClose(); }
    else if (r.status === 'duplicate') setServerDup(true);
  };

  return (
    <Sheet eyebrow="Filmoversikt" title="Ny tittel" onClose={onClose}>
      <div>
        <Label>Tittel</Label>
        <input className="input" autoFocus value={title} placeholder="🎬 Hva vil dere se?"
          onChange={e => setTitle(e.target.value)} onKeyDown={e => e.key === 'Enter' && void submit()}
          style={{ minHeight: 44 }} />
      </div>
      {blocked && <DuplicateStop dup={dup} onGo={m => { onClose(); onGo(m); }} />}
      <div><Label>Type</Label><KindPicker value={kind} onChange={setKind} /></div>
      <div>
        <Label>Hvem må være med?</Label>
        <div style={{ display: 'flex', gap: 8 }}>
          {WHOS.map(w => <MustChip key={w} who={w} on={must[w]} onClick={() => setMust(p => ({ ...p, [w]: !p[w] }))} />)}
        </div>
      </div>
      <div>
        <Label hint="valgfritt">Notat</Label>
        <textarea className="input" rows={2} value={note} onChange={e => setNote(e.target.value)} style={{ resize: 'vertical' }} />
      </div>
      <button className="btn primary" disabled={!clean || blocked || saving} onClick={() => void submit()}
        style={{ minHeight: 44, justifyContent: 'center', opacity: !clean || blocked ? 0.4 : 1 }}>
        {saving ? 'Lagrer…' : 'Legg til'}
      </button>
    </Sheet>
  );
}

function EditSheet({ movie, onClose, onGo }: { movie: Movie; onClose: () => void; onGo: (m: Movie) => void }) {
  const { movies, update, remove } = useMovies();
  const [title, setTitle] = useState(movie.title);
  const [kind, setKind] = useState<MovieKind>(movie.kind);
  const [note, setNote] = useState(movie.note ?? '');
  const [saving, setSaving] = useState(false);

  const clean = normalizeTitle(title);
  const dup = useMemo(() => findDuplicate(movies, clean, kind, movie.id), [movies, clean, kind, movie.id]);

  const save = async () => {
    if (!clean || dup || saving) return;
    setSaving(true);
    const ok = await update(movie.id, { title: clean, kind, note: note.trim() || null });
    setSaving(false);
    if (ok) onClose();
  };

  return (
    <Sheet eyebrow="Rediger" title={movie.title} onClose={onClose}>
      <div><Label>Tittel</Label><input className="input" value={title} onChange={e => setTitle(e.target.value)} style={{ minHeight: 44 }} /></div>
      {dup && <DuplicateStop dup={dup} onGo={m => { onClose(); onGo(m); }} />}
      <div><Label>Type</Label><KindPicker value={kind} onChange={setKind} /></div>
      <div><Label hint="valgfritt">Notat</Label><textarea className="input" rows={3} value={note} onChange={e => setNote(e.target.value)} style={{ resize: 'vertical' }} /></div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn danger" style={{ minHeight: 44, justifyContent: 'center' }}
          onClick={() => { remove(movie); onClose(); }}>Slett</button>
        <button className="btn primary" disabled={!clean || !!dup || saving} onClick={() => void save()}
          style={{ flex: 1, minHeight: 44, justifyContent: 'center', opacity: !clean || dup ? 0.4 : 1 }}>
          {saving ? 'Lagrer…' : 'Lagre'}
        </button>
      </div>
    </Sheet>
  );
}

function WatchedSheet({ movie, onClose }: { movie: Movie; onClose: () => void }) {
  const { markWatched, setRating } = useMovies();
  const [date, setDate] = useState(todayIso());
  const [r, setR] = useState<Record<MovieWho, number | null>>({ M: movie.ratingM, L: movie.ratingL });

  const save = () => {
    markWatched(movie.id, date || todayIso());
    if (r.M !== movie.ratingM) setRating(movie.id, 'M', r.M);
    if (r.L !== movie.ratingL) setRating(movie.id, 'L', r.L);
    onClose();
  };

  return (
    <Sheet eyebrow="Merk som sett" title={movie.title} onClose={onClose}>
      <div>
        <Label>Dato</Label>
        <input className="input" type="date" value={date} max={todayIso()} onChange={e => setDate(e.target.value)} style={{ minHeight: 44 }} />
      </div>
      <div>
        <Label hint="valgfritt, kan også gjøres senere">Rating</Label>
        {WHOS.map(w => (
          <div key={w} className="mv-rate">
            <span className="who">{WHO_NAME[w]}</span>
            <Stars who={w} value={r[w]} onChange={v => setR(p => ({ ...p, [w]: v }))} />
          </div>
        ))}
      </div>
      <button className="btn primary" style={{ minHeight: 44, justifyContent: 'center' }} onClick={save}>Lagre som sett</button>
    </Sheet>
  );
}

function TonightSheet({ onClose, onWatched }: { onClose: () => void; onWatched: (m: Movie) => void }) {
  const { movies } = useMovies();
  const [presence, setPresence] = useState<Presence>('both');
  const [kind, setKind] = useState<KindFilter>('all');
  const [started, setStarted] = useState(false);
  const [pick, setPick] = useState<Movie | null>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  const pool = useMemo(() => eligibleForTonight(movies, presence, kind), [movies, presence, kind]);
  // Holder trekket oppdatert ved realtime-endringer (f.eks. markert sett fra den andre telefonen).
  const current = pick ? movies.find(m => m.id === pick.id && !isWatched(m)) ?? null : null;

  const draw = () => {
    setStarted(true);
    setPick(pickRandom(pool, Math.random, pick?.id));
    requestAnimationFrame(() => {
      const r = resultRef.current?.getBoundingClientRect();
      if (r) burst(r.left + r.width / 2, r.top + 24);
    });
  };

  const showResult = started && current;
  const empty = started && !current;
  const seg = <T extends string>(items: { id: T; label: string }[], value: T, set: (v: T) => void) => (
    <div className="mv-chips">
      {items.map(i => (
        <button key={i.id} type="button" className={'mv-chip' + (value === i.id ? ' on' : '')} aria-pressed={value === i.id}
          style={{ minHeight: 44, flex: 1, justifyContent: 'center' }} onClick={() => { set(i.id); setStarted(false); setPick(null); }}>{i.label}</button>
      ))}
    </div>
  );

  return (
    <Sheet eyebrow="Filmkveld" title="Hva skal vi se i kveld?" onClose={onClose}>
      <div><Label>Hvem ser?</Label>
        {seg<Presence>([{ id: 'both', label: 'Begge' }, { id: 'M', label: 'Bare Andreas' }, { id: 'L', label: 'Bare Taran' }], presence, setPresence)}
      </div>
      <div><Label>Type</Label>
        {seg<KindFilter>([{ id: 'all', label: 'Alle' }, { id: 'film', label: 'Film' }, { id: 'serie', label: 'Serie' }], kind, setKind)}
      </div>
      {!started && (
        <button className="btn primary" style={{ minHeight: 44, justifyContent: 'center' }} onClick={draw}>
          🎲 Trekk en tittel ({pool.length} å velge mellom)
        </button>
      )}
      {empty && (
        <div className="mv-meta" style={{ textAlign: 'center', padding: '12px 0', fontSize: 12 }}>
          Ingen titler i «Vil se» passer. Titler der en fraværende person må være med, er utelukket.
        </div>
      )}
      {showResult && (
        <div ref={resultRef} className="mv-row" style={{ alignItems: 'center', textAlign: 'center', borderColor: 'var(--accent)' }}>
          <Tag kind="outline">{KIND_LABEL[current.kind]}</Tag>
          <div style={{ fontSize: 22, fontWeight: 500, overflowWrap: 'anywhere' }}>{current.title}</div>
          <div className="mv-meta">
            {current.mustM && current.mustL ? 'Begge må være med' : current.mustM ? 'Andreas må være med' : current.mustL ? 'Taran må være med' : 'Ingen må være med'}
          </div>
          {current.note && <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>{current.note}</div>}
        </div>
      )}
      {started && (
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn" style={{ flex: 1, minHeight: 44, justifyContent: 'center' }} onClick={draw} disabled={!pool.length}>Trekk på nytt</button>
          {showResult && (
            <button className="btn primary" style={{ flex: 1, minHeight: 44, justifyContent: 'center' }}
              onClick={() => { onClose(); onWatched(current); }}>Merk som sett</button>
          )}
        </div>
      )}
    </Sheet>
  );
}

// ─── row ───────────────────────────────────────────────────────────────────

function MovieRow({ movie, highlight, onEdit, onWatched }: {
  movie: Movie; highlight: boolean; onEdit: () => void; onWatched: () => void;
}) {
  const { toggleMust, setRating, unwatch } = useMovies();
  const watched = isWatched(movie);
  const avg = avgRating(movie);
  const missing = missingRatings(movie);
  return (
    <div id={'mv-' + movie.id} className={'mv-row' + (highlight ? ' flash' : '')}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div className="mv-title">{movie.title}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <Tag kind="outline">{KIND_LABEL[movie.kind]}</Tag>
            {watched && <span className="mv-meta">Sett {fmtDate(movie.watchedAt!)}</span>}
          </div>
          {movie.note && <div style={{ fontSize: 12, color: 'var(--ink-3)', overflowWrap: 'anywhere' }}>{movie.note}</div>}
        </div>
        <button onClick={onEdit} aria-label={`Rediger ${movie.title}`}
          style={{ background: 'transparent', border: '1px solid var(--line)', borderRadius: 6, minWidth: 44, minHeight: 44, fontSize: 16, color: 'var(--ink-3)', flexShrink: 0 }}>✎</button>
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        {WHOS.map(w => <MustChip key={w} who={w} on={w === 'M' ? movie.mustM : movie.mustL} onClick={() => toggleMust(movie.id, w)} />)}
      </div>

      {watched && (
        <div>
          {WHOS.map(w => (
            <div key={w} className="mv-rate">
              <span className="who">{WHO_NAME[w]}</span>
              <Stars who={w} value={w === 'M' ? movie.ratingM : movie.ratingL} onChange={v => setRating(movie.id, w, v)} />
            </div>
          ))}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 4 }}>
            {avg != null && <span style={{ fontSize: 13, fontWeight: 600 }} aria-label={`Snitt ${fmtAvg(avg)} av 5`}>★ {fmtAvg(avg)} snitt</span>}
            {missing.map(w => <span key={w} className="mv-badge">Mangler rating fra {WHO_NAME[w]}</span>)}
          </div>
        </div>
      )}

      {watched
        ? <button className="btn ghost" style={{ minHeight: 44, justifyContent: 'center' }} onClick={() => unwatch(movie.id)}>↩ Angre sett</button>
        : <button className="btn" style={{ minHeight: 44, justifyContent: 'center' }} onClick={onWatched}>✓ Merk som sett</button>}
    </div>
  );
}

// ─── page ──────────────────────────────────────────────────────────────────

export default function Filmer() {
  const { movies, loading } = useMovies();
  const isMobile = useIsMobile();
  const [tab, setTab] = useState<MovieTab>('want');
  const [must, setMust] = useState<MustFilter>('all');
  const [kind, setKind] = useState<KindFilter>('all');
  const [query, setQuery] = useState('');
  const [sorts, setSorts] = useState<Record<MovieTab, MovieSort>>({ want: 'added', seen: 'seen' });
  const [sheet, setSheet] = useState<
    | { type: 'add' } | { type: 'tonight' }
    | { type: 'edit'; id: string } | { type: 'watched'; id: string } | null
  >(null);
  const [highlight, setHighlight] = useState<string | null>(null);

  const counts = useMemo(() => {
    const seen = movies.filter(isWatched).length;
    return { want: movies.length - seen, seen };
  }, [movies]);

  const visible = useMemo(
    () => sortMovies(applyFilters(movies, { tab, must, kind, query }), sorts[tab]),
    [movies, tab, must, kind, query, sorts],
  );

  // «Gå til tittelen» fra duplikatvarselet: bytt til riktig fane, nullstill filtre og marker raden.
  const goTo = (m: Movie) => {
    setTab(isWatched(m) ? 'seen' : 'want');
    setMust('all'); setKind('all'); setQuery('');
    setHighlight(m.id);
  };
  useEffect(() => {
    if (!highlight) return;
    const t = setTimeout(() => document.getElementById('mv-' + highlight)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 60);
    const clear = setTimeout(() => setHighlight(null), 2200);
    return () => { clearTimeout(t); clearTimeout(clear); };
  }, [highlight]);

  const sheetMovie = (id: string) => movies.find(m => m.id === id) ?? null;
  const editMovie = sheet?.type === 'edit' ? sheetMovie(sheet.id) : null;
  const watchedMovie = sheet?.type === 'watched' ? sheetMovie(sheet.id) : null;
  const close = () => setSheet(null);
  const filtering = must !== 'all' || kind !== 'all' || query.trim() !== '';

  return (
    <>
      <div className="mv-toolbar">
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <Tabs value={tab} onChange={id => setTab(id as MovieTab)}
            items={[{ id: 'want', label: 'Vil se', count: counts.want }, { id: 'seen', label: 'Sett', count: counts.seen }]} />
          <button className="btn" style={{ minHeight: 44, marginLeft: 'auto' }} onClick={() => setSheet({ type: 'tonight' })}>🎲 Hva skal vi se i kveld?</button>
          {!isMobile && <button className="btn primary" style={{ minHeight: 44 }} onClick={() => setSheet({ type: 'add' })}>+ Legg til</button>}
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <input className="input" type="search" placeholder="Søk i tittel…" aria-label="Søk i tittel" value={query}
            onChange={e => setQuery(e.target.value)} style={{ flex: 1, minHeight: 44 }} />
          <select className="input" aria-label="Sortering" value={sorts[tab]} style={{ width: 'auto', minHeight: 44 }}
            onChange={e => setSorts(p => ({ ...p, [tab]: e.target.value as MovieSort }))}>
            {SORTS[tab].map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </div>

        <div className="mv-chips" role="group" aria-label="Obligatorisk-filter">
          {MUST_FILTERS.map(f => (
            <button key={f.id} className={'mv-chip' + (must === f.id ? ' on' : '')} aria-pressed={must === f.id} onClick={() => setMust(f.id)}>{f.label}</button>
          ))}
        </div>
        <div className="mv-chips" role="group" aria-label="Type-filter">
          {([['all', 'Alle typer'], ['film', 'Film'], ['serie', 'Serie']] as [KindFilter, string][]).map(([id, label]) => (
            <button key={id} className={'mv-chip' + (kind === id ? ' on' : '')} aria-pressed={kind === id} onClick={() => setKind(id)}>{label}</button>
          ))}
        </div>
      </div>

      {loading && <SkeletonList rows={6} />}

      {!loading && visible.length === 0 && (
        <div style={{ padding: '40px 16px', textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--ink-4)', lineHeight: 1.6 }}>
          {filtering
            ? 'Ingen titler matcher filteret.'
            : tab === 'want'
              ? <>Ingen titler i «Vil se» ennå.<br />Legg til filmer og serier dere vil se, og marker hvem som må være med.</>
              : <>Ingenting er sett ennå.<br />Trykk «Merk som sett» på en tittel i «Vil se», så dukker den opp her med rating fra dere begge.</>}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 320px), 1fr))', gap: 12 }}>
        {visible.map(m => (
          <MovieRow key={m.id} movie={m} highlight={m.id === highlight}
            onEdit={() => setSheet({ type: 'edit', id: m.id })}
            onWatched={() => setSheet({ type: 'watched', id: m.id })} />
        ))}
      </div>

      {isMobile && !sheet && <Fab onClick={() => setSheet({ type: 'add' })} label="Legg til tittel" />}

      {sheet?.type === 'add' && <AddSheet onClose={close} onGo={goTo} />}
      {sheet?.type === 'tonight' && <TonightSheet onClose={close} onWatched={m => setSheet({ type: 'watched', id: m.id })} />}
      {editMovie && <EditSheet key={editMovie.id} movie={editMovie} onClose={close} onGo={goTo} />}
      {watchedMovie && <WatchedSheet key={watchedMovie.id} movie={watchedMovie} onClose={close} />}
    </>
  );
}
