-- ============================================================================
-- RECONSTRUCTED SCHEMA — Felles / SG88B
-- ============================================================================
-- backups/schema.sql (the real pg_dump snapshot) was permanently deleted.
-- This file is a best-effort RECONSTRUCTION, not an authoritative dump. It
-- was assembled by reading every migration script in scripts/ and cross-
-- checking column usage in the TypeScript context/page code that talks to
-- Supabase. It does NOT include the `ratings` / `rating_categories` tables
-- (Ratinger was removed from the app), the `categories` / `snapshots`
-- portfolio-tracker tables from scripts/portfolio-import.sql (unused,
-- excluded), or the `kalender` domain (calendar events are fetched live
-- from external iCal feeds via CAL_* env vars — nothing is persisted, so
-- there is no table to reconstruct).
--
-- Legend used in comments below:
--   [CONFIRMED]  — taken directly from an actual CREATE/ALTER TABLE in
--                   scripts/, or from a fragment of the real backups/schema.sql
--                   that was read earlier in this session before it was deleted.
--   [INFERRED]   — no migration script ever created this table (it was set up
--                   directly in the Supabase UI). Reconstructed purely from
--                   how the app's TypeScript code selects/inserts/updates it.
--                   Nullability, exact defaults, and whether a CHECK constraint
--                   really exists in the DB are best-effort guesses — verify
--                   against the live database (Supabase Studio → Table Editor,
--                   or `supabase db dump --schema-only`) before trusting this
--                   for anything destructive.
--
-- RLS / policy / grant / realtime statements are inlined right after each
-- table's CREATE TABLE below (a deliberate departure from how the original
-- migration scripts group these by category at the end of the file — for a
-- reference document, keeping each table self-contained is more useful).
-- Policy names match the real ones exactly where a migration script (or a
-- fragment of the deleted backups/schema.sql) confirms them; tables with no
-- migration script use the dominant "authenticated_<table>_all" convention
-- seen in the newest scripts (trening-rebuild.sql). Realtime (`alter
-- publication supabase_realtime add table ...`) is only added for tables a
-- context/hook actually subscribes to via `supabase.channel(...).on(
-- 'postgres_changes', ...)` — confirmed by grepping every such call in
-- src/contexts and src/hooks, not guessed.
--
-- Several older migration scripts are SUPERSEDED by later ones in scripts/
-- and are deliberately NOT represented here (see "Superseded / obsolete"
-- section at the bottom for the full list and why).
-- ============================================================================


-- ============================================================================
-- DOMAIN: Økonomi / Forbruk (Okonomi.tsx, FinanceContext, CategoryContext)
-- ============================================================================

-- [CONFIRMED] scripts/import-v2-migration.sql — no realtime subscription in
-- app code, so none added (matches the original script exactly).
create table public.finance_imports (
  id             uuid primary key default gen_random_uuid(),
  source         text not null,        -- 'bank_M' | 'bank_L' | 'trumf'
  month          text not null,        -- 'YYYY-MM', dominant month of the import
  filename       text,
  file_hash      text,                 -- sha-256 of file bytes, re-import detection
  row_count      int,
  skipped_count  int,
  imported_at    timestamptz default now()
);

alter table public.finance_imports enable row level security;
create policy "authenticated_finance_imports" on public.finance_imports
  for all using (auth.role() = 'authenticated');
grant select, insert, update, delete on public.finance_imports to authenticated;

-- [CONFIRMED] scripts/import-v2-migration.sql — no realtime subscription.
create table public.merchants (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  category    text not null default 'annet',   -- soft-FK to spending_categories.key
  kind        text not null default 'merchant'
              check (kind in ('merchant','person','internal','settlement','intermediary')),
  created_at  timestamptz default now()
);

alter table public.merchants enable row level security;
create policy "authenticated_merchants" on public.merchants
  for all using (auth.role() = 'authenticated');
grant select, insert, update, delete on public.merchants to authenticated;

create unique index merchants_name_uniq on public.merchants (lower(name));

-- [CONFIRMED] scripts/import-v2-migration.sql — no realtime subscription.
create table public.merchant_aliases (
  alias        text primary key,
  merchant_id  uuid not null references public.merchants(id) on delete cascade,
  created_at   timestamptz default now()
);

alter table public.merchant_aliases enable row level security;
create policy "authenticated_merchant_aliases" on public.merchant_aliases
  for all using (auth.role() = 'authenticated');
grant select, insert, update, delete on public.merchant_aliases to authenticated;

create index merchant_aliases_merchant_idx on public.merchant_aliases (merchant_id);

