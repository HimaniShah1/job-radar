-- Idempotent: safe to run on every deploy.

create table if not exists jobs (
  id              bigserial primary key,
  key             text not null unique,            -- "{ats}:{slug}:{externalId}"
  company         text not null,
  ats             text not null,
  external_id     text not null,
  title           text not null,
  locations       text[] not null default '{}',
  cities          text[] not null default '{}',
  remote          boolean,
  url             text not null,
  apply_url       text,
  description     text,                            -- kept because postings disappear after closing
  department      text,
  posted_at       timestamptz,                     -- what the ATS claims
  first_seen_at   timestamptz not null default now(),  -- what we actually observed: the honest freshness signal
  last_seen_at    timestamptz not null default now(),
  closed_at       timestamptz,                     -- set when the posting vanishes from its board
  score           int not null default 0,
  score_reasons   text[] not null default '{}',
  rejected_reason text,
  status          text not null default 'new' check (status in
                  ('new','shortlisted','applied','recruiter_call','oa','interviewing','offer','rejected','ghosted','skipped')),
  notified_at     timestamptz,
  applied_at      timestamptz,
  notes           text
);

create index if not exists jobs_first_seen_idx on jobs (first_seen_at desc);
create index if not exists jobs_inbox_idx on jobs (status, score desc) where rejected_reason is null and closed_at is null;
create index if not exists jobs_company_open_idx on jobs (company) where closed_at is null;

create table if not exists feedback (
  job_id     bigint primary key references jobs(id) on delete cascade,
  verdict    smallint not null check (verdict in (-1, 1)),
  created_at timestamptz not null default now()
);

-- One row per company per poll: tells you which boards are broken or moved.
create table if not exists source_runs (
  id          bigserial primary key,
  company     text not null,
  ats         text not null,
  ok          boolean not null,
  job_count   int,
  new_count   int,
  error       text,
  duration_ms int not null,
  ran_at      timestamptz not null default now()
);
create index if not exists source_runs_recent_idx on source_runs (company, ran_at desc);

-- A source's first successful poll stores everything silently, so adding a company
-- with 40 open roles doesn't fire 40 "new job" alerts.
create table if not exists source_state (
  company         text primary key,
  bootstrapped_at timestamptz not null default now()
);
