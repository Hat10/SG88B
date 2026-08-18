-- Kjør i Supabase SQL editor.
--
-- Kategorisering av handlelistevarer for Handlemodus (pages/middag/
-- ShoppingMode.tsx) — varer grupperes under butikkavdelinger i stedet for
-- Fra ukens middager/Basisvarer/Andre varer.
--
-- category er ren tekst uten CHECK-constraint (den kanoniske lista med 11
-- avdelinger + «Annet» lever kun i koden, se GROCERY_CATEGORIES i
-- src/lib/groceryCategories.ts) — så den lista kan justeres uten en ny
-- migrasjon hver gang. Foreslås automatisk av en nøkkelord-heuristikk
-- (guessCategory()) når raden opprettes (fra oppskrift, basisvare eller
-- fritekst, se syncGroceryList()/addGroceryItem() i MatplanContext.tsx).
--
-- grocery_category_overrides husker en brukers manuelle kategori-valg (satt
-- i Handlemodus) per varenavn (lowercased), sjekket FØR heuristikken ved ny
-- rad-generering — slik at «Melk» ikke trenger rettes på nytt hver uke etter
-- at den er korrigert én gang. Ingen fremmednøkkel til grocery_items (den er
-- navnebasert med vilje, ikke radbasert, siden formålet er å styre FREMTIDIGE
-- rader, ikke bare den ene som ble redigert).

alter table public.grocery_items
  add column category text;

create table public.grocery_category_overrides (
  name     text primary key,
  category text
);

alter table public.grocery_category_overrides enable row level security;
create policy "authenticated_grocery_category_overrides_all" on public.grocery_category_overrides
  for all using (auth.role() = 'authenticated');
grant select, insert, update, delete on public.grocery_category_overrides to authenticated;
alter publication supabase_realtime add table public.grocery_category_overrides;
