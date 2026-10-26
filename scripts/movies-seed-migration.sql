-- Seed for Filmoversikt (fra Excel-arket): 68 filmer + 4 serier = 72 rader, alle «ikke sett».
-- Kolonnene i VALUES: (n, tittel, kind, must_l = Taran obligatorisk, must_m = Andreas obligatorisk).
--
-- created_at trappes med 1 sekund per rad i listens rekkefølge (n = 1 først):
-- now() er konstant innenfor en transaksjon, så uten trappingen ble alle radene
-- like og sortering på «nylig lagt til» ble tilfeldig. Siden n øker nedover i
-- listen er den siste raden «nyest».
--
-- ⚠ DOKUMENTASJON FOR EN NY, TOM DATABASE. Dagens database er allerede seedet og
-- korrigert manuelt (created_at). Denne filen skal IKKE kjøres på nytt der:
-- ON CONFLICT DO NOTHING ville ikke rette opp eksisterende rader uansett.
--
-- Krever at movies-migration.sql er kjørt først.
-- Idempotent: ON CONFLICT DO NOTHING mot den unike indeksen (lower(title), kind).

insert into public.movies (title, kind, must_l, must_m, created_at)
select v.title, v.kind, v.must_l, v.must_m, now() + v.n * interval '1 second'
from (values
  (1, 'MAMA', 'film', true, false),
  (2, 'The Danish Girl', 'film', true, false),
  (3, 'IT 1', 'film', false, false),
  (4, 'IT 2', 'film', false, false),
  (5, 'Mother', 'film', true, false),
  (6, 'Interstellar', 'film', true, false),
  (7, 'On the Basis of Sex', 'film', false, false),
  (8, 'Coraline', 'film', true, false),
  (9, 'I Am Mother', 'film', true, false),
  (10, 'Disko', 'film', false, false),
  (11, 'The King''s Speech', 'film', false, false),
  (12, 'Mamma Mia 1', 'film', false, false),
  (13, 'Mamma Mia 2', 'film', false, false),
  (14, 'Raya and the Last Dragon', 'film', true, true),
  (15, 'David Attenborough: Et liv på vår planet', 'film', true, false),
  (16, 'Framing Britney Spears', 'film', false, false),
  (17, 'A Walk to Remember', 'film', true, false),
  (18, 'The Last Song', 'film', true, false),
  (19, 'The Imitation Game', 'film', true, false),
  (20, 'The Truman Show', 'film', true, false),
  (21, 'Schindlers liste', 'film', true, true),
  (22, 'The Revenant', 'film', true, false),
  (23, 'The Grand Budapest Hotel', 'film', false, false),
  (24, 'The Secret Life of Bees', 'film', false, false),
  (25, '1917', 'film', true, false),
  (26, 'Frihetens regn', 'film', true, false),
  (27, 'Bridget Jones 4', 'film', false, false),
  (28, 'Springsteen', 'film', true, true),
  (29, 'Se meg', 'film', false, true),
  (30, 'F1', 'film', false, true),
  (31, 'Nosferatu', 'film', true, true),
  (32, 'Now You See Me 1', 'film', false, false),
  (33, 'Now You See Me 2', 'film', false, false),
  (34, 'Now You See Me 3', 'film', false, false),
  (35, 'Avatar 1', 'film', true, false),
  (36, 'Avatar 2', 'film', true, true),
  (37, 'Avatar 3', 'film', true, true),
  (38, 'Foreldrefellen', 'film', true, false),
  (39, 'The Greatest Showman', 'film', true, true),
  (40, 'Spy Kids 1', 'film', true, true),
  (41, 'Spy Kids 2', 'film', true, true),
  (42, 'Spy Kids 3', 'film', true, true),
  (43, 'Spy Kids 4', 'film', false, false),
  (44, 'Spy Kids 5', 'film', false, false),
  (45, 'Ford v Ferrari', 'film', true, true),
  (46, 'Office Space', 'film', true, true),
  (47, 'The Big Short', 'film', true, true),
  (48, 'Too Big to Fail', 'film', true, true),
  (49, 'Margin Call', 'film', true, true),
  (50, 'The Wizard of Lies', 'film', true, true),
  (51, 'The Talented Mr. Ripley', 'film', true, true),
  (52, 'Inside Job', 'film', true, true),
  (53, 'Becoming Warren Buffett', 'film', true, true),
  (54, 'BlackBerry', 'film', true, true),
  (55, 'Dead Poets Society', 'film', true, true),
  (56, 'The Bear', 'film', false, true),
  (57, 'Dogma', 'film', false, true),
  (58, 'Ricky Stanicky', 'film', false, true),
  (59, 'Apex', 'film', false, true),
  (60, '100 Meters', 'film', false, true),
  (61, 'American Beauty', 'film', false, true),
  (62, 'Him', 'film', false, true),
  (63, 'Life Is Wonderful', 'film', false, true),
  (64, 'Creep', 'film', true, true),
  (65, 'Weird: The Al Yankovic Story', 'film', true, true),
  (66, 'Free Fall', 'film', false, true),
  (67, 'The Musical', 'film', false, false),
  (68, 'Five Nights at Freddy''s', 'film', true, true),
  (69, 'See', 'serie', true, false),
  (70, 'Love, Victor', 'serie', false, false),
  (71, 'Raised by Wolves', 'serie', true, false),
  (72, 'Mindhunter', 'serie', false, false)
) as v(n, title, kind, must_l, must_m)
on conflict (lower(title), kind) do nothing;

-- Verifisering (kjør etterpå):
-- select kind, count(*) from public.movies group by kind;  -- forventet: film 68, serie 4
-- select count(distinct created_at) from public.movies;    -- forventet: 72 (alle ulike)
