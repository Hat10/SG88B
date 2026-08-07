-- Trening: muskelgrupper på kategoriene (dekning/kobling)
--
-- Bakgrunn: kategoriene overlapper (Overkropp = Push + Pull, Fullkropp = alle).
-- En Fullkropp-økt bør regnes som at Push/Pull/Legs også ble trent — for «sist
-- trent» og pulsmeldinga — men fortsatt telle som én økt. Løsningen er å tagge
-- hver kategori med muskelgruppene den treffer. Dekning utledes så automatisk:
-- en økt dekker en kategori hvis øktas grupper er et supersett av kategoriens.
--
-- Additiv og idempotent — trygg å kjøre om igjen. Ingenting slettes.

alter table public.workout_categories
  add column if not exists muscle_groups text[] not null default '{}';

-- Seed standardkategorienes grupper, men bare der de ennå er tomme (så egne
-- valg ikke overskrives om skriptet kjøres på nytt). Egendefinerte kategorier
-- (Sykkeltur, Gåtur, …) tagges i appen under «Rediger kategori».
update public.workout_categories set muscle_groups = '{Push}'
  where name = 'Push'      and muscle_groups = '{}';
update public.workout_categories set muscle_groups = '{Pull}'
  where name = 'Pull'      and muscle_groups = '{}';
update public.workout_categories set muscle_groups = '{Legs}'
  where name = 'Legs'      and muscle_groups = '{}';
update public.workout_categories set muscle_groups = '{Push,Pull}'
  where name = 'Overkropp' and muscle_groups = '{}';
update public.workout_categories set muscle_groups = '{Push,Pull,Legs}'
  where name = 'Fullkropp' and muscle_groups = '{}';
update public.workout_categories set muscle_groups = '{Cardio}'
  where name = 'Cardio'    and muscle_groups = '{}';
