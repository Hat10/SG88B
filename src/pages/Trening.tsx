import { useState, useEffect, useMemo, createContext, useContext } from 'react';
import { createPortal } from 'react-dom';
import { useScrollLock } from '../lib/useScrollLock';
import {
  useTrening, catColor, trainerFromEmail,
  type WorkoutCategory, type WorkoutSession, type WorkoutRecord, type WorkoutGoal,
  type Trainer, type RecordUnit, type GoalKind,
} from '../contexts/TreningContext';
import { useAuth } from '../contexts/AuthContext';
import { useSnackbar } from '../contexts/SnackbarContext';
import { useConfirm } from '../contexts/ConfirmContext';
import { Fab, SkeletonList } from '../components';
import { TopbarPortal } from '../lib/topbarSlot';
import type { Who } from '../data';
import {
  WHO_LABEL, TRAINERS, dayKey, fmtNum, startOfWeek,
  weekStreak, bestWeekStreak, computePulse,
  goalStatus, goalKindInfo, fmtDeadline, GOAL_KINDS, STREAK_MIN_SESSIONS,
} from '../lib/treningPulse';
import { fireworkRain } from '../confetti';

// ─── Farge per kategori ──────────────────────────────────────────────────────
//
// De seks standardkategoriene har tema-bevisste CSS-variabler (catColor). Egne
// kategorier har en lagret hex-farge. Slik at ingen av de mange visningsstedene
// må vite hvilket, legger vi oppslaget i en context: CatTag/CatDot spør bare
// «hvilken farge har dette navnet», og PageTrening fyller den ut fra basen.

type ColorFor = (name: string) => string;
const CatColorCtx = createContext<ColorFor>(catColor);
const useCatColor = () => useContext(CatColorCtx);

const WHO_COLOR: Record<Who, string> = { f: 'var(--good)', M: 'var(--accent)', L: 'var(--ink)' };

// Fargepalett for egendefinerte kategorier — valgt for å være lesbare i både lyst
// og mørkt tema. De seks første er standardfargenes lyse-tema-verdier.
const CAT_PALETTE = [
  '#2F6FB5', '#B54B84', '#1F8B65', '#7150C0', '#9C6B14', '#BC4E34',
  '#0E7C86', '#C7562B', '#5B6BD6', '#3F8F3F', '#B23B6E', '#6C7A8C',
];

/**
 * Kategorien som fargekodet merkelapp. Den står overalt en kategori nevnes, så
 * fargen kjennes igjen uten å leses.
 */
function CatTag({ category, dark = false, lg = false }: { category: string; dark?: boolean; lg?: boolean }) {
  const colorFor = useCatColor();
  if (!category) return null;
  return (
    <span className={'tr-cat' + (dark ? ' on-dark' : '') + (lg ? ' lg' : '')}
      style={{ '--cat': colorFor(category) } as React.CSSProperties}>
      <span className="tr-catdot" />{category}
    </span>
  );
}

/** Bare prikken — til lister der en full merkelapp ville tatt for mye plass. */
const CatDot = ({ category }: { category: string }) => {
  const colorFor = useCatColor();
  return <span className="tr-catdot" style={{ '--cat': colorFor(category) } as React.CSSProperties} title={category} />;
};

const WHO_INITIAL: Record<'M' | 'L', string> = { M: 'A', L: 'T' }; // Andreas, Taran

/** Avatar for en loggrad — «A» eller «T». */
function WhoAvatar({ who, size = 24 }: { who: Trainer; size?: number }) {
  const style = { width: size, height: size, fontSize: size * 0.38 };
  return <div className={`avatar avatar-${who.toLowerCase()}`} style={style}>{WHO_INITIAL[who]}</div>;
}

function fmtDay(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const diff = Math.round((new Date(dayKey(today)).getTime() - new Date(dayKey(d)).getTime()) / 86400000);
  if (diff === 0) return 'i dag';
  if (diff === 1) return 'i går';
  if (diff < 7) return d.toLocaleDateString('nb-NO', { weekday: 'long' });
  return d.toLocaleDateString('nb-NO', { weekday: 'short', day: 'numeric', month: 'short' });
}

/** «sist i går» / «sist for 12 dager siden» / «aldri». */
function fmtSince(ts: number | undefined): string {
  if (!ts) return 'aldri';
  const days = Math.round((new Date(dayKey(new Date())).getTime() - new Date(dayKey(new Date(ts))).getTime()) / 86400000);
  return days === 0 ? 'sist i dag' : days === 1 ? 'sist i går' : `sist for ${days} dager siden`;
}

// ─── Aggregat per kategori ──────────────────────────────────────────────────

interface CatAgg {
  total: number; year: number; month: number;
  /** Antall og sist gjort per person. */
  count: Record<Trainer, number>;
  lastBy: Record<Trainer, number | undefined>;
  last: number | undefined;
}
const emptyAgg = (): CatAgg => ({
  total: 0, year: 0, month: 0,
  count: { M: 0, L: 0 }, lastBy: { M: undefined, L: undefined }, last: undefined,
});

/** Antall og «sist gjort» per kategori — totalt, i år, denne måneden, og per person. */
function aggregateByCategory(sessions: WorkoutSession[]): Map<string, CatAgg> {
  const now = new Date(), y = now.getFullYear(), mo = now.getMonth();
  const map = new Map<string, CatAgg>();
  for (const s of sessions) {
    if (!s.completedAt) continue;
    const a = map.get(s.category) ?? emptyAgg();
    const d = new Date(s.startedAt), t = d.getTime();
    a.total += 1;
    if (d.getFullYear() === y) { a.year += 1; if (d.getMonth() === mo) a.month += 1; }
    a.count[s.who] += 1;
    if (a.lastBy[s.who] === undefined || t > a.lastBy[s.who]!) a.lastBy[s.who] = t;
    if (a.last === undefined || t > a.last) a.last = t;
    map.set(s.category, a);
  }
  return map;
}

// ─── Mobil ───────────────────────────────────────────────────────────────────

/** < 768px = mobil. Siden brukes hovedsakelig på gymmen, så mobil er hovedcaset. */
function useIsMobile() {
  const [m, setM] = useState(() => window.innerWidth < 768);
  useEffect(() => {
    const u = () => setM(window.innerWidth < 768);
    window.addEventListener('resize', u);
    return () => window.removeEventListener('resize', u);
  }, []);
  return m;
}

// ─── Modal-skall ─────────────────────────────────────────────────────────────
//
// Bunn-ark på mobil (glir opp fra bunnen, med dra-håndtak), sentrert kort på PC —
// samme mønster som QuickSheet i QuickAdd.tsx, så registrering kjennes hjemlig på
// telefonen der siden faktisk brukes.

function Modal({ eyebrow, title, onClose, children, footer, width = 520 }: {
  eyebrow?: string; title: React.ReactNode; onClose: () => void;
  children: React.ReactNode; footer?: React.ReactNode; width?: number;
}) {
  useScrollLock();
  const isMobile = useIsMobile();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal((
    <div style={{
      position: 'fixed', inset: 0, zIndex: 302, display: 'flex',
      alignItems: isMobile ? 'flex-end' : 'center', justifyContent: 'center',
      padding: isMobile ? 0 : 16,
    }}>
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(11,37,69,0.45)', animation: 'confirm-fade 0.18s ease both' }} onClick={onClose} />
      <div style={{
        position: 'relative', background: 'var(--surface)',
        borderRadius: isMobile ? '16px 16px 0 0' : 12,
        width: '100%', maxWidth: isMobile ? '100%' : width,
        boxShadow: '0 8px 40px rgba(11,37,69,0.18)',
        display: 'flex', flexDirection: 'column',
        maxHeight: isMobile ? '92dvh' : '88dvh', overflow: 'hidden',
        animation: `${isMobile ? 'quick-sheet-up' : 'confirm-pop'} 0.22s cubic-bezier(0.18,0.9,0.32,1.1) both`,
      }}>
        {isMobile && (
          <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 10 }}>
            <div style={{ width: 36, height: 4, borderRadius: 2, background: 'var(--line-2)' }} />
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, padding: '14px 20px 12px', borderBottom: '1px solid var(--line)', flexShrink: 0 }}>
          <div>
            {eyebrow && <div className="card-eyebrow">{eyebrow}</div>}
            <h3 style={{ margin: '2px 0 0', fontSize: 19, fontWeight: 500, letterSpacing: '-0.015em' }}>{title}</h3>
          </div>
          <button onClick={onClose} aria-label="Lukk" style={{ background: 'transparent', border: '1px solid var(--line)', borderRadius: 6, minWidth: 36, minHeight: 36, display: 'grid', placeItems: 'center', cursor: 'pointer', fontSize: 16, color: 'var(--ink-3)', flexShrink: 0 }}>×</button>
        </div>
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          {children}
        </div>
        {footer && (
          <div style={{ padding: '12px 20px', paddingBottom: 'calc(16px + env(safe-area-inset-bottom, 0px))', borderTop: '1px solid var(--line)', flexShrink: 0 }}>
            {footer}
          </div>
        )}
      </div>
    </div>
  ), document.body);
}

// ─── Når + hvem — delt av «Registrer» og «Rediger» ──────────────────────────

const toDateInput = (iso: string) => dayKey(new Date(iso));

/** Tolker dato fra <input>-feltet: gyldig, og ikke fram i tid. */
function readWhen(date: string) {
  const at = new Date(`${date}T00:00`);
  const ok = !isNaN(at.getTime());
  const future = ok && at.getTime() > Date.now() + 60000;
  const valid = ok && !future;
  const error = !ok ? 'Ugyldig dato' : future ? 'Datoen ligger fram i tid' : null;
  return { at, valid, error };
}

const WHO_LOG_COLOR: Record<Trainer, string> = { M: 'var(--accent)', L: 'var(--ink)' };
const WHO_LOG_LABEL: Record<Trainer, string> = { M: 'Andreas', L: 'Taran' };

/**
 * M / L som store, fargekodede knapper. Store trykkflater gjør at det
 * viktigste valget ved en registrering går kjapt med tommelen på mobil.
 */
function WhoPicker({ who, setWho }: { who: Trainer; setWho: (w: Trainer) => void }) {
  return (
    <div className="row" style={{ gap: 8 }}>
      {(['M', 'L'] as Trainer[]).map(w => {
        const on = who === w;
        const col = WHO_LOG_COLOR[w];
        return (
          <button key={w} onClick={() => setWho(w)} aria-pressed={on} style={{
            flex: 1, padding: '12px 6px', borderRadius: 10, cursor: 'pointer',
            fontSize: 13, fontWeight: 600, fontFamily: 'var(--font-sans)',
            border: `1.5px solid ${on ? col : 'var(--line-2)'}`,
            background: on ? `color-mix(in oklab, ${col} 15%, transparent)` : 'transparent',
            color: on ? col : 'var(--ink-3)',
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 7,
          }}>
            <WhoAvatar who={w} size={26} />
            {WHO_LOG_LABEL[w]}
          </button>
        );
      })}
    </div>
  );
}

/** Dato med «I dag» / «I går»-snarveier. */
function WhenFields({ date, setDate, error }: {
  date: string; setDate: (s: string) => void; error: string | null;
}) {
  const today = dayKey(new Date());
  const yesterday = dayKey(new Date(Date.now() - 86400000));
  return (
    <div className="col" style={{ gap: 8 }}>
      <label className="card-eyebrow">Når ble den gjennomført?</label>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        <button className={'tr-chip' + (date === today ? ' on' : '')} onClick={() => setDate(today)}>I dag</button>
        <button className={'tr-chip' + (date === yesterday ? ' on' : '')} onClick={() => setDate(yesterday)}>I går</button>
      </div>
      <div className="col" style={{ gap: 6 }}>
        <label className="card-eyebrow" htmlFor="tr-when-date">Dato</label>
        <input id="tr-when-date" className="input" type="date" value={date} max={today} onChange={e => setDate(e.target.value)} />
      </div>
      {error && <div className="card-meta" style={{ color: 'var(--danger)' }}>{error}</div>}
    </div>
  );
}

