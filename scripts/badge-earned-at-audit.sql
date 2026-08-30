-- Diagnostikk, ikke en migrasjon — kjør i Supabase SQL editor og del resultatet.
--
-- Finner når hver av de 9 allerede opptjente badgene faktisk BURDE vært
-- opptjent, basert på ekte treningshistorikk (workout_sessions/
-- workout_records), til sammenligning mot earned_badges.earned_at (som i
-- dag bare reflekterer når badge-koden tilfeldigvis sjekket og fant
-- betingelsen oppfylt — se forrige svar for hvorfor de kan avvike).
--
-- Betingelsene er hentet direkte fra BADGE_DEFS i src/pages/Trening.tsx:
--
--   forste_okt      : totalCompleted(ctx) >= 1
--                      → den kronologisk FØRSTE fullførte økta.
--   totalt_5        : totalCompleted(ctx) >= 5
--                      → den kronologisk 5. fullførte økta.
--   forste_fjelltur : triedCategory(ctx, ['Fjelltur'])
--                      → den kronologisk FØRSTE fullførte økta med
--                        category = 'Fjelltur'.
--   forste_rekord   : ctx.records.some(r => r.who === ctx.who)
--                      → den kronologisk FØRSTE raden i workout_records.
--   ukestreak_1     : personalWeekStreak(ctx) >= 1, altså weekStreak(...) >= 1
--                      → den TIDLIGSTE mandag-til-søndag-uken (Europe/Oslo,
--                        samme uke-anker som startOfWeek i treningPulse.ts)
--                        der personen har >= STREAK_MIN_SESSIONS (3)
--                        fullførte økter, og innenfor den uken: tidspunktet
--                        for den 3. økten kronologisk (det er da kravet
--                        faktisk ble oppfylt, ikke uken sin første dag).
--
-- "Fullført" betyr completed_at is not null i alle spørringene pinner
-- (samme filter som totalCompleted/triedCategory bruker).

-- ── forste_okt ──────────────────────────────────────────────────────────────
select who, min(started_at) as forste_okt_dato
from public.workout_sessions
where completed_at is not null and who in ('M','L')
group by who
order by who;

-- ── totalt_5 ────────────────────────────────────────────────────────────────
select who, started_at as totalt_5_dato, category
from (
  select who, started_at, category,
         row_number() over (partition by who order by started_at) as rn
  from public.workout_sessions
  where completed_at is not null and who in ('M','L')
) ranked
where rn = 5
order by who;

-- ── forste_fjelltur ─────────────────────────────────────────────────────────
select who, min(started_at) as forste_fjelltur_dato
from public.workout_sessions
where completed_at is not null and who in ('M','L') and category = 'Fjelltur'
group by who
order by who;

-- ── forste_rekord ───────────────────────────────────────────────────────────
select who, date as forste_rekord_dato, exercise, value, unit
from (
  select who, date, exercise, value, unit,
         row_number() over (partition by who order by date, id) as rn
  from public.workout_records
  where who in ('M','L')
) ranked
where rn = 1
order by who;

-- ── ukestreak_1 ─────────────────────────────────────────────────────────────
-- Uke-grensen regnes i Europe/Oslo-lokal tid (at time zone), samme som
-- startOfWeek(new Date(s.startedAt)) i appen — date_trunc('week', ...) er
-- mandag-ankret i Postgres, akkurat som startOfWeek.
with weekly as (
  select who, started_at,
         date_trunc('week', started_at at time zone 'Europe/Oslo') as week_start,
         row_number() over (
           partition by who, date_trunc('week', started_at at time zone 'Europe/Oslo')
           order by started_at
         ) as rn_in_week
  from public.workout_sessions
  where completed_at is not null and who in ('M','L')
),
qualifying_weeks as (
  select who, week_start, count(*) as sessions_in_week
  from weekly
  group by who, week_start
  having count(*) >= 3
)
select w.who, q.week_start, w.started_at as ukestreak_1_dato
from weekly w
join qualifying_weeks q on q.who = w.who and q.week_start = w.week_start
where w.rn_in_week = 3
  and q.week_start = (select min(week_start) from qualifying_weeks qq where qq.who = w.who)
order by w.who;

-- ── Til sammenligning: dagens (mulig upresise) earned_at ───────────────────
select who, badge_key, earned_at
from public.earned_badges
where badge_key in ('forste_okt', 'totalt_5', 'forste_fjelltur', 'forste_rekord', 'ukestreak_1')
order by who, badge_key;
