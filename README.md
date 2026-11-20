# GroundScore

A small, mobile-first, open-source cricket scoring web app for recreational weekly cricket groups.

## Features

- No account/login.
- Toss winner and bat/bowl decision.
- Scorer name stored on every ball.
- Ball-by-ball scoring: batter, bowler, runs, extras and wickets.
- Persistent Supabase/Postgres storage across devices.
- Post-match result, top run-scorers, top wicket-takers, run rate and notable moments.
- Static frontend with no build step.

## Stack

Plain HTML/CSS/JavaScript + Supabase Postgres REST API. Host the static files on GitHub Pages, Netlify, Cloudflare Pages or Vercel.

## Local setup

1. Create a Supabase project.
2. Run `supabase/schema.sql` in Supabase SQL Editor.
3. Put your Supabase project URL and anonymous/publishable key into `config.js`.
4. Serve the folder:
   ```bash
   python3 -m http.server 8080
   ```
5. Open `http://localhost:8080`.

Do not use a Supabase service-role/secret key in the browser.

## Public deployment

### GitHub Pages
1. Create a public GitHub repository and push this project.
2. Set the two Supabase values in `config.js`.
3. GitHub -> Settings -> Pages -> deploy the `main` branch root.
4. Share the generated HTTPS URL.

### Netlify / Cloudflare Pages / Vercel
Import the repository as a static site. No build command is required; publish the repository root.

## Storage/hosting trade-offs

This project deliberately uses a Supabase database because the requirement is persistent data shared between phones without accounts. The frontend is static, so hosting is simple and inexpensive.

The trade-off is security: because there is no login, the database policies allow the public `anon` role to read/write match data. This is suitable for a trusted recreational group, but it is not an audit-grade or tamper-proof scoring system. Scorer names are user-entered and cannot be independently verified.

If the project grows, add authentication or a small server-side API with validation/rate limiting.

## Notes

- Wides/no-balls do not consume a legal ball.
- Byes/leg-byes consume a legal ball.
- Bowler wicket totals exclude run-outs.
- The app supports two innings and configurable overs.
- The scorer can refresh another device to see the latest stored score.

## License

MIT — see `LICENSE`.
