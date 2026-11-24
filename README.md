# GroundScore

A mobile-first cricket tournament and scoring web app. Static HTML/CSS/JavaScript + Supabase Postgres. No app install or login required for spectators.

## Current experience
- Tournament home, create/join flow, member roster and saved teams/squads.
- Shared player directory with autocomplete across tournaments; existing saved squads and match players are backfilled.
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


## Tournament deletion (admin password)

Tournament deletion is performed server-side; the admin password is never stored in `app.js`, `config.js`, or other public browser files.

1. Run [`supabase/migrations/20261120_delete_tournament_admin.sql`](supabase/migrations/20261120_delete_tournament_admin.sql) and [`supabase/migrations/20261120_revoke_public_deletes.sql`](supabase/migrations/20261120_revoke_public_deletes.sql) in Supabase Dashboard → SQL Editor. The second migration prevents anonymous REST clients from bypassing the password-protected delete flow with direct DELETE requests.
2. Install the Supabase CLI and sign in:
   ```bash
   supabase login
   supabase link --project-ref shyrcxrgccxtlsztebkb
   ```
3. Set the Edge Function password as a Supabase secret. To use the password requested for this first setup:
   ```bash
   supabase secrets set TOURNAMENT_DELETE_PASSWORD='Scoredel'
   ```
   This phrase has been shared in the development conversation. For a public app, replace it with a unique, stronger password before enabling deletion.
4. Deploy the Edge Function:
   ```bash
   supabase functions deploy delete-tournament --no-verify-jwt
   ```

The app sends the password in an HTTPS request to the Edge Function. The function checks it server-side, then calls a restricted database function using the service-role credential supplied by Supabase. Anonymous browser clients retain select/insert/update for normal scoring and soft-undo, but no longer have hard-delete privileges. It deletes the tournament's matches first (including innings, players and deliveries), then deletes the tournament (including members, teams and saved squads). The UI also requires the exact tournament name as a second confirmation.

The Edge Function is not deployed by GitHub Pages. It must be deployed separately using the CLI commands above. Do not put the service-role/secret key or the delete password in GitHub source files.

## Shared scorer directory

Run [`supabase/migrations/20261124_scorer_directory.sql`](supabase/migrations/20261124_scorer_directory.sql) in Supabase Dashboard → SQL Editor. Match setup uses a free-text scorer field with suggestions drawn from both current team squads, the shared player directory and previously used scorers. Any person can be entered as scorer; the selected name is stored on `matches.created_by` and registered separately in `scorer_directory` for future suggestions. Existing scorer names are backfilled from previous matches.

## Shared player directory

Run [`supabase/migrations/20261123_player_directory.sql`](supabase/migrations/20261123_player_directory.sql) in Supabase Dashboard → SQL Editor. This creates a reusable player-name directory, backfills names from saved squads and previous match lineups, and exposes read-only suggestions to the app. Team creation and match setup register new player names automatically. Names remain available across tournaments even when a team or tournament is deleted.

## Clear test data

Use [`supabase/reset_test_data.sql`](supabase/reset_test_data.sql) to inspect the current database counts and list tournaments with their match/delivery counts. The file is read-only by default. It includes a clearly commented reset block that deletes **all** matches and tournaments if uncommented. Only run that block if the Supabase project contains disposable test data exclusively; it also removes dependent scorecards, deliveries, players, memberships, teams and squads. Back up anything that should be retained first.

## License
MIT — see LICENSE.

### Coin toss database fix
If match creation reports that `toss_call` or `toss_result` is missing from the schema cache, run [`supabase/add_coin_toss_columns.sql`](supabase/add_coin_toss_columns.sql) in Supabase SQL Editor. This migration adds only the coin-toss fields and reloads the PostgREST schema. It is safe to run repeatedly and preserves existing match data.


Run [`supabase/migrations/20261123_player_directory.sql`](supabase/migrations/20261123_player_directory.sql) in Supabase Dashboard → SQL Editor. This creates a reusable player-name directory, backfills names from saved squads and previous match lineups, and exposes read-only suggestions to the app. Team creation and match setup register new player names automatically. Names remain available across tournaments even when a team or tournament is deleted.

## Clear test data

Use [`supabase/reset_test_data.sql`](supabase/reset_test_data.sql) to inspect the current database counts and list tournaments with their match/delivery counts. The file is read-only by default. It includes a clearly commented reset block that deletes **all** matches and tournaments if uncommented. Only run that block if the Supabase project contains disposable test data exclusively; it also removes dependent scorecards, deliveries, players, memberships, teams and squads. Back up anything that should be retained first.

## License
MIT — see LICENSE.

### Coin toss database fix
If match creation reports that `toss_call` or `toss_result` is missing from the schema cache, run [`supabase/add_coin_toss_columns.sql`](supabase/add_coin_toss_columns.sql) in Supabase SQL Editor. This migration adds only the coin-toss fields and reloads the PostgREST schema. It is safe to run repeatedly and preserves existing match data.
