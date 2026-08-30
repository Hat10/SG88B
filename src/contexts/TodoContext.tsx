import { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { Who } from '../data';

export type Priority = 'høy' | 'middels' | 'lav';

// De fire faste alternativene har ikke noe "antall"-konsept (spesielt
// monthly/monthly-last, som er ankret til kalendermåneden, ikke et fast
// antall dager) — 'custom' er det femte, egendefinerte alternativet, med
// repeatInterval/repeatUnit under for å uttrykke "hver X dager/uker".
export type FixedRepeatInterval = 'daily' | 'weekly' | 'monthly' | 'monthly-last';
export type RepeatInterval = FixedRepeatInterval | 'custom';
export type RepeatUnit = 'day' | 'week' | 'month';
// Kun relevant/påkrevd når repeatUnit === 'month' — samme skille som de faste
// 'monthly' (same_date) vs. 'monthly-last' (last_day) uttrykker, se
// addMonthsSameDate()/lastDayOfMonthsAhead() under.
export type RepeatMonthMode = 'same_date' | 'last_day';

export const REPEAT_LABELS: Record<FixedRepeatInterval, string> = {
  daily:         'Daglig',
  weekly:        'Ukentlig',
  monthly:       'Månedlig (samme dato)',
  'monthly-last': 'Månedlig (siste dag)',
};

const REPEAT_UNIT_LABEL: Record<RepeatUnit, string> = { day: 'dag', week: 'uke', month: 'måned' };

// Visningstekst for 🔁-badgen — faste tekster for de fire opprinnelige,
// utledet "Hver X. dag/uke/måned (...)" for 'custom'. Norsk ordenstall-
// fraseologi ("hver 3. dag") bøyer ikke substantivet, så samme entallsform
// brukes uansett intervallverdi.
export function repeatLabel(item: { repeat?: RepeatInterval; repeatInterval?: number; repeatUnit?: RepeatUnit; repeatMonthMode?: RepeatMonthMode }): string | undefined {
  if (!item.repeat) return undefined;
  if (item.repeat === 'custom') {
    const n = item.repeatInterval ?? 1;
    if (item.repeatUnit === 'month') {
      const modeLabel = item.repeatMonthMode === 'last_day' ? 'siste dag' : 'samme dato';
      return `Hver ${n}. måned (${modeLabel})`;
    }
    return `Hver ${n}. ${REPEAT_UNIT_LABEL[item.repeatUnit ?? 'day']}`;
  }
  return REPEAT_LABELS[item.repeat];
}

export interface TodoEntry {
  id: string;
  title: string;
  description?: string;
  who: Who;
  priority: Priority;
  deadline?: string; // ISO date string YYYY-MM-DD
  time?: string;     // HH:MM local time, optional
  done: boolean;
  doneYear?: string;
  doneAt?: string;   // ISO timestamp when completed
  overdue_days: number;
  repeat?: RepeatInterval;
  /** Kun brukt når repeat === 'custom' — se repeatLabel()/nextDeadline(). */
  repeatInterval?: number;
  repeatUnit?: RepeatUnit;
  /** Kun brukt når repeat === 'custom' && repeatUnit === 'month'. */
  repeatMonthMode?: RepeatMonthMode;
}

// Samme dag i måneden, `months` måneder frem — klippet til siste dag i
// målmåneden hvis dagen ikke finnes der (f.eks. 31. jan + 1 måned -> 28./29.
// feb, ikke 3. mars). Delt av det faste 'monthly'-alternativet og det
// egendefinerte month-caset (repeatMonthMode === 'same_date') i nextDeadline().
function addMonthsSameDate(d: Date, months: number): Date {
  const next = new Date(d);
  const dayOfMonth = next.getDate();
  next.setMonth(next.getMonth() + months);
  if (next.getDate() !== dayOfMonth) next.setDate(0);
  return next;
}

// Siste dag i måneden `months` måneder frem. Delt av det faste
// 'monthly-last'-alternativet og det egendefinerte month-caset
// (repeatMonthMode === 'last_day') i nextDeadline().
function lastDayOfMonthsAhead(d: Date, months: number): Date {
  const next = new Date(d);
  next.setMonth(next.getMonth() + months + 1, 0);
  return next;
}

function toIsoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function nextDeadline(
  deadline: string, repeat: RepeatInterval,
  repeatInterval?: number, repeatUnit?: RepeatUnit, repeatMonthMode?: RepeatMonthMode,
): string {
  // Always advance from the current deadline, not from today.
  // This preserves the schedule whether the task was completed early or late.
  let d = new Date(deadline + 'T00:00:00');

  switch (repeat) {
    case 'daily':
      d.setDate(d.getDate() + 1);
      break;
    case 'weekly':
      d.setDate(d.getDate() + 7);
      break;
    case 'monthly':
      d = addMonthsSameDate(d, 1);
      break;
    case 'monthly-last':
      d = lastDayOfMonthsAhead(d, 1);
      break;
    case 'custom': {
      const n = repeatInterval ?? 1;
      if (repeatUnit === 'week') d.setDate(d.getDate() + n * 7);
      else if (repeatUnit === 'month') {
        d = repeatMonthMode === 'last_day' ? lastDayOfMonthsAhead(d, n) : addMonthsSameDate(d, n);
      } else {
        d.setDate(d.getDate() + n); // 'day' (default)
      }
      break;
    }
  }

  return toIsoDate(d);
}

export type TodoPatch = Partial<Omit<TodoEntry, 'id'>>;

interface TodoCtx {
  items: TodoEntry[];
  loading: boolean;
  addItem: (item: Omit<TodoEntry, 'id'>) => Promise<void>;
  updateItem: (id: string, patch: TodoPatch) => Promise<void>;
  toggleItem: (id: string, done: boolean) => Promise<void>;
  removeItem: (id: string) => Promise<void>;
}

const TodoContext = createContext<TodoCtx>({
  items: [], loading: true,
  addItem: async () => {}, updateItem: async () => {}, toggleItem: async () => {},
  removeItem: async () => {},
});

const fromRow = (r: Record<string, unknown>): TodoEntry => ({
  id: r.id as string,
  title: r.title as string,
  description: (r.description as string | null) ?? undefined,
  who: (r.who as Who) ?? 'f',
  priority: (r.priority as Priority) ?? 'middels',
  deadline: (r.deadline as string | null) ?? undefined,
  time: (r.time as string | null) ?? undefined,
  done: r.done as boolean,
  doneYear: (r.done_year as string | null) ?? undefined,
  doneAt:   (r.done_at   as string | null) ?? undefined,
  overdue_days: (r.overdue_days as number | null) ?? 0,
  repeat: (r.repeat as RepeatInterval | null) ?? undefined,
  repeatInterval: (r.repeat_interval as number | null) ?? undefined,
  repeatUnit: (r.repeat_unit as RepeatUnit | null) ?? undefined,
  repeatMonthMode: (r.repeat_month_mode as RepeatMonthMode | null) ?? undefined,
});

export function TodoProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<TodoEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async (): Promise<TodoEntry[]> => {
    const { data: its } = await supabase.from('todo_items').select('*').order('created_at', { ascending: false });
    const items = its ? its.map(fromRow) : [];
    setItems(items);
    return items;
  };

  const rollover = async (loadedItems: TodoEntry[]): Promise<boolean> => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    // Use local date components — NOT toISOString() which gives UTC (wrong in UTC+2 before 2am)
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    if (localStorage.getItem('todo_last_rollover') === todayStr) return false;
    localStorage.setItem('todo_last_rollover', todayStr);

    const overdue = loadedItems.filter(it =>
      !it.done && it.deadline && new Date(it.deadline + 'T00:00:00') < today
    );
    if (overdue.length === 0) return false;

    await Promise.all(overdue.map(it => {
      const dl = new Date(it.deadline! + 'T00:00:00');
      const daysPast = Math.round((today.getTime() - dl.getTime()) / 86400000);
      return supabase.from('todo_items').update({
        deadline: todayStr,
        overdue_days: it.overdue_days + daysPast,
      }).eq('id', it.id);
    }));

    return true;
  };

  useEffect(() => {
    (async () => {
      const items = await load();
      const rolled = await rollover(items);
      if (rolled) await load();
      setLoading(false);
    })();

    const channel = supabase
      .channel('todo_realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'todo_items' }, () => { load(); })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  const addItem = async (item: Omit<TodoEntry, 'id'>) => {
    await supabase.from('todo_items').insert({
      title: item.title,
      description: item.description ?? null,
      who: item.who,
      priority: item.priority,
      deadline: item.deadline ?? null,
      time: item.time ?? null,
      done: item.done,
      done_year: item.doneYear ?? null,
      overdue_days: 0,
      repeat: item.repeat ?? null,
      repeat_interval: item.repeatInterval ?? null,
      repeat_unit: item.repeatUnit ?? null,
      repeat_month_mode: item.repeatMonthMode ?? null,
    });
    await load();
  };

  const updateItem = async (id: string, patch: TodoPatch) => {
    const db: Record<string, unknown> = {};
    if ('title' in patch)       db.title       = patch.title;
    if ('description' in patch) db.description = patch.description ?? null;
    if ('who' in patch)         db.who         = patch.who;
    if ('priority' in patch)    db.priority    = patch.priority;
    if ('deadline' in patch) {
      db.deadline     = patch.deadline ?? null;
      db.overdue_days = 0;
    }
    if ('time' in patch)     db.time        = patch.time ?? null;
    if ('done' in patch)        db.done        = patch.done;
    if ('doneYear' in patch)    db.done_year   = patch.doneYear ?? null;
    if ('repeat' in patch)      db.repeat      = patch.repeat ?? null;
    if ('repeatInterval' in patch) db.repeat_interval = patch.repeatInterval ?? null;
    if ('repeatUnit' in patch)     db.repeat_unit     = patch.repeatUnit ?? null;
    if ('repeatMonthMode' in patch) db.repeat_month_mode = patch.repeatMonthMode ?? null;
    await supabase.from('todo_items').update(db).eq('id', id);
    await load();
  };

  const toggleItem = async (id: string, done: boolean) => {
    const completing = !done;
    const year   = completing ? String(new Date().getFullYear()) : undefined;
    const doneAt = completing ? new Date().toISOString() : null;
    await supabase.from('todo_items').update({ done: completing, done_year: year ?? null, done_at: doneAt }).eq('id', id);

    // Spawn next occurrence when completing a recurring item
    if (completing) {
      const item = items.find(i => i.id === id);
      if (item?.repeat && item.deadline) {
        await supabase.from('todo_items').insert({
          title:       item.title,
          description: item.description ?? null,
          who:         item.who,
          priority:    item.priority,
          deadline:    nextDeadline(item.deadline, item.repeat, item.repeatInterval, item.repeatUnit, item.repeatMonthMode),
          time:        item.time ?? null,
          done:        false,
          done_year:   null,
          overdue_days: 0,
          repeat:      item.repeat,
          repeat_interval: item.repeatInterval ?? null,
          repeat_unit:     item.repeatUnit ?? null,
          repeat_month_mode: item.repeatMonthMode ?? null,
        });
      }
    }

    await load();
  };

  const removeItem = async (id: string) => {
    await supabase.from('todo_items').delete().eq('id', id);
    await load();
  };

  return (
    <TodoContext.Provider value={{ items, loading, addItem, updateItem, toggleItem, removeItem }}>
      {children}
    </TodoContext.Provider>
  );
}

export const useTodo = () => useContext(TodoContext);
