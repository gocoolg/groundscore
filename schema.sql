-- GroundScore schema and additive upgrade migration.
-- Safe to rerun: existing tournaments, matches and balls are preserved.
create extension if not exists pgcrypto;

create table if not exists public.tournaments (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  event_date date,
  venue text,
  status text not null default 'upcoming' check (status in ('upcoming','live','completed')),
  created_by text not null,
  created_at timestamptz not null default now()
);
alter table public.tournaments add column if not exists format text not null default 'friendly';
alter table public.tournaments add column if not exists updated_at timestamptz not null default now();

create table if not exists public.tournament_members (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  name text not null,
  joined_at timestamptz not null default now(),
  unique(tournament_id, name)
);

create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  unique(tournament_id, name)
);
create table if not exists public.team_players (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  name text not null,
  batting_hand text,
  bowling_style text,
  created_at timestamptz not null default now(),
  unique(team_id, name)
);

create table if not exists public.matches (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid references public.tournaments(id) on delete set null,
  team1 text not null,
  team2 text not null,
  overs integer not null check (overs between 1 and 50),
  toss_winner text not null,
  toss_decision text not null check (toss_decision in ('bat','bowl')),
  status text not null default 'live' check (status in ('live','finished')),
  current_innings integer not null default 1,
  created_by text not null,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
alter table public.matches add column if not exists team1_id uuid references public.teams(id) on delete set null;
alter table public.matches add column if not exists team2_id uuid references public.teams(id) on delete set null;
alter table public.matches add column if not exists innings1_batting_team_id uuid references public.teams(id) on delete set null;
alter table public.matches add column if not exists scheduled_at timestamptz;
alter table public.matches add column if not exists round_name text;
alter table public.matches add column if not exists players_per_team integer not null default 11;
alter table public.matches add column if not exists venue text;
alter table public.matches add column if not exists updated_at timestamptz not null default now();
alter table public.matches add column if not exists toss_call text check (toss_call in ('heads','tails'));
alter table public.matches add column if not exists toss_result text check (toss_result in ('heads','tails'));
alter table public.matches add column if not exists toss_tossed_at timestamptz;


create table if not exists public.players (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  team text not null check (team in ('team1','team2')),
  name text not null
);
alter table public.players add column if not exists tournament_id uuid references public.tournaments(id) on delete set null;
alter table public.players add column if not exists team_id uuid references public.teams(id) on delete set null;

create table if not exists public.innings (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  innings_no integer not null check (innings_no in (1,2)),
  batting_team text not null check (batting_team in ('team1','team2')),
  bowling_team text not null check (bowling_team in ('team1','team2')),
  status text not null default 'live' check (status in ('live','completed')),
  unique(match_id, innings_no)
);

create table if not exists public.balls (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  innings_no integer not null check (innings_no in (1,2)),
  over_number integer not null,
  ball_number integer not null check (ball_number between 1 and 6),
  striker_id uuid references public.players(id),
  non_striker_id uuid references public.players(id),
  bowler_id uuid references public.players(id),
  runs integer not null default 0 check (runs between 0 and 6),
  runs_off_bat integer not null default 0 check (runs_off_bat between 0 and 6),
  extra_type text check (extra_type in ('wide','no-ball','bye','leg-bye')),
  extra_runs integer not null default 0,
  total_runs integer not null default 0,
  wicket text check (wicket in ('bowled','caught','lbw','run out','stumped','hit wicket')),
  dismissed_batsman_id uuid references public.players(id),
  next_striker_id uuid references public.players(id),
  next_non_striker_id uuid references public.players(id),
  next_batter_id uuid references public.players(id),
  scorer_name text not null,
  created_at timestamptz not null default now()
);
alter table public.balls add column if not exists delivery_number integer;
alter table public.balls add column if not exists wide_runs integer not null default 0;
alter table public.balls add column if not exists no_ball_runs integer not null default 0;
alter table public.balls add column if not exists bye_runs integer not null default 0;
alter table public.balls add column if not exists leg_bye_runs integer not null default 0;
alter table public.balls add column if not exists running_runs integer not null default 0;
alter table public.balls add column if not exists is_boundary boolean not null default false;
alter table public.balls add column if not exists crossed_before_wicket boolean not null default false;
alter table public.balls add column if not exists voided_at timestamptz;
alter table public.balls add column if not exists voided_by text;
alter table public.balls add column if not exists idempotency_key uuid;

-- Backfill sequence/stat fields for matches scored before this version.
with numbered as (
  select id, row_number() over (
    partition by match_id, innings_no
    order by created_at, id
  ) as seq
  from public.balls
  where delivery_number is null
)
update public.balls b set delivery_number = n.seq
from numbered n where b.id = n.id;

update public.balls
set
  wide_runs = case when extra_type = 'wide' then greatest(extra_runs, 1) else wide_runs end,
  no_ball_runs = case when extra_type = 'no-ball' then greatest(no_ball_runs, 1) else no_ball_runs end,
  bye_runs = case when extra_type = 'bye' then extra_runs else bye_runs end,
  leg_bye_runs = case when extra_type = 'leg-bye' then extra_runs else leg_bye_runs end,
  running_runs = case
    when extra_type = 'wide' then greatest(extra_runs - 1, 0)
    when extra_type in ('bye','leg-bye') then extra_runs
    else runs_off_bat
  end,
  is_boundary = case when runs_off_bat in (4,6) then true else is_boundary end
where delivery_number is not null;

create index if not exists matches_tournament_idx on public.matches(tournament_id, created_at desc);
create index if not exists matches_team1_idx on public.matches(team1_id);
create index if not exists matches_team2_idx on public.matches(team2_id);
create index if not exists members_tournament_idx on public.tournament_members(tournament_id, name);
create index if not exists teams_tournament_idx on public.teams(tournament_id, name);
create index if not exists team_players_team_idx on public.team_players(team_id, name);
create index if not exists balls_match_idx on public.balls(match_id, innings_no, delivery_number);
create index if not exists players_match_idx on public.players(match_id, team);
create unique index if not exists balls_delivery_sequence_uq on public.balls(match_id, innings_no, delivery_number) where delivery_number is not null;
create unique index if not exists balls_idempotency_uq on public.balls(idempotency_key) where idempotency_key is not null;

alter table public.tournaments enable row level security;
alter table public.tournament_members enable row level security;
alter table public.teams enable row level security;
alter table public.team_players enable row level security;
alter table public.matches enable row level security;
alter table public.players enable row level security;
alter table public.innings enable row level security;
alter table public.balls enable row level security;

drop policy if exists tournaments_public on public.tournaments;
create policy tournaments_public on public.tournaments for all to anon using (true) with check (true);
drop policy if exists tournament_members_public on public.tournament_members;
create policy tournament_members_public on public.tournament_members for all to anon using (true) with check (true);
drop policy if exists teams_public on public.teams;
create policy teams_public on public.teams for all to anon using (true) with check (true);
drop policy if exists team_players_public on public.team_players;
create policy team_players_public on public.team_players for all to anon using (true) with check (true);
drop policy if exists matches_public on public.matches;
create policy matches_public on public.matches for all to anon using (true) with check (true);
drop policy if exists players_public on public.players;
create policy players_public on public.players for all to anon using (true) with check (true);
drop policy if exists innings_public on public.innings;
create policy innings_public on public.innings for all to anon using (true) with check (true);
drop policy if exists balls_public on public.balls;
create policy balls_public on public.balls for all to anon using (true) with check (true);

grant usage on schema public to anon;
grant select, insert, update on public.tournaments, public.tournament_members, public.teams, public.team_players, public.matches, public.players, public.innings, public.balls to anon;

-- Anonymous users can score and soft-undo deliveries, but must not hard-delete data.
revoke delete on public.tournaments, public.tournament_members, public.teams,
  public.team_players, public.matches, public.players, public.innings, public.balls from anon;


-- Reusable player directory, also available in the standalone migration.
-- GroundScore reusable player directory
-- Run this once in Supabase Dashboard -> SQL Editor.
-- Player names are retained independently of tournaments and saved teams so
-- the same players can be suggested in future tournaments.

create table if not exists public.player_directory (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 80),
  normalized_name text not null unique,
  created_at timestamptz not null default now()
);

