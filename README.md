# Job Radar

Finds new SDE-1/SDE-2 roles in Bengaluru, Hyderabad and Pune directly from company career pages, scores each one against your profile, and sends a Telegram alert within about 20 minutes of the posting going live. A small dashboard tracks your pipeline and learns from your 👍/👎.

Why career pages: roles often appear there days before they reach Naukri or LinkedIn, and Greenhouse, Lever, Ashby, Workable and Recruitee all publish open roles as public JSON. Reading that JSON is allowed and needs no login, scraping or proxies. See [RESEARCH.md](RESEARCH.md) for the portal and ATS research.

```
config/companies.json ──► adapters (greenhouse | lever | ashby | workable | recruitee | keka*)
                              │  public JSON, one request per company
                              ▼
                     normalize ─► city match (BLR / HYD / PUNE / Remote-India)
                              ▼
                     score 0-100 (hard filters, then title, experience, stack, freshness, your feedback)
                              ▼
                     Postgres upsert (dedupe on ats:slug:id, close jobs that vanish)
                              ▼
               new + score ≥ threshold ─► Telegram     dashboard ◄─ you: applied / skip / 👍 👎
```
\* Keka is experimental, see below.

## Quick start (local)

```bash
cp .env.example .env            # add Telegram token + chat id (optional at first)
docker compose up -d            # Postgres on localhost:5432
npm install
npm run migrate
npm run dry-run                 # fetch + score everything, no DB, no alerts: sanity check
npm run poll                    # first run per company stores silently (no alert flood)
npm run poll:watch              # keep polling every ~20 min
npm run serve                   # dashboard at http://localhost:3000
```

Without Telegram configured, alerts print to the console.

## Make it yours

- **`config/profile.json`**: cities, years of experience, title include/exclude words, skill weights, notify threshold. Run `npm run dry-run -- --all` after a change to see which roles pass, which get rejected, and why.
- **`config/companies.json`**: boards to poll. `npm run probe` checks every name in `config/candidates.txt` across five ATSs and prints lines to paste in. `npm run probe -- "Razorpay"` checks one company.
- **Keka companies** (`"enabled": false` in the seed list): open the company's `*.keka.com/careers` page, open browser devtools → Network, find the `careers/api/jobs/<portal>/active` request, put `<portal>` in the `portal` field, set `enabled: true`, then `npm run dry-run -- --only "<Name>"` to confirm the parser handles the real response.

## How scoring works

Hard filters reject: wrong city, excluded title words (manager, staff engineer, SDET, intern...), title not an engineering role, or experience minimum more than `yearsOfExperience + 2`.

Then the score adds up from a base of 30: title level (`SDE 2` +15, `senior` −15), experience fit (+20 if it fits), stack overlap (up to +30 for Node/TS/Postgres/AWS...), freshness (+10 if posted under 6h ago) and your feedback (±12 at most). Every alert lists its reasons.

**Learning:** after 10 or more 👍/👎 in the dashboard, a per-word log-odds model over job titles starts adjusting scores. It's intentionally small: with dozens of labels, anything bigger would just memorize them. It can nudge rankings but never overrides the hard filters.

## Deploy on EC2

A `t4g.small` or `t3.small` is plenty. Run Postgres on the same box, or use RDS/Supabase.

```bash
sudo useradd -r -m radar && sudo git clone <repo> /opt/job-radar && cd /opt/job-radar
sudo -u radar npm ci && sudo -u radar cp .env.example .env   # fill it in
sudo -u radar npm run migrate
sudo cp deploy/*.service /etc/systemd/system/ && sudo systemctl daemon-reload
sudo systemctl enable --now job-radar-poller job-radar-web
journalctl -u job-radar-poller -f
```

Keep `HOST=127.0.0.1` and reach the dashboard through an SSH tunnel (`ssh -L 3000:localhost:3000 ec2`), or set `DASHBOARD_USER`/`DASHBOARD_PASSWORD` and put it behind HTTPS (Caddy is the easiest option).

## Cost

| Item | Monthly |
|---|---|
| EC2 small + Postgres on the same box | ₹0 on free tier, ~₹1,000–1,500 after |
| ATS APIs, Telegram | Free |
| LLM re-ranking (not built yet) | ~₹500–1,500 at small-model rates |

## Being a good citizen

One request per company per ~20 minutes, at most 6 in flight, with jitter and an honest User-Agent. Don't lower the interval below 10 minutes. It wouldn't get you jobs faster in any way that matters.

## Tests

`npm test` runs adapter parsing against fixtures, the location/experience/scoring rules, and an end-to-end poll pipeline on real Postgres (PGlite, in-process): bootstrap without alerts, one alert per new match, no re-alerts, closing and reopening postings, and failing boards.

## Roadmap

1. **Gmail alert parser:** Instahyre, Naukri, Cutshort and LinkedIn alert emails go into the same pipeline (covers Darwinbox, Zoho and custom career sites).
2. **Referral matcher:** import your LinkedIn connections export and flag postings at companies where you know someone.
3. **LLM re-rank** of the top results only, against your resume.
4. **Apply kit:** pick the resume version and pre-draft answers to common questions (CTC, notice period, relocation). You still review and submit.
5. **Claude skill** on top of the API: "prep me for my round at X" using the saved JD.
