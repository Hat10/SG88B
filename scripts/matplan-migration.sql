-- Middagsplanlegger + Handleliste Dagligvarer — kjør i Supabase SQL editor.
--
-- Fire tabeller:
--   recipes        — oppskrifter (strukturert ingrediensliste som jsonb)
--   meal_plan      — hvilken oppskrift som er planlagt hvilken dato (én per dag)
--   staple_items   — faste/sjeldne basisvarer, med kjøpsintervall i uker
--   grocery_items  — selve handlelisten; hver rad stammer enten fra en planlagt
--                    middag (meal_plan_id) eller en basisvare (staple_item_id),
--                    aldri begge — det er det check-constrainten nederst håndhever.
--
-- Ingen forslags-algoritme, kalenderlesing eller Spoonacular-integrasjon her —
-- kun datamodell + manuell grunnfunksjonalitet, som avtalt.

create table public.recipes (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null,
  -- [{ name: text, amount: number|null, unit: text|null }, ...]
  ingredients        jsonb not null default '[]',
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


create table public.staple_items (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null,
  amount             numeric,
  unit               text,
  -- 1 = ukentlig; >1 = hver N. uke ("sjeldnere")
  interval_weeks     int not null default 1 check (interval_weeks >= 1),
  last_bought_at     date,
  -- satt når man vil hoppe over neste påminnelse uten å endre selve intervallet
  postponed_until    date,
  created_at         timestamptz default now()
);

alter table public.staple_items enable row level security;
create policy "authenticated_staple_items_all" on public.staple_items
  for all using (auth.role() = 'authenticated');
grant select, insert, update, delete on public.staple_items to authenticated;
alter publication supabase_realtime add table public.staple_items;


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
    (meal_plan_id is not null)::int + (staple_item_id is not null)::int = 1
  )
);

alter table public.grocery_items enable row level security;
create policy "authenticated_grocery_items_all" on public.grocery_items
  for all using (auth.role() = 'authenticated');
grant select, insert, update, delete on public.grocery_items to authenticated;
alter publication supabase_realtime add table public.grocery_items;

create index grocery_items_meal_plan_idx   on public.grocery_items (meal_plan_id);
create index grocery_items_staple_item_idx on public.grocery_items (staple_item_id);
