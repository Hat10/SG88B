-- Trening: fjerner eksisterende felles-mål (16.08.2026)
--
-- «Felles»-visningen på Trening → Statistikk er fjernet fra appen — alle mål
-- gjelder nå enten Andreas eller Taran, aldri begge samlet. Denne sletter
-- eventuelle gjenværende workout_goals-rader som fortsatt står med who='f' fra
-- før den endringen. Slike rader vises ikke lenger noe sted i appen etter
-- kodeendringen, uansett om de slettes eller ikke — dette er ren opprydding.
--
-- Kjør dette FØR trening-goals-who-constraint-migration.sql, som strammer inn
-- CHECK-constrainten til å ikke tillate 'f' i det hele tatt.
--
-- Trygt å kjøre om igjen (matcher 0 rader andre gang). Kjør i Supabase SQL
-- editor.

delete from public.workout_goals where who = 'f';
