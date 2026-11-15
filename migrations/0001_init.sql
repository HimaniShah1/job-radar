-- D1 (SQLite). Apply with `npm run db:migrate` (remote) or `npm run db:migrate:local`.
-- Schema changes go in a new numbered file; never edit an applied migration.
-- Conventions: timestamps are ISO-8601 UTC text ("2026-11-14T10:43:49.158Z"), so they sort and
-- compare as strings; arrays are JSON text; booleans are 0/1.

create table jobs (
  id              integer primary key,
  key             text not null unique,                 -- "{ats}:{slug}:{externalId}"
  company         text not null,
  ats             text not null,
  external_id     text not null,
  title           text not null,
  locations       text not null default '[]',           -- JSON array, as the board lists them
  cities          text not null default '[]',           -- JSON array of matched target cities
  remote          integer,                              -- 1/0, null when the board doesn't say
  url             text not null,
  apply_url       text,
  description     text,                                 -- kept because postings disappear after closing
  department      text,
  posted_at       text,                                 -- what the ATS claims
  first_seen_at   text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),  -- what we observed: the honest freshness signal
  closed_at       text,                                 -- set when the posting vanishes from its board
  score           integer not null default 0,
  score_reasons   text not null default '[]',           -- JSON array
  rejected_reason text,
  -- to_apply: score >= toApplyThreshold   maybe: passes filters, lower score
  -- removed: hidden by you; kept so the next poll doesn't re-add it.
  -- Keep in sync with STATUSES in src/types.ts.
  status          text not null default 'to_apply' check (status in
                  ('to_apply','maybe','applied','recruiter_call','oa','interviewing','offer','rejected','ghosted','skipped','removed')),
  applied_at      text,
  notes           text
);

create index jobs_first_seen_idx on jobs (first_seen_at desc);
create index jobs_status_idx on jobs (status, first_seen_at desc) where rejected_reason is null;
create index jobs_company_open_idx on jobs (company) where closed_at is null;

create table feedback (
  job_id     integer primary key references jobs(id) on delete cascade,
  verdict    integer not null check (verdict in (-1, 1)),
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- One row per company per poll: tells you which boards are broken or moved. Pruned after 30 days.
create table source_runs (
  id          integer primary key,
  company     text not null,
  ats         text not null,
  ok          integer not null,
  job_count   integer,
  new_count   integer,
  error       text,
  duration_ms integer not null,
  ran_at      text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
create index source_runs_recent_idx on source_runs (company, ran_at desc);
