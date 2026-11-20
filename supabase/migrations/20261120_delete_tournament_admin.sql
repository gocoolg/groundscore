-- GroundScore secure tournament deletion
-- Run this once in Supabase SQL Editor after reviewing the migration.
-- The Edge Function authenticates the admin password and invokes this function
-- using the Supabase service-role client. It is not executable by anon users.

create or replace function public.delete_tournament_admin(
  p_tournament_id uuid,
  p_expected_name text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  actual_name text;
  deleted_matches integer := 0;
begin
  select name
    into actual_name
    from public.tournaments
   where id = p_tournament_id
   for update;

  if actual_name is null then
    raise exception 'Tournament not found';
  end if;

  if actual_name <> p_expected_name then
    raise exception 'Tournament name confirmation does not match';
  end if;

  -- Matches are deleted first because tournament_id on matches is SET NULL.
  -- Match deletion cascades to innings, players and ball-by-ball records.
  delete from public.matches
   where tournament_id = p_tournament_id;
  get diagnostics deleted_matches = row_count;

  -- Tournament deletion cascades to members, teams and saved team players.
  delete from public.tournaments
   where id = p_tournament_id;

  return jsonb_build_object(
    'deleted_tournament_id', p_tournament_id,
    'deleted_matches', deleted_matches
  );
end;
$function$;

revoke all on function public.delete_tournament_admin(uuid, text) from public;
revoke all on function public.delete_tournament_admin(uuid, text) from anon;
revoke all on function public.delete_tournament_admin(uuid, text) from authenticated;
grant execute on function public.delete_tournament_admin(uuid, text) to service_role;

notify pgrst, 'reload schema';