-- [CONFIRMED] scripts/import-v2-migration.sql, kind CHECK widened by
-- scripts/investment-kind-migration.sql (this is the FINAL constraint) — no
-- realtime subscription.
create table public.transactions (
  id                  uuid primary key default gen_random_uuid(),
  import_id           uuid references public.finance_imports(id) on delete cascade,
  date                date not null,
  description         text not null,          -- denormalized merchant name for display
  merchant_id         uuid references public.merchants(id) on delete set null,
  amount              numeric not null,        -- negative = expense, positive = income
  -- [INFERRED] no CHECK found in any script; app also writes 'felles' (updateOwner
  -- in Okonomi.tsx) even though the original migration comment only mentions
  -- bank_M/bank_L/trumf. Left unconstrained here to match observed reality —
  -- add a CHECK only after confirming the live column has none.
  source              text not null,          -- 'bank_M' | 'bank_L' | 'trumf' | 'felles'
  category            text not null default 'annet',  -- soft-FK to spending_categories.key
  category_confirmed  boolean default false,
  kind                text not null default 'purchase'
                      check (kind in ('purchase','refund','income','investment','internal','card_settlement','p2p')),
  month               text not null,           -- 'YYYY-MM'
  raw_description     text,                    -- bank's original text, never edited
  note                text,
  meta                jsonb,                   -- TxMeta: channel, reference, aliasKey, intermediary, currency/rate...
  fingerprint         text                     -- hash of date|amount|raw_description, for dedup
);

alter table public.transactions enable row level security;
create policy "authenticated_transactions" on public.transactions
  for all using (auth.role() = 'authenticated');
grant select, insert, update, delete on public.transactions to authenticated;

create index transactions_month_idx       on public.transactions (month);
create index transactions_source_idx      on public.transactions (source);
create index transactions_fingerprint_idx on public.transactions (fingerprint);
create index transactions_merchant_idx    on public.transactions (merchant_id);

-- [CONFIRMED] scripts/spending-categories-migration.sql. That script only
-- creates the RLS policy (via a `do $$ if not exists` guard) and grant — it
-- does NOT add this table to the realtime publication, yet CategoryContext.tsx
-- subscribes to it (`.channel('spending_categories_changes')`). Added below
-- so the reconstructed schema actually matches what the app needs to work.
create table public.spending_categories (
  key         text primary key,
  label       text not null,
  color       text not null default '#9E9E9E',
  sort_order  int not null default 100,
  is_system   boolean not null default false,
  created_at  timestamptz default now()
);

alter table public.spending_categories enable row level security;
create policy "authenticated_spending_categories" on public.spending_categories
  for all using (auth.role() = 'authenticated');
grant select, insert, update, delete on public.spending_categories to authenticated;
alter publication supabase_realtime add table public.spending_categories;

-- [CONFIRMED] scripts/spending-categories-migration.sql — exact seed data.
-- sort_order intentionally skips 17: that slot is conceptually reserved for
-- 'overføring' (internal transfers), which is deliberately NOT seeded here —
-- transfers aren't a user-pickable spending category, even though import/
-- classify code still tags rows with that key.
insert into public.spending_categories (key, label, color, sort_order, is_system) values
  ('dagligvarer', 'Dagligvarer',        '#5B9BD5',  0, true),
  ('kiosk',       'Kiosk',              '#7BC4C4',  1, true),
  ('kafé',        'Kafé & Restaurant',  '#F4A261',  2, true),
  ('hjem',        'Hjem & Bygg',        '#8BC34A',  3, true),
  ('klær',        'Klær & Shopping',    '#C97A8B',  4, true),
  ('transport',   'Transport',          '#7B68EE',  5, true),
  ('abonnement',  'Abonnementer',       '#FF8C00',  6, true),
  ('forsikring',  'Forsikring',         '#4A80C4',  7, true),
  ('trening',     'Trening',            '#26A69A',  8, true),
  ('velvære',     'Velvære',            '#B39DDB',  9, true),
  ('helse',       'Helse & Apotek',     '#EC407A', 10, true),
  ('utdanning',   'Utdanning & læring', '#5C6BC0', 11, true),
  ('bolig',       'Bolig & Strøm',      '#A0856A', 12, true),
  ('arrangement', 'Arrangementer',      '#AB47BC', 13, true),
  ('gambling',    'Gambling',           '#D32F2F', 14, true),
  ('reise',       'Reise',              '#26C6DA', 15, true),
  ('finans',      'Finans & Skatt',     '#78909C', 16, true),
  ('inntekt',     'Inntekt',            '#66BB6A', 18, true),
  ('investering', 'Investering',        '#FFD700', 19, true),
  ('annet',       'Annet',              '#9E9E9E', 20, true)
on conflict (key) do nothing;

