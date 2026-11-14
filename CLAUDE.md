# Job Radar

Personal job-discovery tool for SDE-1/SDE-2 roles in Bengaluru, Hyderabad and Pune. It polls company career pages (public ATS JSON), scores postings against `config/profile.json`, sends Telegram alerts for new good matches, and tracks applications in a small dashboard.

Owner: Himani, backend-focused full-stack developer (~2 YOE; Node, TypeScript, Postgres, React, AWS). Built for her own job search first, and as a portfolio project second.

## Stack
Node 22, TypeScript (strict, ESM, NodeNext), Postgres (`pg`), Hono, Vitest. No framework beyond that. Keep it small.

## Commands
- `npm test`: unit + pipeline tests (pipeline runs on in-process Postgres via PGlite)
- `npm run typecheck`
- `npm run dry-run [-- --only "Company" --all]`: fetch and score with no DB or alerts
- `npm run probe [-- "Company"]`: find which ATS a company uses
- `npm run migrate`, `npm run poll`, `npm run poll:watch`, `npm run serve`

Run `npm test && npm run typecheck` before calling any change done.

## Layout
- `src/adapters/index.ts`: one URL builder + one pure parser per ATS. Parsers are tested against `test/fixtures/*.json`.
- `src/lib/`: location, experience, scoring, learning, text, http helpers
- `src/poller.ts`: fetch, score, upsert, alert, close vanished postings
- `src/db.ts`: queries; `useDb()` swaps in PGlite for tests
- `src/server.ts` + `public/index.html`: dashboard API and UI
- `config/profile.json`, `config/companies.json`, `config/candidates.txt`: user-editable config
- `db/schema.sql`: idempotent schema; edit it additively

## Hard rules
- Do NOT scrape LinkedIn, Naukri, Instahyre or Cutshort. They forbid it and it risks her real accounts. Use ATS public JSON and, later, Gmail job-alert emails.
- Do NOT auto-submit applications. Assisted apply only: prepare and pre-fill, she reviews and clicks submit.
- Poll politely: one request per company per cycle, max 6 concurrent, minimum 10-minute interval, honest User-Agent.
- One Telegram alert per new matching posting, never repeats. A company's first successful poll stores jobs silently (bootstrap).
- Never commit `.env` or tokens. The dashboard must require `DASHBOARD_USER`/`DASHBOARD_PASSWORD` before binding beyond localhost.
- Keep this repo private until she has an offer: a public job-search tool signals to her employer that she is looking.

## Conventions
- New ATS adapter: add it to `adapters/index.ts`, add a fixture and a test in `test/adapters.test.ts`, then add real boards to `companies.json`.
- Parsers stay pure (no network) so they can be tested from fixtures.
- Hard filters live in `scoreJob`; every score change needs a human-readable reason string.
- Learning is deliberately small (title-token log-odds, +/-12 max). Don't replace it with something heavier without evidence it helps.
- Honest freshness: `first_seen_at` (when we saw it) is trusted over `posted_at` (what the ATS claims).
- Schema changes: additive only, with `if not exists`.

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
