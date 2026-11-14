import pg from 'pg';
import type { Job, ScoreResult } from './types.js';
import type { Label } from './lib/learn.js';

/** The slice of pg.Pool we use, so tests can swap in an in-process Postgres. */
export interface Queryable {
  query<R extends Record<string, any> = any>(text: string, params?: unknown[]): Promise<{ rows: R[]; rowCount: number | null }>;
  end?(): Promise<void>;
}

let client: Queryable | null = null;

export function db(): Queryable {
  if (!client) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error('DATABASE_URL is not set (see .env.example)');
    client = new pg.Pool({ connectionString, max: 5 });
  }
  return client;
}

export function useDb(q: Queryable) {
  client = q;
}

export async function closeDb() {
  await client?.end?.();
  client = null;
}

export async function isBootstrapped(company: string): Promise<boolean> {
  const r = await db().query('select 1 from source_state where company = $1', [company]);
  return r.rows.length > 0;
}

export async function markBootstrapped(company: string) {
  await db().query('insert into source_state (company) values ($1) on conflict do nothing', [company]);
}

/**
 * Insert or refresh a job. `(xmax = 0)` is true only for rows this statement inserted,
 * which is how we tell "brand new posting" from "seen it before" in one round trip.
 * Score is recomputed on every sighting so profile changes apply to open jobs too.
 */
export async function upsertJob(job: Job, s: ScoreResult): Promise<{ id: number; inserted: boolean }> {
  const r = await db().query<{ id: string; inserted: boolean }>(
    `insert into jobs (key, company, ats, external_id, title, locations, cities, remote, url, apply_url,
                       description, department, posted_at, score, score_reasons, rejected_reason)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
     on conflict (key) do update set
       title = excluded.title, locations = excluded.locations, cities = excluded.cities,
       remote = excluded.remote, url = excluded.url, apply_url = excluded.apply_url,
       description = excluded.description, department = excluded.department,
       score = excluded.score, score_reasons = excluded.score_reasons,
       rejected_reason = excluded.rejected_reason,
       last_seen_at = now(), closed_at = null
     returning id, (xmax = 0) as inserted`,
    [
      job.key, job.company, job.ats, job.externalId, job.title, job.locations, job.cities, job.remote,
      job.url, job.applyUrl ?? null, job.description, job.department ?? null, job.postedAt,
      s.score, s.reasons, s.rejected,
    ],
  );
  const row = r.rows[0]!;
  return { id: Number(row.id), inserted: row.inserted };
}

/** Anything from this company we didn't see in a successful poll is closed. */
export async function closeMissing(company: string, seenKeys: string[]) {
  await db().query(
    `update jobs set closed_at = now()
     where company = $1 and closed_at is null and not (key = any($2::text[]))`,
    [company, seenKeys],
  );
}

export async function markNotified(id: number) {
  await db().query('update jobs set notified_at = now() where id = $1', [id]);
}

export async function recordRun(r: {
  company: string; ats: string; ok: boolean; jobCount?: number; newCount?: number; error?: string; durationMs: number;
}) {
  await db().query(
    `insert into source_runs (company, ats, ok, job_count, new_count, error, duration_ms) values ($1,$2,$3,$4,$5,$6,$7)`,
    [r.company, r.ats, r.ok, r.jobCount ?? null, r.newCount ?? null, r.error ?? null, r.durationMs],
  );
}

export async function loadLabels(): Promise<Label[]> {
  const r = await db().query<{ title: string; verdict: number }>(
    'select j.title, f.verdict from feedback f join jobs j on j.id = f.job_id',
  );
  return r.rows.map((x) => ({ title: x.title, verdict: x.verdict === 1 ? 1 : -1 }));
}
