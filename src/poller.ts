/**
 * One poll of every enabled board. Runs in GitHub Actions on a schedule (.github/workflows/poll.yml)
 * and writes to D1 over the HTTP API. Cloudflare's free plan can't run it as a Cron Trigger:
 * a poll needs ~60 ms+ CPU and many D1 calls, and free cron runs get 10 ms and 50 subrequests.
 *
 *   npm run poll           # real D1 (CLOUDFLARE_* env vars)
 *   npm run poll:local     # wrangler's local D1, for `npm run dev`
 */
import { pathToFileURL } from 'node:url';
import { fetchSource } from './adapters/index.js';
import { loadCompanies, loadProfile, toJob } from './config.js';
import { closeMissingStmt, existingKeys, loadLabels, pruneRunsStmt, recordRunStmt, upsertJobStmt } from './db/jobs.js';
import { nodeDb } from './db/node.js';
import type { Db } from './db/types.js';
import { trainTitleModel, type TitleModel } from './lib/learn.js';
import { mapLimit } from './lib/pool.js';
import { scoreJob } from './lib/score.js';
import type { CompanySource, JobStatus, Profile, ScoreResult } from './types.js';

const CONCURRENCY = Number(process.env.POLL_CONCURRENCY ?? 6);

/**
 * Where a newly seen job lands on the dashboard. Hard-filtered jobs get "maybe" but stay hidden
 * (the API hides anything with a rejected_reason).
 */
export function initialStatus(s: ScoreResult, profile: Profile): JobStatus {
  return !s.rejected && s.score >= profile.toApplyThreshold ? 'to_apply' : 'maybe';
}

interface SourceResult {
  company: string;
  ok: boolean;
  total: number;
  inTarget: number;
  /** New jobs this poll that landed in "To apply". */
  toApply: number;
  error?: string;
}

export async function pollSource(db: Db, src: CompanySource, profile: Profile, model: TitleModel | null): Promise<SourceResult> {
  const started = Date.now();
  try {
    const raws = await fetchSource(src);
    const jobs = raws.map((r) => toJob(r, src)).filter((j) => j.cities.length > 0);
    const known = await existingKeys(db, src.name);

    let newCount = 0;
    let toApply = 0;
    const stmts = jobs.map((job) => {
      const s = scoreJob(job, profile, model);
      const status = initialStatus(s, profile);
      if (!known.has(job.key)) {
        newCount++;
        if (status === 'to_apply') toApply++;
      }
      return upsertJobStmt(job, s, status);
    });
    stmts.push(closeMissingStmt(src.name, jobs.map((j) => j.key)));
    stmts.push(recordRunStmt({ company: src.name, ats: src.ats, ok: true, jobCount: raws.length, newCount, durationMs: Date.now() - started }));
    await db.batch(stmts);
    return { company: src.name, ok: true, total: raws.length, inTarget: jobs.length, toApply };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    await db.batch([recordRunStmt({ company: src.name, ats: src.ats, ok: false, error, durationMs: Date.now() - started })]).catch(() => {});
    return { company: src.name, ok: false, total: 0, inTarget: 0, toApply: 0, error };
  }
}

export async function pollOnce(db: Db): Promise<SourceResult[]> {
  const profile = loadProfile();
  const sources = loadCompanies();
  const model = trainTitleModel(await loadLabels(db));
  const results = await mapLimit(sources, CONCURRENCY, (s) => pollSource(db, s, profile, model));
  await db.batch([pruneRunsStmt()]);

  const failed = results.filter((r) => !r.ok);
  const toApply = results.reduce((n, r) => n + r.toApply, 0);
  const inTarget = results.reduce((n, r) => n + r.inTarget, 0);
  console.log(
    `[${new Date().toISOString()}] ${sources.length} sources, ${inTarget} open roles in India, ` +
      `${toApply} new in To apply, ${failed.length} failed`,
  );
  for (const f of failed) console.log(`  ✗ ${f.company}: ${f.error}`);
  return results;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const db = await nodeDb(process.argv.includes('--local'));
  const results = await pollOnce(db);
  // A failing board is normal (it moved, it's down). Every board failing means our side is broken.
  if (results.length > 0 && results.every((r) => !r.ok)) process.exit(1);
}
