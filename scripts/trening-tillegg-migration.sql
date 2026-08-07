-- Tillegg utenfor selve økta ("Diverse tilleggsøvelser").
--
-- Bakgrunn: etter en fullført økt kan man bli igjen på gymmen og gjøre litt
-- diverse — uttøying, litt mage, en runde til. Det er tid på gymmen, men det er
-- ikke en del av økta, og skal derfor ikke dra ned (eller opp) øktsnittet.
--
-- Modellen:
--   extra_started_at IKKE null  ⇒  et tillegg løper akkurat nå (live «fortsett»-
--                                   timer). Ankeret timeren måles fra. Vises på
--                                   begge telefonene, og overlever at siden
--                                   lukkes — akkurat som en pågående økt.
--   extra_minutes    IKKE null  ⇒  ferdig registrert tillegg, i minutter.
--   begge null                  ⇒  vanlig økt uten tillegg.
--
-- Når man trykker «Ferdig på gym» settes extra_minutes og extra_started_at
-- nulles. Selve økta (started_at → completed_at) røres aldri, så durationMin og
-- alle snitt er nøyaktig som før. Bare summene for «total tid på gymmen» legger
-- tillegget oppå.
--
-- Trygg å kjøre om igjen: alt er «if not exists».

alter table public.workout_sessions
  add column if not exists extra_started_at timestamptz,
  add column if not exists extra_minutes    integer;

comment on column public.workout_sessions.extra_started_at is
  'Ikke null ⇒ et tillegg løper nå (ankeret live-timeren måles fra). Nulles når tillegget avsluttes.';
comment on column public.workout_sessions.extra_minutes is
  'Ferdig registrert tillegg i minutter. Teller i total gymtid, aldri i øktvarighet/snitt.';
