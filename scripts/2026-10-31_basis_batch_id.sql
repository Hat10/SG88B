-- «Legg til basisvarer for neste uke» — bekreftelse + angre
-- (src/pages/Handleliste.tsx → StapleManager, src/lib/basisvarer.ts,
-- addBasisBatch/undoBasisBatch i src/contexts/MatplanContext.tsx).
--
-- Kjør manuelt i Supabase SQL Editor FØR deploy. Idempotent — trygt å kjøre
-- flere ganger. Appen tåler at dette ikke er kjørt ennå: kolonnene mangler da
-- bare i select('*'), innsettingen prøves på nytt uten dem, og angring er
-- skjult.
--
-- basis_batch_id: én uuid (v7, tidsstempel i de første 48 bitene) per
--   innsetting, satt på alle radene i den. Grunnlaget for «Angre» — også
--   etter ny innlasting og på den andre enheten.
-- basis_prev_done_at: grocery_items har én rad per basisvare for alltid
--   (grocery_items_staple_uidx), så «legg til» gjenaktiverer en avhuket rad
--   i stedet for å lage en ny. Her huskes den gamle done_at, slik at angring
--   legger raden tilbake som kjøpt i stedet for å slette en rad som sto der
--   fra før. null ⇒ raden ble opprettet av innsettingen og kan slettes.

alter table public.grocery_items add column if not exists basis_batch_id uuid;
alter table public.grocery_items add column if not exists basis_prev_done_at timestamptz;

-- Angring slår opp på basis_batch_id; nesten alle rader har null.
create index if not exists grocery_items_basis_batch_idx
  on public.grocery_items (basis_batch_id) where basis_batch_id is not null;

-- Tabell-GRANT-er dekker nye kolonner automatisk. Gjentatt her (idempotent)
-- i tråd med service-role-grants-migration.sql — ingen api/-kode bruker
-- disse kolonnene i dag, men da slipper vi «permission denied» om det endrer seg.
grant select, insert, update, delete on public.grocery_items to authenticated;
grant select, insert, update, delete on public.grocery_items to service_role;
