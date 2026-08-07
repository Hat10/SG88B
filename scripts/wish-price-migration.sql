-- Run this in Supabase SQL editor

-- Deal flags on existing wishlist items (written by the daily cron /api/cron/rollover)
alter table wish_items add column if not exists deal_pct   int;      -- % below 30-day avg when at a 30-day low
alter table wish_items add column if not exists deal_avg30 numeric;  -- the 30-day average (for transparency)

-- Daily price history per wishlist item (one row per cron run per item)
create table if not exists wish_price_history (
  id         uuid primary key default gen_random_uuid(),
  item_id    uuid not null references wish_items(id) on delete cascade,
  price      numeric not null,
  checked_at timestamptz not null default now()
);

-- Explicit grants (required for Data API access from May/October 2026)
grant select, insert, update, delete on public.wish_price_history to authenticated;

-- Row level security
alter table wish_price_history enable row level security;

create policy "authenticated_wish_price_history" on wish_price_history
  for all using (auth.role() = 'authenticated');

-- Index for fast 30-day window queries
create index if not exists wish_price_history_item_checked_idx
  on wish_price_history(item_id, checked_at desc);

-- Enable realtime on wish_items so the Gangskjerm picks up deal flags live (no refresh).
-- Safe to re-run: ignores the error if the table is already in the publication.
do $$
begin
  alter publication supabase_realtime add table public.wish_items;
exception
  when duplicate_object then null;
end $$;
