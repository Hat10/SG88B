-- Filmoversikt ↔ TMDB (themoviedb.org): kobling og minimal lagring av filmdata.
--
-- MÅ KJØRES MANUELT i Supabase SQL Editor (etter movies-migration.sql).
-- Trygt å kjøre flere ganger (idempotent).
--
-- Hva som lagres (bare det listevisningen trenger):
--   tmdb_id, tmdb_kind ('movie' | 'tv'), poster_path, release_year,
--   runtime_min (film: spilletid; serie: typisk episodelengde), genres (norske navn),
--   overview, tmdb_synced_at.
-- Skuespillere og strømmetjenester lagres IKKE; de hentes ferskt via /api/tmdb
-- når popupen åpnes.
--
-- TMDB-vilkårene tillater ikke mellomlagring i mer enn 6 måneder. Appen frisker
-- derfor opp feltene (tmdb_synced_at) når popupen åpnes og dataene er eldre enn
-- 30 dager, og «Koble filmer til TMDB» frisker opp alt som er eldre enn 5 måneder.
--
-- `title` er brukerens egen tittel og endres aldri automatisk av TMDB-koblingen.
-- Appen tåler at denne filen ikke er kjørt ennå (lesing virker; TMDB-felt lagres ikke).

alter table public.movies add column if not exists tmdb_id        integer;
alter table public.movies add column if not exists tmdb_kind      text;
alter table public.movies add column if not exists poster_path    text;
alter table public.movies add column if not exists release_year   smallint;
alter table public.movies add column if not exists runtime_min    smallint;
alter table public.movies add column if not exists genres         text[];
alter table public.movies add column if not exists overview       text;
alter table public.movies add column if not exists tmdb_synced_at timestamptz;

-- tmdb_kind: 'movie' eller 'tv', og satt hvis og bare hvis tmdb_id er satt.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'movies_tmdb_kind_check' and conrelid = 'public.movies'::regclass
  ) then
    alter table public.movies add constraint movies_tmdb_kind_check
      check (
        (tmdb_id is null and tmdb_kind is null)
        or (tmdb_id is not null and tmdb_kind in ('movie', 'tv'))
      );
  end if;
end $$;

-- Samme TMDB-tittel kan ikke kobles til to rader.
create unique index if not exists movies_tmdb_uniq
  on public.movies (tmdb_kind, tmdb_id)
  where tmdb_id is not null;

-- «The Bear» ble seedet som film, men er en serie. Rettes bare hvis det ikke
-- allerede finnes en serie med samme tittel (unik indeks på (lower(title), kind)).
update public.movies m
set kind = 'serie', updated_at = now()
where lower(m.title) = 'the bear'
  and m.kind = 'film'
  and not exists (
    select 1 from public.movies s
    where lower(s.title) = 'the bear' and s.kind = 'serie'
  );

-- Grants gjentas (gjelder hele tabellen, også nye kolonner). Ufarlig å kjøre på nytt.
grant select, insert, update, delete on public.movies to authenticated;
grant select, insert, update, delete on public.movies to service_role;

-- Verifisering (kjør etterpå):
-- select column_name, data_type from information_schema.columns
--   where table_schema = 'public' and table_name = 'movies' and column_name like any (array['tmdb%','poster_path','release_year','runtime_min','genres','overview']);
-- select title, kind from public.movies where lower(title) = 'the bear';  -- forventet: serie
