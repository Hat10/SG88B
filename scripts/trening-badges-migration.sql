-- Trening: badges (milepæler for begge)
--
-- earned_badges registrerer NÅR en badge faktisk ble låst opp — selve
-- definisjonen av hver badge (nøkkel, terskel, ikon, tekst) bor i koden
-- (BADGE_DEFS i Trening.tsx), ikke i basen. unique(who, badge_key) gjør
-- innsettingen idempotent: `insert ... on conflict do nothing` er trygt å
-- kjøre på nytt, og gir oss gratis en garanti for at samme badge aldri låses
-- opp — og dermed aldri feires — to ganger for samme person.
--
-- Additiv og idempotent — trygt å kjøre om igjen. Ingenting slettes.

create table if not exists public.earned_badges (
  id          uuid primary key default gen_random_uuid(),
  who         text not null check (who in ('M','L')),
  badge_key   text not null,
  earned_at   timestamptz not null default now(),
  unique (who, badge_key)
);

alter table public.earned_badges enable row level security;
create policy "authenticated_earned_badges_all" on public.earned_badges
  for all using (auth.role() = 'authenticated');
grant select, insert, update, delete on public.earned_badges to authenticated;
alter publication supabase_realtime add table public.earned_badges;
