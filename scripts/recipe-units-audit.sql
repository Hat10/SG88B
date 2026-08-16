-- Diagnostikk, ikke en migrasjon — kjør i Supabase SQL editor og del resultatet.
--
-- Lister alle enheter som i dag finnes i recipes.ingredients (jsonb), men som
-- IKKE matcher noen av de faste valgene i den nye nedtrekksmenyen for enhet
-- (stk, g, kg, dl, ml, l, ts, ss, klype, boks/pakke). Matching er
-- case-insensitiv og trimmet, samme som appen selv bruker. Endrer ingenting —
-- kun til å avgjøre om avvikende verdier (f.eks. "Liter" med stor L) skal
-- migreres/normaliseres eller stå som de er.

select
  ing ->> 'unit' as unit,
  count(*)        as antall_forekomster,
  array_agg(distinct r.name order by r.name) as brukt_i_oppskrifter
from public.recipes r,
     jsonb_array_elements(r.ingredients) as ing
where ing ->> 'unit' is not null
  and trim(ing ->> 'unit') <> ''
  and lower(trim(ing ->> 'unit')) not in
    ('stk', 'g', 'kg', 'dl', 'ml', 'l', 'ts', 'ss', 'klype', 'boks/pakke')
group by ing ->> 'unit'
order by unit;