// ─── Belønning: Tarans ukentlige styrkemål ──────────────────────────────────
//
// Ikke koblet til workout_goals — ingen eksisterende GoalKind kan uttrykke «N
// økter i akkurat denne uka» med en terskel vi styrer selv (weekly_streak sin
// uke-terskel er STREAK_MIN_SESSIONS, en global konstant delt av hele appen,
// ikke noe et enkeltmål kan sette). Egen, lettvekts konstant og telling holdt
// utenfor mål-motoren i stedet.

const TARAN_STRENGTH_GOAL_PER_WEEK = 2;

// Kategoriene har ingen «styrke»-tagging lenger (fjernet sammen med
// muskelgruppe-funksjonaliteten). Denne må derfor oppdateres manuelt her
// dersom flere styrke-kategorier kommer til — i dag bare «Styrketrening» av
// de fire aktive (Fjelltur, Styrketrening, Cardio, Yoga/Pilates).
const STRENGTH_CATEGORIES = new Set(['Styrketrening']);

type MiniSession = Pick<WorkoutSession, 'startedAt' | 'completedAt' | 'who' | 'category'>;

/** Antall fullførte styrkeøkter `who` har i uka (mandag–søndag) som inneholder `at`. */
function strengthSessionsInWeek(sessions: MiniSession[], who: Trainer, at: Date): number {
  const from = startOfWeek(at).getTime();
  const to = from + 7 * 86400000;
  return sessions.filter(s => {
    if (!s.completedAt || s.who !== who || !STRENGTH_CATEGORIES.has(s.category)) return false;
    const t = new Date(s.startedAt).getTime();
    return t >= from && t < to;
  }).length;
}

/** Uker på rad, til og med uka rundt `at`, der `who` nådde ukemålet. */
function strengthWeekStreak(sessions: MiniSession[], who: Trainer, at: Date): number {
  let cursor = startOfWeek(at);
  let n = 0;
  while (strengthSessionsInWeek(sessions, who, cursor) >= TARAN_STRENGTH_GOAL_PER_WEEK) {
    n++;
    cursor = new Date(cursor.getTime() - 7 * 86400000);
  }
  return n;
}

const pickRandom = <T,>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)];

const STRENGTH_GOAL_MESSAGES: ((weeks: number) => string)[] = [
  weeks => weeks >= 2 ? `Ukemålet i boks — ${weeks} uker på rad nå! 💪` : `Ukemålet er i boks denne uka! 💪`,
  weeks => weeks >= 2
    ? `${weeks} uker på rad med ${TARAN_STRENGTH_GOAL_PER_WEEK}+ styrkeøkter — stø kurs!`
    : `${TARAN_STRENGTH_GOAL_PER_WEEK} styrkeøkter denne uka — akkurat i mål!`,
  weeks => `Nice! Styrkemålet for uka er nådd${weeks >= 2 ? ` — ${weeks} uker på rad` : ''} 🎉`,
  weeks => weeks >= 2
    ? `Solid! ${weeks} uker på rad nå med styrkemålet i boks.`
    : `Der har vi det — ${TARAN_STRENGTH_GOAL_PER_WEEK} styrkeøkter denne uka!`,
];

// ─── Badges: milepæler for begge ─────────────────────────────────────────────
//
// Egen tabell (earned_badges), ikke koblet til workout_goals — samme
// begrunnelse som Tarans ukemål over. Katalogen (nøkkel/terskel/ikon/tekst)
// bor her i koden; earned_badges er bare beviset på når noen faktisk nådde
// en av dem. Sjekkes ved hver registrering, for begge likt.
//
// Rekkefølgen på lista er bevisst stigende «imponerende-het» — når flere
// badges låses opp i samme registrering (typisk første gang funksjonen
// rulles ut, og noen retroaktivt kvalifiserer for flere på én gang), feires
// bare den siste kvalifiserte i lista, ikke alle samtidig.

interface BadgeCtx { sessions: MiniSession[]; records: WorkoutRecord[]; categories: WorkoutCategory[]; who: Trainer }

const totalCompleted = (ctx: BadgeCtx) => ctx.sessions.filter(s => s.completedAt && s.who === ctx.who).length;
const triedCategory = (ctx: BadgeCtx, names: string[]) =>
  ctx.sessions.some(s => s.completedAt && s.who === ctx.who && names.includes(s.category));
// weekStreak leser bare completedAt/startedAt/who — MiniSession dekker det,
// selv om den ikke er en fullverdig WorkoutSession.
const personalWeekStreak = (ctx: BadgeCtx) => weekStreak(ctx.sessions as WorkoutSession[], [ctx.who]);

interface BadgeDef {
  key: string;
  icon: string;
  label: string;
  message: string;
  isEarned: (ctx: BadgeCtx) => boolean;
}

const BADGE_DEFS: BadgeDef[] = [
  { key: 'forste_okt', icon: '🌱', label: 'Første økt', message: 'Første økt i loggen — sånn skal det se ut! 🌱',
    isEarned: ctx => totalCompleted(ctx) >= 1 },
  { key: 'totalt_5', icon: '⭐', label: '5 økter', message: '5 økter i loggen! ⭐',
    isEarned: ctx => totalCompleted(ctx) >= 5 },
  { key: 'ukestreak_1', icon: '📅', label: '1 uke på rad', message: 'Første fulle treningsuke i boks! 📅',
    isEarned: ctx => personalWeekStreak(ctx) >= 1 },
  { key: 'forste_fjelltur', icon: '⛰️', label: 'Første fjelltur', message: 'Første fjelltur logget — nydelig! ⛰️',
    isEarned: ctx => triedCategory(ctx, ['Fjelltur']) },
  { key: 'forste_yoga_cardio', icon: '🧘', label: 'Første yoga/cardio', message: 'Første yoga- eller cardioøkt i boks! 🧘',
    isEarned: ctx => triedCategory(ctx, ['Yoga/Pilates', 'Cardio']) },
  { key: 'totalt_25', icon: '🔥', label: '25 økter', message: '25 økter — stø kurs! 🔥',
    isEarned: ctx => totalCompleted(ctx) >= 25 },
  { key: 'ukestreak_4', icon: '🗓️', label: '4 uker på rad', message: '4 uker på rad — det begynner å bli en vane! 🗓️',
    isEarned: ctx => personalWeekStreak(ctx) >= 4 },
  { key: 'alle_kategorier', icon: '🎯', label: 'Prøvd alle kategorier', message: 'Alle kategoriene prøvd — allsidig! 🎯',
    isEarned: ctx => ctx.categories.filter(c => !c.archived).every(c => triedCategory(ctx, [c.name])) },
  { key: 'forste_rekord', icon: '🏅', label: 'Første rekord', message: 'Første rekord logget! 🏅',
    isEarned: ctx => ctx.records.some(r => r.who === ctx.who) },
  { key: 'totalt_50', icon: '💯', label: '50 økter', message: '50 økter — imponerende! 💯',
    isEarned: ctx => totalCompleted(ctx) >= 50 },
  { key: 'ukestreak_12', icon: '🏆', label: '12 uker på rad', message: '12 uker på rad — tre måneder rett gjennom! 🏆',
    isEarned: ctx => personalWeekStreak(ctx) >= 12 },
  { key: 'totalt_100', icon: '💎', label: '100 økter', message: '100 økter i loggen! 💎',
    isEarned: ctx => totalCompleted(ctx) >= 100 },
  { key: 'ukestreak_26', icon: '👑', label: '26 uker på rad', message: '26 uker på rad — et halvt år uten avbrudd! 👑',
    isEarned: ctx => personalWeekStreak(ctx) >= 26 },
];

/** Badges `who` kvalifiserer for akkurat nå, men ikke har fra før. */
function checkBadges(
  sessions: MiniSession[], records: WorkoutRecord[], categories: WorkoutCategory[],
  who: Trainer, alreadyEarned: Set<string>,
): BadgeDef[] {
  const ctx: BadgeCtx = { sessions, records, categories, who };
  return BADGE_DEFS.filter(b => !alreadyEarned.has(b.key) && b.isEarned(ctx));
}

// ─── Registrer en gjennomført økt ────────────────────────────────────────────

