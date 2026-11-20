# GroundScore
A mobile-friendly cricket scoring and tournament app. Static HTML/CSS/JavaScript + Supabase Postgres. No login and no install required.

## Features
- Tournament-first home: create, browse, join and view public scorecards.
- Member roster: select an existing display name or add a new one.
- Toss, overs, team squads and opening striker/non-striker/bowler selection.
- Ball-by-ball score entry with runs, wides, no-balls, byes, leg-byes, extra-run selector and wickets.
- Strike rotates on odd completed runs; 2/4/6 do not rotate; ends change after six legal balls.
- Undo last delivery with confirmation.
- Public live score polling every 12 seconds.
- Full-screen team and batter 50/100 milestone celebrations.
- Match summary with result, batting figures, bowler wickets, run rates and notable moments.

## Supabase setup
1. Create a Supabase project.
2. Run the complete root `schema.sql` in SQL Editor. It upgrades the old GroundScore database by adding tournaments and new ball-state columns.
3. Set the project URL and publishable key in `config.js`.
4. Never put a service-role/secret key in browser code.

## Local development
```bash
python3 -m http.server 8080
```
Open http://localhost:8080.

## GitHub Pages
Settings → Pages → Deploy from branch → `main` → `/(root)`. Share `https://<username>.github.io/groundscore/`.

## Public access model
There are no accounts by design. Anonymous visitors can read and write tournaments, members, matches and scores. This is convenient for a trusted recreational group but is not authenticated or tamper-proof: anyone who knows the Supabase project endpoint can potentially alter or delete data. Use authentication, server-side validation and audit logs for higher-trust events.

## Scoring assumptions and limitations
- One automatic penalty run is added for a wide/no-ball; the Extra runs field represents additional extras on top of that penalty. Example: wide + 2 additional runs = 3 total extras.
- Wides and no-balls are not legal deliveries; byes and leg-byes are legal.
- Completed odd runs rotate strike; 2, 4 and 6 do not. At the end of six legal balls, ends change.
- Run-outs are not credited to the bowler; bowled/caught/LBW/stumped/hit wicket are credited.
- This is a recreational scorer, not a complete Laws-of-Cricket engine. Penalty runs, retired hurt, timed out, free-hit enforcement and detailed overthrow handling are not modelled.

## License
MIT — see LICENSE.