-- [CONFIRMED] scripts/investment-values-migration.sql — no realtime subscription.
-- Design note (from the script's own comment): originally meant for monthly
-- market-value snapshots per account, but that idea was abandoned. In
-- practice the app writes exactly ONE row: month='0000-00', account='start'
-- (the pre-tracking baseline). Columns remain general-purpose but unused
-- beyond that single row today.
create table public.investment_values (
  id          uuid primary key default gen_random_uuid(),
  month       text not null default '0000-00',   -- 'YYYY-MM', or sentinel '0000-00'
  account     text not null default 'Totalt',    -- e.g. Kron, Nordnet, BSU, or sentinel 'start'
  value       numeric not null default 0,
  note        text,
  updated_at  timestamptz not null default now(),
  unique (month, account)
);

alter table public.investment_values enable row level security;
create policy "authenticated_investment_values" on public.investment_values
  for all using (auth.role() = 'authenticated');
grant select, insert, update, delete on public.investment_values to authenticated;

create index investment_values_month_idx on public.investment_values (month);

-- [INFERRED] No CREATE TABLE exists anywhere in scripts/ — only
-- scripts/asset-classes-migration.sql ALTERs it (adding the 4 asset-class
-- columns), proving it predates every script in this repo. Reconstructed
-- from FinanceContext.tsx's select('*')/upsert(...) shape. Used by the Hus
-- page for monthly per-person net-worth entries — NOT shared with any other
-- domain table. FinanceContext.tsx subscribes to it
-- (`.channel('finance_entries_changes')`), so realtime is added below.
create table public.finance_entries (
  id          uuid primary key default gen_random_uuid(),
  who         text not null check (who in ('M','L')),   -- no 'f' option observed here
  month       text not null,          -- 'Jan 26' style (3-letter month + 2-digit year) —
                                       -- NOT the same 'YYYY-MM' format as transactions.month
  -- [CONFIRMED] scripts/asset-classes-migration.sql
  eiendom     numeric not null default 0,
  aksjefond   numeric not null default 0,
  rentefond   numeric not null default 0,
  annet       numeric not null default 0,
  -- [INFERRED] pre-migration legacy total; app now always writes it as the
  -- sum of the 4 asset-class columns above ("kept so nothing else breaks")
  assets      numeric not null default 0,
  bolig_laan  numeric not null default 0,    -- mortgage / home loan
  annet_laan  numeric not null default 0,    -- other loans
  salary      numeric not null default 0,
  created_at  timestamptz default now(),
  unique (who, month)
);

alter table public.finance_entries enable row level security;
create policy "authenticated_finance_entries_all" on public.finance_entries
  for all using (auth.role() = 'authenticated');
grant select, insert, update, delete on public.finance_entries to authenticated;
alter publication supabase_realtime add table public.finance_entries;

-- [INFERRED] Generic shared key/value settings store — no migration script.
-- Used by Hus (hus_goal, lb_prognose, lb_prognose_history, bp_params) and by
-- the weekly-bucket-reminder cron (weekly_bucket) — not finance-specific,
-- just documented here since finance_entries and Hus share this file.
-- Subscribed to by useHusGoal.ts, useHusPrognose.ts, useHusPrognoseHistory.ts,
-- useBuyingPowerParams.ts and useWeeklyBucket.ts (each filters by `key`), so
-- realtime is added below.
create table public.settings (
  key    text primary key,
  value  jsonb
);

alter table public.settings enable row level security;
create policy "authenticated_settings_all" on public.settings
  for all using (auth.role() = 'authenticated');
grant select, insert, update, delete on public.settings to authenticated;
alter publication supabase_realtime add table public.settings;

-- Known keys (documentation only, not schema):
--   hus_goal            → number (house savings goal)
--   lb_prognose         → object {savings, salaryGrowth, returns, horizonYears, ...}
--   lb_prognose_history → array of frozen year-end snapshots
--   bp_params           → object {loanMultiple, equityPct}
--   weekly_bucket       → cron state for the weekly random Bucket-item pick


-- ============================================================================
-- DOMAIN: Trening (TreningContext, treningPulse.ts, Trening.tsx)
-- ============================================================================
-- Current live model is the CATEGORY-based one from scripts/trening-rebuild.sql,
-- layered with scripts/trening-note-migration.sql.
-- scripts/trening-muskelgrupper-migration.sql (muscle_groups column) was
-- later reverted by scripts/trening-fjern-muskelgrupper-migration.sql — see
-- "Superseded" section. scripts/trening-tillegg-migration.sql
-- (extra_started_at/extra_minutes, a "continue session" feature) is
-- deliberately NOT applied here — see "Superseded" section; it'll come back
-- as its own properly-wired task later.
-- The original TEMPLATE-based model from scripts/trening-migration.sql /
-- scripts/trening-goals-migration.sql (workout_templates table, template_id/
-- template_name on sessions) was fully replaced — see "Superseded" section.
-- earned_badges (scripts/trening-badges-migration.sql) was added later, for
-- the badge system — same realtime-subscription pattern as the other four.
-- All five tables below are subscribed to by TreningContext.tsx via a single
-- `.channel('trening_realtime')`, confirmed by scripts/trening-rebuild.sql
-- (four of five) and scripts/trening-badges-migration.sql (the fifth).

-- [CONFIRMED] scripts/trening-rebuild.sql
create table public.workout_categories (
  id             uuid primary key default gen_random_uuid(),
  name           text not null unique,
  color          text,
  sort_order     int not null default 0,
  archived       boolean not null default false,
  created_at     timestamptz default now()
);

alter table public.workout_categories enable row level security;
create policy "authenticated_workout_categories_all" on public.workout_categories
  for all using (auth.role() = 'authenticated');
grant select, insert, update, delete on public.workout_categories to authenticated;
alter publication supabase_realtime add table public.workout_categories;

-- [CONFIRMED] Base 6 rows from scripts/trening-rebuild.sql (name, sort_order).
insert into public.workout_categories (name, sort_order) values
  ('Push',       0),
  ('Pull',       1),
  ('Legs',       2),
  ('Fullkropp',  3),
  ('Overkropp',  4),
  ('Cardio',     5)
on conflict (name) do nothing;

-- [CONFIRMED] scripts/trening-rebuild.sql, extended by
-- scripts/trening-note-migration.sql (note — already present in rebuild,
-- the later script is a harmless idempotent no-op).
--
-- NOTE: extra_started_at/extra_minutes (a "continue session" / tillegg-tid
-- feature from scripts/trening-tillegg-migration.sql) are deliberately
-- excluded for now — treningPulse.ts still has calculation logic for them,
-- but TreningContext.tsx never reads/writes them, so wiring them back in
-- properly (a real "fortsett økt" feature) is its own future task.
--
-- session_group (the "Sammen"/shared-session column) is also excluded: the
-- Sammen feature was removed from the app entirely (UI, context logic, and
-- the treningPulse.ts rule family it powered) rather than deferred.
create table public.workout_sessions (
  id             uuid primary key default gen_random_uuid(),
  category       text not null,          -- denormalized copy of workout_categories.name,
                                          -- no FK — deleting a category doesn't touch history
  who            text not null check (who in ('M','L')),
  started_at     timestamptz not null default now(),
  completed_at   timestamptz,            -- always = started_at in current model
  note           text,
  created_at     timestamptz default now()
);

alter table public.workout_sessions enable row level security;
create policy "authenticated_workout_sessions_all" on public.workout_sessions
  for all using (auth.role() = 'authenticated');
grant select, insert, update, delete on public.workout_sessions to authenticated;
alter publication supabase_realtime add table public.workout_sessions;

create index workout_sessions_started_idx on public.workout_sessions (started_at desc);

-- [CONFIRMED] scripts/trening-migration.sql, recreated identically by rebuild
create table public.workout_records (
  id          uuid primary key default gen_random_uuid(),
  exercise    text not null,
  who         text not null check (who in ('M','L')),
  value       numeric not null,
  unit        text not null default 'kg' check (unit in ('kg','reps')),
  date        date not null default current_date,
  target      numeric,
  created_at  timestamptz default now()
);

alter table public.workout_records enable row level security;
create policy "authenticated_workout_records_all" on public.workout_records
  for all using (auth.role() = 'authenticated');
grant select, insert, update, delete on public.workout_records to authenticated;
alter publication supabase_realtime add table public.workout_records;

create index workout_records_exercise_idx on public.workout_records (exercise, who, date desc);

-- [CONFIRMED] scripts/trening-migration.sql / trening-goals-migration.sql,
-- recreated identically by rebuild (final shape below)
create table public.workout_goals (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  who         text not null default 'f' check (who in ('f','M','L')),
  kind        text not null check (kind in (
                'sessions_year','sessions_month','sessions_total','hours_year',
                'minutes_week','together_week','weekly_streak','record')),
  target      numeric not null,
  exercise    text,     -- only set when kind = 'record'
  unit        text check (unit is null or unit in ('kg','reps')),
  deadline    date,
  created_at  timestamptz default now(),
  constraint workout_goals_record_check check (
    (kind =  'record' and exercise is not null and unit is not null) or
    (kind <> 'record' and exercise is null     and unit is null)
  )
);

alter table public.workout_goals enable row level security;
create policy "authenticated_workout_goals_all" on public.workout_goals
  for all using (auth.role() = 'authenticated');
grant select, insert, update, delete on public.workout_goals to authenticated;
alter publication supabase_realtime add table public.workout_goals;

-- [CONFIRMED] scripts/trening-badges-migration.sql
-- badge_key is not an FK into any table — the badge catalogue (key, terskel,
-- ikon, tekst) lives in BADGE_DEFS in Trening.tsx, not in the database.
-- unique(who, badge_key) makes `insert ... on conflict do nothing` idempotent,
-- so the client can safely re-check-and-award on every registration without
-- risking a duplicate unlock (and duplicate celebration) for the same badge.
create table public.earned_badges (
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


-- ============================================================================
-- DOMAIN: Ønskeliste (WishContext)
-- ============================================================================

-- [INFERRED, except deal_pct/deal_avg30] No CREATE script ever existed.
-- The original real backups/schema.sql (read directly earlier in this
-- session, before it was deleted) had this CHECK constraint using the
-- pre-rename values: CHECK (list = ANY (ARRAY['felles','mikkel','leah'])).
-- Since this is a brand-new, empty database, the constraint below is set
-- directly to the post-rename values — no data migration needed.
-- WishContext.tsx subscribes via `.channel('wish_realtime')`; realtime is
-- [CONFIRMED] by scripts/wish-price-migration.sql (added there, wrapped in
-- a `do $$ ... exception when duplicate_object` guard — inlined plainly
-- here instead since this targets a fresh, empty database).
create table public.wish_items (
  id           uuid primary key default gen_random_uuid(),
  list         text not null check (list in ('felles','andreas','taran')),
  t            text not null,             -- title (short column name, literally "t")
  done         boolean not null default false,
  who          text not null check (who in ('M','L','f')),
  note         text,
  priority     text not null check (priority in ('lav','middels','høy')),
  added_at     date not null default current_date,
  price        numeric,
  price_url    text,
  price_source text check (price_source is null or price_source in ('manual','prisjakt')),
  -- [CONFIRMED] scripts/wish-price-migration.sql — written by /api/cron/rollover
  deal_pct     int,
  deal_avg30   numeric
);

alter table public.wish_items enable row level security;
create policy "authenticated_wish_items_all" on public.wish_items
  for all using (auth.role() = 'authenticated');
grant select, insert, update, delete on public.wish_items to authenticated;
alter publication supabase_realtime add table public.wish_items;

-- [CONFIRMED] scripts/wish-price-migration.sql — no realtime subscription
-- (only queried on demand for the 30-day price chart, never subscribed to).
create table public.wish_price_history (
  id          uuid primary key default gen_random_uuid(),
  item_id     uuid not null references public.wish_items(id) on delete cascade,
  price       numeric not null,
  checked_at  timestamptz not null default now()
);

alter table public.wish_price_history enable row level security;
create policy "authenticated_wish_price_history" on public.wish_price_history
  for all using (auth.role() = 'authenticated');
grant select, insert, update, delete on public.wish_price_history to authenticated;

create index wish_price_history_item_checked_idx on public.wish_price_history (item_id, checked_at desc);


-- ============================================================================
-- DOMAIN: Ting vi vil gjøre / Bucket (BucketContext)
-- ============================================================================

-- [INFERRED] No migration script. category is a free-text value matched
-- against bucket_categories.name BY VALUE, not a real FK — renaming a
-- category rewrites this column on every matching row from the app.
-- BucketContext.tsx has no realtime subscription (no `.channel(...)` call),
-- so none is added here.
create table public.bucket_items (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  description  text,
  category     text,
  who          text not null check (who in ('M','L','f')),
  done         boolean not null default false,
  done_year    text,
  created_at   timestamptz default now()
);

alter table public.bucket_items enable row level security;
create policy "authenticated_bucket_items_all" on public.bucket_items
  for all using (auth.role() = 'authenticated');
grant select, insert, update, delete on public.bucket_items to authenticated;

-- [INFERRED] Only `name` is ever read/written by the app. No UPDATE policy
-- observed — "renaming" a category is done by insert-new + bulk-rewrite +
-- delete-old. `name` is likely the real PK/UNIQUE but not directly confirmed;
-- an `id`/`created_at` column may or may not additionally exist. No realtime
-- subscription found for this table either.
create table public.bucket_categories (
  name  text primary key
);

alter table public.bucket_categories enable row level security;
create policy "authenticated_bucket_categories_all" on public.bucket_categories
  for all using (auth.role() = 'authenticated');
grant select, insert, update, delete on public.bucket_categories to authenticated;


-- ============================================================================
-- DOMAIN: Kart (MapContext) — pins placed for bucket items (rating pins are
-- orphaned now that Ratinger is removed; see note below)
-- ============================================================================

-- [INFERRED] No migration script.
-- ⚠ source_type historically also allowed 'rating' (rating-page map pins).
-- Now that Ratinger/RatingContext has been removed from the app, any
-- pre-existing rows with source_type='rating' are orphaned — nothing in the
-- app reads or writes them anymore, and Kart.tsx's cleanup effect only
-- targets source_type='bucket'. They are harmless leftover rows, not a
-- schema problem; delete them manually if you want, or leave the CHECK as
-- 'bucket' only if you're rebuilding this table from scratch.
-- MapContext.tsx subscribes to this table via `.channel('map_realtime')`.
create table public.map_pins (
  id           uuid primary key default gen_random_uuid(),
  source_type  text not null,   -- 'bucket' (still-used) | 'rating' (orphaned, feature removed)
  source_id    text not null,
  lat          double precision not null,
  lng          double precision not null,
  unique (source_type, source_id)
);

alter table public.map_pins enable row level security;
create policy "authenticated_map_pins_all" on public.map_pins
  for all using (auth.role() = 'authenticated');
grant select, insert, update, delete on public.map_pins to authenticated;
alter publication supabase_realtime add table public.map_pins;

-- [INFERRED] No migration script. Only 'bucket' is ever used as source_type.
-- Also subscribed to by MapContext.tsx's `.channel('map_realtime')`.
create table public.map_dismissed (
  id           uuid primary key default gen_random_uuid(),
  source_type  text not null default 'bucket',
  source_id    text not null,
  unique (source_type, source_id)
);

alter table public.map_dismissed enable row level security;
create policy "authenticated_map_dismissed_all" on public.map_dismissed
  for all using (auth.role() = 'authenticated');
grant select, insert, update, delete on public.map_dismissed to authenticated;
alter publication supabase_realtime add table public.map_dismissed;


-- ============================================================================
-- DOMAIN: Gjøremål (TodoContext, api/todos.ics.ts, api/cron/rollover.ts)
-- ============================================================================

-- [INFERRED] No migration script. Table name confirmed as `todo_items`
-- (not "todos") via TodoContext.tsx / api/todos.ics.ts / cron rollover.
-- TodoContext.tsx subscribes via `.channel('todo_realtime')`.
create table public.todo_items (
  id            uuid primary key default gen_random_uuid(),
  title         text not null,
  description   text,
  who           text not null check (who in ('M','L','f')),
  priority      text not null check (priority in ('høy','middels','lav')),
  deadline      date,
  time          text,       -- 'HH:MM' string, not a Postgres time column
  done          boolean not null default false,
  done_year     text,
  done_at       timestamptz,
  overdue_days  int not null default 0,     -- incremented daily by cron rollover
  repeat        text check (repeat is null or repeat in ('daily','weekly','monthly','monthly-last')),
  created_at    timestamptz default now()
);

alter table public.todo_items enable row level security;
create policy "authenticated_todo_items_all" on public.todo_items
  for all using (auth.role() = 'authenticated');
grant select, insert, update, delete on public.todo_items to authenticated;
alter publication supabase_realtime add table public.todo_items;


-- ============================================================================
-- DOMAIN: Boligflipping (BoligflippingContext)
-- ============================================================================
-- No contradictions found between scripts/boligflipping-migration.sql and how
-- the app code reads/writes these tables. That script does NOT add either
-- table to the realtime publication, yet BoligflippingContext.tsx subscribes
-- to both (`.channel('flipping_projects_changes')` /
-- `.channel('flipping_costs_changes')`) — added below so the reconstructed
-- schema actually matches what the app needs to work.

-- [CONFIRMED] scripts/boligflipping-migration.sql
create table public.flipping_projects (
  id              uuid primary key default gen_random_uuid(),
  project_name    text not null,
  purchase_price  int not null,
  sale_price      int,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

alter table public.flipping_projects enable row level security;
create policy "authenticated_projects_all" on public.flipping_projects
  for all using (auth.role() = 'authenticated');
grant select, insert, update, delete on public.flipping_projects to authenticated;
alter publication supabase_realtime add table public.flipping_projects;

create index flipping_projects_created_idx on public.flipping_projects (created_at);

-- [CONFIRMED] scripts/boligflipping-migration.sql
create table public.flipping_costs (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.flipping_projects(id) on delete cascade,
  category     text not null,
  description  text not null,
  amount       int not null,
  date         date not null,
  created_at   timestamptz default now()
);

alter table public.flipping_costs enable row level security;
create policy "authenticated_costs_all" on public.flipping_costs
  for all using (auth.role() = 'authenticated');
grant select, insert, update, delete on public.flipping_costs to authenticated;
alter publication supabase_realtime add table public.flipping_costs;

create index flipping_costs_project_idx  on public.flipping_costs (project_id);
create index flipping_costs_date_idx     on public.flipping_costs (date);
create index flipping_costs_category_idx on public.flipping_costs (category);


-- ============================================================================
-- DOMAIN: Hus (kjøpekraft / net-worth prognosis)
-- ============================================================================
-- Uses `finance_entries` (monthly per-person net-worth entries) and
-- `settings` (goal + prognosis-assumption config) — both already defined
-- above in the Økonomi section. No separate Hus-specific table exists.


-- ============================================================================
-- DOMAIN: Kalender
-- ============================================================================
-- No table. Events are fetched live from external iCal feed URLs on every
-- request (api/kalender.ts) — nothing is persisted. Three calendars, three
-- env vars: CAL_ANDREAS, CAL_TARAN (personal), CAL_FELLES (shared, not
-- duplicated per person) — set these in Vercel/GitHub secrets.


-- ============================================================================
-- DOMAIN: Middagsplanlegger + Dagligvarer (scripts/matplan-migration.sql)
-- ============================================================================
-- [CONFIRMED] scripts/matplan-migration.sql — brand new, no prior migration
-- to reconcile against. Manual planning + grocery list only; no suggestion
-- algorithm, calendar reading, or Spoonacular integration yet (deferred).
--
-- [CONFIRMED] scripts/pantry-ingredients-drop-migration.sql — a short-lived
-- pantry_ingredients table (never committed to git) was created and dropped
-- again in favour of the ingredients.onGroceryList field below, decided per
-- ingredient against the existing staple_items list instead of a separate
-- name list.

create table public.recipes (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null,
  ingredients        jsonb not null default '[]',  -- [{name, amount, unit, onGroceryList}, ...] — onGroceryList besluttet/lagret ved opprettelse/redigering, se scripts/pantry-ingredients-drop-migration.sql
  cook_time_minutes  int,
  instructions       text,
  tags               text[] not null default '{}',
  source             text not null default 'egen' check (source in ('egen', 'spoonacular')),
  created_at         timestamptz default now(),
  updated_at         timestamptz default now()
);

alter table public.recipes enable row level security;
create policy "authenticated_recipes_all" on public.recipes
  for all using (auth.role() = 'authenticated');
grant select, insert, update, delete on public.recipes to authenticated;
alter publication supabase_realtime add table public.recipes;

create table public.meal_plan (
  id          uuid primary key default gen_random_uuid(),
  date        date not null unique,
  recipe_id   uuid not null references public.recipes(id) on delete cascade,
  created_at  timestamptz default now()
);

alter table public.meal_plan enable row level security;
create policy "authenticated_meal_plan_all" on public.meal_plan
  for all using (auth.role() = 'authenticated');
grant select, insert, update, delete on public.meal_plan to authenticated;
alter publication supabase_realtime add table public.meal_plan;

create index meal_plan_recipe_idx on public.meal_plan (recipe_id);

-- [CONFIRMED] scripts/staple-interval-nullable-migration.sql — interval_weeks
-- gjort nullable; null = "ingen kjøpsfrekvens definert" (ren referanse, aldri
-- forfalt), atskilt fra en eksplisitt verdi som 1 ("hver uke").
create table public.staple_items (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null,
  amount             numeric,
  unit               text,
  interval_weeks     int check (interval_weeks is null or interval_weeks >= 1),  -- 1 = ukentlig, null = ingen frekvens definert
  last_bought_at     date,
  postponed_until    date,   -- hopp over neste påminnelse uten å endre intervallet
  created_at         timestamptz default now()
);

alter table public.staple_items enable row level security;
create policy "authenticated_staple_items_all" on public.staple_items
  for all using (auth.role() = 'authenticated');
grant select, insert, update, delete on public.staple_items to authenticated;
alter publication supabase_realtime add table public.staple_items;

-- [CONFIRMED] scripts/matplan-migration.sql, constraint since relaxed by
-- scripts/grocery-standalone-migration.sql — both link columns null is now
-- valid too (a freeform item on the standalone dagligvare-handleliste, not
-- tied to a planned dinner or a staple yet).
create table public.grocery_items (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  amount           numeric,
  unit             text,
  done             boolean not null default false,
  meal_plan_id     uuid references public.meal_plan(id) on delete cascade,
  staple_item_id   uuid references public.staple_items(id) on delete cascade,
  created_at       timestamptz default now(),
  constraint grocery_items_single_origin check (
    (meal_plan_id is not null)::int + (staple_item_id is not null)::int <= 1
  )
);

alter table public.grocery_items enable row level security;
create policy "authenticated_grocery_items_all" on public.grocery_items
  for all using (auth.role() = 'authenticated');
grant select, insert, update, delete on public.grocery_items to authenticated;
alter publication supabase_realtime add table public.grocery_items;

create index grocery_items_meal_plan_idx   on public.grocery_items (meal_plan_id);
create index grocery_items_staple_item_idx on public.grocery_items (staple_item_id);

-- [CONFIRMED] scripts/grocery-dedupe-migration.sql — lets syncGroceryList()
-- (MatplanContext.tsx) rely on the database for idempotency (upsert +
-- onConflict) instead of a client-side existence check, which wasn't safe
-- against two clients running the sync at the same time. NULLs are never
-- equal to each other in a unique index, so this doesn't block multiple
-- freeform/meal rows with staple_item_id = null, or vice versa.
create unique index grocery_items_meal_name_uidx on public.grocery_items (meal_plan_id, name);
create unique index grocery_items_staple_uidx     on public.grocery_items (staple_item_id);


-- ============================================================================
-- DOMAIN: Nedtelling (useCountdowns, Dashboard.tsx, Skjerm.tsx)
-- ============================================================================
-- [CONFIRMED] scripts/countdowns-migration.sql — erstatter den gamle
-- enkelt-verdien i settings (key='countdown', se SUPERSEDED under). En liste
-- fordi Gangskjerm etter hvert skal la deg bla mellom flere nedtellinger
-- (swipe — ikke bygget ennå); i dag vises/redigeres bare den nærmeste.

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


-- ============================================================================
-- SUPERSEDED / OBSOLETE — do NOT create these; listed for historical context
-- only, since removing them from this file entirely would hide real repo
-- history that explains why later scripts look the way they do.
-- ============================================================================
-- • finance_imports/transactions (v1, scripts/finance-migration.sql)
--     — dropped by scripts/import-v2-migration.sql, replaced by the v2
--       versions defined above.
-- • merchant_rules (scripts/merchant-rules-migration.sql)
--     — dropped by scripts/import-v2-migration.sql.
-- • merchants (v1, scripts/merchants-migration.sql — PK was `key text`, no
--   `id`/`kind`) — renamed to merchants_legacy, used once as a seed source,
--   then dropped by scripts/import-v2-migration.sql. Unrelated to the
--   current `merchants` table above (different shape entirely).
-- • renovation_expenses / renovation_projects
--     — dropped by scripts/cleanup-renovation.sql; replaced by
--       flipping_projects/flipping_costs from scripts/boligflipping-migration.sql.
-- • workout_templates + workout_sessions.template_id/template_name
--     — the entire template-based Trening model from scripts/trening-migration.sql
--       and scripts/trening-goals-migration.sql. Fully dropped and replaced
--       by the category-based model in scripts/trening-rebuild.sql.
-- • workout_categories.muscle_groups (scripts/trening-muskelgrupper-migration.sql)
--     — dropped by scripts/trening-fjern-muskelgrupper-migration.sql. The
--       coverage feature it powered (a Fullkropp-økt counting as Push/Pull/Legs
--       too) is removed from the app entirely: the chip editor in «Rediger
--       kategori», the groups field on WorkoutCategory, and the two
--       kategori-etterslep pulse rules in treningPulse.ts are all gone.
-- • workout_sessions.extra_started_at/extra_minutes (scripts/trening-tillegg-migration.sql)
--     — not superseded, just DEFERRED: intentionally left out of this schema
--       for now per your instruction. Revisit as its own task when the
--       "fortsett økt" feature is properly wired up end-to-end.
-- • workout_sessions.session_group + the "Sammen" feature it powered
--     — removed from the app entirely (RegisterModal/EditSessionModal UI,
--       TreningContext's registerSession/saveLoggedSession branching, and the
--       togetherGroups/togetherOccasions/etc. + sammen-* pulse rules in
--       treningPulse.ts). Not deferred like tillegg above — just gone.
-- • ratings, rating_categories
--     — Ratinger feature removed from the app entirely (see earlier commit).
--       Per your instruction, these tables/migrations were left untouched in
--       the live DB and are intentionally NOT reconstructed here.
-- • categories, snapshots (scripts/portfolio-import.sql)
--     — Orphaned portfolio-tracker tables, no longer read/written by any app
--       code. Excluded from this reconstruction per your instruction.
-- • settings key='countdown' (single {label,date} value)
--     — replaced by the countdowns table (scripts/countdowns-migration.sql),
--       which also migrates this row's data over before deleting it.


-- ============================================================================
-- OPEN QUESTIONS — verify against the live DB before treating this file as
-- authoritative for anything destructive (e.g. before writing new migrations
-- against these tables):
-- ============================================================================
-- 1. Exact nullability/defaults on every [INFERRED] table — this file
--    guesses "not null" wherever the app always sends an explicit value,
--    but that's not proof the DB itself enforces it.
-- 2. Whether the CHECK constraints on [INFERRED] columns (list, who,
--    priority, repeat, price_source, kind on the various tables) actually
--    exist in Postgres, or are only enforced by TypeScript union types today.
-- 3. bucket_categories / map_pins / map_dismissed / finance_entries /
--    todo_items: possible extra columns never referenced by any app code
--    (e.g. an `id`/`created_at` on bucket_categories) that this
--    reconstruction has no way of detecting.
-- 4. transactions.source has no confirmed CHECK constraint despite comments
--    implying a fixed enum — decide whether to add one matching actual
--    usage ('bank_M','bank_L','trumf','felles').
-- ============================================================================
