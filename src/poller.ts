import { pathToFileURL } from 'node:url';
import { fetchSource } from './adapters/index.js';
import { loadCompanies, loadProfile, toJob } from './config.js';
import {
  closeDb, closeMissing, isBootstrapped, loadLabels, markBootstrapped, markNotified, recordRun, upsertJob,
} from './db.js';
import { trainTitleModel, type TitleModel } from './lib/learn.js';
import { mapLimit } from './lib/pool.js';
import { scoreJob } from './lib/score.js';
import { formatAlert, sendTelegram } from './notify/telegram.js';
import type { CompanySource, Profile } from './types.js';

const CONCURRENCY = Number(process.env.POLL_CONCURRENCY ?? 6);
const INTERVAL_MIN = Math.max(10, Number(process.env.POLL_INTERVAL_MIN ?? 20));
/** Don't alert on a posting the ATS says is older than this, even if we've never seen it. */
const MAX_ALERT_AGE_H = Number(process.env.MAX_ALERT_AGE_HOURS ?? 72);

interface SourceResult {
  company: string;
  ok: boolean;
  total: number;
  inTarget: number;
  alerts: number;
  error?: string;
}

export async function pollSource(src: CompanySource, profile: Profile, model: TitleModel | null): Promise<SourceResult> {
  const started = Date.now();
  try {
    const raws = await fetchSource(src);
    const jobs = raws.map((r) => toJob(r, src)).filter((j) => j.cities.length > 0);
    const bootstrapped = await isBootstrapped(src.name);

    let newCount = 0;
    let alerts = 0;
    for (const job of jobs) {
      const s = scoreJob(job, profile, model);
      const { id, inserted } = await upsertJob(job, s);
      if (!inserted) continue;
      newCount++;

      const tooOld = job.postedAt && Date.now() - job.postedAt.getTime() > MAX_ALERT_AGE_H * 3_600_000;
      if (bootstrapped && !s.rejected && s.score >= profile.notifyThreshold && !tooOld) {
        await sendTelegram(formatAlert(job, s, process.env.DASHBOARD_URL, id));
        await markNotified(id);
        alerts++;
      }
    }

    await closeMissing(src.name, jobs.map((j) => j.key));
    if (!bootstrapped) await markBootstrapped(src.name);
    await recordRun({ company: src.name, ats: src.ats, ok: true, jobCount: raws.length, newCount, durationMs: Date.now() - started });
    return { company: src.name, ok: true, total: raws.length, inTarget: jobs.length, alerts };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    await recordRun({ company: src.name, ats: src.ats, ok: false, error, durationMs: Date.now() - started }).catch(() => {});
    return { company: src.name, ok: false, total: 0, inTarget: 0, alerts: 0, error };
  }
}

export async function pollOnce(): Promise<SourceResult[]> {
  const profile = loadProfile();
  const sources = loadCompanies();
  const model = trainTitleModel(await loadLabels());
  const results = await mapLimit(sources, CONCURRENCY, (s) => pollSource(s, profile, model));

  const failed = results.filter((r) => !r.ok);
  const alerts = results.reduce((n, r) => n + r.alerts, 0);
  const inTarget = results.reduce((n, r) => n + r.inTarget, 0);
  console.log(
    `[${new Date().toISOString()}] ${sources.length} sources, ${inTarget} open roles in target cities, ` +
      `${alerts} alerts, ${failed.length} failed`,
  );
  for (const f of failed) console.log(`  ✗ ${f.company}: ${f.error}`);
  return results;
}

async function main() {
  if (!process.argv.includes('--watch')) {
    await pollOnce();
    await closeDb();
    return;
  }
  console.log(`Watching every ~${INTERVAL_MIN} min. Ctrl+C to stop.`);
  for (;;) {
    await pollOnce().catch((e) => console.error('poll failed', e));
    // Jitter so we never hit every board on the exact same second each cycle.
    const waitMs = INTERVAL_MIN * 60_000 * (0.85 + Math.random() * 0.3);
    await new Promise((r) => setTimeout(r, waitMs));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(async (e) => {
    console.error(e);
    await closeDb();
    process.exit(1);
  });
}
