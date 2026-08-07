-- Run in Supabase SQL editor (after finance-migration.sql)

create table if not exists merchant_rules (
  merchant   text primary key,   -- lowercase normalized merchant key
  category   text not null,
  label      text,               -- display name (optional override)
  updated_at timestamptz default now()
);

-- Explicit grants (required for Data API access from May/October 2026)
grant select, insert, update, delete on public.merchant_rules to authenticated;

-- Row level security
alter table merchant_rules enable row level security;

create policy "authenticated_merchant_rules" on merchant_rules
  for all using (auth.role() = 'authenticated');
