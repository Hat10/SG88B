-- Engangs datakorreksjon, ikke en skjemaendring — hører derfor ikke hjemme i
-- scripts/schema-reconstructed.sql. Kjør i Supabase SQL editor.
--
-- Retter earned_at for de 10 allerede opptjente badgene til de historisk
-- korrekte tidspunktene, fastslått ut fra scripts/badge-earned-at-audit.sql
-- sin gjennomgang av ekte workout_sessions/workout_records-historikk (og,
-- for Tarans totalt_5, etter å ha luket ut en feilaktig/test-rad datert
-- 12. august som ikke hørte hjemme i historikken). Se samtalen for
-- bekreftelsen av hver enkelt dato.
--
-- who + badge_key identifiserer raden (unique (who, badge_key) fra
-- trening-badges-migration.sql) — trygt å kjøre som separate UPDATE per rad.

begin;

-- ── Taran (L) ────────────────────────────────────────────────────────────
update public.earned_badges set earned_at = '2026-08-05 14:20:00+00' where who = 'L' and badge_key = 'forste_okt';
update public.earned_badges set earned_at = '2026-08-08 21:30:00+00' where who = 'L' and badge_key = 'forste_fjelltur';
update public.earned_badges set earned_at = '2026-08-08 21:30:00+00' where who = 'L' and badge_key = 'ukestreak_1';
update public.earned_badges set earned_at = '2024-08-10 00:00:00+00' where who = 'L' and badge_key = 'forste_rekord';
update public.earned_badges set earned_at = '2026-08-13 22:00:00+00' where who = 'L' and badge_key = 'totalt_5';

-- ── Andreas (M) ──────────────────────────────────────────────────────────
update public.earned_badges set earned_at = '2026-08-03 18:19:00+00' where who = 'M' and badge_key = 'forste_okt';
update public.earned_badges set earned_at = '2026-08-07 22:00:00+00' where who = 'M' and badge_key = 'totalt_5';
update public.earned_badges set earned_at = '2026-08-07 22:00:00+00' where who = 'M' and badge_key = 'forste_fjelltur';
update public.earned_badges set earned_at = '2026-08-06 13:40:00+00' where who = 'M' and badge_key = 'ukestreak_1';
update public.earned_badges set earned_at = '2025-03-01 00:00:00+00' where who = 'M' and badge_key = 'forste_rekord';

-- Verifiser før commit — bør vise nøyaktig 10 rader, én per (who, badge_key)
-- over, med de nye tidspunktene.
select who, badge_key, earned_at
from public.earned_badges
where badge_key in ('forste_okt', 'totalt_5', 'forste_fjelltur', 'forste_rekord', 'ukestreak_1')
order by who, badge_key;

commit;
