-- GroundScore live site viewer presence
-- Run once in Supabase Dashboard -> SQL Editor.
-- Counts active browser sessions using short-lived heartbeats. No personal data is stored.

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
