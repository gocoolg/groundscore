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
