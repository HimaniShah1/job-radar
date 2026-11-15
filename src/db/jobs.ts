import type { Label } from '../lib/learn.js';
import type { Job, JobStatus, ScoreResult } from '../types.js';
import { iso, type Db, type Stmt } from './types.js';

/** Keys we already store for a company, so the poller can tell new postings from known ones. */
export async function existingKeys(db: Db, company: string): Promise<Set<string>> {
  const rows = await db.all<{ key: string }>('select key from jobs where company = ?', [company]);
  return new Set(rows.map((r) => r.key));
}

/**
 * Insert a new posting, or refresh a known one.
 * `status` is only the initial status. Once a row exists the status is yours; the one automatic
 * move is "maybe" -> "to_apply" when a rescore crosses the threshold.
 * The WHERE clause skips rows where nothing changed, which keeps D1 row writes (100k/day free) low.
 */
export function upsertJobStmt(job: Job, s: ScoreResult, status: JobStatus): Stmt {
  return {
    sql: `insert into jobs (key, company, ats, external_id, title, locations, cities, remote, url, apply_url,
                            description, department, posted_at, score, score_reasons, rejected_reason, status)
          values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)
          on conflict (key) do update set
            title = excluded.title, locations = excluded.locations, cities = excluded.cities,
            remote = excluded.remote, url = excluded.url, apply_url = excluded.apply_url,
            description = excluded.description, department = excluded.department,
            score = excluded.score, score_reasons = excluded.score_reasons,
            rejected_reason = excluded.rejected_reason,
            status = case when jobs.status = 'maybe' and excluded.status = 'to_apply' then 'to_apply' else jobs.status end,
            closed_at = null
          where jobs.closed_at is not null
             or (jobs.status = 'maybe' and excluded.status = 'to_apply')
             or jobs.title is not excluded.title or jobs.locations is not excluded.locations
             or jobs.cities is not excluded.cities or jobs.remote is not excluded.remote
             or jobs.url is not excluded.url or jobs.apply_url is not excluded.apply_url
             or jobs.description is not excluded.description or jobs.department is not excluded.department
             or jobs.score is not excluded.score or jobs.score_reasons is not excluded.score_reasons
             or jobs.rejected_reason is not excluded.rejected_reason`,
    params: [
      job.key, job.company, job.ats, job.externalId, job.title,
      JSON.stringify(job.locations), JSON.stringify(job.cities),
      job.remote === null ? null : job.remote ? 1 : 0,
      job.url, job.applyUrl ?? null, job.description, job.department ?? null,
      job.postedAt ? iso(job.postedAt) : null,
      s.score, JSON.stringify(s.reasons), s.rejected, status,
    ],
  };
}

/**
 * Anything from this company we didn't see in a successful poll is closed.
 * Keys go in as one JSON parameter: D1 allows at most 100 bound parameters per query.
 */
export function closeMissingStmt(company: string, seenKeys: string[]): Stmt {
  return {
    sql: `update jobs set closed_at = ?3
          where company = ?1 and closed_at is null and key not in (select value from json_each(?2))`,
    params: [company, JSON.stringify(seenKeys), iso(new Date())],
  };
}

export function recordRunStmt(r: {
  company: string; ats: string; ok: boolean; jobCount?: number; newCount?: number; error?: string; durationMs: number;
}): Stmt {
  return {
    sql: `insert into source_runs (company, ats, ok, job_count, new_count, error, duration_ms) values (?, ?, ?, ?, ?, ?, ?)`,
    params: [r.company, r.ats, r.ok ? 1 : 0, r.jobCount ?? null, r.newCount ?? null, r.error ?? null, r.durationMs],
  };
}

export function pruneRunsStmt(days = 30): Stmt {
  return { sql: `delete from source_runs where ran_at < ?`, params: [iso(new Date(Date.now() - days * 86_400_000))] };
}

export async function loadLabels(db: Db): Promise<Label[]> {
  const rows = await db.all<{ title: string; verdict: number }>(
    'select j.title, f.verdict from feedback f join jobs j on j.id = f.job_id',
  );
  return rows.map((x) => ({ title: x.title, verdict: x.verdict === 1 ? 1 : -1 }));
}
