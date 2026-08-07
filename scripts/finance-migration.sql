-- Run this in Supabase SQL editor

create table if not exists finance_imports (
  id          uuid primary key default gen_random_uuid(),
  source      text not null,       -- 'bank_M' | 'bank_L' | 'trumf'
  month       text not null,       -- '2026-05'
  filename    text,
  imported_at timestamptz default now(),
  row_count   int
);

create table if not exists transactions (
  id                 uuid primary key default gen_random_uuid(),
  import_id          uuid references finance_imports(id) on delete cascade,
  date               date not null,
  description        text not null,
  amount             numeric not null,  -- negative = expense, positive = income
  source             text not null,     -- 'bank_M' | 'bank_L' | 'trumf'
  category           text not null default 'annet',
  category_confirmed boolean default false,
  month              text not null,     -- '2026-05'
  raw_description    text
);

-- Explicit grants (required for Data API access from May/October 2026)
grant select, insert, update, delete on public.finance_imports to authenticated;
grant select, insert, update, delete on public.transactions     to authenticated;

-- Row level security
alter table finance_imports enable row level security;
alter table transactions     enable row level security;

create policy "authenticated_imports" on finance_imports
  for all using (auth.role() = 'authenticated');

create policy "authenticated_transactions" on transactions
  for all using (auth.role() = 'authenticated');

-- Index for fast month queries
create index if not exists transactions_month_idx on transactions(month);
create index if not exists transactions_source_idx on transactions(source);
