-- Run this in the Supabase SQL editor.
-- Moves *spending* categories out of the codebase and into the database, so they can
-- be named, added and deleted from the website. Transactions/merchants keep storing
-- the category *key* (text) — this table just holds the label + colour + order.
--
-- NB: named spending_categories (not `categories`) because a separate `categories`
-- table already exists for the portfolio tracker (asset classes + tax rates).

create table if not exists spending_categories (
  key        text primary key,           -- stable id stored on transactions.category
  label      text not null,              -- display name, editable
  color      text not null default '#9E9E9E',
  sort_order int  not null default 100,  -- display order
  is_system  boolean not null default false, -- true = seeded built-in (auto-import targets these)
  created_at timestamptz default now()
);

-- Explicit grants (required for Data API access from May/October 2026)
grant select, insert, update, delete on public.spending_categories to authenticated;

-- Row level security — same pattern as transactions/finance_entries
alter table spending_categories enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where tablename='spending_categories' and policyname='authenticated_spending_categories') then
    create policy "authenticated_spending_categories" on spending_categories
      for all using (auth.role() = 'authenticated');
  end if;
end $$;

-- ── Seed the current built-in categories ────────────────────────────────────
-- ON CONFLICT DO NOTHING so re-running never clobbers labels/colours you've since
-- edited on the site.
insert into spending_categories (key, label, color, sort_order, is_system) values
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
  -- NB: 'overføring' is intentionally NOT seeded — transfers aren't spending. The
  -- import code still tags them 'overføring' to auto-exclude them, and the app keeps
  -- a display label for the key, but it must not be a user-pickable category.
  ('inntekt',     'Inntekt',            '#66BB6A', 18, true),
  ('investering', 'Investering',        '#FFD700', 19, true),
  ('annet',       'Annet',              '#9E9E9E', 20, true)
on conflict (key) do nothing;
