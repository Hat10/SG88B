-- Utvider grocery_items (fra scripts/matplan-migration.sql) til også å tillate
-- frittstående varer som ikke stammer fra en planlagt middag eller en
-- basisvare — dvs. en enkel handleliste for dagligvarer, uten kobling til
-- Middagsplanleggeren ennå. Constrainten gikk fra "nøyaktig én av
-- meal_plan_id/staple_item_id satt" til "høyst én satt" (begge null er nå
-- gyldig — det er en frittstående vare).
--
-- Kjør i Supabase SQL editor, etter matplan-migration.sql.

alter table public.grocery_items
  drop constraint grocery_items_single_origin;

alter table public.grocery_items
  add constraint grocery_items_single_origin check (
    (meal_plan_id is not null)::int + (staple_item_id is not null)::int <= 1
  );
