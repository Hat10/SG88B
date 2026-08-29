-- Trening: strammer workout_goals.who til bare Andreas/Taran (16.08.2026)
--
-- «Felles»-visningen er fjernet fra Trening → Statistikk, og appen tilbyr ikke
-- lenger 'f' som et valg noe sted for mål — verken ved oppretting (GoalModal)
-- eller i beregningene (lib/treningPulse.ts). Denne strammer databasen til å
-- matche: 'f' er ikke lenger en gyldig verdi i det hele tatt, og kolonnen har
-- ingen default lenger (appen sender alltid en eksplisitt who ved innsetting,
-- så en default var aldri i bruk — men en default utenfor det tillatte settet
-- ville uansett vært en felle for fremtidig kode).
--
-- KJØR trening-fjern-felles-mal-migration.sql FØRST — den fjerner eventuelle
-- gjenværende who='f'-rader, som ellers ville brutt denne constrainten.
--
-- Trygt å kjøre om igjen. Kjør i Supabase SQL editor.

alter table public.workout_goals
  alter column who drop default;

alter table public.workout_goals drop constraint if exists workout_goals_who_check;
alter table public.workout_goals add constraint workout_goals_who_check
  check (who in ('M','L'));
