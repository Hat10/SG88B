-- Ingen av migreringsscriptene i dette repoet har noensinne eksplisitt
-- GRANT-et noe til service_role — alle ~50 GRANT-setningene på tvers av
-- scripts/*.sql går kun til `authenticated` (bekreftet ved grep). Det
-- betyr vi har lent oss på at Supabase sine plattform-nivå standard-
-- rettigheter (default privileges) dekker service_role automatisk.
--
-- api/cron/rollover.ts sitt "Ta ut plast"-steg avdekket at dette ikke
-- stemmer: service_role-nøkkelen er bekreftet ekte (JWT-payload
-- verifisert), men første todo_items-spørring i cronen feiler likevel med
-- "permission denied for table todo_items" — en Postgres GRANT-nivå-feil
-- (42501), ikke en RLS-policy-feil (som ville gitt en annen feiltekst:
-- "new row violates row-level security policy"). Det tyder på at
-- service_role på dette prosjektet mangler eksplisitte grants på (i det
-- minste) todo_items, og trolig på alle andre tabeller også, siden ingen
-- av dem noensinne har fått det eksplisitt.
--
-- GRANT er idempotent — å gi en rolle en rettighet den allerede har er en
-- no-op — så dette er trygt å kjøre uansett hva
-- `select grantee, privilege_type from information_schema.role_table_grants
--  where table_name = 'todo_items'` faktisk viser.
--
-- Tabellene under er hentet fra de eksplisitte `grant ... to authenticated`
-- setningene i schema-reconstructed.sql (den filen er selv dokumentert som
-- den forsonede, gjeldende rekonstruksjonen av skjemaet slik appkoden
-- faktisk bruker det). `merchant_rules` (fra merchant-rules-migration.sql)
-- er bevisst utelatt her — den er ikke referert noe sted i src/, og er
-- ikke tatt med i schema-reconstructed.sql sin rekonstruksjon, så den er
-- trolig et dødt/forlatt bord. Si fra hvis den fortsatt er i bruk, så
-- legger vi den til.
--
-- Kjør i Supabase SQL editor.

grant select, insert, update, delete on public.bucket_categories   to service_role;
grant select, insert, update, delete on public.bucket_items        to service_role;
grant select, insert, update, delete on public.countdowns          to service_role;
grant select, insert, update, delete on public.finance_entries     to service_role;
grant select, insert, update, delete on public.finance_imports     to service_role;
grant select, insert, update, delete on public.flipping_costs      to service_role;
grant select, insert, update, delete on public.flipping_projects   to service_role;
grant select, insert, update, delete on public.grocery_items       to service_role;
grant select, insert, update, delete on public.investment_values   to service_role;
grant select, insert, update, delete on public.map_dismissed       to service_role;
grant select, insert, update, delete on public.map_pins            to service_role;
grant select, insert, update, delete on public.meal_plan           to service_role;
grant select, insert, update, delete on public.merchant_aliases    to service_role;
grant select, insert, update, delete on public.merchants           to service_role;
grant select, insert, update, delete on public.recipes             to service_role;
grant select, insert, update, delete on public.settings            to service_role;
grant select, insert, update, delete on public.spending_categories to service_role;
grant select, insert, update, delete on public.staple_items        to service_role;
grant select, insert, update, delete on public.todo_items          to service_role;
grant select, insert, update, delete on public.transactions        to service_role;
grant select, insert, update, delete on public.wish_items          to service_role;
grant select, insert, update, delete on public.wish_price_history  to service_role;
grant select, insert, update, delete on public.workout_categories  to service_role;
grant select, insert, update, delete on public.workout_goals       to service_role;
grant select, insert, update, delete on public.workout_records     to service_role;
grant select, insert, update, delete on public.workout_sessions    to service_role;