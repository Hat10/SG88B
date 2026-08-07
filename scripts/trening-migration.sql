-- Trening — øktmaler, økter, rekorder og mål
-- Kjør denne i Supabase SQL editor før Trening-siden tas i bruk.

drop table if exists public.workout_sessions cascade;
drop table if exists public.workout_records  cascade;
drop table if exists public.workout_goals    cascade;
drop table if exists public.workout_templates cascade;

-- Øktmaler ("Push A", "Pull A", …). exercises = ["Benk", "Skulderpress", …]
-- Bare navn: sett og reps loggføres aldri, lista er en huskeliste for hva økta
-- inneholder. Varigheten kommer fra workout_sessions.
-- rotation_position: plassen i den valgte rekkefølgen, eller null for maler som
-- står utenfor og bare velges manuelt. Rekkefølgen settes opp i appen.
create table public.workout_templates (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,
  category          text not null,
  exercises         jsonb not null default '[]'::jsonb,
  sort_order        int  not null default 0,
  rotation_position int,
  created_at        timestamptz default now()
);

-- Én rad per gjennomført (eller pågående) økt — også når de trener sammen: da
-- lages det én M-rad og én L-rad med samme started_at og samme session_group,
-- så historikk og statistikk teller det som om hver av dem loggførte det selv.
-- completed_at is null  ⇒  økta løper akkurat nå.
-- template_name er en kopi, så historikken overlever at malen slettes.
-- session_group is null  ⇒  vanlig solo-økt; ellers knytter den sammen-øktas to rader.
create table public.workout_sessions (
  id            uuid primary key default gen_random_uuid(),
  template_id   uuid references public.workout_templates(id) on delete set null,
  template_name text not null,
  category      text not null default '',
  who           text not null check (who in ('M','L')),
  session_group uuid,
  started_at    timestamptz not null default now(),
  completed_at  timestamptz,
  created_at    timestamptz default now()
);

-- Bare én pågående økt per person om gangen.
create unique index workout_sessions_one_active
  on public.workout_sessions(who) where completed_at is null;

-- Personlige rekorder. unit = 'kg' eller 'reps'.
create table public.workout_records (
  id         uuid primary key default gen_random_uuid(),
  exercise   text not null,
  who        text not null check (who in ('M','L')),
  value      numeric not null,
  unit       text not null default 'kg' check (unit in ('kg','reps')),
  date       date not null default current_date,
  target     numeric,
  created_at timestamptz default now()
);

-- Mål. Progresjonen regnes ut i appen ut fra kind:
--   sessions_year  — antall økter hittil i år
--   sessions_month — antall økter i inneværende måned
--   sessions_total — antall økter noensinne
--   hours_year     — målt tid hittil i år, i timer
--   minutes_week   — målt tid denne uka, i minutter
--   together_week  — dager denne uka der begge trente
--   weekly_streak  — uker på rad med minst én økt
--   record         — nå en gitt verdi i en øvelse («55 kg benkpress»)
-- Rekordmål leser progresjonen fra workout_records via exercise + unit.
-- deadline er valgfri: null betyr at målet står til det er nådd.
-- (Er basen satt opp før 24.07.2026: kjør scripts/trening-goals-migration.sql
--  i stedet — den legger til det samme uten å slette noe.)
create table public.workout_goals (
  id         uuid primary key default gen_random_uuid(),
  title      text not null,
  who        text not null default 'f' check (who in ('f','M','L')),
  kind       text not null check (kind in (
               'sessions_year','sessions_month','sessions_total','hours_year',
               'minutes_week','together_week','weekly_streak','record')),
  target     numeric not null,
  exercise   text,
  unit       text check (unit is null or unit in ('kg','reps')),
  deadline   date,
  created_at timestamptz default now(),
  constraint workout_goals_record_check check (
    (kind =  'record' and exercise is not null and unit is not null) or
    (kind <> 'record' and exercise is null     and unit is null)
  )
);

alter table public.workout_templates enable row level security;
alter table public.workout_sessions  enable row level security;
alter table public.workout_records   enable row level security;
alter table public.workout_goals     enable row level security;

create policy "authenticated_workout_templates_all" on public.workout_templates
  for all using (auth.role() = 'authenticated');
create policy "authenticated_workout_sessions_all" on public.workout_sessions
  for all using (auth.role() = 'authenticated');
create policy "authenticated_workout_records_all" on public.workout_records
  for all using (auth.role() = 'authenticated');
create policy "authenticated_workout_goals_all" on public.workout_goals
  for all using (auth.role() = 'authenticated');

grant select, insert, update, delete on public.workout_templates to authenticated;
grant select, insert, update, delete on public.workout_sessions  to authenticated;
grant select, insert, update, delete on public.workout_records   to authenticated;
grant select, insert, update, delete on public.workout_goals     to authenticated;

create index workout_sessions_started_idx  on public.workout_sessions(started_at desc);
create index workout_sessions_template_idx on public.workout_sessions(template_id);
create index workout_records_exercise_idx  on public.workout_records(exercise, who, date desc);

-- Realtime, så Start/Fullfør vises på begge telefonene med én gang.
alter publication supabase_realtime add table public.workout_templates;
alter publication supabase_realtime add table public.workout_sessions;
alter publication supabase_realtime add table public.workout_records;
alter publication supabase_realtime add table public.workout_goals;

-- Ingen startdata med vilje: Mikkel og Leah lager sine egne øktmaler og mål
-- i appen. Tabellene skal være helt tomme etter at dette skriptet er kjørt.
