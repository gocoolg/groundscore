# GroundScore 🏏

**Every game has a story.**

GroundScore is a mobile-first cricket scoring and tournament platform for local clubs, teams and recreational cricket communities. Create tournaments, manage squads, score matches ball by ball, share live scorecards and keep player records in one place.

- **Live app:** https://gocoolg.github.io/groundscore/
- **Repository:** https://github.com/gocoolg/groundscore
- **Stack:** HTML, CSS, JavaScript modules and Supabase
- **Deployment:** GitHub Pages + Supabase

[![GroundScore checks](https://github.com/gocoolg/groundscore/actions/workflows/ci.yml/badge.svg)](https://github.com/gocoolg/groundscore/actions/workflows/ci.yml)

---

## Contents

- [What GroundScore does](#what-groundscore-does)
- [Match-day experience](#match-day-experience)
- [Technology](#technology)
- [Repository layout](#repository-layout)
- [Get started](#get-started)
- [Configure Supabase](#configure-supabase)
- [Run locally](#run-locally)
- [Tests and checks](#tests-and-checks)
- [Deploy to GitHub Pages](#deploy-to-github-pages)
- [Tournament deletion setup](#tournament-deletion-setup)
- [Database maintenance](#database-maintenance)
- [Current limitations](#current-limitations)
- [Security notes](#security-notes)
- [License](#license)

---

## What GroundScore does

### Tournament management
- Create tournaments in friendly, league or knockout formats.
- Join an event with a display name.
- Manage tournament members, teams and saved squads.
- Maintain fixtures and results in a tournament centre.
- View league standings and net run rate calculated from completed matches.
- Compare tournament-wide player leaders for runs, wickets, sixes, fours and dot balls.
- Share a direct tournament metrics link using `?tournament=<tournament-id>&view=metrics`; recipients open directly on that tournament's Metrics tab.

### Teams and player directory
- Save a team's squad and reuse it when creating future matches.
- Register player names in a shared directory.
- Get autocomplete suggestions from previously used players when entering a new squad.
- Retain player suggestions across tournaments, independently of a team's saved squad.

### Match setup
- Configure overs, playing-XI size, round, venue and scheduled time.
- Select a scorer from suggestions or enter any scorer's name as free text.
- Save scorer names separately so they can be suggested for later matches.
- Use a coin toss for a new match: Team 1 calls heads or tails, the coin determines the winner, and the winner chooses to bat or bowl.

### Live scoring and scorecards
- Sticky live scoreboard with score, overs, current batters, bowler, current run rate, required run rate and chase target.
- One-tap scoring for 0, 1, 2, 3, 4 and 6.
- Quick extras popup for wides and no-balls, with a one-run penalty applied automatically and 0–6 additional-run chips.
- Quick generic wicket popup with the striker selected by default; choose the dismissed batter, record the wicket, then select the replacement batter at the crease.
- Automatic strike rotation based on completed-run parity and end changes after six legal deliveries; when only one eligible batter remains, they can continue scoring alone without a non-striker until dismissed.
- New-batter confirmation after a wicket and bowler selection at the start of a new over.
- Batting and bowling scorecards for both innings, including the completed first innings while the second-innings chase is live, plus extras, fall of wickets and ball-by-ball commentary.
- Soft undo: a delivery is voided rather than physically deleted.
- Team and batter milestone celebrations.

### Spectator sharing
- Copy a direct link to an individual match.
- Spectators can open the match without installing an app or creating an account.
- The open match view refreshes from Supabase every eight seconds.
- The homepage displays an approximate live count of active browser sessions, refreshed through a lightweight Supabase heartbeat every 25 seconds. Sessions expire from the count after 75 seconds without a heartbeat.
- Open **Display** on a match to show a simplified full-screen scoreboard. It adapts to portrait and landscape and refreshes with the live match data. The app requests the browser Screen Wake Lock API when available; device/browser support and power-saving settings determine whether the screen can stay awake.

### Back-to-back rematches
- A completed scorecard can offer **Start next match** when there is a winner.
- The next match carries over both teams and their playing XIs.
- The team that won the previous match gets to choose whether to bat or bowl first.
- A rematch is saved as a separate match; the previous scorecard remains unchanged.

---

## Match-day experience

A typical flow looks like this:

1. Create a tournament and add teams and squads.
2. Start a match, select the scorer and confirm both playing XIs.
3. Complete the toss and let the toss winner choose bat or bowl.
4. Confirm the opening batters and bowler, then score each delivery.
5. End the first innings and begin the chase. The match is automatically completed when the chasing team reaches its target; the scorer can also finish a match manually.
6. Review and share the final scorecard.
7. Start a rematch with the same teams, allowing the previous winner to choose bat or bowl.

---

## Technology

| Layer | Implementation |
|---|---|
| User interface | HTML and CSS |
| Application logic | Vanilla JavaScript ES modules |
| Scoring rules | `js/scoring-engine.js` |
| Database | Supabase Postgres |
| Data access | Supabase REST API using a publishable key |
| Server-side admin action | Supabase Edge Function (Deno) |
| Hosting | GitHub Pages |
| Automated checks | Node.js test runner and Deno type-check |

No frontend framework or build step is required for the static web app.

---

## Repository layout

```text
groundscore/
├── index.html
├── styles.css
├── app.js
├── config.js
├── schema.sql
├── js/
│   └── scoring-engine.js
├── tests/
│   └── scoring-engine.test.js
├── supabase/
│   ├── add_coin_toss_columns.sql
│   ├── migrations/
│   ├── functions/
│   │   └── delete-tournament/
│   │       └── index.ts
│   ├── reset_test_data.sql
│   └── config.toml
├── .github/
│   └── workflows/
│       └── ci.yml
├── package.json
└── README.md
```

---

## Get started

### Prerequisites

- A modern browser.
- A Supabase project.
- Python 3 (or another static HTTP server) to run the app locally.
- Node.js 22 or later to run the test suite.
- Supabase CLI only if you need to deploy the tournament-deletion Edge Function.

### 1. Clone the repository

```bash
git clone https://github.com/gocoolg/groundscore.git
cd groundscore
```

### 2. Configure the browser app

Edit `config.js` and set your Supabase project URL and **publishable** key:

```javascript
window.GROUNDSCORE_CONFIG = {
  SUPABASE_URL: "https://YOUR_PROJECT_REF.supabase.co",
  SUPABASE_ANON_KEY: "YOUR_SUPABASE_PUBLISHABLE_KEY"
};
```

The app reads these two values in the browser. A publishable key is intended for client-side use when Row Level Security and database grants are configured appropriately.

**Never put a Supabase service-role key, secret API key or tournament-delete password in `config.js`, `app.js`, or any other public frontend file.**

### 3. Set up the database

For a new Supabase project, open **Supabase Dashboard → SQL Editor**, paste the complete [`schema.sql`](schema.sql) file and run it.

The root schema creates the tournament, member, team, squad, match, player, innings and delivery tables. It also includes the current coin-toss columns, reusable player/scorer directories and live site-viewer presence counter. It is designed to be safe to re-run and preserves existing match data.

If the project was set up using an older version of GroundScore, apply any feature migrations that have not yet been run:

| Migration | Purpose |
|---|---|
| [`add_coin_toss_columns.sql`](supabase/add_coin_toss_columns.sql) | Adds coin-toss metadata to older match tables. |
| [`20261123_player_directory.sql`](supabase/migrations/20261123_player_directory.sql) | Creates and backfills reusable player-name suggestions. |
| [`20261124_scorer_directory.sql`](supabase/migrations/20261124_scorer_directory.sql) | Creates and backfills the separate scorer directory. |
| [`20261127_simplified_wicket_and_metrics.sql`](supabase/migrations/20261127_simplified_wicket_and_metrics.sql) | Allows a generic `wicket` value for the quick wicket action. |
| [`20261125_site_viewer_presence.sql`](supabase/migrations/20261125_site_viewer_presence.sql) | Adds a private heartbeat table and RPC for the homepage live viewer count. |
| [`20261120_delete_tournament_admin.sql`](supabase/migrations/20261120_delete_tournament_admin.sql) | Creates the restricted database function used by the delete Edge Function. |
| [`20261120_revoke_public_deletes.sql`](supabase/migrations/20261120_revoke_public_deletes.sql) | Revokes direct hard-delete privileges from the anonymous browser role. |

Run each required SQL file in the Supabase SQL Editor. The migrations are safe to re-run where they use `IF NOT EXISTS`, `CREATE OR REPLACE` or policy replacement.

---

## Run locally

Start a static HTTP server from the repository root:

```bash
python3 -m http.server 8080
```

Open [http://localhost:8080](http://localhost:8080).

The app uses JavaScript modules, so open it through a local web server rather than directly with a `file://` URL.

---

## Tests and checks

Run the scoring-engine regression tests:

```bash
npm test
```

Run JavaScript syntax checks:

```bash
node --check app.js
node --check js/scoring-engine.js
```

GitHub Actions runs the syntax checks, scoring regression tests and tournament-deletion Edge Function type-check on pushes and pull requests to the repository.

The scoring tests cover delivery validation and notation, extras, legal-ball counting, strike rotation, over changes, wicket replacement, batting/bowling figures and chase progress.

---

## Deploy to GitHub Pages

1. Open the repository's **Settings → Pages**.
2. Set the source to **Deploy from a branch**.
3. Select branch `main` and folder `/(root)`.
4. Save the settings and wait for the Pages workflow to complete.

The published app URL is:

**https://gocoolg.github.io/groundscore/**

The static Pages deployment does not deploy Supabase database migrations or Edge Functions. Those are configured separately in Supabase.

Every match has a unique, permanent URL using its match UUID (for example, `?match=<match-id>`). GroundScore updates the browser address automatically when a match opens, so refreshing or reopening the address restores that exact match and its latest score. Use the **Share** action to copy the same direct live-match URL. Back/forward navigation restores the previous tournament or match route.

---

## Tournament deletion setup

Tournament deletion is an administrative action. It is performed by the Supabase Edge Function, not directly by the browser.

### 1. Apply the database migrations

Run both of these files in **Supabase Dashboard → SQL Editor**:

- [`20261120_delete_tournament_admin.sql`](supabase/migrations/20261120_delete_tournament_admin.sql)
- [`20261120_revoke_public_deletes.sql`](supabase/migrations/20261120_revoke_public_deletes.sql)

The database function checks the exact tournament name and can only be executed by the Supabase `service_role`.

### 2. Configure a strong password as a Supabase secret

From the repository root:

```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase secrets set TOURNAMENT_DELETE_PASSWORD='YOUR_LONG_UNIQUE_PASSWORD'
```

Choose a strong, unique password and share it only with trusted tournament administrators. Do not commit it to Git.

### 3. Deploy the Edge Function

```bash
supabase functions deploy delete-tournament --no-verify-jwt
```

If Docker is not available in your environment, use the CLI's API deployment option:

```bash
supabase functions deploy delete-tournament --no-verify-jwt --use-api
```

Run the deploy command from the GroundScore repository root. The function source is located at `supabase/functions/delete-tournament/index.ts`.

The function reads its Supabase URL and service-role credential from the Supabase Edge Function environment. The delete password is read from the `TOURNAMENT_DELETE_PASSWORD` secret.

### 4. Use the delete action

In GroundScore, open a tournament and go to **Members → Danger Zone → Delete tournament**. The confirmation sheet requires the exact tournament name and the administrator password.

The operation deletes the tournament's matches first, which cascades to innings, match players and deliveries. It then deletes the tournament, which cascades to its members, teams and saved team players.

The Edge Function is not part of GitHub Pages deployment and must be deployed separately.

---

## Database maintenance

### Inspect test data

Run [`supabase/reset_test_data.sql`](supabase/reset_test_data.sql) in Supabase SQL Editor to review counts of tournaments, members, teams, saved squad players, matches, match players, innings and deliveries.

The script is **read-only by default**. It includes a commented destructive block for clearing all matches and tournaments. Only uncomment and run that block if the project contains disposable test data exclusively. Back up anything important first.

---

## Cricket scoring conventions

- Wides and no-balls are not legal deliveries; byes and leg-byes are legal deliveries.
- One penalty run is added automatically for a wide or no-ball. Additional completed runs are recorded separately.
- Strike rotation is based on completed runs; the automatic wide/no-ball penalty does not itself rotate strike.
- Ends change after six legal deliveries.
- Batter balls faced exclude wides and include no-balls, byes and leg-byes.
- Bowler runs conceded exclude byes and leg-byes. Run-outs are not credited as bowler wickets.
- A run-out entry records the dismissed batter, incoming batter, completed runs and whether the batters had crossed before the wicket.

GroundScore is a recreational scoring tool. The scorer should record the umpire's decision; the app is not a complete Laws-of-Cricket adjudicator.

---

## Current limitations

The current implementation does not yet provide:

- Free-hit enforcement.
- Penalty-run events.
- Retired hurt or timed-out dismissal workflows.
- DLS calculations.
- Super overs.
- Full fielder and catch attribution.
- Automatic multi-innings formats or a complete knockout-bracket engine.
- Authenticated roles and organizer/scorer permission management.

The app currently refreshes an open match by polling Supabase every eight seconds. It does not use Supabase Realtime subscriptions.

---

## Security notes

GroundScore currently supports a lightweight, no-login experience. The anonymous Supabase role can read and write the tournament and scoring data needed by the public app. This is suitable only for trusted recreational groups and is **not tamper-proof**: users who can access the public app may be able to alter tournament or match data through the public API.

The browser role has hard-delete privileges revoked; tournament deletion uses the password-protected Edge Function and a server-side service-role call. This does not replace full user authentication, organizer permissions, rate limiting or an audit trail.

For formal competitions or sensitive data, add authenticated users, role-based access, restrictive Row Level Security policies, server-side scoring operations and an immutable correction audit trail before relying on the platform.

---

## License

MIT. See [`LICENSE`](LICENSE).
