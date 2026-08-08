-- Rydder opp duplikat-rader i grocery_items forårsaket av at syncGroceryList()
-- (i src/contexts/MatplanContext.tsx) tidligere sjekket mot klientens eget
-- øyeblikksbilde av dataene i stedet for å la databasen håndheve unikhet —
-- se commit-meldingen/samtalen for root cause. Trygt å kjøre selv om du ikke
-- har noen duplikater ennå.
--
-- Kjør i Supabase SQL editor, etter grocery-standalone-migration.sql.

-- 1) Dedupe rader fra planlagte middager: behold én rad per (meal_plan_id,
--    navn) — foretrekk en rad som allerede er avhuket (kjøpt), ellers den eldste.
with ranked as (
  select id,
    row_number() over (
      partition by meal_plan_id, name
      order by done desc, created_at asc
    ) as rn
  from public.grocery_items
  where meal_plan_id is not null
)
delete from public.grocery_items
where id in (select id from ranked where rn > 1);

-- 2) Dedupe rader fra basisvarer: behold én rad per staple_item_id (samme regel).
with ranked as (
  select id,
    row_number() over (
      partition by staple_item_id
      order by done desc, created_at asc
    ) as rn
  from public.grocery_items
  where staple_item_id is not null
)
delete from public.grocery_items
where id in (select id from ranked where rn > 1);

-- 3) Håndhev det samme fremover, i databasen — ikke bare i klientkoden. To
--    samtidige kjøringer av syncGroceryList() (f.eks. to telefoner som åpner
--    handlelisten i samme øyeblikk) kan ikke lenger produsere duplikater:
--    et innsettingsforsøk på en rad som allerede finnes hopper bare over
--    (meal_plan_id/name) eller oppdaterer den eksisterende raden (staple_item_id)
--    — se det oppdaterte syncGroceryList() for hvordan disse brukes.
--
-- NULL-verdier regnes aldri som like i en unik indeks, så dette blokkerer ikke
-- frittstående varer (Andre varer) eller basisvarer fra å ha meal_plan_id = null,
-- og heller ikke middag-/frittstående-rader fra å ha staple_item_id = null.
create unique index grocery_items_meal_name_uidx on public.grocery_items (meal_plan_id, name);
create unique index grocery_items_staple_uidx     on public.grocery_items (staple_item_id);
