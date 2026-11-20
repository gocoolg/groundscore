-- GroundScore test-data reset helper
--
-- STEP 1: Run this file as-is to REVIEW what is currently stored.
-- It does not delete anything.
--
-- STEP 2: Only if this Supabase project contains test data exclusively,
-- copy the commented DELETE block into a separate query, uncomment it,
-- review it once more, and execute it.
--
-- WARNING: the DELETE block removes ALL tournaments and ALL matches,
-- including innings, deliveries, players, memberships, teams and squads.
-- Do not run it if the database contains any real match/tournament data.

select
  (select count(*) from public.tournaments) as tournaments,
  (select count(*) from public.tournament_members) as tournament_members,
  (select count(*) from public.teams) as teams,
  (select count(*) from public.team_players) as saved_team_players,
  (select count(*) from public.matches) as matches,
  (select count(*) from public.players) as match_players,
  (select count(*) from public.innings) as innings,
  (select count(*) from public.balls) as deliveries;

select
  t.id,
  t.name,
  t.event_date,
  t.status,
  count(distinct m.id) as match_count,
  count(distinct b.id) as delivery_count
from public.tournaments t
left join public.matches m on m.tournament_id = t.id
left join public.balls b on b.match_id = m.id
group by t.id, t.name, t.event_date, t.status
order by t.created_at desc;

-- STEP 2 — DESTRUCTIVE RESET (intentionally disabled by default)
-- Run only after reviewing the counts and confirming all rows are disposable.
--
-- begin;
-- delete from public.matches;      -- cascades to match players, innings, deliveries
-- delete from public.tournaments;  -- cascades to memberships, teams and saved squads
-- commit;
