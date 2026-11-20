# GroundScore

A mobile-first cricket tournament and scoring web app. Static HTML/CSS/JavaScript + Supabase Postgres. No app install or login required for spectators.

## Current experience
- Tournament home, create/join flow, member roster and saved teams/squads.
- Tournament tabs for matches, teams, standings and members.
- Match setup: overs, playing XI, venue, scheduled time and a random coin toss (Team 1 calls heads/tails; the winning team chooses bat or bowl).
- Sticky live scoreboard with current batters, bowler, CRR, RRR and chase target.
- Compact one-tap scoring keypad (0, 1, 2, 3, 4, 6).
- Bottom sheets for wides, no-balls, byes, leg-byes and wickets.
- Batter/bowler scorecards, extras, fall of wickets and ball-by-ball commentary.
- Automatic strike rotation for odd completed runs, end change after six legal balls, highlighted next-over bowler selection and new-batter confirmation after wickets.
- Soft undo (voids the delivery rather than deleting it), milestone celebrations and direct share links.
- Spectator polling every eight seconds while a match is open.

## Supabase setup / migration
1. Open Supabase Dashboard → SQL Editor.
2. Run the complete root `schema.sql` from this repository. It is an additive migration: it preserves existing match data and adds saved teams, squads, delivery sequence, extras, soft-undo and match metadata columns.
3. Keep the project URL and publishable key in `config.js`. Never place a service-role/secret key in frontend files.

## Local development
Node is only needed for tests. To serve the static site:
```bash
python3 -m http.server 8080
```
Open http://localhost:8080.

## Tests
```bash
npm test
```
GitHub Actions runs JavaScript syntax checks and the cricket scoring regression tests on pushes and pull requests.

## GitHub Pages
Repository Settings → Pages → Deploy from branch → `main` → `/(root)`. Share `https://<username>.github.io/groundscore/`. Use **Share** from a live match to copy its direct spectator link.

## Cricket scoring conventions
- Wides and no-balls do not count as legal balls; byes and leg-byes do.
- One penalty run is added automatically for a wide/no-ball. The extra sheet has fields for bat runs and additional completed runs. The coin toss call/result and decision are stored in the match record.
- Strike rotation uses completed-run parity; the one-run wide/no-ball penalty itself does not rotate strike. Ends change at the end of six legal deliveries.
- Batter balls-faced exclude wides but include no-balls, byes and leg-byes.
- Bowler runs conceded exclude byes and leg-byes. Run-outs are not credited to the bowler.
- A run-out records the dismissed batter, incoming batter, completed runs and crossing note. This is a recreational scorer, not a complete Laws-of-Cricket adjudicator; the scorer must enter the umpire's decision correctly.
- The app does not yet implement penalty runs, retired hurt, timed out, free-hit enforcement, DLS, super overs, full fielder/catch attribution or automatic multi-innings formats.

## Public access and security
The current no-login mode deliberately lets the public anonymous role read/write tournament and scoring tables. This is convenient for a trusted recreational group but not tamper-proof: anyone with access to the Supabase project endpoint may potentially change or delete data. For formal competitions, introduce authenticated scorers, organizer permissions, restrictive RLS, server-side delivery RPC and an immutable correction audit trail.

## License
MIT — see LICENSE.

### Coin toss database fix
If match creation reports that `toss_call` or `toss_result` is missing from the schema cache, run [`supabase/add_coin_toss_columns.sql`](supabase/add_coin_toss_columns.sql) in Supabase SQL Editor. This migration adds only the coin-toss fields and reloads the PostgREST schema. It is safe to run repeatedly and preserves existing match data.
