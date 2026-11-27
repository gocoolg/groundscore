-- GroundScore quick generic wicket support
-- Run once in Supabase Dashboard -> SQL Editor.
-- The scorer now records the dismissal as the generic value 'wicket' rather
-- than asking for bowled/caught/LBW/run out/stumped/hit wicket.

alter table public.balls
  drop constraint if exists balls_wicket_check;

alter table public.balls
  add constraint balls_wicket_check
  check (wicket in ('bowled','caught','lbw','run out','stumped','hit wicket','wicket'));

notify pgrst, 'reload schema';
