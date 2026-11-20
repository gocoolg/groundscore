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
create table if not exists public.tournament_members (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  name text not null,
  joined_at timestamptz not null default now(),
  unique(tournament_id, name)
);

create table if not exists public.matches (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid references public.tournaments(id) on delete set null,
  team1 text not null, team2 text not null,
  overs integer not null check (overs between 1 and 50),
  toss_winner text not null,
  toss_decision text not null check (toss_decision in ('bat','bowl')),
  status text not null default 'live' check (status in ('live','finished')),
  current_innings integer not null default 1,
  created_by text not null,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create table if not exists public.players (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  tournament_id uuid references public.tournaments(id) on delete set null,
  team text not null check (team in ('team1','team2')), name text not null
);
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
  over_number integer not null, ball_number integer not null check (ball_number between 1 and 6),
  striker_id uuid references public.players(id), non_striker_id uuid references public.players(id), bowler_id uuid references public.players(id),
  runs integer not null default 0 check (runs between 0 and 6), runs_off_bat integer not null default 0 check (runs_off_bat between 0 and 6),
  extra_type text check (extra_type in ('wide','no-ball','bye','leg-bye')),
  extra_runs integer not null default 0, total_runs integer not null default 0,
  wicket text check (wicket in ('bowled','caught','lbw','run out','stumped','hit wicket')),
  dismissed_batsman_id uuid references public.players(id),
  next_striker_id uuid references public.players(id),
  next_non_striker_id uuid references public.players(id),
  next_batter_id uuid references public.players(id),
  scorer_name text not null, created_at timestamptz not null default now()
);

alter table public.matches add column if not exists tournament_id uuid references public.tournaments(id) on delete set null;
alter table public.players add column if not exists tournament_id uuid references public.tournaments(id) on delete set null;
alter table public.balls add column if not exists next_striker_id uuid references public.players(id);
alter table public.balls add column if not exists next_non_striker_id uuid references public.players(id);
alter table public.balls add column if not exists next_batter_id uuid references public.players(id);

create index if not exists matches_tournament_idx on public.matches(tournament_id, created_at desc);
create index if not exists members_tournament_idx on public.tournament_members(tournament_id, name);
create index if not exists balls_match_idx on public.balls(match_id, innings_no, created_at desc);
create index if not exists players_match_idx on public.players(match_id, team);

alter table public.tournaments enable row level security;
alter table public.tournament_members enable row level security;
alter table public.matches enable row level security;
alter table public.players enable row level security;
alter table public.innings enable row level security;
alter table public.balls enable row level security;

drop policy if exists tournaments_public on public.tournaments;
create policy tournaments_public on public.tournaments for all to anon using (true) with check (true);
drop policy if exists tournament_members_public on public.tournament_members;
create policy tournament_members_public on public.tournament_members for all to anon using (true) with check (true);
drop policy if exists matches_public on public.matches;
create policy matches_public on public.matches for all to anon using (true) with check (true);
drop policy if exists players_public on public.players;
create policy players_public on public.players for all to anon using (true) with check (true);
drop policy if exists innings_public on public.innings;
create policy innings_public on public.innings for all to anon using (true) with check (true);
drop policy if exists balls_public on public.balls;
create policy balls_public on public.balls for all to anon using (true) with check (true);

grant usage on schema public to anon;
grant select, insert, update, delete on public.tournaments, public.tournament_members, public.matches, public.players, public.innings, public.balls to anon;
