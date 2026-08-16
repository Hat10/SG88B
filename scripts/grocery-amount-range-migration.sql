-- Kjør i Supabase SQL editor.
--
-- Ny amount_range-kolonne på grocery_items — tekstlig intervall (f.eks.
-- "0.5-1") for ingredienser der en enkelt tallverdi ikke passer, typisk
-- krydder ("0.5-1 ts salt"). Speiler det nye, valgfrie amountRange-feltet på
-- Ingredient i recipes.ingredients (jsonb — ingen skjemaendring nødvendig
-- der, det er bare en ny nøkkel i det eksisterende json-objektet per
-- ingrediens). Satt av syncGroceryList() (MatplanContext.tsx) når en
-- planlagt middags ingrediens har et intervall.
--
-- Additiv: rører ikke den eksisterende amount numeric-kolonnen eller dens
-- betydning. Nøyaktig én av amount/amount_range er satt per rad — aldri
-- begge. groupByNameUnit() (HandlelisteCard.tsx) summerer aldri en
-- amount_range-rad numerisk med en annen rad; se kommentaren der.

alter table public.grocery_items
  add column if not exists amount_range text;
