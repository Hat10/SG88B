-- Trening: valgfritt notat på en registrert økt (06.08.2026)
--
-- Legger til en fritekstkolonne «note» på workout_sessions. Notatet beskriver
-- selve økta (øvelser, hvor hard/rolig den var, e.l.). For en sammen-økt bærer
-- begge radene samme notat. null / tom ⇒ intet notat.
--
-- Trygt å kjøre om igjen. Kjør i Supabase SQL editor.

alter table public.workout_sessions
  add column if not exists note text;
