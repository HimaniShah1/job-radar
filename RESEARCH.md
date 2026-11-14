# Market research: where SDE-1/SDE-2 jobs in Bangalore, Hyderabad, Pune come from (Nov 2026)

## Portals, ranked for a ~2 YOE backend/full-stack developer targeting product companies

| Portal | What it's good for | How Job Radar uses it |
|---|---|---|
| **Instahyre** | Curated product/startup roles, recruiters reach out, salary often shown. Repeatedly cited as the best signal-to-noise for 2+ YOE engineers. | Keep profile sharp; forward its alert emails (Gmail parser, next phase). |
| **Cutshort** | Same niche as Instahyre, AI matching, startup-heavy. | Same as above. |
| **Naukri** | Biggest volume. Developers report more recruiter *calls* from Naukri than from LinkedIn applications, but lots of IT-services and consultancy noise. | Keep profile updated daily (recency drives recruiter search); use tight alerts only. |
| **LinkedIn Jobs** | Brand reach; Easy Apply response rates are poor. Its real value is referrals and recruiter outreach. | Don't scrape (ToS + account risk). Use for referrals. |
| **Wellfound (AngelList), Hirist** | Startups (Wellfound), tech-only (Hirist). | Secondary alerts. |
| **Company career pages (ATS)** | Roles often appear here days before they syndicate to portals. Public JSON, allowed to read. | **Primary source.** Polled every ~20 min. |

Recurring finding across developer threads: **referrals beat cold applications by a wide margin.** Speed matters, and so does knowing someone at the company.

## Which hiring systems (ATS) Indian product companies use

- **Global ATS with public JSON APIs:** Greenhouse, Lever, Ashby, Workable, Recruitee, SmartRecruiters. Used by VC-backed startups and global companies with Indian engineering teams (Postman, CRED, Hevo, Mindtickle, Workato, CommerceIQ...).
- **India-built HRMS/ATS:** Keka, Darwinbox, Zoho Recruit, HROne, greytHR, Freshteam. Common at Indian mid-market companies.
  - **Keka** careers pages load JSON from `{tenant}.keka.com/careers/api/jobs/{portal}/active` (documented by third-party scrapers, not Keka). Supported here as **experimental**.
  - **Darwinbox, Zoho Recruit:** no confirmed public JSON feed. Cover via portal alert emails.
- **Others seen:** Kula (Acko, AppsForBharat), custom pages (Flipkart, Swiggy and other large companies).

## Seed list

`config/companies.json` has 30 boards found by searching live postings in Bengaluru, Hyderabad and Pune
(Nov 2026). `config/candidates.txt` lists ~85 more companies; `npm run probe` finds which ATS they're on.

## Limits

- A company not on a probed ATS needs the email route or a custom adapter.
- `posted_at` is the ATS's claim; `first_seen_at` (when the poller saw it) is the honest freshness signal.
- No tool can guarantee interviews. This one increases speed and fit, and tells you which sources actually convert.
