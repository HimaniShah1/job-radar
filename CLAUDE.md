# Job Radar

Personal job-discovery tool for SDE-1/SDE-2 roles in Bengaluru, Hyderabad and Pune. It polls company career pages (public ATS JSON), scores postings against `config/profile.json`, and puts good matches on her dashboard as "To apply", where she tracks applications. No Telegram or other push alerts (removed Nov 2026 at her request).

Owner: Himani, backend-focused full-stack developer (~2 YOE; Node, TypeScript, Postgres, React, AWS). Built for her own job search first, and as a portfolio project second.

## Stack
TypeScript (strict, ESM, NodeNext), Hono, Vitest. Everything hosted on Cloudflare free plans; no Supabase, Postgres or EC2 (her call, Nov 2026).
- **D1** (SQLite) for data. Timestamps are ISO-8601 UTC text, arrays are JSON text, booleans 0/1.
- **Worker** (`src/worker.ts`) serves the dashboard and API. Behind **Cloudflare Access**; the Worker also verifies the Access JWT and fails closed (503) when `ACCESS_TEAM_DOMAIN`/`ACCESS_AUD` are unset.
- **Polling runs in GitHub Actions** (`.github/workflows/poll.yml`, every 30 min) on Node 22.13+, writing to D1 over its HTTP API. Not a Cron Trigger: a poll needs ~60 ms+ CPU and dozens of D1 calls, and free cron runs get 10 ms and 50 subrequests. Moving it into the Worker means Workers Paid ($5/mo); ask her first.
- Actions budget: private repo = 2,000 min/month, each run bills >=1 min. Don't schedule more often than every 30 min.

## Commands
- `npm test`: unit + pipeline tests (pipeline and API run on `node:sqlite` with the real migrations)
- `npm run typecheck`
- `npm run dry-run [-- --only "Company" --all]`: fetch and score with no DB
- `npm run probe [-- "Company"]`: find which ATS a company uses
- Local: `npm run db:migrate:local`, `npm run poll:local`, `npm run dev` (needs `.dev.vars` from `.dev.vars.example`)
- Real: `npm run db:migrate`, `npm run deploy`, `npm run poll` (needs `CLOUDFLARE_*` in `.env`). Deploying publishes; ask her before running it.

Run `npm test && npm run typecheck` before calling any change done.

## Layout
- `src/adapters/index.ts`: one URL builder + one pure parser per ATS. Parsers are tested against `test/fixtures/*.json`.
- `src/lib/`: location, experience, scoring, learning, text, http helpers
- `src/poller.ts`: fetch, score, then one D1 batch per company (upsert with initial status, close vanished, run log)
- `src/db/`: `Db` interface with three backends: `d1.ts` (Worker binding), `http.ts` (D1 REST API, poller), `sqlite.ts` (node:sqlite, tests and local). `jobs.ts` holds the poller's SQL.
- `src/api.ts`: dashboard API (Hono, no Node APIs: it's bundled into the Worker). `src/worker.ts`: entry + Access check. `src/access.ts`: JWT verification.
- `public/index.html`: dashboard UI, served as Worker static assets
- `config/profile.json`, `config/companies.json`, `config/candidates.txt`: user-editable config
- `migrations/`: D1 migrations, applied with wrangler

## Hard rules
- Do NOT scrape LinkedIn, Naukri, Instahyre or Cutshort. They forbid it and it risks her real accounts. Use ATS public JSON and, later, Gmail job-alert emails.
- Do NOT auto-submit applications. Assisted apply only: prepare and pre-fill, she reviews and clicks submit.
- Poll politely: one request per company per cycle, max 6 concurrent, minimum 10-minute interval, honest User-Agent.
- New matches land as `to_apply` (score >= `toApplyThreshold`) or `maybe`. Polling never overwrites a status she set; the only automatic move is maybe -> to_apply on rescore.
- "Remove" sets status `removed`, never a hard delete: a deleted row would be re-inserted as new by the next poll.
- Never commit `.env`, `.dev.vars` or tokens. The deployed dashboard must stay behind Cloudflare Access; never set `DEV_NO_AUTH` outside `.dev.vars`.
- The repo is public by her choice (Nov 2026). Never commit secrets, tokens or personal data beyond what is already in `config/`.

## Conventions
- New ATS adapter: add it to `adapters/index.ts`, add a fixture and a test in `test/adapters.test.ts`, then add real boards to `companies.json`.
- Parsers stay pure (no network) so they can be tested from fixtures.
- Hard filters live in `scoreJob`; every score change needs a human-readable reason string.
- Learning is deliberately small (title-token log-odds, +/-12 max). Don't replace it with something heavier without evidence it helps.
- Honest freshness: `first_seen_at` (when we saw it) is trusted over `posted_at` (what the ATS claims).
- Schema changes: a new numbered file in `migrations/`, never edit an applied one. Keep the status check in sync with `STATUSES` in `src/types.ts`.
- D1 limits shape the SQL: max 100 bound parameters per query (pass key lists as one JSON param + `json_each`), 100k row writes/day free (upserts skip unchanged rows).

## Known gaps / verify first
- Adapters were built from documented API shapes and fixtures but never run against live boards. First task in any session: `npm run dry-run`, check the output, fix mismatches.
- Keka adapter is experimental (undocumented endpoint, field names are guesses). Companies using it are `enabled: false` until a portal id is found and `dry-run -- --only` confirms the parse.
- Some slugs in `companies.json` are unverified (e.g. FloQast). `probe` or `dry-run` will show failures.

## Roadmap (in order)
1. Verify and fix adapters against live data; grow `companies.json` via `probe`
2. Gmail alert parser (Instahyre, Naukri, Cutshort, LinkedIn alert emails) feeding the same pipeline
3. Referral matcher from the LinkedIn connections export (her own data export, which is allowed)
4. LLM re-rank of top results only, against her resume
5. Assisted-apply kit: resume choice and draft answers (CTC, notice period, relocation)
6. Claude skill on top of the API for interview prep from saved JDs

Budget: about 40 hours total. Keep it from eating DSA and interview prep time.
