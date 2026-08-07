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
-- Several older migration scripts are SUPERSEDED by later ones in scripts/
-- and are deliberately NOT represented here (see "Superseded / obsolete"
-- section at the bottom for the full list and why).
-- ============================================================================


-- ============================================================================
-- DOMAIN: Økonomi / Forbruk (Okonomi.tsx, FinanceContext, CategoryContext)
-- ============================================================================

-- [CONFIRMED] scripts/import-v2-migration.sql
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

-- [CONFIRMED] scripts/import-v2-migration.sql
create table public.merchants (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  category    text not null default 'annet',   -- soft-FK to spending_categories.key
  kind        text not null default 'merchant'
              check (kind in ('merchant','person','internal','settlement','intermediary')),
  created_at  timestamptz default now()
);
create unique index merchants_name_uniq on public.merchants (lower(name));

-- [CONFIRMED] scripts/import-v2-migration.sql
create table public.merchant_aliases (
  alias        text primary key,
  merchant_id  uuid not null references public.merchants(id) on delete cascade,
  created_at   timestamptz default now()
);
create index merchant_aliases_merchant_idx on public.merchant_aliases (merchant_id);

-- [CONFIRMED] scripts/import-v2-migration.sql, kind CHECK widened by
-- scripts/investment-kind-migration.sql (this is the FINAL constraint)
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
create index transactions_month_idx       on public.transactions (month);
create index transactions_source_idx      on public.transactions (source);
create index transactions_fingerprint_idx on public.transactions (fingerprint);
create index transactions_merchant_idx    on public.transactions (merchant_id);

-- [CONFIRMED] scripts/spending-categories-migration.sql
create table public.spending_categories (
  key         text primary key,
  label       text not null,
  color       text not null default '#9E9E9E',
  sort_order  int not null default 100,
  is_system   boolean not null default false,
  created_at  timestamptz default now()
);
-- Seeded with ~19 built-in keys incl. 'investering'; deliberately excludes
-- 'overføring' (internal transfers are tagged that category by import/classify
-- logic but are not a user-pickable spending category).

-- [CONFIRMED] scripts/investment-values-migration.sql
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
create index investment_values_month_idx on public.investment_values (month);

-- [INFERRED] No CREATE TABLE exists anywhere in scripts/ — only
-- scripts/asset-classes-migration.sql ALTERs it (adding the 4 asset-class
-- columns), proving it predates every script in this repo. Reconstructed
-- from FinanceContext.tsx's select('*')/upsert(...) shape. Used by the Hus
-- page for monthly per-person net-worth entries — NOT shared with any other
-- domain table.
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

-- [INFERRED] Generic shared key/value settings store — no migration script.
-- Used by Hus (hus_goal, lb_prognose, lb_prognose_history, bp_params) and by
-- the weekly-bucket-reminder cron (weekly_bucket) — not finance-specific,
-- just documented here since finance_entries and Hus share this file.
create table public.settings (
  key    text primary key,
  value  jsonb
);
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
-- layered with scripts/trening-muskelgrupper-migration.sql and
-- scripts/trening-note-migration.sql. scripts/trening-tillegg-migration.sql
-- (extra_started_at/extra_minutes, a "continue session" feature) is
-- deliberately NOT applied here — see "Superseded" section; it'll come back
-- as its own properly-wired task later.
-- The original TEMPLATE-based model from scripts/trening-migration.sql /
-- scripts/trening-goals-migration.sql (workout_templates table, template_id/
-- template_name on sessions) was fully replaced — see "Superseded" section.

-- [CONFIRMED] scripts/trening-rebuild.sql + scripts/trening-muskelgrupper-migration.sql
create table public.workout_categories (
  id             uuid primary key default gen_random_uuid(),
  name           text not null unique,
  color          text,
  sort_order     int not null default 0,
  archived       boolean not null default false,
  created_at     timestamptz default now(),
  muscle_groups  text[] not null default '{}'
);
-- Seeded: Push(0), Pull(1), Legs(2), Fullkropp(3), Overkropp(4), Cardio(5).

-- [CONFIRMED] scripts/trening-rebuild.sql, extended by
-- scripts/trening-note-migration.sql (note — already present in rebuild,
-- the later script is a harmless idempotent no-op).
--
-- NOTE: extra_started_at/extra_minutes (a "continue session" / tillegg-tid
-- feature from scripts/trening-tillegg-migration.sql) are deliberately
-- excluded for now — treningPulse.ts still has calculation logic for them,
-- but TreningContext.tsx never reads/writes them, so wiring them back in
-- properly (a real "fortsett økt" feature) is its own future task.
create table public.workout_sessions (
  id             uuid primary key default gen_random_uuid(),
  category       text not null,          -- denormalized copy of workout_categories.name,
                                          -- no FK — deleting a category doesn't touch history
  who            text not null check (who in ('M','L')),
  session_group  uuid,                   -- shared by both rows of a "sammen" session; null if solo
  started_at     timestamptz not null default now(),
  completed_at   timestamptz,            -- always = started_at in current model
  note           text,
  created_at     timestamptz default now()
);
create index workout_sessions_started_idx on public.workout_sessions (started_at desc);
create index workout_sessions_group_idx   on public.workout_sessions (session_group);

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


