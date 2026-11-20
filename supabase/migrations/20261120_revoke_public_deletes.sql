-- Prevent anonymous clients from bypassing the password-protected delete flow.
-- Scoring uses inserts/updates and soft-undo, not hard DELETE.
revoke delete on public.tournaments, public.tournament_members, public.teams,
  public.team_players, public.matches, public.players, public.innings, public.balls from anon;

notify pgrst, 'reload schema';
