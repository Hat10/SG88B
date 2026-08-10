-- Trening: fjern muskelgrupper på kategoriene
--
-- Reverserer scripts/trening-muskelgrupper-migration.sql. Dekningslogikken
-- (en Fullkropp-økt teller som at Push/Pull/Legs også ble trent) er tatt ut
-- av appen — chip-editoren i «Rediger kategori», groups-feltet på
-- WorkoutCategory, og de to pulsreglene som varslet om utrent muskelgruppe
-- er alle fjernet i samme omgang. Denne kolonnen er dermed ikke lest eller
-- skrevet noe sted lenger.
--
-- Destruktiv: eventuelle grupper som er tagget på kategoriene forsvinner.
-- Selve kategoriene og øktloggen er upåvirket.

alter table public.workout_categories
  drop column if exists muscle_groups;
