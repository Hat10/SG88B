-- Trening: ren gjenoppbygging til kategori-modellen (02.08.2026)
--
-- ⚠️  DETTE SLETTER ALL TRENINGSDATA (økter, rekorder, mål, kategorier) og
--     bygger tabellene på nytt — tomme, bortsett fra de seks standardkategoriene.
--     Kjør i Supabase SQL editor. Legg inn dataene dine på nytt i appen etterpå.
--
-- Modellen: kategorien er enheten. En «avhuking» er én workout_sessions-rad med
-- started_at = completed_at (ingen varighet). En sammen-økt er to rader (én M,
-- én L) med delt session_group. De døde kolonnene fra den gamle øktmal-modellen
-- (template_id, template_name, extra_started_at, extra_minutes) og hele
-- workout_templates-tabellen er borte.
--
-- Hele skriptet kan trygt kjøres om igjen: det dropper alt først.

-- 1. Rydd bort alt gammelt. cascade fjerner fremmednøkler og publication-medlemskap.
drop table if exists public.workout_sessions   cascade;
drop table if exists public.workout_records    cascade;
drop table if exists public.workout_goals      cascade;
drop table if exists public.workout_templates  cascade;   -- øktmaler: helt utgått
drop table if exists public.workout_categories cascade;

-- 2. Kategorier — det man huker av på.
create table public.workout_categories (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  color      text,                 -- hex; null ⇒ appen bruker CSS-var/--cat-none
  sort_order int not null default 0,
  archived   boolean not null default false,
  created_at timestamptz default now()
);

-- 3. Økter — én rad per avhuking. started_at = completed_at = tidspunktet.
create table public.workout_sessions (
  id            uuid primary key default gen_random_uuid(),
  category      text not null,
  who           text not null check (who in ('M','L')),
  session_group uuid,                       -- delt av de to radene i en sammen-økt
  started_at    timestamptz not null default now(),
  completed_at  timestamptz,               -- settes = started_at ved registrering
  note          text,                       -- valgfritt fritekstnotat om økta
  created_at    timestamptz default now()
);

-- 4. Personlige rekorder.
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

-- 5. Mål. hours_year/minutes_week beholdes i constrainten — koden regner dem
--    fortsatt ut, appen skjuler dem bare for nye mål.
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

-- 6. RLS + policyer. Delt konto: alle innloggede har full tilgang.
alter table public.workout_categories enable row level security;
alter table public.workout_sessions   enable row level security;
alter table public.workout_records     enable row level security;
alter table public.workout_goals       enable row level security;

create policy "authenticated_workout_categories_all" on public.workout_categories
  for all using (auth.role() = 'authenticated');
create policy "authenticated_workout_sessions_all" on public.workout_sessions
  for all using (auth.role() = 'authenticated');
create policy "authenticated_workout_records_all" on public.workout_records
  for all using (auth.role() = 'authenticated');
create policy "authenticated_workout_goals_all" on public.workout_goals
  for all using (auth.role() = 'authenticated');

grant select, insert, update, delete on public.workout_categories to authenticated;
grant select, insert, update, delete on public.workout_sessions   to authenticated;
grant select, insert, update, delete on public.workout_records    to authenticated;
grant select, insert, update, delete on public.workout_goals      to authenticated;

-- 7. Indekser.
create index workout_sessions_started_idx on public.workout_sessions(started_at desc);
create index workout_sessions_group_idx   on public.workout_sessions(session_group);
create index workout_records_exercise_idx on public.workout_records(exercise, who, date desc);

-- 8. Realtime — endringer vises på begge telefonene med én gang.
alter publication supabase_realtime add table public.workout_categories;
alter publication supabase_realtime add table public.workout_sessions;
alter publication supabase_realtime add table public.workout_records;
alter publication supabase_realtime add table public.workout_goals;

-- 9. De seks standardkategoriene (color = null ⇒ tema-bevisste CSS-farger).
--    Alt annet er tomt — legg inn økter/rekorder/mål manuelt i appen.
insert into public.workout_categories (name, sort_order) values
  ('Push', 0), ('Pull', 1), ('Legs', 2),
  ('Fullkropp', 3), ('Overkropp', 4), ('Cardio', 5);