-- ============================================================================
-- DOMAIN: Ønskeliste (WishContext)
-- ============================================================================

-- [INFERRED, except deal_pct/deal_avg30] No CREATE script ever existed.
-- The original real backups/schema.sql (read directly earlier in this
-- session, before it was deleted) had this CHECK constraint using the
-- pre-rename values: CHECK (list = ANY (ARRAY['felles','mikkel','leah'])).
-- Since this is a brand-new, empty database, the constraint below is set
-- directly to the post-rename values — no data migration needed.
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

-- [CONFIRMED] scripts/wish-price-migration.sql
create table public.wish_price_history (
  id          uuid primary key default gen_random_uuid(),
  item_id     uuid not null references public.wish_items(id) on delete cascade,
  price       numeric not null,
  checked_at  timestamptz not null default now()
);
create index wish_price_history_item_checked_idx on public.wish_price_history (item_id, checked_at desc);


-- ============================================================================
-- DOMAIN: Ting vi vil gjøre / Bucket (BucketContext)
-- ============================================================================

-- [INFERRED] No migration script. category is a free-text value matched
-- against bucket_categories.name BY VALUE, not a real FK — renaming a
-- category rewrites this column on every matching row from the app.
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

-- [INFERRED] Only `name` is ever read/written by the app. No UPDATE policy
-- observed — "renaming" a category is done by insert-new + bulk-rewrite +
-- delete-old. `name` is likely the real PK/UNIQUE but not directly confirmed;
-- an `id`/`created_at` column may or may not additionally exist.
create table public.bucket_categories (
  name  text primary key
);


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
create table public.map_pins (
  id           uuid primary key default gen_random_uuid(),
  source_type  text not null,   -- 'bucket' (still-used) | 'rating' (orphaned, feature removed)
  source_id    text not null,
  lat          double precision not null,
  lng          double precision not null,
  unique (source_type, source_id)
);

-- [INFERRED] No migration script. Only 'bucket' is ever used as source_type.
create table public.map_dismissed (
  id           uuid primary key default gen_random_uuid(),
  source_type  text not null default 'bucket',
  source_id    text not null,
  unique (source_type, source_id)
);


-- ============================================================================
-- DOMAIN: Gjøremål (TodoContext, api/todos.ics.ts, api/cron/rollover.ts)
-- ============================================================================

-- [INFERRED] No migration script. Table name confirmed as `todo_items`
-- (not "todos") via TodoContext.tsx / api/todos.ics.ts / cron rollover.
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


-- ============================================================================
-- DOMAIN: Boligflipping (BoligflippingContext) — fully confirmed, no
-- contradictions found between the migration script and app code
-- ============================================================================

-- [CONFIRMED] scripts/boligflipping-migration.sql
create table public.flipping_projects (
  id              uuid primary key default gen_random_uuid(),
  project_name    text not null,
  purchase_price  int not null,
  sale_price      int,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);
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
-- request (api/kalender.ts) — nothing is persisted. The feed URLs themselves
-- live in env vars: CAL_ANDREAS_PERSONAL, CAL_ANDREAS_FELLES,
-- CAL_TARAN_PERSONAL, CAL_TARAN_FELLES (renamed from CAL_MIKKEL_*/CAL_LEAH_*
-- — you still need to update these in Vercel/GitHub secrets, see earlier
-- rename summary).


-- ============================================================================
-- RLS / grants pattern (confirmed identical across every table that DOES
-- have a migration script — apply the same pattern to the inferred tables
-- above if/when you formally create them)
-- ============================================================================
-- alter table public.<table> enable row level security;
-- create policy authenticated_<table>_all on public.<table>
--   for all using (auth.role() = 'authenticated');
-- grant select, insert, update, delete on public.<table> to authenticated;
-- alter publication supabase_realtime add table public.<table>;


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
-- • workout_sessions.extra_started_at/extra_minutes (scripts/trening-tillegg-migration.sql)
--     — not superseded, just DEFERRED: intentionally left out of this schema
--       for now per your instruction. Revisit as its own task when the
--       "fortsett økt" feature is properly wired up end-to-end.
-- • ratings, rating_categories
--     — Ratinger feature removed from the app entirely (see earlier commit).
--       Per your instruction, these tables/migrations were left untouched in
--       the live DB and are intentionally NOT reconstructed here.
-- • categories, snapshots (scripts/portfolio-import.sql)
--     — Orphaned portfolio-tracker tables, no longer read/written by any app
--       code. Excluded from this reconstruction per your instruction.


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
