-- Bytter nedtelling fra én verdi lagret i settings (key='countdown') til en
-- liste med egen tabell, slik at flere nedtellinger kan finnes samtidig
-- (forberedelse for swipe-mellom-dem på Gangskjerm i en senere økt — selve
-- swipen bygges ikke her). Gangskjerm og Hjem-siden viser foreløpig kun den
-- første (nærmeste) nedtellingen.
--
-- Kjør i Supabase SQL editor.

create table public.countdowns (
  id          uuid primary key default gen_random_uuid(),
  label       text not null,
  date        date not null,
  created_at  timestamptz default now()
);

alter table public.countdowns enable row level security;
create policy "authenticated_countdowns_all" on public.countdowns
  for all using (auth.role() = 'authenticated');
grant select, insert, update, delete on public.countdowns to authenticated;
alter publication supabase_realtime add table public.countdowns;

create index countdowns_date_idx on public.countdowns (date);

-- Flytt en eventuell eksisterende enkelt-nedtelling fra settings over til den
-- nye tabellen, så du ikke mister Kina-tur-nedtellingen ved overgangen.
insert into public.countdowns (label, date)
select (value->>'label')::text, (value->>'date')::date
from public.settings
where key = 'countdown' and value ? 'label' and value ? 'date';

delete from public.settings where key = 'countdown';