function RegisterModal({ categories, presetCategory, onClose }: {
  categories: WorkoutCategory[]; presetCategory?: string; onClose: () => void;
}) {
  const { registerSession, sessions, records, earnedBadges, awardBadges } = useTrening();
  const { session } = useAuth();
  const { notify } = useSnackbar();
  const isMobile = useIsMobile();

  // Aktive kategorier, men ta alltid med en forhåndsvalgt selv om den er arkivert.
  const options = useMemo(() => {
    const active = categories.filter(c => !c.archived);
    if (presetCategory && !active.some(c => c.name === presetCategory)) {
      const arch = categories.find(c => c.name === presetCategory);
      if (arch) return [arch, ...active];
    }
    return active;
  }, [categories, presetCategory]);

  const [category, setCategory] = useState(presetCategory ?? options[0]?.name ?? '');
  // Forhåndsvalg ut fra innlogget bruker — kun et utgangspunkt, ikke en låsing.
  const [who, setWho] = useState<Trainer>(() => trainerFromEmail(session?.user?.email));
  const [date, setDate] = useState(() => dayKey(new Date()));
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const { at, valid, error } = readWhen(date);
  const canSave = valid && category.trim().length > 0;
  const whoLabel = WHO_LABEL[who];

  const save = async (el: HTMLElement | null) => {
    if (!canSave || saving) return;
    setSaving(true);
    try {
      await registerSession({ category, who, performedAt: at.toISOString(), note: note.trim() || null });

      let message = `Registrert · ${category} · ${whoLabel} · ${fmtDay(at.toISOString())} 💪`;
      if (el) {
        const r = el.getBoundingClientRect();
        const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        const withNew: MiniSession[] = [...sessions, { startedAt: at.toISOString(), completedAt: at.toISOString(), who, category }];

        // Feiringen (fireworkRain) er nå alltid den samme, for begge, uansett
        // kategori — bare TEKSTEN varierer, og kun når en badge eller Tarans
        // ukemål faktisk inntreffer (else if, maks én spesialtekst per
        // registrering). Ellers står den vanlige "Registrert · ..."-teksten.
        const alreadyEarned = new Set(earnedBadges.filter(b => b.who === who).map(b => b.badgeKey));
        const candidates = checkBadges(withNew, records, categories, who, alreadyEarned).map(b => b.key);
        const newlyEarned = candidates.length > 0 ? await awardBadges(who, candidates) : [];

        if (newlyEarned.length > 0) {
          // Databasen (ikke `candidates`) er fasit på hva som faktisk var nytt.
          // Flere kan låses opp samtidig (typisk første gang funksjonen er i
          // bruk) — feir bare den mest imponerende, siste i BADGE_DEFS' stigende
          // rekkefølge.
          const top = BADGE_DEFS.filter(b => newlyEarned.includes(b.key)).pop()!;
          message = top.message;
        } else if (who === 'L' && STRENGTH_CATEGORIES.has(category)) {
          // Tarans ukentlige styrkemål — kun for henne.
          // "Akkurat nå": uka regnes ut fra det virkelige tidspunktet, ikke fra
          // `at` (den registrerte datoen) — en tilbakedatert økt fra forrige
          // uke skal ikke kunne utløse denne ukas gratulasjon.
          const now = new Date();
          const weeklyCount = strengthSessionsInWeek(withNew, 'L', now);
          if (weeklyCount === TARAN_STRENGTH_GOAL_PER_WEEK) {
            const weeks = strengthWeekStreak(withNew, 'L', now);
            message = pickRandom(STRENGTH_GOAL_MESSAGES)(weeks);
          }
        }
        fireworkRain(cx, cy);
      }
      notify(message);
      onClose();
    } finally { setSaving(false); }
  };

  return (
    <Modal
      eyebrow="Huk av en økt" title="Registrer trening" onClose={onClose} width={440}
      footer={
        <div className="row" style={{ gap: 10 }}>
          <button className="btn" onClick={onClose} style={{ padding: isMobile ? '12px 16px' : undefined, fontSize: isMobile ? 14 : undefined }}>Avbryt</button>
          <button className="btn primary" disabled={!canSave || saving}
            onClick={e => void save(e.currentTarget)}
            style={{ flex: 1, justifyContent: 'center', padding: isMobile ? '13px' : undefined, fontSize: isMobile ? 15 : undefined, opacity: !canSave || saving ? 0.4 : 1 }}>
            {saving ? 'Lagrer…' : 'Registrer'}
          </button>
        </div>
      }
    >
      {options.length === 0 ? (
        <div className="card-meta" style={{ color: 'var(--danger)' }}>Lag en kategori først.</div>
      ) : (
        <div className="col" style={{ gap: 6 }}>
          <label className="card-eyebrow" htmlFor="tr-reg-cat">Kategori</label>
          <div className="row" style={{ gap: 8 }}>
            <select id="tr-reg-cat" className="input" value={category} onChange={e => setCategory(e.target.value)} style={{ flex: 1 }}>
              {options.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
            </select>
            <CatTag category={category} lg />
          </div>
        </div>
      )}

      <div className="col" style={{ gap: 8 }}>
        <label className="card-eyebrow">Hvem gjennomførte?</label>
        <WhoPicker who={who} setWho={setWho} />
        <span className="card-meta">Loggføres på {whoLabel}.</span>
      </div>

      <WhenFields date={date} setDate={setDate} error={error} />

      <div className="col" style={{ gap: 6 }}>
        <label className="card-eyebrow" htmlFor="tr-reg-note">Notat <span style={{ opacity: 0.5 }}>(valgfritt)</span></label>
        <textarea id="tr-reg-note" className="input" placeholder="📝 Øvelser, hard eller rolig, e.l.…"
          value={note} onChange={e => setNote(e.target.value)} rows={2}
          style={{ width: '100%', resize: 'vertical' }} />
      </div>
    </Modal>
  );
}

// ─── Rediger en tidligere registrert økt ────────────────────────────────────

function EditSessionModal({ session, categories, onClose }: {
  session: WorkoutSession; categories: WorkoutCategory[]; onClose: () => void;
}) {
  const { saveLoggedSession, removeSession, restoreSession } = useTrening();
  const { notify } = useSnackbar();
  const { confirm } = useConfirm();
  const isMobile = useIsMobile();

  const options = useMemo(() => {
    const active = categories.filter(c => !c.archived);
    if (!active.some(c => c.name === session.category) && session.category) {
      const arch = categories.find(c => c.name === session.category);
      return arch ? [arch, ...active] : [{ id: '_', name: session.category, color: null, sortOrder: -1, archived: true }, ...active];
    }
    return active;
  }, [categories, session.category]);

  const [category, setCategory] = useState(session.category);
  const [who, setWho] = useState<Trainer>(session.who);
  const [date, setDate] = useState(() => toDateInput(session.startedAt));
  const [note, setNote] = useState(session.note ?? '');
  const [saving, setSaving] = useState(false);

  const { at, valid, error } = readWhen(date);
  const canSave = valid && category.trim().length > 0;

  const del = async () => {
    if (!await confirm({
      title: 'Slett økt fra loggen?',
      message: `${session.category} · ${WHO_LABEL[session.who]} · ${fmtDay(session.startedAt)}`,
      confirmLabel: 'Slett',
    })) return;
    await removeSession(session.id);
    notify('Økt slettet', { actionLabel: 'Angre', onAction: async () => { await restoreSession(session); } });
    onClose();
  };

  return (
    <Modal
      eyebrow="Rediger registrering"
      title={<span className="row" style={{ gap: 9, flexWrap: 'wrap' }}>Rediger økt <CatTag category={session.category} /></span>}
      onClose={onClose} width={440}
      footer={
        <div className="col" style={{ gap: 10 }}>
          <div className="row" style={{ gap: 10 }}>
            <button className="btn" onClick={onClose} style={{ padding: isMobile ? '12px 16px' : undefined, fontSize: isMobile ? 14 : undefined }}>Avbryt</button>
            <button className="btn primary" disabled={!canSave || saving}
              style={{ flex: 1, justifyContent: 'center', padding: isMobile ? '13px' : undefined, fontSize: isMobile ? 15 : undefined, opacity: !canSave || saving ? 0.4 : 1 }}
              onClick={async () => {
                if (!canSave || saving) return;
                setSaving(true);
                try {
                  await saveLoggedSession({ occasion: session, who, category, performedAt: at.toISOString(), note: note.trim() || null });
                  notify('Økt oppdatert');
                  onClose();
                } finally { setSaving(false); }
              }}>{saving ? 'Lagrer…' : 'Lagre endringer'}</button>
          </div>
          <button className="btn ghost sm" style={{ color: 'var(--danger)', alignSelf: 'flex-start' }} onClick={() => void del()}>Slett økt</button>
        </div>
      }
    >
      <div className="col" style={{ gap: 6 }}>
        <label className="card-eyebrow" htmlFor="tr-edit-cat">Kategori</label>
        <div className="row" style={{ gap: 8 }}>
          <select id="tr-edit-cat" className="input" value={category} onChange={e => setCategory(e.target.value)} style={{ flex: 1 }}>
            {options.map(c => <option key={c.id} value={c.name}>{c.name}{c.archived ? ' (arkivert)' : ''}</option>)}
          </select>
          <CatTag category={category} lg />
        </div>
      </div>

      <div className="col" style={{ gap: 8 }}>
        <label className="card-eyebrow">Hvem gjennomførte?</label>
        <WhoPicker who={who} setWho={setWho} />
      </div>

      <WhenFields date={date} setDate={setDate} error={error} />

      <div className="col" style={{ gap: 6 }}>
        <label className="card-eyebrow" htmlFor="tr-edit-note">Notat <span style={{ opacity: 0.5 }}>(valgfritt)</span></label>
        <textarea id="tr-edit-note" className="input" placeholder="📝 Øvelser, hard eller rolig, e.l.…"
          value={note} onChange={e => setNote(e.target.value)} rows={2}
          style={{ width: '100%', resize: 'vertical' }} />
      </div>
    </Modal>
  );
}

// ─── Ny / rediger kategori ───────────────────────────────────────────────────

function CategoryModal({ category, categories, sessions, onClose }: {
  category: WorkoutCategory | null; categories: WorkoutCategory[]; sessions: WorkoutSession[]; onClose: () => void;
}) {
  const { addCategory, updateCategory, removeCategory, restoreCategory } = useTrening();
  const { notify } = useSnackbar();
  const { confirm } = useConfirm();

  const [name, setName] = useState(category?.name ?? '');
  // null = «standard» (CSS-var for kjente navn, ellers nøytral). Ellers en hex.
  const [color, setColor] = useState<string | null>(category ? category.color : CAT_PALETTE[0]);
  const [archived, setArchived] = useState(category?.archived ?? false);
  const [saving, setSaving] = useState(false);

  const trimmed = name.trim();
  const clash = categories.some(c => c.id !== category?.id && c.name.trim().toLowerCase() === trimmed.toLowerCase());
  const valid = trimmed.length > 0 && !clash;
  const usedCount = category ? sessions.filter(s => s.completedAt && s.category === category.name).length : 0;

  const save = async () => {
    if (!valid || saving) return;
    setSaving(true);
    try {
      if (category) {
        await updateCategory(category.id, { name: trimmed, color, archived });
        notify('Kategori oppdatert');
      } else {
        await addCategory({ name: trimmed, color });
        notify('Kategori lagt til');
      }
      onClose();
    } finally { setSaving(false); }
  };

  const del = async () => {
    if (!category) return;
    if (!await confirm({
      title: 'Slett kategori?',
      message: usedCount > 0
        ? `«${category.name}» — de ${usedCount} registrerte øktene blir stående i historikken.`
        : `«${category.name}»`,
      confirmLabel: 'Slett',
    })) return;
    await removeCategory(category.id);
    notify('Kategori slettet', { actionLabel: 'Angre', onAction: () => void restoreCategory(category) });
    onClose();
  };

  return (
    <Modal
      eyebrow={category ? 'Rediger kategori' : 'Ny kategori'}
      title={category ? <span className="row" style={{ gap: 9, flexWrap: 'wrap' }}>Rediger — {category.name}</span> : 'Ny kategori'}
      onClose={onClose} width={440}
      footer={
        <div className="row between" style={{ gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          {category
            ? <button className="btn ghost sm" style={{ color: 'var(--danger)' }} onClick={() => void del()}>Slett</button>
            : <span />}
          <div className="row" style={{ gap: 10, marginLeft: 'auto' }}>
            <button className="btn" onClick={onClose}>Avbryt</button>
            <button className="btn primary" disabled={!valid || saving} style={{ opacity: !valid || saving ? 0.4 : 1 }}
              onClick={() => void save()}>{saving ? 'Lagrer…' : category ? 'Lagre' : 'Lag kategori'}</button>
          </div>
        </div>
      }
    >
      <div className="col" style={{ gap: 6 }}>
        <label className="card-eyebrow" htmlFor="tr-cat-name">Navn</label>
        <input id="tr-cat-name" className="input" value={name} autoFocus
          onChange={e => setName(e.target.value)} placeholder="F.eks. Yoga" />
        {clash && <div className="card-meta" style={{ color: 'var(--danger)' }}>Det finnes allerede en kategori med dette navnet.</div>}
      </div>

      <div className="col" style={{ gap: 8 }}>
        <label className="card-eyebrow">Farge</label>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <button
            onClick={() => setColor(null)} title="Standard"
            style={{
              width: 30, height: 30, borderRadius: '50%', cursor: 'pointer',
              border: color === null ? '2px solid var(--ink)' : '1px solid var(--line-2)',
              background: 'var(--surface-2)', color: 'var(--ink-4)', fontSize: 11,
            }}
          >A</button>
          {CAT_PALETTE.map(hex => (
            <button
              key={hex} onClick={() => setColor(hex)} aria-label={hex}
              style={{
                width: 30, height: 30, borderRadius: '50%', cursor: 'pointer', background: hex,
                border: color === hex ? '2px solid var(--ink)' : '1px solid transparent',
                boxShadow: color === hex ? '0 0 0 2px var(--surface) inset' : 'none',
              }}
            />
          ))}
        </div>
        <div className="row" style={{ gap: 8, alignItems: 'center' }}>
          <span className="card-meta">Forhåndsvisning:</span>
          <CatColorCtx.Provider value={(n) => (n === trimmed ? (color ?? catColor(trimmed)) : catColor(n))}>
            <CatTag category={trimmed || 'Kategori'} lg />
          </CatColorCtx.Provider>
        </div>
      </div>

      {category && (
        <label className="row" style={{ gap: 10, alignItems: 'center', cursor: 'pointer' }}>
          <input type="checkbox" checked={archived} onChange={e => setArchived(e.target.checked)} />
          <span className="col" style={{ gap: 1 }}>
            <span style={{ fontSize: 13 }}>Arkiver</span>
            <span className="card-meta">Skjules i velgerne, men beholdes i historikken.</span>
          </span>
        </label>
      )}
    </Modal>
  );
}

// ─── Ny rekord ───────────────────────────────────────────────────────────────

function RecordModal({ exercises, preset, onClose }: {
  exercises: string[]; preset?: { exercise: string; who: Trainer; unit: RecordUnit; target?: number }; onClose: () => void;
}) {
  const { addRecord } = useTrening();
  const { notify } = useSnackbar();
  const [exercise, setExercise] = useState(preset?.exercise ?? '');
  const [who, setWho] = useState<Trainer>(preset?.who ?? 'M');
  const [value, setValue] = useState('');
  const [unit, setUnit] = useState<RecordUnit>(preset?.unit ?? 'kg');
  const [date, setDate] = useState(dayKey(new Date()));
  const [target, setTarget] = useState(preset?.target != null ? String(preset.target) : '');
  const [saving, setSaving] = useState(false);

  const num = Number(value.replace(',', '.'));
  const valid = exercise.trim().length > 0 && isFinite(num) && num > 0;

  const save = async () => {
    if (!valid || saving) return;
    setSaving(true);
    try {
      const tgt = Number(target.replace(',', '.'));
      await addRecord({
        exercise: exercise.trim(), who, value: num, unit, date,
        target: target.trim() && isFinite(tgt) ? tgt : undefined,
      });
      notify('Rekord logget 💪');
      onClose();
    } finally { setSaving(false); }
  };

  return (
    <Modal
      eyebrow="Personlig rekord" title="Logg nytt forsøk" onClose={onClose} width={440}
      footer={
        <div className="row" style={{ gap: 10, justifyContent: 'flex-end' }}>
          <button className="btn" onClick={onClose}>Avbryt</button>
          <button className="btn primary" onClick={() => void save()} disabled={!valid || saving} style={{ opacity: !valid || saving ? 0.4 : 1 }}>
            {saving ? 'Lagrer…' : 'Lagre rekord'}
          </button>
        </div>
      }
    >
      <div className="col" style={{ gap: 6 }}>
        <label className="card-eyebrow" htmlFor="tr-ex">Øvelse</label>
        <input id="tr-ex" className="input" list="tr-ex-list" value={exercise} autoFocus
          onChange={e => setExercise(e.target.value)} placeholder="F.eks. Benkpress" />
        <datalist id="tr-ex-list">{exercises.map(e => <option key={e} value={e} />)}</datalist>
      </div>

      <div className="col" style={{ gap: 6 }}>
        <span className="card-eyebrow">Hvem</span>
        <div className="row" style={{ gap: 6 }}>
          {TRAINERS.map(w => (
            <button key={w} onClick={() => setWho(w)} style={{
              flex: 1, padding: '8px 0', borderRadius: 6, cursor: 'pointer', fontSize: 12,
              fontFamily: 'var(--font-mono)',
              border: `1px solid ${who === w ? WHO_COLOR[w] : 'var(--line-2)'}`,
              background: who === w ? `${WHO_COLOR[w]}18` : 'transparent',
              color: who === w ? WHO_COLOR[w] : 'var(--ink-4)',
            }}>{WHO_LABEL[w]}</button>
          ))}
        </div>
      </div>

      <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
        <div className="col" style={{ gap: 6, flex: 1, minWidth: 120 }}>
          <label className="card-eyebrow" htmlFor="tr-val">Resultat</label>
          <input id="tr-val" className="input" inputMode="decimal" value={value}
            onChange={e => setValue(e.target.value)} placeholder="100" />
        </div>
        <div className="col" style={{ gap: 6 }}>
          <label className="card-eyebrow" htmlFor="tr-unit">Enhet</label>
          <select id="tr-unit" className="input" value={unit} onChange={e => setUnit(e.target.value as RecordUnit)}>
            <option value="kg">kg</option>
            <option value="reps">reps</option>
          </select>
        </div>
        <div className="col" style={{ gap: 6 }}>
          <label className="card-eyebrow" htmlFor="tr-date">Dato</label>
          <input id="tr-date" className="input" type="date" value={date} onChange={e => setDate(e.target.value)} />
        </div>
      </div>

      <div className="col" style={{ gap: 6 }}>
        <label className="card-eyebrow" htmlFor="tr-target">Mål <span style={{ opacity: 0.5 }}>(valgfritt)</span></label>
        <input id="tr-target" className="input" inputMode="decimal" value={target}
          onChange={e => setTarget(e.target.value)} placeholder="110" />
      </div>
    </Modal>
  );
}

// ─── Rekord-detalj ───────────────────────────────────────────────────────────

interface PR {
  exercise: string;
  who: Trainer;
  unit: RecordUnit;
  best: number;
  target?: number;
  history: WorkoutRecord[];
}

function buildPRs(records: WorkoutRecord[]): PR[] {
  const groups = new Map<string, WorkoutRecord[]>();
  for (const r of records) {
    const k = `${r.exercise} ${r.who}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(r);
  }
  return [...groups.values()]
    .map(rs => {
      const history = [...rs].sort((a, b) => a.date.localeCompare(b.date));
      const best = Math.max(...history.map(r => r.value));
      return {
        exercise: history[0].exercise,
        who: history[0].who,
        unit: history[history.length - 1].unit,
        best,
        target: [...history].reverse().find(r => r.target != null)?.target,
        history,
      };
    })
    .sort((a, b) => b.history[b.history.length - 1].date.localeCompare(a.history[a.history.length - 1].date));
}

/** Endring i inneværende kalendermåned. */
function monthDelta(pr: PR): number {
  const start = dayKey(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const before = pr.history.filter(r => r.date < start);
  if (before.length === 0) return 0;
  return pr.best - Math.max(...before.map(r => r.value));
}

function Sparkline({ values, width = 72, height = 22 }: { values: number[]; width?: number; height?: number }) {
  if (values.length < 2) return <svg width={width} height={height} aria-hidden />;
  const min = Math.min(...values), max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => {
    const x = 1 + (i / (values.length - 1)) * (width - 2);
    const y = height - 3 - ((v - min) / span) * (height - 6);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} fill="none" aria-hidden>
      <polyline points={pts} stroke="var(--accent)" strokeWidth="1.5" />
    </svg>
  );
}

function RecordDetail({ pr, onClose, onLog }: { pr: PR; onClose: () => void; onLog: () => void }) {
  const { removeRecord, restoreRecord } = useTrening();
  const { confirm } = useConfirm();
  const { notify } = useSnackbar();

  const values = pr.history.map(r => r.value);
  const latest = pr.history[pr.history.length - 1];
  const yearAgo = dayKey(new Date(new Date().setFullYear(new Date().getFullYear() - 1)));
  const beforeYear = pr.history.filter(r => r.date < yearAgo);
  const gain = beforeYear.length ? pr.best - Math.max(...beforeYear.map(r => r.value)) : pr.best - values[0];
  const thisYear = String(new Date().getFullYear());
  const newThisYear = pr.history.filter(r => r.date.startsWith(thisYear)).length;

  const W = 440, H = 140;
  const min = Math.min(...values), max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => {
    const x = values.length === 1 ? W / 2 : 5 + (i / (values.length - 1)) * (W - 10);
    const y = 124 - ((v - min) / span) * 108;
    return { x, y };
  });

  return (
    <Modal
      eyebrow={`Personlig rekord · ${WHO_LABEL[pr.who]}`} title={pr.exercise} onClose={onClose}
      footer={<button className="btn primary" onClick={onLog}>+ Logg nytt forsøk</button>}
    >
      <div className="row" style={{ alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <span className="mono tabular" style={{ fontSize: 40, fontWeight: 500, color: 'var(--ink)', lineHeight: 1 }}>
          {fmtNum(pr.best)} <span style={{ fontSize: 20 }}>{pr.unit}</span>
        </span>
        <span className="tag accent">
          {latest.value >= pr.best ? 'ny rekord' : 'siste'} · {new Date(latest.date).toLocaleDateString('nb-NO', { day: 'numeric', month: 'short' })}
        </span>
      </div>

      <div style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 18 }}>
        <div className="section-h" style={{ marginBottom: 12 }}>
          <h3>Utvikling</h3>
          <span className="meta">{pr.history.length} registreringer</span>
        </div>
        <svg viewBox={`0 0 ${W} ${H}`} fill="none" style={{ width: '100%', height: 'auto' }} role="img" aria-label={`Utvikling for ${pr.exercise}: fra ${fmtNum(min)} til ${fmtNum(max)} ${pr.unit}`}>
          <line x1="0" y1="124" x2={W} y2="124" stroke="var(--line)" strokeWidth="1" />
          <line x1="0" y1="80" x2={W} y2="80" stroke="var(--line)" strokeWidth="1" strokeDasharray="3 3" />
          <line x1="0" y1="36" x2={W} y2="36" stroke="var(--line)" strokeWidth="1" strokeDasharray="3 3" />
          {pts.length > 1 && <polyline points={pts.map(p => `${p.x},${p.y}`).join(' ')} fill="none" stroke="var(--accent)" strokeWidth="2" />}
          {pts.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={i === pts.length - 1 ? 4 : 2.5} fill="var(--accent-deep)" />)}
          <text x="6" y="14" fontFamily="var(--font-mono)" fontSize="9" fill="var(--ink-4)">{fmtNum(max)} {pr.unit}</text>
          <text x="6" y={H - 4} fontFamily="var(--font-mono)" fontSize="9" fill="var(--ink-4)">{fmtNum(min)} {pr.unit}</text>
        </svg>
      </div>

      <div className="row" style={{ gap: 24, flexWrap: 'wrap' }}>
        <div className="col" style={{ gap: 2 }}>
          <span className="kpi-num" style={{ fontSize: 20, color: gain > 0 ? 'var(--good)' : 'var(--ink)' }}>
            {gain > 0 ? '+' : ''}{fmtNum(gain)} {pr.unit}
          </span>
          <span className="kpi-sub">siste 12 mnd</span>
        </div>
        <div className="col" style={{ gap: 2 }}>
          <span className="kpi-num" style={{ fontSize: 20 }}>{newThisYear}</span>
          <span className="kpi-sub">registreringer i år</span>
        </div>
        {pr.target != null && (
          <div className="col" style={{ gap: 2 }}>
            <span className="kpi-num" style={{ fontSize: 20 }}>{fmtNum(pr.target)} {pr.unit}</span>
            <span className="kpi-sub">mål</span>
          </div>
        )}
      </div>

      <div className="hairline" />

      <div className="list tight">
        {[...pr.history].reverse().map((r, i, arr) => {
          const prev = arr[i + 1];
          const delta = prev ? r.value - prev.value : null;
          return (
            <div key={r.id} className="li-row">
              <div className="grow">
                <div className="ttl">{fmtNum(r.value)} {r.unit}</div>
                <div className="sub">{new Date(r.date).toLocaleDateString('nb-NO', { day: 'numeric', month: 'long', year: 'numeric' })}</div>
              </div>
              {delta != null && delta !== 0 && (
                <span className={'tag ' + (i === 0 ? 'accent' : 'outline')}>{delta > 0 ? '+' : ''}{fmtNum(delta)}</span>
              )}
              <button
                onClick={async () => {
                  if (!await confirm({
                    title: 'Slett registrering?',
                    message: `${pr.exercise} · ${fmtNum(r.value)} ${r.unit} · ${new Date(r.date).toLocaleDateString('nb-NO')}`,
                    confirmLabel: 'Slett',
                  })) return;
                  await removeRecord(r.id);
                  notify('Registrering slettet', { actionLabel: 'Angre', onAction: () => void restoreRecord(r) });
                  if (pr.history.length === 1) onClose();
                }}
                aria-label="Slett registrering"
                style={{ background: 'transparent', border: '1px solid var(--line)', borderRadius: 4, minWidth: 30, minHeight: 30, cursor: 'pointer', fontSize: 14, color: 'var(--ink-4)' }}
              >×</button>
            </div>
          );
        })}
      </div>
    </Modal>
  );
}

// ─── Nytt mål ────────────────────────────────────────────────────────────────

/** Nyttår, sommer og «om tre måneder» — de fristene man faktisk setter. */
function deadlinePresets(): { label: string; date: string }[] {
  const now = new Date();
  const in3 = new Date(now); in3.setMonth(in3.getMonth() + 3);
  const in6 = new Date(now); in6.setMonth(in6.getMonth() + 6);
  const nyttar = new Date(now.getFullYear(), 11, 31);
  if (nyttar.getTime() < now.getTime()) nyttar.setFullYear(nyttar.getFullYear() + 1);
  return [
    { label: 'Om 3 mnd', date: dayKey(in3) },
    { label: 'Om 6 mnd', date: dayKey(in6) },
    { label: `Nyttår ${nyttar.getFullYear()}`, date: dayKey(nyttar) },
  ];
}

function GoalModal({ goal, exercises, onClose }: {
  goal: WorkoutGoal | null; exercises: string[]; onClose: () => void;
}) {
  const { addGoal, updateGoal } = useTrening();
  const { notify } = useSnackbar();

  const [kind, setKind] = useState<GoalKind>(goal?.kind ?? 'record');
  const [who, setWho] = useState<Who>(goal?.who ?? 'M');
  const [target, setTarget] = useState(goal ? String(goal.target) : '100');
  const [exercise, setExercise] = useState(goal?.exercise ?? '');
  const [unit, setUnit] = useState<RecordUnit>(goal?.unit ?? 'kg');
  const [deadline, setDeadline] = useState(goal?.deadline ?? '');
  const [title, setTitle] = useState(goal?.title ?? '');
  const [titleTouched, setTitleTouched] = useState(!!goal);
  const [saving, setSaving] = useState(false);

  const info = goalKindInfo(kind);
  const num = Number(target.replace(',', '.'));
  const numOk = isFinite(num) && num > 0;

  const unitLabel = kind === 'record' ? unit : info.unit;
  const suggestedTitle = kind === 'record'
    ? exercise.trim() ? `${fmtNum(num || 0)} ${unit} ${exercise.trim().toLowerCase()}` : ''
    : `${fmtNum(num || 0, 0)} ${info.unit}${info.titleSuffix}`;
  const effectiveTitle = (titleTouched ? title : suggestedTitle).trim();

  useEffect(() => {
    if (info.who === 'felles' && who !== 'f') setWho('f');
    if (info.who === 'person' && who === 'f') setWho('M');
  }, [info.who, who]);

  const whoDisabled = (w: Who) =>
    (info.who === 'felles' && w !== 'f') || (info.who === 'person' && w === 'f');

  const valid = effectiveTitle.length > 0 && numOk && (kind !== 'record' || exercise.trim().length > 0);

  const save = async () => {
    if (!valid || saving) return;
    setSaving(true);
    const payload = {
      title: effectiveTitle,
      who,
      kind,
      target: num,
      exercise: kind === 'record' ? exercise.trim() : null,
      unit: kind === 'record' ? unit : null,
      deadline: deadline || null,
    };
    try {
      if (goal) { await updateGoal(goal.id, payload); notify('Mål oppdatert'); }
      else { await addGoal(payload); notify('Mål lagt til'); }
      onClose();
    } finally { setSaving(false); }
  };

  return (
    <Modal
      eyebrow="Mål" title={goal ? `Rediger — ${goal.title}` : 'Nytt mål'} onClose={onClose} width={460}
      footer={
        <div className="row" style={{ gap: 10, justifyContent: 'flex-end' }}>
          <button className="btn" onClick={onClose}>Avbryt</button>
          <button className="btn primary" disabled={!valid || saving} style={{ opacity: !valid || saving ? 0.4 : 1 }}
            onClick={() => void save()}>{saving ? 'Lagrer…' : goal ? 'Lagre endringer' : 'Lagre mål'}</button>
        </div>
      }
    >
      <div className="col" style={{ gap: 6 }}>
        <label className="card-eyebrow" htmlFor="tr-goal-kind">Type</label>
        <select id="tr-goal-kind" className="input" value={kind}
          onChange={e => {
            const next = e.target.value as GoalKind;
            setKind(next);
            setTarget(String(goalKindInfo(next).suggest));
          }}>
          {GOAL_KINDS.map(k => <option key={k.v} value={k.v}>{k.label}</option>)}
        </select>
        <span className="card-meta">{info.hint}</span>
      </div>

      {kind === 'record' && (
        <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
          <div className="col" style={{ gap: 6, flex: 1, minWidth: 160 }}>
            <label className="card-eyebrow" htmlFor="tr-goal-ex">Øvelse</label>
            <input id="tr-goal-ex" className="input" list="tr-goal-ex-list" value={exercise} autoFocus
              onChange={e => setExercise(e.target.value)} placeholder="F.eks. Benkpress" />
            <datalist id="tr-goal-ex-list">{exercises.map(e => <option key={e} value={e} />)}</datalist>
          </div>
          <div className="col" style={{ gap: 6 }}>
            <label className="card-eyebrow" htmlFor="tr-goal-unit">Enhet</label>
            <select id="tr-goal-unit" className="input" value={unit} onChange={e => setUnit(e.target.value as RecordUnit)}>
              <option value="kg">kg</option>
              <option value="reps">reps</option>
            </select>
          </div>
        </div>
      )}

      <div className="row" style={{ gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div className="col" style={{ gap: 6, flex: 1, minWidth: 110 }}>
          <label className="card-eyebrow" htmlFor="tr-goal-target">Mål ({unitLabel})</label>
          <input id="tr-goal-target" className="input" inputMode="decimal" value={target}
            autoFocus={kind !== 'record'} onChange={e => setTarget(e.target.value)} />
        </div>
        <div className="col" style={{ gap: 6, flex: 1, minWidth: 150 }}>
          <span className="card-eyebrow">Gjelder</span>
          <div className="row" style={{ gap: 6 }}>
            {(['f', 'M', 'L'] as Who[]).map(w => (
              <button key={w} onClick={() => setWho(w)} disabled={whoDisabled(w)} style={{
                flex: 1, padding: '8px 0', borderRadius: 6, fontSize: 11, fontFamily: 'var(--font-mono)',
                cursor: whoDisabled(w) ? 'not-allowed' : 'pointer',
                opacity: whoDisabled(w) ? 0.35 : 1,
                border: `1px solid ${who === w ? WHO_COLOR[w] : 'var(--line-2)'}`,
                background: who === w ? `${WHO_COLOR[w]}18` : 'transparent',
                color: who === w ? WHO_COLOR[w] : 'var(--ink-4)',
              }}>{WHO_LABEL[w]}</button>
            ))}
          </div>
        </div>
      </div>

      <div className="col" style={{ gap: 6 }}>
        <div className="row between">
          <label className="card-eyebrow" htmlFor="tr-goal-deadline">Frist</label>
          <span className="card-meta">valgfritt — et mål kan stå uten</span>
        </div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <input id="tr-goal-deadline" className="input" type="date" value={deadline}
            onChange={e => setDeadline(e.target.value)} style={{ flex: 1, minWidth: 150 }} />
          {deadline && <button className="btn ghost sm" onClick={() => setDeadline('')}>Fjern frist</button>}
        </div>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          {deadlinePresets().map(p => (
            <button key={p.label} className={'tr-chip' + (deadline === p.date ? ' on' : '')}
              onClick={() => setDeadline(p.date)}>{p.label}</button>
          ))}
          <button className={'tr-chip' + (deadline === '' ? ' on' : '')} onClick={() => setDeadline('')}>Ingen frist</button>
        </div>
      </div>

      <div className="col" style={{ gap: 6 }}>
        <label className="card-eyebrow" htmlFor="tr-goal-title">Tittel</label>
        <input id="tr-goal-title" className="input" value={titleTouched ? title : suggestedTitle}
          onChange={e => { setTitleTouched(true); setTitle(e.target.value); }}
          placeholder={suggestedTitle || 'F.eks. 150 økter i år'} />
        <span className="card-meta">
          {titleTouched
            ? 'Skrevet inn manuelt'
            : 'Foreslås ut fra feltene over — skriv over hvis du vil ha noe annet'}
        </span>
      </div>
    </Modal>
  );
}

// ─── Delt navigasjon: Felles/Andreas/Taran + Registrer økt ──────────────────
//
// Samme rad, samme oppførsel, uansett om du står på registreringsskjermbildet
// eller på Statistikk — fanene tar deg rett til Statistikk-visningen for akkurat
// den personen (ett klikk i stedet for «gå til Statistikk, så velg person»).
// «Registrer økt» sin faktiske handling avhenger av hvor den vises fra —
// bestemt av hvilken `onRegister` hver kaller sender inn, se PageTrening.
// Ny kategori er bevisst IKKE med her: den finnes bare via kategori-rutenettet
// på «Hva har dere trent?»-siden.

function TreningNav({ activeWho, onSelectPerson, onRegister }: {
  /** Aktiv fane akkurat nå — null på registreringsskjermbildet, som ikke har noe personfilter. */
  activeWho: Who | null;
  onSelectPerson: (w: Who) => void;
  onRegister: () => void;
}) {
  return (
    <>
      <div className="tr-seg">
        {(['f', 'M', 'L'] as Who[]).map(w => (
          <button key={w} className={activeWho === w ? 'on' : ''} onClick={() => onSelectPerson(w)}>
            {w === 'f' ? 'Felles' : WHO_LABEL[w]}
          </button>
        ))}
      </div>
      <button className="btn primary sm" onClick={onRegister}>Registrer økt</button>
    </>
  );
}

// ─── Dashboard ───────────────────────────────────────────────────────────────

function Dashboard({ onSelectPerson, onRegister, onNewCategory, onEditCategory }: {
  onSelectPerson: (w: Who) => void; onRegister: (category?: string) => void;
  onNewCategory: () => void; onEditCategory: (c: WorkoutCategory) => void;
}) {
  const { categories, sessions, loading } = useTrening();
  const colorFor = useCatColor();
  const isMobile = useIsMobile();

  const agg = useMemo(() => aggregateByCategory(sessions), [sessions]);
  // Sist gjort øverst. «Aldri trent» (last = 0) faller til bunnen; likt eller
  // urørt tie-brytes på den faste rekkefølgen (sort_order).
  const active = useMemo(() =>
    categories.filter(c => !c.archived).sort((a, b) => {
      const la = agg.get(a.name)?.last ?? 0;
      const lb = agg.get(b.name)?.last ?? 0;
      return lb - la || a.sortOrder - b.sortOrder;
    }), [categories, agg]);

  if (loading) {
    return (
      <>
        <div className="page-head"><div><div className="page-sub">På gymmen</div><h1 className="page-title">Trening</h1></div></div>
        <SkeletonList rows={4} />
      </>
    );
  }

  return (
    <>
      <TopbarPortal><TreningNav activeWho={null} onSelectPerson={onSelectPerson} onRegister={() => onRegister()} /></TopbarPortal>
      <div className="page-head" style={isMobile ? { paddingBottom: 10 } : undefined}>
        <div>
          <div className="page-sub">På gymmen</div>
          <h1 className="page-title">Hva har dere <em>trent</em>?</h1>
          {!isMobile && <div className="page-sub" style={{ marginTop: 8 }}>Huk av en kategori når en økt er gjennomført — velg hvem og når.</div>}
        </div>
      </div>

      {active.length === 0 ? (
        <div style={{
          border: '1.5px dashed var(--line-2)', borderRadius: 'var(--radius-lg)',
          padding: isMobile ? '28px 20px' : '44px 32px', textAlign: 'center',
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14,
        }}>
          <span style={{ fontSize: 30 }}>🏋️</span>
          <div>
            <h2 style={{ fontSize: 17, fontWeight: 600, margin: 0 }}>Ingen kategorier ennå</h2>
            <p style={{ fontSize: 13, color: 'var(--ink-3)', lineHeight: 1.5, maxWidth: 420, margin: '8px auto 0' }}>
              Lag en kategori for hver type trening dere gjør — Push, Pull, Cardio, Yoga …
              Så huker dere bare av når en økt er gjennomført.
            </p>
          </div>
          <button className="btn primary" onClick={onNewCategory}>+ Lag din første kategori</button>
        </div>
      ) : (
        <div className="grid grid-12" style={{ gap: 14 }}>
          {active.map(c => {
            const a = agg.get(c.name) ?? emptyAgg();
            return (
              <div
                key={c.id} className="tr-wcard col-4" role="button" tabIndex={0}
                onClick={() => onRegister(c.name)}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onRegister(c.name); } }}
                style={{ borderLeft: `3px solid ${c.color ?? colorFor(c.name)}`, cursor: 'pointer' }}
              >
                <div className="row between" style={{ gap: 8 }}>
                  <CatTag category={c.name} lg />
                  <button
                    className="btn ghost sm" onClick={e => { e.stopPropagation(); onEditCategory(c); }}
                    aria-label={`Rediger ${c.name}`} title="Rediger kategori"
                    style={{ minWidth: 30, padding: '4px 8px' }}
                  >✎</button>
                </div>

                <div className="row" style={{ alignItems: 'baseline', gap: 8, marginTop: 2 }}>
                  <span className="mono tabular" style={{ fontSize: 26, fontWeight: 500, color: 'var(--ink)' }}>{a.year}</span>
                  <span className="card-meta">økter i år{a.month > 0 ? ` · ${a.month} denne mnd` : ''}</span>
                </div>

                <div className="col" style={{ gap: 5 }}>
                  {TRAINERS.map(w => {
                    const last = a.lastBy[w];
                    const cnt = a.count[w];
                    return (
                      <div key={w} className="row" style={{ gap: 7, alignItems: 'center' }}>
                        <span className={`avatar avatar-${w.toLowerCase()}`} style={{ width: 17, height: 17, fontSize: 8.5, flexShrink: 0 }}>{WHO_INITIAL[w]}</span>
                        <span className="mono" style={{ fontSize: 10.5, color: 'var(--ink-4)' }}>
                          {last
                            ? <>{cnt > 0 ? `${cnt}× · ` : ''}{fmtSince(last)}</>
                            : 'ingen ennå'}
                        </span>
                      </div>
                    );
                  })}
                </div>

                <button
                  className={'btn' + (isMobile ? '' : ' sm')}
                  style={{ marginTop: 'auto', alignSelf: isMobile ? 'stretch' : 'flex-start', justifyContent: 'center', padding: isMobile ? '11px' : undefined, fontSize: isMobile ? 14 : undefined }}
                  onClick={e => { e.stopPropagation(); onRegister(c.name); }}>+ Registrer</button>
              </div>
            );
          })}

          {!isMobile && (
            <button
              onClick={onNewCategory} className="col-4"
              style={{ border: '1.5px dashed var(--line-2)', borderRadius: 'var(--radius-lg)', background: 'transparent', display: 'grid', placeItems: 'center', minHeight: 150, cursor: 'pointer' }}
            >
              <div className="col" style={{ alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 22, color: 'var(--ink-4)' }}>+</span>
                <span className="card-meta">Ny kategori</span>
              </div>
            </button>
          )}
        </div>
      )}

      {isMobile && active.length > 0 && <Fab onClick={() => onRegister()} label="Registrer økt" />}
    </>
  );
}

// ─── Statistikk ──────────────────────────────────────────────────────────────

const WEEKDAYS = ['man', 'tir', 'ons', 'tor', 'fre', 'lør', 'søn'];

/** Den 1. i inneværende måned, midnatt — månedsvelgerens nullpunkt. */
const thisMonthStart = () => {
  const d = new Date();
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d;
};

/** Én rad per registrert økt. Nyest først. */
function occasionsOf(done: WorkoutSession[]): { key: string; session: WorkoutSession }[] {
  return done.map(s => ({ key: s.id, session: s }));
}

function Statistikk({ viewWho, onSelectPerson, onGoToDashboard, onNewRecord, onOpenRecord, onNewGoal, onEditGoal, onEditSession, onRegister }: {
  viewWho: Who; onSelectPerson: (w: Who) => void;
  /** Navigasjonsradens «Registrer økt» — tar deg til «Hva har dere trent?», ikke rett til modalen. */
  onGoToDashboard: () => void;
  onNewRecord: () => void; onOpenRecord: (pr: PR) => void;
  onNewGoal: () => void; onEditGoal: (g: WorkoutGoal) => void; onEditSession: (s: WorkoutSession) => void;
  /** Åpner registreringsmodalen direkte — brukt av «Siste økter»-kortets egen knapp. */
  onRegister: () => void;
}) {
  const { categories, sessions, records, goals, earnedBadges, loading, removeGoal, restoreGoal, removeSession, restoreSession } = useTrening();
  const { confirm } = useConfirm();
  const { notify } = useSnackbar();
  const colorFor = useCatColor();

  const [logCount, setLogCount] = useState(8);
  const [month, setMonth] = useState(thisMonthStart);

  const allDone = useMemo(() => sessions.filter(s => s.completedAt), [sessions]);

  // Person-filteret: Felles = begge, ellers bare den ene. Alt aktivitets-basert
  // under bygger på `done`, så ett bytte scoper hele siden på én gang.
  const isPerson = viewWho !== 'f';
  const who = viewWho as Trainer; // meningsfull kun når isPerson
  const done = useMemo(
    () => (isPerson ? allDone.filter(s => s.who === who) : allDone),
    [allDone, isPerson, who],
  );

  const isThisMonth = month.getTime() === thisMonthStart().getTime();

  const year = new Date().getFullYear();
  const thisYear = done.filter(s => new Date(s.startedAt).getFullYear() === year);
  const thisWeekStart = startOfWeek(new Date()).getTime();
  // Det aller første loggeåret startet dere ikke 1. januar — å dele på alle ukene
  // siden nyttår ville gitt et kunstig lavt snitt. Så det første året teller fra
  // første logga økt; senere år (når det finnes data fra i fjor) fra 1. januar.
  // Samme regel som i lib/treningPulse.ts, så tallet og pulsmeldinga er enige.
  const firstEver = done.length ? Math.min(...done.map(s => new Date(s.startedAt).getTime())) : Date.now();
  const countFrom = new Date(firstEver).getFullYear() === year ? firstEver : new Date(year, 0, 1).getTime();
  // Kun HELE, avsluttede uker telles — verken i teller eller nevner. Uken som
  // pågår nå er ufullstendig og ville dratt snittet kunstig ned. thisWeekStart
  // er samme mandag-ankrede uke-grense (startOfWeek) som resten av sidens
  // uke-baserte tall — ikke den tidligere rene dager-siden-countFrom-
  // tellingen, som ikke brukte noen kalenderuke-avgrensning i det hele tatt.
  // Delt logikk med lib/treningPulse.ts — hold de to i sync.
  const weeksElapsed = Math.max(1, Math.floor((thisWeekStart - countFrom) / (7 * 86400000)));
  const completedThisYear = thisYear.filter(s => new Date(s.startedAt).getTime() < thisWeekStart);
  const perWeek = completedThisYear.length / weeksElapsed;

  const lastYear = done.filter(s => new Date(s.startedAt).getFullYear() === year - 1);
  const perWeekLast = lastYear.length / 52;

  const daysTrainedYear = useMemo(() => new Set(thisYear.map(s => dayKey(new Date(s.startedAt)))).size, [thisYear]);

  const inPeriod = useMemo(
    () => done.filter(s => new Date(s.startedAt).getFullYear() === year),
    [done, year]);

  const daysTrained = useMemo(() => new Set(inPeriod.map(s => dayKey(new Date(s.startedAt)))).size, [inPeriod]);

  // ── Kategorier ──
  const byCategory = useMemo(() => {
    const rows = new Map<string, { category: string; n: number; m: number; l: number; last: number }>();
    for (const s of inPeriod) {
      const cat = s.category || 'Uten kategori';
      const row = rows.get(cat) ?? { category: cat, n: 0, m: 0, l: 0, last: 0 };
      row.n += 1;
      if (s.who === 'M') row.m += 1; else row.l += 1;
      row.last = Math.max(row.last, new Date(s.startedAt).getTime());
      rows.set(cat, row);
    }
    return [...rows.values()].sort((a, b) => b.n - a.n);
  }, [inPeriod]);
  const catMax = Math.max(1, ...byCategory.map(c => c.n));
  const catSessions = byCategory.reduce((sum, c) => sum + c.n, 0);

  // Kategorier man har, men ikke har rørt i perioden — fra kategori-basen.
  const missingCategories = useMemo(() =>
    categories.filter(c => !c.archived && !byCategory.some(x => x.category === c.name))
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map(c => c.name), [categories, byCategory]);

  // ── Rytme ──
  const byWeekday = useMemo(() => {
    const counts = Array.from({ length: 7 }, () => 0);
    for (const s of inPeriod) counts[(new Date(s.startedAt).getDay() + 6) % 7] += 1;
    return counts;
  }, [inPeriod]);
  const weekdayMax = Math.max(1, ...byWeekday);

  // ── Søylediagram: 12 måneder ──
  const bars = useMemo(() => Array.from({ length: 12 }, (_, i) => {
    const d = new Date(year, i, 1);
    const inMonth = done.filter(s => { const x = new Date(s.startedAt); return x.getFullYear() === year && x.getMonth() === i; });
    return {
      key: `m${i}`,
      label: d.toLocaleDateString('nb-NO', { month: 'short' }).slice(0, 3),
      total: inMonth.length,
      m: inMonth.filter(s => s.who === 'M').length,
      l: inMonth.filter(s => s.who === 'L').length,
    };
  }), [done, year]);
  const barMax = Math.max(1, ...bars.map(b => b.total));

  // ── Kalender ──
  const cells = useMemo(() => {
    const first = new Date(month.getFullYear(), month.getMonth(), 1);
    const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    const offset = (first.getDay() + 6) % 7;
    const byDay = new Map<string, Set<Trainer>>();
    for (const s of done) {
      const k = dayKey(new Date(s.startedAt));
      if (!byDay.has(k)) byDay.set(k, new Set());
      byDay.get(k)!.add(s.who);
    }
    const out: { key: string; day: number | ''; badge: string; bg: string; fg: string; bfg: string }[] = [];
    for (let i = 0; i < offset; i++) out.push({ key: `pad${i}`, day: '', badge: '', bg: 'transparent', fg: 'transparent', bfg: 'transparent' });
    for (let d = 1; d <= days; d++) {
      const k = dayKey(new Date(month.getFullYear(), month.getMonth(), d));
      const who = byDay.get(k);
      let bg = 'var(--surface-2)', fg = 'var(--ink-4)', bfg = 'transparent', badge = '';
      if (who?.has('M') && who.has('L')) {
        bg = 'var(--tr-both)'; fg = 'var(--bg)'; bfg = 'var(--bg)';
        badge = `${WHO_INITIAL.M}+${WHO_INITIAL.L}`;
      }
      else if (who?.has('M'))            { bg = 'var(--accent-soft)'; fg = 'var(--accent-deep)'; bfg = 'var(--accent-deep)'; badge = WHO_INITIAL.M; }
      else if (who?.has('L'))            { bg = 'var(--tr-solo-l)';   fg = 'var(--ink-2)';       bfg = 'var(--ink)';         badge = WHO_INITIAL.L; }
      out.push({ key: k, day: d, badge, bg, fg, bfg });
    }
    return out;
  }, [done, month]);

  const pulse = useMemo(() => computePulse(sessions, records, goals, viewWho), [sessions, records, goals, viewWho]);

  // Felles trekker fra begges badges (samme trainers-scoping som resten av
  // siden); Andreas/Taran ser bare sine egne.
  const myBadges = useMemo(
    () => earnedBadges.filter(b => (isPerson ? b.who === who : true)),
    [earnedBadges, isPerson, who]);

  const prs = useMemo(() => buildPRs(records), [records]);
  const visiblePrs = isPerson ? prs.filter(p => p.who === who) : prs;
  const streakWho = isPerson ? [who] : TRAINERS;
  const streak = weekStreak(done, streakWho);
  const best = bestWeekStreak(done, streakWho);
  const sessionsGoal = goals.find(g => g.kind === 'sessions_year' && g.who === viewWho);

  const logRows = useMemo(() => occasionsOf(done), [done]);

  const visibleGoals = useMemo(() => {
    const mine = goals.filter(g => g.who === viewWho);
    return [
      ...mine.filter(g => !goalStatus(g, done, records).done),
      ...mine.filter(g => goalStatus(g, done, records).done),
    ];
  }, [goals, viewWho, done, records]);

  const delOccasion = async (s: WorkoutSession) => {
    if (!await confirm({
      title: 'Slett økt fra loggen?',
      message: `${s.category} · ${WHO_LABEL[s.who]} · ${fmtDay(s.startedAt)}`,
      confirmLabel: 'Slett',
    })) return;
    await removeSession(s.id);
    notify('Økt slettet', { actionLabel: 'Angre', onAction: async () => { await restoreSession(s); } });
  };

  if (loading) {
    return (
      <>
        <div className="page-head"><div><div className="page-sub">Oversikt</div><h1 className="page-title">Statistikk</h1></div></div>
        <SkeletonList rows={5} />
      </>
    );
  }

  return (
    <>
      <TopbarPortal><TreningNav activeWho={viewWho} onSelectPerson={onSelectPerson} onRegister={onGoToDashboard} /></TopbarPortal>
      <div className="page-head">
        <div>
          <div className="page-sub">
            Oversikt <span className="meta">• {year}</span>
          </div>
          <h1 className="page-title">Slik trener <em>{isPerson ? WHO_LABEL[who] : 'dere'}</em></h1>
        </div>
      </div>

      {allDone.length === 0 ? (
        <div style={{ padding: '40px 0', textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--ink-4)' }}>
          Ingen registrerte økter ennå — huk av en økt så fylles dette ut.
        </div>
      ) : (pulse || myBadges.length > 0) && (
        <div className="note" style={{ borderLeftColor: pulse?.color ?? 'var(--accent-deep)' }}>
          {pulse && <>{pulse.text}<span className="note-from">{pulse.from}</span></>}
          {myBadges.length > 0 && (
            <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: pulse ? 10 : 0 }}>
              {myBadges.map(b => {
                const def = BADGE_DEFS.find(d => d.key === b.badgeKey);
                if (!def) return null;
                return (
                  <span key={`${b.who}-${b.badgeKey}`} title={`${def.label}${isPerson ? '' : ` · ${WHO_LABEL[b.who]}`}`}
                    style={{ fontSize: 17, fontStyle: 'normal', lineHeight: 1 }}>{def.icon}</span>
                );
              })}
            </div>
          )}
        </div>
      )}

      <div className="card" style={{ flexDirection: 'row', padding: 0, flexWrap: 'wrap' }}>
        <div className="stat" style={{ flex: 1, minWidth: 130 }}>
          <span className="stat-lbl">Økter i år</span>
          <span className="stat-val">{thisYear.length}</span>
          <span className="stat-delta">{sessionsGoal ? `mål: ${sessionsGoal.target}` : 'registrerte økter'}</span>
        </div>
        <div className="stat" style={{ flex: 1, minWidth: 130 }}>
          <span className="stat-lbl">Økter totalt</span>
          <span className="stat-val">{done.length}</span>
          <span className="stat-delta">siden start</span>
        </div>
        <div className="stat" style={{ flex: 1, minWidth: 130 }}
          title={`En uke teller i streaken når ${isPerson ? WHO_LABEL[who] + ' har' : 'begge har'} minst ${STREAK_MIN_SESSIONS} registrerte økter (mandag–søndag). Beste rekke: ${best}.`}>
          <span className="stat-lbl">Streak</span>
          <span className="stat-val">{streak} {streak === 1 ? 'uke' : 'uker'}</span>
          <span className="stat-delta">{STREAK_MIN_SESSIONS} økter {isPerson ? 'i uka' : 'hver'} · beste: {best}</span>
        </div>
        <div className="stat" style={{ flex: 1, minWidth: 130 }}>
          <span className="stat-lbl">Snitt per uke</span>
          <span className="stat-val">{fmtNum(perWeek)}</span>
          <span className={'stat-delta' + (perWeek < perWeekLast ? ' down' : '')}>
            {lastYear.length ? `${perWeek >= perWeekLast ? '↑' : '↓'} fra ${fmtNum(perWeekLast)} i fjor` : 'første året'}
          </span>
        </div>
        <div className="stat" style={{ flex: 1, minWidth: 130 }}>
          <span className="stat-lbl">Dager trent i år</span>
          <span className="stat-val">{daysTrainedYear}</span>
          <span className="stat-delta">unike treningsdager</span>
        </div>
      </div>

      <div className="grid grid-12">
        {/* Kalender */}
        <div className="card col-12">
          <div className="card-head" style={{ flexWrap: 'wrap', gap: 10 }}>
            <div className="row" style={{ gap: 12, alignItems: 'center' }}>
              <button className="btn ghost sm" aria-label="Forrige måned"
                onClick={() => setMonth(m => new Date(m.getFullYear(), m.getMonth() - 1, 1))}>←</button>
              <h3 className="card-title" style={{ minWidth: 110, textAlign: 'center', textTransform: 'capitalize' }}>
                {month.toLocaleDateString('nb-NO', { month: 'long', year: 'numeric' })}
              </h3>
              <button className="btn ghost sm" aria-label="Neste måned"
                onClick={() => setMonth(m => new Date(m.getFullYear(), m.getMonth() + 1, 1))}>→</button>
              {!isThisMonth && (
                <button className="btn ghost sm" onClick={() => setMonth(thisMonthStart())}>I dag</button>
              )}
            </div>
            <div className="row" style={{ gap: 12 }}>
              {isPerson ? (
                <span className="mono" style={{ fontSize: 10, color: 'var(--ink-4)' }}><b style={{ color: WHO_COLOR[who] }}>●</b> {WHO_LABEL[who]}</span>
              ) : (
                <>
                  <span className="mono" style={{ fontSize: 10, color: 'var(--ink-4)' }}><b style={{ color: 'var(--accent)' }}>●</b> {WHO_INITIAL.M}</span>
                  <span className="mono" style={{ fontSize: 10, color: 'var(--ink-4)' }}><b style={{ color: 'var(--ink)' }}>●</b> {WHO_INITIAL.L}</span>
                  <span className="mono" style={{ fontSize: 10, color: 'var(--ink-4)' }}><b style={{ color: 'var(--tr-both)' }}>●</b> begge</span>
                </>
              )}
            </div>
          </div>
          <div className="tr-cal" style={{ marginBottom: 6 }}>
            {['ma', 'ti', 'on', 'to', 'fr', 'lø', 'sø'].map(d => (
              <span key={d} className="tr-cal-num" style={{ textAlign: 'center', color: 'var(--ink-4)' }}>{d}</span>
            ))}
          </div>
          <div className="card-meta" style={{ marginBottom: 8 }}>
            {isPerson
              ? <>Dagene {WHO_LABEL[who]} trente.</>
              : <><strong>{WHO_INITIAL.M}+{WHO_INITIAL.L}</strong> betyr at begge trente den dagen.</>}
          </div>
          <div className="tr-cal">
            {cells.map(c => (
              <div key={c.key} className="tr-cal-cell" style={{ background: c.bg }}>
                <span className="tr-cal-num" style={{ color: c.fg }}>{c.day}</span>
                <span className="tr-cal-badge" style={{ color: c.bfg }}>{c.badge}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Kategorifordeling */}
        <div className="card col-12">
          <div className="section-h">
            <h3>Hvor ofte trener dere hva?</h3>
          </div>
          {byCategory.length === 0 ? (
            <div className="card-meta">Ingen økter i perioden</div>
          ) : (
            <>
              <div className="col" style={{ gap: 12 }}>
                {byCategory.map(c => (
                  <div key={c.category} className="col" style={{ gap: 5 }}>
                    <div className="row between" style={{ gap: 8, flexWrap: 'wrap' }}>
                      <div className="row" style={{ gap: 8 }}>
                        <CatTag category={c.category} />
                        <span className="mono tabular" style={{ fontSize: 11, color: 'var(--ink-2)' }}>
                          {c.n} {c.n === 1 ? 'økt' : 'økter'}
                        </span>
                      </div>
                      <span className="mono tabular" style={{ fontSize: 10, color: 'var(--ink-4)' }}>
                        {Math.round((c.n / Math.max(1, catSessions)) * 100)} %{isPerson ? '' : ` · ${WHO_INITIAL.M} ${c.m} / ${WHO_INITIAL.L} ${c.l}`}
                      </span>
                    </div>
                    <div className="prog tall">
                      <i style={{ width: `${(c.n / catMax) * 100}%`, background: colorFor(c.category) }} />
                    </div>
                  </div>
                ))}
              </div>
              {missingCategories.length > 0 && (
                <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 12, alignItems: 'center' }}>
                  <span className="card-meta">Ikke rørt i perioden:</span>
                  {missingCategories.map(c => (
                    <span key={c} style={{ opacity: 0.5 }}><CatTag category={c} /></span>
                  ))}
                </div>
              )}
              <div className="card-meta" style={{ marginTop: 10 }}>
                {isPerson
                  ? `Bare øktene ${WHO_LABEL[who]} har registrert.`
                  : 'Teller én rad per person.'}
              </div>
            </>
          )}
        </div>

        {/* Rytme */}
        <div className="card col-12">
          <div className="section-h">
            <h3>Når trener dere?</h3>
          </div>
          {inPeriod.length === 0 ? (
            <div className="card-meta">Ingen økter i perioden</div>
          ) : (
            <div className="col" style={{ gap: 10 }}>
              <span className="card-eyebrow">Ukedag</span>
              <div className="row" style={{ alignItems: 'flex-end', gap: 8, height: 90 }}>
                {byWeekday.map((n, i) => (
                  <div key={WEEKDAYS[i]} className="col" style={{ flex: 1, alignItems: 'center', gap: 6, justifyContent: 'flex-end', height: '100%' }}>
                    <span className="mono tabular" style={{ fontSize: 9, color: 'var(--ink-4)' }}>{n || ''}</span>
                    <div
                      title={`${WEEKDAYS[i]}: ${n} økter`}
                      style={{
                        width: '100%', borderRadius: '3px 3px 0 0', minHeight: n ? 4 : 2,
                        height: `${(n / weekdayMax) * 100}%`,
                        background: n === weekdayMax && n > 0 ? 'var(--accent-deep)' : 'var(--accent-soft)',
                      }}
                    />
                    <span className="mono" style={{ fontSize: 9, color: 'var(--ink-4)' }}>{WEEKDAYS[i]}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Siste økter */}
        <div className="card col-8">
          <div className="section-h">
            <h3>Siste økter</h3>
            <div className="row" style={{ gap: 10, alignItems: 'baseline' }}>
              <span className="meta">{isPerson ? `${WHO_LABEL[who]} sin logg` : 'Felles logg'} · {logRows.length} totalt</span>
              <button className="btn ghost sm" onClick={onRegister}>Registrer økt</button>
            </div>
          </div>
          {logRows.length === 0 && <div className="card-meta">Ingen økter ennå</div>}
          <div className="list">
            {logRows.slice(0, logCount).map(({ key, session: s }) => (
              <div key={key} className="li-row" style={{ borderLeft: `3px solid ${colorFor(s.category)}`, paddingLeft: 10 }}>
                <WhoAvatar who={s.who} />
                <div className="grow">
                  <div className="row" style={{ gap: 7, minWidth: 0 }}>
                    <CatTag category={s.category} />
                  </div>
                  <div className="sub">{fmtDay(s.startedAt)}</div>
                  {s.note && <div className="sub" style={{ fontStyle: 'italic', whiteSpace: 'pre-wrap' }}>📝 {s.note}</div>}
                </div>
                <button
                  onClick={() => onEditSession(s)}
                  aria-label={`Rediger ${s.category}`} title="Rediger"
                  style={{ background: 'transparent', border: '1px solid var(--line)', borderRadius: 4, minWidth: 30, minHeight: 30, cursor: 'pointer', fontSize: 13, color: 'var(--ink-4)' }}
                >✎</button>
                <button
                  onClick={() => void delOccasion(s)}
                  aria-label="Slett økt fra loggen"
                  style={{ background: 'transparent', border: '1px solid var(--line)', borderRadius: 4, minWidth: 30, minHeight: 30, cursor: 'pointer', fontSize: 14, color: 'var(--ink-4)' }}
                >×</button>
              </div>
            ))}
          </div>
          {logRows.length > logCount && (
            <button className="btn ghost sm" style={{ alignSelf: 'flex-start', marginTop: 10 }}
              onClick={() => setLogCount(c => c + 20)}>
              Vis flere ({logRows.length - logCount} igjen)
            </button>
          )}
        </div>

        {/* Mål */}
        <div className="card col-4">
          <div className="row between" style={{ gap: 8 }}>
            <h3 style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>Mål</h3>
            <span className="meta">{isPerson ? WHO_LABEL[who] : 'Felles'}</span>
          </div>
          {visibleGoals.length === 0 && <div className="card-meta" style={{ marginTop: 8 }}>Ingen mål for {WHO_LABEL[viewWho].toLowerCase()} ennå — bytt person øverst for å se andres.</div>}
          <div className="col" style={{ gap: 16, marginTop: 4 }}>
            {visibleGoals.map(g => {
              const st = goalStatus(g, done, records);
              const info = goalKindInfo(g.kind);
              const overdue = !st.done && st.daysLeft !== null && st.daysLeft < 0;
              const fill = st.done ? 'var(--good)' : overdue ? 'var(--warn)' : 'var(--ink)';
              return (
                <div key={g.id} className="col" style={{ gap: 6 }}>
                  <div className="row between" style={{ gap: 8 }}>
                    <span style={{ fontSize: 12.5 }}>{g.title}</span>
                    <div className="row" style={{ gap: 4, alignItems: 'center', flexShrink: 0 }}>
                      <span className="mono tabular" style={{ fontSize: 10, color: st.done ? 'var(--good)' : 'var(--ink-3)' }}>
                        {st.label}{st.done ? ' ✓' : ''}
                      </span>
                      <button
                        onClick={() => onEditGoal(g)}
                        aria-label={`Rediger målet ${g.title}`} title="Rediger mål"
                        style={{ background: 'transparent', border: 0, cursor: 'pointer', fontSize: 11, color: 'var(--ink-4)', padding: '2px 3px' }}
                      >✎</button>
                      <button
                        onClick={async () => {
                          if (!await confirm({ title: 'Slett mål?', message: `«${g.title}»`, confirmLabel: 'Slett' })) return;
                          await removeGoal(g.id);
                          notify('Mål slettet', { actionLabel: 'Angre', onAction: () => void restoreGoal(g) });
                        }}
                        aria-label={`Slett målet ${g.title}`}
                        style={{ background: 'transparent', border: 0, cursor: 'pointer', fontSize: 13, color: 'var(--ink-4)', padding: '2px 4px' }}
                      >×</button>
                    </div>
                  </div>
                  <div className="prog tall"><i style={{ width: `${st.pct * 100}%`, background: fill }} /></div>
                  <div className="card-meta">
                    {g.kind === 'record' ? `${g.exercise} · ${info.label.toLowerCase()}` : info.label}
                    {' · '}
                    {st.done
                      ? st.achievedOn
                        ? `nådd ${new Date(st.achievedOn).toLocaleDateString('nb-NO', { day: 'numeric', month: 'short', year: 'numeric' })}`
                        : 'i havn'
                      : g.deadline === null
                        ? 'uten frist'
                        : overdue
                          ? `fristen gikk ut ${fmtDeadline(g.deadline)}`
                          : `innen ${fmtDeadline(g.deadline)} · ${st.daysLeft} ${st.daysLeft === 1 ? 'dag' : 'dager'} igjen`}
                    {!st.done && st.remaining > 0 && ` · ${fmtNum(st.remaining)} ${st.unit} igjen`}
                  </div>
                </div>
              );
            })}
          </div>
          <button className="btn ghost sm" style={{ alignSelf: 'flex-start', marginTop: 12 }} onClick={onNewGoal}>+ Nytt mål</button>
        </div>

        {/* Søylediagram */}
        <div className="card col-12">
          <div className="section-h">
            <h3>Økter per måned</h3>
            <div className="row" style={{ gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              <span className="meta">Siste 12 måneder</span>
              <span className="mono" style={{ fontSize: 10, color: 'var(--ink-4)' }}><b style={{ color: 'var(--accent)' }}>●</b> Andreas</span>
              <span className="mono" style={{ fontSize: 10, color: 'var(--ink-4)' }}><b style={{ color: 'var(--ink)' }}>●</b> Taran</span>
            </div>
          </div>
          <div className="row" style={{ alignItems: 'flex-end', gap: 10, height: 110 }}>
            {bars.map(b => (
              <div key={b.key} className="col" style={{ flex: 1, alignItems: 'center', gap: 6, justifyContent: 'flex-end', height: '100%' }}>
                <div
                  title={`${b.label}: ${b.total} økter · Andreas ${b.m} / Taran ${b.l}`}
                  style={{
                    width: '100%', background: 'var(--surface-2)', borderRadius: '3px 3px 0 0',
                    height: `${(b.total / barMax) * 100}%`, minHeight: b.total ? 4 : 2,
                    overflow: 'hidden',
                    display: 'flex', flexDirection: 'column', justifyContent: 'flex-end',
                  }}
                >
                  <div style={{ width: '100%', background: 'var(--ink)', height: `${b.total ? (b.l / b.total) * 100 : 0}%` }} />
                  <div style={{ width: '100%', background: 'var(--accent)', height: `${b.total ? (b.m / b.total) * 100 : 0}%` }} />
                </div>
                <span className="mono" style={{ fontSize: 8, color: 'var(--ink-4)' }}>{b.label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Rekorder */}
        <div className="card col-12">
          <div className="section-h">
            <h3>Personlige rekorder</h3>
            <span className="meta">Trykk en rekord for utvikling →</span>
          </div>
          {visiblePrs.length === 0 && <div className="card-meta">{isPerson ? `Ingen rekorder for ${WHO_LABEL[who]} ennå` : 'Ingen rekorder logget ennå'}</div>}
          <div className="grid grid-12" style={{ gap: 12 }}>
            {visiblePrs.map(pr => {
              const delta = monthDelta(pr);
              return (
                <button
                  key={`${pr.exercise}-${pr.who}`} className="col-3" onClick={() => onOpenRecord(pr)}
                  style={{ border: '1px solid var(--line)', borderRadius: 6, padding: '12px 14px', background: 'var(--surface)', display: 'flex', flexDirection: 'column', gap: 6, textAlign: 'left', cursor: 'pointer' }}
                >
                  <div className="row between" style={{ gap: 8 }}>
                    <span className="card-eyebrow">{pr.exercise}</span>
                    <div className={`avatar avatar-${pr.who.toLowerCase()}`} style={{ width: 18, height: 18, fontSize: 8 }}>{WHO_INITIAL[pr.who]}</div>
                  </div>
                  <div className="row between" style={{ alignItems: 'flex-end', gap: 8 }}>
                    <span className="mono tabular" style={{ fontSize: 20, fontWeight: 500, color: 'var(--ink)' }}>{fmtNum(pr.best)} {pr.unit}</span>
                    <Sparkline values={pr.history.map(r => r.value)} />
                  </div>
                  <span className="mono" style={{ fontSize: 9, color: delta > 0 ? 'var(--good)' : 'var(--ink-4)' }}>
                    {delta > 0 ? `+${fmtNum(delta)} ${pr.unit} denne mnd` : 'uendret denne mnd'}
                  </span>
                </button>
              );
            })}
          </div>
          <button className="btn ghost sm" style={{ alignSelf: 'flex-start', marginTop: 12 }} onClick={onNewRecord}>+ Logg ny rekord</button>
        </div>
      </div>
    </>
  );
}

// ─── Side ────────────────────────────────────────────────────────────────────

export default function PageTrening() {
  const { categories, sessions, records } = useTrening();
  const [view, setView] = useState<'okter' | 'statistikk'>('okter');
  const [viewWho, setViewWho] = useState<Who>('f');

  const [registerOpen,   setRegisterOpen]   = useState(false);
  const [registerPreset, setRegisterPreset] = useState<string | undefined>();
  const [editSession,    setEditSession]    = useState<WorkoutSession | null>(null);
  const [catModalOpen,   setCatModalOpen]   = useState(false);
  const [editCategory,   setEditCategory]   = useState<WorkoutCategory | null>(null);
  const [recordOpen,     setRecordOpen]     = useState(false);
  const [recordPreset,   setRecordPreset]   = useState<{ exercise: string; who: Trainer; unit: RecordUnit; target?: number } | undefined>();
  const [goalOpen,       setGoalOpen]       = useState(false);
  const [editGoal,       setEditGoal]       = useState<WorkoutGoal | null>(null);
  const [detail,         setDetail]         = useState<PR | null>(null);

  // Fargeoppslag: lagret hex per kategori, ellers CSS-var/nøytral via catColor.
  const colorFor = useMemo<ColorFor>(() => {
    const m = new Map(categories.map(c => [c.name, c.color] as const));
    return (name: string) => m.get(name) ?? catColor(name);
  }, [categories]);

  const prs = useMemo(() => buildPRs(records), [records]);
  const liveDetail = detail ? prs.find(p => p.exercise === detail.exercise && p.who === detail.who) ?? null : null;
  useEffect(() => { if (detail && !liveDetail) setDetail(null); }, [detail, liveDetail]);

  const knownExercises = useMemo(() =>
    [...new Set(records.map(r => r.exercise))].filter(Boolean).sort(), [records]);

  const openRegister = (category?: string) => { setRegisterPreset(category); setRegisterOpen(true); };
  const openCategory = (c: WorkoutCategory | null) => { setEditCategory(c); setCatModalOpen(true); };
  const goToStats = (w: Who) => { setViewWho(w); setView('statistikk'); window.scrollTo({ top: 0 }); };

  return (
    <CatColorCtx.Provider value={colorFor}>
      {view === 'okter'
        ? <Dashboard
            onSelectPerson={goToStats}
            onRegister={openRegister}
            onNewCategory={() => openCategory(null)}
            onEditCategory={c => openCategory(c)}
          />
        : <Statistikk
            viewWho={viewWho}
            onSelectPerson={goToStats}
            onGoToDashboard={() => { setView('okter'); window.scrollTo({ top: 0 }); }}
            onNewRecord={() => { setRecordPreset(undefined); setRecordOpen(true); }}
            onOpenRecord={pr => setDetail(pr)}
            onNewGoal={() => { setEditGoal(null); setGoalOpen(true); }}
            onEditGoal={g => { setEditGoal(g); setGoalOpen(true); }}
            onEditSession={s => setEditSession(s)}
            onRegister={() => openRegister()}
          />}

      {registerOpen && (
        <RegisterModal
          categories={categories}
          presetCategory={registerPreset}
          onClose={() => { setRegisterOpen(false); setRegisterPreset(undefined); }}
        />
      )}

      {editSession && (
        <EditSessionModal
          session={editSession}
          categories={categories}
          onClose={() => setEditSession(null)}
        />
      )}

      {catModalOpen && (
        <CategoryModal
          key={editCategory?.id ?? 'ny'}
          category={editCategory}
          categories={categories}
          sessions={sessions}
          onClose={() => { setCatModalOpen(false); setEditCategory(null); }}
        />
      )}

      {liveDetail && !recordOpen && (
        <RecordDetail
          pr={liveDetail}
          onClose={() => setDetail(null)}
          onLog={() => {
            setRecordPreset({ exercise: liveDetail.exercise, who: liveDetail.who, unit: liveDetail.unit, target: liveDetail.target });
            setRecordOpen(true);
          }}
        />
      )}

      {recordOpen && (
        <RecordModal
          exercises={knownExercises}
          preset={recordPreset}
          onClose={() => { setRecordOpen(false); setRecordPreset(undefined); }}
        />
      )}

      {goalOpen && (
        <GoalModal
          key={editGoal?.id ?? 'nytt'}
          goal={editGoal}
          exercises={knownExercises}
          onClose={() => { setGoalOpen(false); setEditGoal(null); }}
        />
      )}
    </CatColorCtx.Provider>
  );
}
