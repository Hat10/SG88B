-- Sparing som egen førsteklasses transaksjonstype (kind = 'investment').
-- Kjøres i Supabase SQL editor ETTER import-v2-migration.sql.
--
-- Innskudd til og uttak fra investering (Kron, Nordnet, BSU …) er verken
-- forbruk eller inntekt — de flyttes til egen kind så forbruks- og
-- inntektstallene blir rene og «Til overs» kan regnes konsistent.

begin;

-- 1) Utvid lovlige kind-verdier
alter table transactions drop constraint if exists transactions_kind_check;
alter table transactions add constraint transactions_kind_check
  check (kind in ('purchase','refund','income','investment','internal','card_settlement','p2p'));

-- 2) Flytt eksisterende investeringsrader (begge retninger) til ny kind
update transactions set kind = 'investment' where category = 'investering';

commit;