-- Seed suggestions from existing saved team squads and historical match players.
with source_names as (
  select name from public.team_players
  union all
  select name from public.players
),
cleaned as (
  select regexp_replace(btrim(name), '\s+', ' ', 'g') as clean_name
  from source_names
  where name is not null
),
normalized as (
  select clean_name, lower(clean_name) as normalized_name
  from cleaned
  where clean_name <> '' and length(clean_name) <= 80
)
insert into public.player_directory (name, normalized_name)
select distinct on (normalized_name) clean_name, normalized_name
from normalized
order by normalized_name, clean_name
on conflict (normalized_name) do nothing;

create index if not exists player_directory_name_idx
  on public.player_directory (name);

alter table public.player_directory enable row level security;

drop policy if exists player_directory_read on public.player_directory;
create policy player_directory_read
  on public.player_directory
  for select to anon
  using (true);

grant select on public.player_directory to anon;
revoke insert, update, delete on public.player_directory from anon, authenticated;

-- Writes go through this SQL function, which normalizes names and ignores duplicates.
create or replace function public.register_player_directory_names(p_names text[])
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  inserted_count integer := 0;
begin
  with cleaned as (
    select regexp_replace(btrim(value), '\s+', ' ', 'g') as clean_name
    from unnest(coalesce(p_names, array[]::text[])) as entries(value)
  ),
  normalized as (
    select distinct on (lower(clean_name))
      clean_name,
      lower(clean_name) as normalized_name
    from cleaned
    where clean_name is not null
      and clean_name <> ''
      and length(clean_name) <= 80
    order by lower(clean_name), clean_name
  )
  insert into public.player_directory (name, normalized_name)
  select clean_name, normalized_name
  from normalized
  on conflict (normalized_name) do nothing;

  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$function$;

