-- Håndhever unikhet på (title, deadline) i todo_items, i databasen — ikke
-- bare i applikasjonskoden. Brukes av api/cron/rollover.ts sin automatiske
-- opprettelse av "Ta ut plast"-gjøremål (deadline = dagen før neste
-- Iris-henting av plast, se fetchPickups() i api/tommeplan.ts): et
-- innsettingsforsøk med samme (title, deadline) som en rad som allerede
-- finnes hopper bare over (ON CONFLICT ... DO NOTHING via upsert med
-- ignoreDuplicates), i stedet for å opprette en duplikat-rad. Dette er
-- nøyaktig samme fiks som handlelisten fikk for sin samtidighets-/
-- duplikat-bug — se grocery-dedupe-migration.sql.
--
-- NULL-deadline telles aldri som like i en unik indeks, så dette påvirker
-- ikke gjøremål uten forfallsdato. To ulike gjøremål ville måtte dele både
-- eksakt tittel og eksakt dato for at dette skal blokkere noe — usannsynlig
-- utenom nettopp "Ta ut plast"-syklusen den er laget for.
--
-- Kjør i Supabase SQL editor. Trygt å kjøre selv om du ikke har noen
-- duplikater ennå (og det finnes ingen kjente duplikater å rydde opp i før
-- denne, siden funksjonen som skriver "Ta ut plast" er ny).

create unique index if not exists todo_items_title_deadline_uidx on public.todo_items (title, deadline);