-- GroundScore: coin toss metadata migration
-- Run this in Supabase Dashboard -> SQL Editor.
-- Safe to run more than once; it does not modify or delete match data.

alter table public.matches
  add column if not exists toss_call text
    check (toss_call in ('heads', 'tails'));

alter table public.matches
  add column if not exists toss_result text
    check (toss_result in ('heads', 'tails'));

alter table public.matches
  add column if not exists toss_tossed_at timestamptz;

-- Refresh the PostgREST API schema so the new columns are immediately available.
notify pgrst, 'reload schema';