revoke all on function public.register_player_directory_names(text[]) from public;
revoke all on function public.register_player_directory_names(text[]) from authenticated;
grant execute on function public.register_player_directory_names(text[]) to anon;
grant execute on function public.register_player_directory_names(text[]) to service_role;

notify pgrst, 'reload schema';


-- Reusable scorer directory, also available in the standalone migration.
-- GroundScore reusable scorer directory
-- Run once in Supabase Dashboard -> SQL Editor.
-- Scorers are stored independently from tournament members and team players.
-- Free-text scorer names remain valid; matches.created_by still stores the
-- actual scorer on each match record.

create table if not exists public.scorer_directory (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 80),
  normalized_name text not null unique,
  created_at timestamptz not null default now()
);

-- Backfill previously used scorer names from existing matches.
with cleaned as (
  select regexp_replace(btrim(created_by), '\s+', ' ', 'g') as clean_name
  from public.matches
  where created_by is not null
),
normalized as (
  select clean_name, lower(clean_name) as normalized_name
  from cleaned
  where clean_name <> '' and length(clean_name) <= 80
)
insert into public.scorer_directory (name, normalized_name)
select distinct on (normalized_name) clean_name, normalized_name
from normalized
order by normalized_name, clean_name
on conflict (normalized_name) do nothing;

create index if not exists scorer_directory_name_idx
  on public.scorer_directory (name);

alter table public.scorer_directory enable row level security;

drop policy if exists scorer_directory_read on public.scorer_directory;
create policy scorer_directory_read
  on public.scorer_directory
  for select to anon
  using (true);

grant select on public.scorer_directory to anon;
revoke insert, update, delete on public.scorer_directory from anon, authenticated;

-- Register a scorer from the match setup free-text field.
create or replace function public.register_scorer_directory_name(p_name text)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  clean_name text;
  inserted_count integer := 0;
begin
  clean_name := regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g');

  if clean_name = '' or length(clean_name) > 80 then
    return 0;
  end if;

  insert into public.scorer_directory (name, normalized_name)
  values (clean_name, lower(clean_name))
  on conflict (normalized_name) do nothing;

  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$function$;

revoke all on function public.register_scorer_directory_name(text) from public;
revoke all on function public.register_scorer_directory_name(text) from authenticated;
grant execute on function public.register_scorer_directory_name(text) to anon;
grant execute on function public.register_scorer_directory_name(text) to service_role;

notify pgrst, 'reload schema';


-- Live site viewer presence (also available as a standalone migration).
create table if not exists public.site_viewers (
  session_id uuid primary key,
  last_seen_at timestamptz not null default now()
);
create index if not exists site_viewers_last_seen_idx
  on public.site_viewers (last_seen_at);
alter table public.site_viewers enable row level security;
revoke all on public.site_viewers from public, anon, authenticated;

create or replace function public.record_site_viewer(p_session_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  active_count integer := 0;
begin
  if p_session_id is null then return 0; end if;
  insert into public.site_viewers (session_id, last_seen_at)
  values (p_session_id, now())
  on conflict (session_id) do update
    set last_seen_at = excluded.last_seen_at
    where public.site_viewers.last_seen_at < now() - interval '10 seconds';
  delete from public.site_viewers
  where last_seen_at < now() - interval '10 minutes';
  select count(*)::integer into active_count
  from public.site_viewers
  where last_seen_at >= now() - interval '75 seconds';
  return active_count;
end;
$function$;
revoke all on function public.record_site_viewer(uuid) from public;
revoke all on function public.record_site_viewer(uuid) from authenticated;
grant execute on function public.record_site_viewer(uuid) to anon;
grant execute on function public.record_site_viewer(uuid) to service_role;
notify pgrst, 'reload schema';
