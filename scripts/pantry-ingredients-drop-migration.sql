-- Kjør i Supabase SQL editor.
--
-- Rydder opp igjen etter en kortlevd pantry_ingredients-tabell (opprettet av
-- en migrasjon som aldri ble committet til git) — droppes til fordel for å
-- gjenbruke den eksisterende Basisvarer-listen (staple_items) som eneste
-- kilde til hva som regnes som en "har vanligvis hjemme"-vare. Tabellen har
-- 0 rader, så dette er trygt uten datatap. Fjernes automatisk fra
-- supabase_realtime-publikasjonen når tabellen droppes — ingen egen
-- opprydding av det trengs.

drop table if exists public.pantry_ingredients;
