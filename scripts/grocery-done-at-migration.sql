-- Kjør i Supabase SQL editor.
--
-- Ny done_at-kolonne på grocery_items, satt av toggleGroceryItem() (i
-- MatplanContext.tsx) når en rad markeres kjøpt, nullstilt hvis avhukingen
-- angres. Brukes til å avgrense "Vis handlet" i HandlelisteCard.tsx til kun
-- det som ble kjøpt i inneværende handleuke (lørdag–fredag, se
-- handleukeStart i useWeeklyBucket.ts) — uten dette tidsstempelet er det
-- umulig å vite NÅR en rad ble huket av, bare AT den er det.
--
-- Eksisterende avhukede rader (done = true) får done_at = null — det finnes
-- ingen historikk å hente det fra. De forsvinner dermed fra "Vis handlet"
-- med det samme (null matcher aldri "inneværende handleuke"), men slettes
-- ikke fra databasen.

alter table public.grocery_items
  add column if not exists done_at timestamptz;
