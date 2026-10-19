-- Realtime for «Ting vi vil gjøre» (bucket_items).
--
-- Gjør at avhaking/sletting/ny aktivitet på én fane eller enhet vises på de
-- andre, slik at lista og kartet (map_pins har allerede realtime) er enige.
-- BucketContext abonnerer på tabellen; uten denne migreringen fungerer appen
-- som før, men bucket-endringer vises først etter reload.
--
-- MÅ KJØRES MANUELT i Supabase SQL Editor. Trygt å kjøre flere ganger.
-- Ingen ny tabell, så ingen GRANT til service_role er nødvendig.

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'bucket_items'
  ) then
    alter publication supabase_realtime add table public.bucket_items;
  end if;
end $$;
