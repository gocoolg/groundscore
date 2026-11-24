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
