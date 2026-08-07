import { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { Who } from '../data';

/** Bare M og L trener — «f» (felles) brukes kun på mål. */
export type Trainer = Exclude<Who, 'f'>;
export const TRAINERS: Trainer[] = ['M', 'L'];

/** Standardkategoriene appen kommer med. Basen kan ha flere — se workout_categories. */
export const WORKOUT_CATEGORIES = ['Push', 'Pull', 'Legs', 'Fullkropp', 'Overkropp', 'Cardio'] as const;

/**
 * Fargekode per standardkategori.
 *
 * Kategorien må kunne kjennes igjen på farge uten å leses. For de seks
 * standardnavnene bor fargene i styles.css, én verdi per tema, så de er lesbare
 * både på lys og mørk bakgrunn. Egendefinerte kategorier har i stedet en lagret
 * hex-farge på seg (workout_categories.color) som sendes inn eksplisitt.
 */
const CATEGORY_VAR: Record<string, string> = {
  Push:      'var(--cat-push)',
  Pull:      'var(--cat-pull)',
  Legs:      'var(--cat-legs)',
  Fullkropp: 'var(--cat-fullkropp)',
  Overkropp: 'var(--cat-overkropp)',
  Cardio:    'var(--cat-cardio)',
};

/** Fargen for et kategorinavn når vi ikke har en lagret hex — CSS-var eller nøytral. */
export const catColor = (category: string) => CATEGORY_VAR[category] ?? 'var(--cat-none)';

export interface WorkoutCategory {
  id: string;
  name: string;
  /** Lagret hex-farge, eller null ⇒ bruk CATEGORY_VAR/--cat-none via catColor(). */
  color: string | null;
  sortOrder: number;
  /** Arkivert ⇒ skjult i velgerne, men beholdt i lista for gjenåpning. */
  archived: boolean;
  /**
   * Muskelgruppene kategorien treffer, f.eks. Fullkropp = ['Push','Pull','Legs'].
   * Brukt til dekning: en økt dekker en annen kategori når gruppene er et
   * supersett. Påvirker «sist trent» og pulsen — aldri tellingen.
   */
  groups: string[];
}

export interface WorkoutSession {
  id: string;
  /** Beholdt for gammel logg; nye registreringer setter den til null. */
  templateId: string | null;
  /** Nå en kopi av kategorien. Beholdt fordi eldre stats/rader leser feltet. */
  templateName: string;
  category: string;
  who: Trainer;
  /** Tidspunktet økta ble gjennomført. For avhukinger er completedAt lik denne. */
  startedAt: string;
  /** null ⇒ eldre pågående økt; for avhukinger alltid lik startedAt. */
  completedAt: string | null;
  /** Valgfritt fritekstnotat om økta (øvelser, hard/rolig, …). null ⇒ intet notat. */
  note: string | null;
  /** Gammelt «Diverse»-tillegg — beholdt så eldre rader og stats fortsatt tolkes. */
  extraStartedAt?: string | null;
  extraMinutes?: number | null;
}

export type RecordUnit = 'kg' | 'reps';

export interface WorkoutRecord {
  id: string;
  exercise: string;
  who: Trainer;
  value: number;
  unit: RecordUnit;
  date: string;
  target?: number;
}

export type GoalKind =
  | 'sessions_year'   // fullførte økter hittil i år
  | 'sessions_month'  // fullførte økter i inneværende måned
  | 'sessions_total'  // fullførte økter noensinne
  | 'hours_year'      // målt tid hittil i år, i timer
  | 'minutes_week'    // målt tid denne uka, i minutter
  | 'weekly_streak'   // uker på rad med minst én økt
  | 'record';         // nå en gitt verdi i en øvelse — «55 kg benk»

export interface WorkoutGoal {
  id: string;
  title: string;
  who: Who;
  kind: GoalKind;
  target: number;
  /** Bare for kind='record': øvelsen og enheten målet gjelder. */
  exercise: string | null;
  unit: RecordUnit | null;
  /** yyyy-mm-dd, eller null for et mål uten frist. */
  deadline: string | null;
}

interface TreningCtx {
  categories: WorkoutCategory[];
  sessions: WorkoutSession[];
  records: WorkoutRecord[];
  goals: WorkoutGoal[];
  loading: boolean;
  addCategory: (c: { name: string; color: string | null; groups: string[] }) => Promise<void>;
  updateCategory: (id: string, patch: Partial<Omit<WorkoutCategory, 'id'>>) => Promise<void>;
  /** Sletter kategorien. Øktradene beholder kategorinavnet, så historikken består. */
  removeCategory: (id: string) => Promise<void>;
  restoreCategory: (c: WorkoutCategory) => Promise<void>;
  /**
   * Huk av at en økt i en kategori er gjennomført. started_at = completed_at =
   * performedAt, så den teller som fullført, men uten målt varighet.
   */
  registerSession: (input: { category: string; who: Trainer; performedAt: string; note?: string | null }) => Promise<void>;
  /** Rediger en tidligere registrert økt. */
  saveLoggedSession: (input: { occasion: WorkoutSession; who: Trainer; category: string; performedAt: string; note?: string | null }) => Promise<void>;
  removeSession: (id: string) => Promise<void>;
  restoreSession: (s: WorkoutSession) => Promise<void>;
  addRecord: (r: Omit<WorkoutRecord, 'id'>) => Promise<void>;
  removeRecord: (id: string) => Promise<void>;
  restoreRecord: (r: WorkoutRecord) => Promise<void>;
  addGoal: (g: Omit<WorkoutGoal, 'id'>) => Promise<void>;
  updateGoal: (id: string, patch: Partial<Omit<WorkoutGoal, 'id'>>) => Promise<void>;
  removeGoal: (id: string) => Promise<void>;
  restoreGoal: (g: WorkoutGoal) => Promise<void>;
}

const noop = async () => {};

const TreningContext = createContext<TreningCtx>({
  categories: [], sessions: [], records: [], goals: [], loading: true,
  addCategory: noop, updateCategory: noop, removeCategory: noop, restoreCategory: noop,
  registerSession: noop, saveLoggedSession: noop,
  removeSession: noop, restoreSession: noop,
  addRecord: noop, removeRecord: noop, restoreRecord: noop,
  addGoal: noop, updateGoal: noop, removeGoal: noop, restoreGoal: noop,
});

const categoryFromRow = (r: Record<string, unknown>): WorkoutCategory => ({
  id: r.id as string,
  name: r.name as string,
  color: (r.color as string | null) ?? null,
  sortOrder: (r.sort_order as number | null) ?? 0,
  archived: !!r.archived,
  groups: Array.isArray(r.muscle_groups) ? (r.muscle_groups as unknown[]).filter((g): g is string => typeof g === 'string') : [],
});

const sessionFromRow = (r: Record<string, unknown>): WorkoutSession => ({
  id: r.id as string,
  category: (r.category as string | null) ?? '',
  who: (r.who as Trainer) ?? 'M',
  startedAt: r.started_at as string,
  completedAt: (r.completed_at as string | null) ?? null,
  note: (r.note as string | null) ?? null,
  // Utgåtte kolonner (fjernet i scripts/trening-rebuild.sql). Typen beholder
  // feltene fordi lib/treningPulse.ts og testene bruker dem — her er de tomme.
  templateId: null,
  templateName: '',
  extraStartedAt: null,
  extraMinutes: null,
});

const recordFromRow = (r: Record<string, unknown>): WorkoutRecord => ({
  id: r.id as string,
  exercise: r.exercise as string,
  who: (r.who as Trainer) ?? 'M',
  value: Number(r.value),
  unit: (r.unit as RecordUnit) ?? 'kg',
  date: r.date as string,
  target: r.target == null ? undefined : Number(r.target),
});

const goalFromRow = (r: Record<string, unknown>): WorkoutGoal => ({
  id: r.id as string,
  title: r.title as string,
  who: (r.who as Who) ?? 'f',
  kind: (r.kind as GoalKind) ?? 'sessions_year',
  target: Number(r.target ?? 0),
  exercise: (r.exercise as string | null) ?? null,
  unit: (r.unit as RecordUnit | null) ?? null,
  deadline: (r.deadline as string | null) ?? null,
});

export function TreningProvider({ children }: { children: React.ReactNode }) {
  const [categories, setCategories] = useState<WorkoutCategory[]>([]);
  const [sessions,   setSessions]   = useState<WorkoutSession[]>([]);
  const [records,    setRecords]    = useState<WorkoutRecord[]>([]);
  const [goals,      setGoals]      = useState<WorkoutGoal[]>([]);
  const [loading,    setLoading]    = useState(true);

  const load = async () => {
    const [{ data: cat }, { data: ses }, { data: rec }, { data: gol }] = await Promise.all([
      supabase.from('workout_categories').select('*').order('sort_order').order('name'),
      supabase.from('workout_sessions').select('*').order('started_at', { ascending: false }),
      supabase.from('workout_records').select('*').order('date', { ascending: false }),
      supabase.from('workout_goals').select('*').order('created_at'),
    ]);
    if (cat) setCategories(cat.map(categoryFromRow));
    if (ses) setSessions(ses.map(sessionFromRow));
    if (rec) setRecords(rec.map(recordFromRow));
    if (gol) setGoals(gol.map(goalFromRow));
  };

  useEffect(() => {
    (async () => { await load(); setLoading(false); })();

    const channel = supabase
      .channel('trening_realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'workout_categories' }, () => { load(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'workout_sessions' },   () => { load(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'workout_records' },     () => { load(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'workout_goals' },       () => { load(); })
      .subscribe();

    // En registrering kan ha kommet inn på den andre telefonen mens skjermen lå
    // død — hent på nytt når fanen kommer tilbake.
    const onVisible = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      supabase.removeChannel(channel);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  // ── Kategorier ─────────────────────────────────────────────────────────────

  const addCategory = async ({ name, color, groups }: { name: string; color: string | null; groups: string[] }) => {
    const sortOrder = categories.reduce((m, x) => Math.max(m, x.sortOrder), -1) + 1;
    await supabase.from('workout_categories').insert({ name, color, sort_order: sortOrder, muscle_groups: groups });
    await load();
  };

  const updateCategory = async (id: string, patch: Partial<Omit<WorkoutCategory, 'id'>>) => {
    const db: Record<string, unknown> = {};
    if ('name' in patch)      db.name          = patch.name;
    if ('color' in patch)     db.color         = patch.color;
    if ('sortOrder' in patch) db.sort_order    = patch.sortOrder;
    if ('archived' in patch)  db.archived      = patch.archived;
    if ('groups' in patch)    db.muscle_groups = patch.groups;
    await supabase.from('workout_categories').update(db).eq('id', id);
    await load();
  };

  // Øktradene har kategorinavnet lagret på seg (denormalisert), så en sletting
  // her rører aldri historikken — akkurat som template_name overlevde at en mal
  // ble slettet i den gamle modellen.
  const removeCategory = async (id: string) => {
    await supabase.from('workout_categories').delete().eq('id', id);
    await load();
  };

  const restoreCategory = async (c: WorkoutCategory) => {
    await supabase.from('workout_categories').insert({
      id: c.id, name: c.name, color: c.color, sort_order: c.sortOrder, archived: c.archived, muscle_groups: c.groups,
    });
    await load();
  };

  // ── Økter ──────────────────────────────────────────────────────────────────

  // Én avhuking: started_at = completed_at, template_id null, template_name =
  // kategorien (feltet er not null og leses fortsatt enkelte steder).
  const insertOccasion = async (category: string, who: Trainer, performedAt: string, note: string | null) => {
    await supabase.from('workout_sessions').insert({
      category, who, started_at: performedAt, completed_at: performedAt, note,
    });
  };

  const registerSession = async ({ category, who, performedAt, note = null }:
    { category: string; who: Trainer; performedAt: string; note?: string | null }) => {
    await insertOccasion(category, who, performedAt, note);
    await load();
  };

  const saveLoggedSession = async ({ occasion, who, category, performedAt, note = null }:
    { occasion: WorkoutSession; who: Trainer; category: string; performedAt: string; note?: string | null }) => {
    await supabase.from('workout_sessions').delete().eq('id', occasion.id);
    await insertOccasion(category, who, performedAt, note);
    await load();
  };

  const removeSession = async (id: string) => {
    await supabase.from('workout_sessions').delete().eq('id', id);
    await load();
  };

  const restoreSession = async (s: WorkoutSession) => {
    await supabase.from('workout_sessions').insert({
      id: s.id, category: s.category, who: s.who,
      started_at: s.startedAt, completed_at: s.completedAt, note: s.note,
    });
    await load();
  };

  // ── Rekorder ───────────────────────────────────────────────────────────────

  const addRecord = async (r: Omit<WorkoutRecord, 'id'>) => {
    await supabase.from('workout_records').insert({
      exercise: r.exercise, who: r.who, value: r.value, unit: r.unit,
      date: r.date, target: r.target ?? null,
    });
    await load();
  };

  const removeRecord = async (id: string) => {
    await supabase.from('workout_records').delete().eq('id', id);
    await load();
  };

  const restoreRecord = async (r: WorkoutRecord) => {
    await supabase.from('workout_records').insert({
      id: r.id, exercise: r.exercise, who: r.who, value: r.value,
      unit: r.unit, date: r.date, target: r.target ?? null,
    });
    await load();
  };

  // ── Mål ────────────────────────────────────────────────────────────────────

  const addGoal = async (g: Omit<WorkoutGoal, 'id'>) => {
    await supabase.from('workout_goals').insert({
      title: g.title, who: g.who, kind: g.kind, target: g.target,
      exercise: g.exercise, unit: g.unit, deadline: g.deadline,
    });
    await load();
  };

  const updateGoal = async (id: string, patch: Partial<Omit<WorkoutGoal, 'id'>>) => {
    const db: Record<string, unknown> = {};
    if ('title' in patch)    db.title    = patch.title;
    if ('who' in patch)      db.who      = patch.who;
    if ('kind' in patch)     db.kind     = patch.kind;
    if ('target' in patch)   db.target   = patch.target;
    if ('exercise' in patch) db.exercise = patch.exercise;
    if ('unit' in patch)     db.unit     = patch.unit;
    if ('deadline' in patch) db.deadline = patch.deadline;
    await supabase.from('workout_goals').update(db).eq('id', id);
    await load();
  };

  const removeGoal = async (id: string) => {
    await supabase.from('workout_goals').delete().eq('id', id);
    await load();
  };

  const restoreGoal = async (g: WorkoutGoal) => {
    await supabase.from('workout_goals').insert({
      id: g.id, title: g.title, who: g.who, kind: g.kind, target: g.target,
      exercise: g.exercise, unit: g.unit, deadline: g.deadline,
    });
    await load();
  };

  return (
    <TreningContext.Provider value={{
      categories, sessions, records, goals, loading,
      addCategory, updateCategory, removeCategory, restoreCategory,
      registerSession, saveLoggedSession, removeSession, restoreSession,
      addRecord, removeRecord, restoreRecord,
      addGoal, updateGoal, removeGoal, restoreGoal,
    }}>
      {children}
    </TreningContext.Provider>
  );
}

export const useTrening = () => useContext(TreningContext);
