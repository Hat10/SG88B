-- Kjør i Supabase SQL editor. Følger opp scripts/todo-repeat-custom-migration.sql
-- (repeat = 'custom' med repeat_interval/repeat_unit): utvider repeat_unit med
-- 'month' som tredje enhet ved siden av 'day'/'week', og legger til
-- repeat_month_mode for å skille mellom de to måtene en måned kan telles på.
--
-- repeat_month_mode er kun meningsfull når repeat_unit = 'month':
--   'same_date' — samme dag i måneden, klippet til siste dag hvis den ikke
--                  finnes i målmåneden (samme logikk som det faste
--                  'monthly'-alternativet)
--   'last_day'  — alltid siste dag i måneden (samme logikk som det faste
--                  'monthly-last'-alternativet)
-- Se addMonthsSameDate()/lastDayOfMonthsAhead() i src/contexts/TodoContext.tsx,
-- som nå brukes av BÅDE de to faste alternativene og det egendefinerte
-- month-caset — ingen tredje kopi av dato-klippingen.
--
-- Ingen eksisterende rader berøres: repeat_unit var allerede fritt for 'day'/
-- 'week', og repeat_month_mode er en ny, nullable kolonne.

alter table public.todo_items
  drop constraint if exists todo_items_repeat_unit_check;
alter table public.todo_items
  add constraint todo_items_repeat_unit_check
    check (repeat_unit is null or repeat_unit in ('day', 'week', 'month'));

alter table public.todo_items
  add column repeat_month_mode text
    check (repeat_month_mode is null or repeat_month_mode in ('same_date', 'last_day'));
