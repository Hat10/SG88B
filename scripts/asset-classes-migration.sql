-- Run this in the Supabase SQL editor.
--
-- Splits the single "assets" number on finance_entries into four asset classes
-- (eiendom, aksjefond, rentefond, annet) so the prognosis can apply a different
-- expected return to each. The old "assets" column is kept and is written by the
-- app as the sum of the four, so nothing else breaks.

alter table finance_entries
  add column if not exists eiendom   numeric not null default 0,
  add column if not exists aksjefond numeric not null default 0,
  add column if not exists rentefond numeric not null default 0,
  add column if not exists annet     numeric not null default 0;

-- Preserve existing totals: move each row's old "assets" value into "annet" so no
-- data is lost. You can then re-categorise it into eiendom/aksjefond/rentefond
-- from the Landsbydrømmen page.
update finance_entries
  set annet = assets
  where coalesce(eiendom, 0) + coalesce(aksjefond, 0) + coalesce(rentefond, 0) + coalesce(annet, 0) = 0
    and coalesce(assets, 0) <> 0;
