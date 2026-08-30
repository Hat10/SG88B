-- Kjør i Supabase SQL editor.
--
-- Legger til støtte for egendefinert gjentakelsesintervall ("hver X dager" /
-- "hver X uker") på todo_items, i tillegg til de fire faste alternativene
-- (daily/weekly/monthly/monthly-last) som fortsetter å virke helt uendret —
-- se REPEAT_LABELS/nextDeadline() i src/contexts/TodoContext.tsx. Ingen
-- eksisterende rader berøres av denne migrasjonen.
--
-- repeat_interval/repeat_unit er kun meningsfulle når repeat = 'custom' —
-- for de fire faste alternativene forblir de null, akkurat som før.
--
-- monthly/monthly-last er bevisst IKKE forsøkt uttrykt i denne unit+interval-
-- modellen: de har egen dato-klipping (siste dag i måneden, hopp over
-- ikke-eksisterende datoer) som en generisk "hver N måned" ikke uten videre
-- kan erstatte, og ingen har bedt om egendefinert intervall i måneder — se
-- samtalen. De to forblir derfor egne, spesielle repeat-verdier.

alter table public.todo_items
  add column repeat_interval int check (repeat_interval is null or repeat_interval > 0),
  add column repeat_unit text check (repeat_unit is null or repeat_unit in ('day', 'week'));

alter table public.todo_items
  drop constraint if exists todo_items_repeat_check;
alter table public.todo_items
  add constraint todo_items_repeat_check
    check (repeat is null or repeat in ('daily','weekly','monthly','monthly-last','custom'));
