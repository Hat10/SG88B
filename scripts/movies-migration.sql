-- Filmoversikt: filmer og serier vi vil se / har sett, hvem som må være med, og
-- stjerne-rating per person. Erstatter Excel-arket.
--
-- who-koder: 'M' = Andreas, 'L' = Taran (kolonnene must_m/must_l, rating_m/rating_l,
-- added_by). I UI vises alltid navnene.
--
-- watched_at is null  ⇒  «Vil se»;  not null  ⇒  «Sett».
-- Unik indeks på (lower(title), kind): samme tittel kan ikke ligge to ganger
-- (case-insensitivt) innenfor samme type. Appen viser «Finnes allerede» og
-- håndterer unique-violation (23505) ved samtidig innlegging.
-- tmdb_id / poster_url / year kan legges til senere med `add column if not exists`.
--
-- MÅ KJØRES MANUELT i Supabase SQL Editor, FØR movies-seed-migration.sql.
-- Trygt å kjøre flere ganger.

create table if not exists public.movies (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  kind        text not null default 'film' check (kind in ('film','serie')),
  must_m      boolean not null default false,   -- Andreas må være med
  must_l      boolean not null default false,   -- Taran må være med
  watched_at  date,
  rating_m    smallint check (rating_m between 1 and 5),   -- Andreas
  rating_l    smallint check (rating_l between 1 and 5),   -- Taran
  note        text,
  added_by    text check (added_by in ('M','L')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create unique index if not exists movies_title_kind_uniq
  on public.movies (lower(title), kind);

alter table public.movies enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'movies' and policyname = 'authenticated_movies_all'
  ) then
    create policy "authenticated_movies_all" on public.movies
      for all using (auth.role() = 'authenticated');
  end if;
end $$;

-- Eksplisitte grants (service_role får ikke rettigheter automatisk)
grant select, insert, update, delete on public.movies to authenticated;
grant select, insert, update, delete on public.movies to service_role;

-- Realtime, slik at endringer på den ene telefonen vises på den andre.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'movies'
  ) then
    alter publication supabase_realtime add table public.movies;
  end if;
end $$;
