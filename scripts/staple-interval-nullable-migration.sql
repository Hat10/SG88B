-- Kjør i Supabase SQL editor.
--
-- Gjør interval_weeks nullable. null betyr nå eksplisitt "ingen kjøpsfrekvens
-- definert" — en ren referanse i Basisvarer-lista, som aldri regnes som
-- forfalt og aldri havner på handlelisten automatisk (se isStapleDue i
-- MatplanContext.tsx) — atskilt fra en eksplisitt verdi som f.eks. 1
-- ("hver uke"). Sorteringen i StapleManager bruker samme skille: varer med
-- definert intervall øverst (stigende), varer uten nederst.
--
-- Før denne migrasjonen hadde ALLE rader en tallverdi (kolonnen var
-- not null default 1), så eksisterende basisvarer som aldri fikk en
-- frekvens satt via UI leser fortsatt som "hver uke" etter denne
-- migrasjonen — det finnes ingen måte å skille dem fra faktisk ukentlige
-- varer i eksisterende data. Skillet gjelder derfor først fremover: nye
-- basisvarer uten kjøpsfrekvens lagres nå med null, og en eksisterende
-- vare kan settes til null ved redigering (tøm "Uker"-feltet).

alter table public.staple_items
  alter column interval_weeks drop not null,
  alter column interval_weeks drop default;

alter table public.staple_items
  drop constraint if exists staple_items_interval_weeks_check;
alter table public.staple_items
  add constraint staple_items_interval_weeks_check
    check (interval_weeks is null or interval_weeks >= 1);
