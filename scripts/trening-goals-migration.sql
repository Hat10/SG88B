-- Trening — flere måltyper enn «økter i år»
--
-- Kjør denne i Supabase SQL editor ETTER trening-migration.sql. Den er additiv:
-- eksisterende mål beholdes uendret (de får exercise/unit/deadline = null, som
-- betyr «rekordløst mål uten frist» — nøyaktig slik de oppførte seg før).
--
-- Nytt her:
--   exercise/unit — for kind='record': «55 kg benkpress». Progresjonen leses
--                   fra workout_records, så et rekordmål og en loggført rekord
--                   er samme tall to steder.
--   deadline      — valgfri frist. null = målet står til det er nådd.
--   target        — numeric i stedet for int, så 57,5 kg er et lovlig mål.

alter table public.workout_goals
  add column if not exists exercise text,
  add column if not exists unit     text,
  add column if not exists deadline date;

alter table public.workout_goals
  alter column target type numeric;

-- Måltypene appen regner ut. Constrainten heter det Postgres kaller den når den
-- lages inline i create table.
alter table public.workout_goals drop constraint if exists workout_goals_kind_check;
alter table public.workout_goals add constraint workout_goals_kind_check
  check (kind in (
    'sessions_year',   -- fullførte økter hittil i år
    'sessions_month',  -- fullførte økter i inneværende måned
    'sessions_total',  -- fullførte økter noensinne
    'hours_year',      -- målt tid hittil i år, i timer
    'minutes_week',    -- målt tid denne uka, i minutter
    'together_week',   -- dager denne uka der begge trente
    'weekly_streak',   -- uker på rad med minst én økt
    'record'           -- nå en gitt verdi i en øvelse
  ));

alter table public.workout_goals drop constraint if exists workout_goals_unit_check;
alter table public.workout_goals add constraint workout_goals_unit_check
  check (unit is null or unit in ('kg','reps'));

-- Et rekordmål uten øvelse er ikke målbart; en øvelse på et øktmål er støy.
alter table public.workout_goals drop constraint if exists workout_goals_record_check;
alter table public.workout_goals add constraint workout_goals_record_check
  check (
    (kind =  'record' and exercise is not null and unit is not null) or
    (kind <> 'record' and exercise is null     and unit is null)
  );
