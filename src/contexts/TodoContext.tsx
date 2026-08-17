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
export type RepeatUnit = 'day' | 'week';

export const REPEAT_LABELS: Record<FixedRepeatInterval, string> = {
  daily:         'Daglig',
  weekly:        'Ukentlig',
  monthly:       'Månedlig (samme dato)',
  'monthly-last': 'Månedlig (siste dag)',
};

const REPEAT_UNIT_LABEL: Record<RepeatUnit, string> = { day: 'dag', week: 'uke' };

// Visningstekst for 🔁-badgen — faste tekster for de fire opprinnelige,
// utledet "Hver X. dag/uke" for 'custom'. Norsk ordenstall-fraseologi
// ("hver 3. dag") bøyer ikke substantivet, så samme entallsform brukes
// uansett intervallverdi.
export function repeatLabel(item: { repeat?: RepeatInterval; repeatInterval?: number; repeatUnit?: RepeatUnit }): string | undefined {
  if (!item.repeat) return undefined;
  if (item.repeat === 'custom') {
    return `Hver ${item.repeatInterval ?? 1}. ${REPEAT_UNIT_LABEL[item.repeatUnit ?? 'day']}`;
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
}

function nextDeadline(deadline: string, repeat: RepeatInterval, repeatInterval?: number, repeatUnit?: RepeatUnit): string {
  // Always advance from the current deadline, not from today.
  // This preserves the schedule whether the task was completed early or late.
  const d = new Date(deadline + 'T00:00:00');

  switch (repeat) {
    case 'daily':
      d.setDate(d.getDate() + 1);
      break;
    case 'weekly':
      d.setDate(d.getDate() + 7);
      break;
    case 'monthly': {
      const dayOfMonth = d.getDate();
      d.setMonth(d.getMonth() + 1);
      // If that day doesn't exist in next month (e.g. Feb 30), use last day
      if (d.getDate() !== dayOfMonth) d.setDate(0);
      break;
    }
    case 'monthly-last':
      // Last day of next month
      d.setMonth(d.getMonth() + 2, 0);
      break;
    case 'custom':
      d.setDate(d.getDate() + (repeatInterval ?? 1) * (repeatUnit === 'week' ? 7 : 1));
      break;
  }

  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
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
          deadline:    nextDeadline(item.deadline, item.repeat, item.repeatInterval, item.repeatUnit),
          time:        item.time ?? null,
          done:        false,
          done_year:   null,
          overdue_days: 0,
          repeat:      item.repeat,
          repeat_interval: item.repeatInterval ?? null,
          repeat_unit:     item.repeatUnit ?? null,
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
