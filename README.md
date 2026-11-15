# Job Radar

Finds new SDE-1/SDE-2 roles in Bengaluru, Hyderabad and Pune directly from company career pages, scores each one against your profile, and puts good matches on your own dashboard as **To apply** within about half an hour of the posting going live. From there you open the apply link, move the job through your pipeline, or remove it. The dashboard also learns from your 👍/👎.

Why career pages: roles often appear there days before they reach Naukri or LinkedIn, and Greenhouse, Lever, Ashby, Workable and Recruitee all publish open roles as public JSON. Reading that JSON is allowed and needs no login, scraping or proxies. See [RESEARCH.md](RESEARCH.md) for the portal and ATS research.

```
config/companies.json ──► adapters (greenhouse | lever | ashby | workable | recruitee | keka*)
                              │  public JSON, one request per company
                              ▼
                     normalize ─► city match (BLR / HYD / PUNE / Remote-India)
                              ▼
                     score 0-100 (hard filters, then title, experience, stack, freshness, your feedback)
                              ▼
                     D1 upsert (dedupe on ats:slug:id, close jobs that vanish)
                              ▼
          new + score ≥ threshold ─► To apply    (lower scores ─► Maybe)
                              ▼
                          dashboard ◄─ you: status, remove, notes, 👍 👎
```
\* Keka is experimental, see below.

**Where it runs (all on free plans):**

| Piece | Runs on | Why there |
|---|---|---|
| Database | Cloudflare D1 (SQLite) | Free: 500 MB per database, 100k row writes/day. Polls only rewrite jobs that changed |
| Dashboard + API | Cloudflare Worker (`src/worker.ts`), page from `public/` | One person's dashboard fits easily in the free plan |
| Login | Cloudflare Access (email one-time code) | No password in the app. The Worker also verifies Access's signed token, and refuses everything if Access isn't configured |
| Polling | GitHub Actions every 30 min (`.github/workflows/poll.yml`), writing to D1 over its HTTP API | A poll needs ~60 ms+ CPU and dozens of D1 calls; a free-plan Cron Trigger gets 10 ms and 50. Polling inside Cloudflare needs Workers Paid ($5/month) |

## Quick start (local)

Everything runs against a local D1; no Cloudflare account needed.

```bash
npm install
cp .dev.vars.example .dev.vars  # lets `npm run dev` skip the Access check, on localhost only
npm run dry-run                 # fetch + score everything, no DB: sanity check
npm run db:migrate:local        # create the local D1 database
npm run poll:local              # poll every board into it (re-run for fresh jobs)
npm run dev                     # dashboard at http://localhost:8787
```

## The dashboard

One row per job: company, role, location, score, when the board says it was posted, when Job Radar found it, a status dropdown and an **Apply ↗** button (the application form when the ATS has one, otherwise the posting). Click a role to see every location, the score breakdown, the full description, links, a notes box and 👍/👎.

Tabs: **To apply** (score ≥ `toApplyThreshold`) · **Maybe** (passes the filters, lower score) · **Applied** · **In process** (recruiter call, OA, interviewing) · **Offer** · **Closed out** (rejected, ghosted, not interested) · **Removed**.

- Change status from the dropdown; every change has an Undo. Moving to Applied records the date.
- **✕ removes** a row you won't apply to. It is hidden rather than deleted, so the next poll doesn't bring it back; undo from the Removed tab.
- Polling never changes a status you set. The only automatic move is Maybe → To apply when a rescore crosses the threshold.
- Postings that vanish from their board drop out of To apply and Maybe, but stay visible (tagged *posting closed*) once you've applied.

## Make it yours

- **`config/profile.json`**: cities (`preferredCities` rank first; elsewhere in India loses `otherCityPenalty` points), how old a posting may be (`maxPostingAgeDays`), years of experience, title include/exclude words, skill weights, `toApplyThreshold`. Run `npm run dry-run -- --all` after a change to see which roles pass, which get rejected, and why.
- **`config/companies.json`**: boards to poll. `npm run probe` checks every name in `config/candidates.txt` across five ATSs and prints lines to paste in. `npm run probe -- "Razorpay"` checks one company.
- **Keka companies** (`"enabled": false` in the seed list): open the company's `*.keka.com/careers` page, open browser devtools → Network, find the `careers/api/jobs/<portal>/active` request, put `<portal>` in the `portal` field, set `enabled: true`, then `npm run dry-run -- --only "<Name>"` to confirm the parser handles the real response.

## How scoring works

Hard filters reject: outside India, posted more than `maxPostingAgeDays` ago (30 by default; undated postings are kept), excluded title words (manager, staff engineer, SDET, intern...), title not an engineering role, or experience minimum more than `yearsOfExperience + 2`.

