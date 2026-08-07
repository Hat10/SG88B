-- Startbeløp for investeringer — kjøres i Supabase SQL editor. ALLEREDE KJØRT
-- 21.07.2026; ligger her som dokumentasjon av skjemaet.
--
-- Transaksjonene (kind = 'investment') forteller hvor mye som er SATT INN og
-- TATT UT etter at sporingen startet. Det de ikke kan vite er hva som allerede
-- sto der før den første importerte transaksjonen. Det tallet registreres én
-- gang i Investering-fanen og lagres som ÉN rad her:
--
--   month = '0000-00', account = 'start'
--
-- Tabellen ble opprinnelig laget for månedlige markedsverdier (én rad per måned
-- og konto). Den idéen ble forkastet — den krevde manuell føring hver måned —
-- så kolonnene er generelle, men appen bruker og leser bare start-raden.

create table if not exists public.investment_values (
  id         uuid primary key default gen_random_uuid(),
  month      text        not null,               -- 'YYYY-MM'
  account    text        not null default 'Totalt',  -- Kron, Nordnet, BSU … eller 'Totalt'
  value      numeric     not null default 0,     -- markedsverdi ved månedsslutt
  note       text,
  updated_at timestamptz not null default now(),
  unique (month, account)
);

-- Explicit grants (required for Data API access from May/October 2026)
grant select, insert, update, delete on public.investment_values to authenticated;

alter table public.investment_values enable row level security;

drop policy if exists "authenticated_investment_values" on public.investment_values;
create policy "authenticated_investment_values" on public.investment_values
  for all using (auth.role() = 'authenticated');

create index if not exists investment_values_month_idx on public.investment_values(month);