Then the score adds up from a base of 30: outside your preferred cities (−10), title level (`SDE 2` +15, `senior` −15), experience fit (+20 if it fits), stack overlap (up to +30 for Node/TS/Postgres/AWS...), freshness (+10 if posted under 6h ago) and your feedback (±12 at most). Every row shows its reasons.

**Learning:** after 10 or more 👍/👎 in the dashboard, a per-word log-odds model over job titles starts adjusting scores. It's intentionally small: with dozens of labels, anything bigger would just memorize them. It can nudge rankings but never overrides the hard filters.

## Deploy to Cloudflare

One-time setup, about 15 minutes. You need a free Cloudflare account and this repo on GitHub.

**1. Database and Worker**

```bash
npx wrangler login
npx wrangler d1 create job-radar          # copy the database_id it prints into wrangler.jsonc
npm run db:migrate                        # creates the tables in the real D1
npm run deploy                            # publishes the Worker; note its *.workers.dev URL
```

When `d1 create` offers to add the database to your config, say **no**. Paste the id into the existing `DB` entry instead. Accepting adds a second entry with a different binding name, and `db:migrate` then fails with *database 00000000-… could not be found*.

Until step 2 is done, the deployed dashboard answers every request with 503. That's on purpose: no Access config means nobody gets in.

**2. Cloudflare Access (login)**

1. Cloudflare dashboard → **Zero Trust** (pick the free plan if asked; it covers up to 50 users). Note your team domain, e.g. `yourname.cloudflareaccess.com`.
2. **Access → Applications → Add an application → Self-hosted.** Domain: your Worker's `job-radar.<subdomain>.workers.dev` (and any custom domain you add later).
3. Add a policy: **Allow**, *Include → Emails →* your email. Login method: one-time PIN.
4. Open the application and copy its **Application Audience (AUD) Tag**.
5. Put both into `wrangler.jsonc` under `vars` (`ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`) and run `npm run deploy` again.

Opening the dashboard now asks for your email and a code, then keeps you signed in for the session length set on the application (24h by default).

**3. Polling (GitHub Actions)**

1. Cloudflare → **My Profile → API Tokens → Create Token → Custom token**, permission **Account → D1 → Edit** on your account, nothing else.
2. GitHub repo → **Settings → Secrets and variables → Actions**: add `CLOUDFLARE_ACCOUNT_ID`, `D1_DATABASE_ID` and `CLOUDFLARE_API_TOKEN`.
3. **Actions → poll → Run workflow** once to fill the dashboard. After that it runs by itself every 30 minutes.

To poll the real database from your laptop, put the same three values in `.env` and run `npm run poll`.

**Limits to know**

- **Actions minutes:** private repos get 2,000 free minutes a month, and each poll bills at least 1 minute. Every 30 min (~1,440/month) fits; every 20 min (~2,160) does not. CI runs on push also count.
- **Late runs:** GitHub sometimes starts scheduled runs 10–30 min late when it's busy. Fine for job hunting; just don't expect exact timing.
- **D1:** 100k row writes/day free. A poll rewrites only jobs that changed, so a normal day uses a few thousand.

## Cost

| Item | Monthly |
|---|---|
| Cloudflare Workers, D1, Access (free plans) | ₹0 |
| GitHub Actions (private repo, within 2,000 min) | ₹0 |
| ATS APIs | Free |
| Optional: Workers Paid, to poll from a Cron Trigger instead of Actions | $5 (~₹450) |
| LLM re-ranking (not built yet) | ~₹500–1,500 at small-model rates |

## Being a good citizen

One request per company per ~30 minutes, at most 6 in flight, with jitter and an honest User-Agent. Don't lower the interval below 10 minutes. It wouldn't get you jobs faster in any way that matters.

## Tests

`npm test` runs adapter parsing against fixtures, the location/experience/scoring rules, and an end-to-end poll pipeline and dashboard API on real SQLite (`node:sqlite`, the engine D1 runs) using the real migrations: To apply vs Maybe, statuses polling never overwrites, remove and undo, unchanged polls writing nothing, closing postings on boards bigger than D1's 100-parameter limit, and failing boards. It also covers the D1 HTTP client and the Cloudflare Access token check (valid, wrong audience or issuer, expired, tampered, unknown key).

## Roadmap

1. **Gmail alert parser:** Instahyre, Naukri, Cutshort and LinkedIn alert emails go into the same pipeline (covers Darwinbox, Zoho and custom career sites).
2. **Referral matcher:** import your LinkedIn connections export and flag postings at companies where you know someone.
3. **LLM re-rank** of the top results only, against your resume.
4. **Apply kit:** pick the resume version and pre-draft answers to common questions (CTC, notice period, relocation). You still review and submit.
5. **Claude skill** on top of the API: "prep me for my round at X" using the saved JD.
