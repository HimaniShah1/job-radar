/**
 * Fetch and score without a database or Telegram. Use it to check a new source
 * or tune profile.json:
 *   npm run dry-run                      # every enabled source
 *   npm run dry-run -- --only "Hevo Data" --all   # one source, include rejected roles
 */
import { fetchSource } from '../adapters/index.js';
import { loadCompanies, loadProfile, toJob } from '../config.js';
import { mapLimit } from '../lib/pool.js';
import { scoreJob } from '../lib/score.js';

const args = process.argv.slice(2);
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : undefined;
const showAll = args.includes('--all');

const profile = loadProfile();
const sources = loadCompanies().filter((s) => !only || s.name.toLowerCase() === only.toLowerCase());
if (sources.length === 0) throw new Error(`No enabled source named "${only}"`);

const rows = (
  await mapLimit(sources, 6, async (src) => {
    try {
      const jobs = (await fetchSource(src)).map((r) => toJob(r, src)).filter((j) => j.cities.length > 0);
      return jobs.map((j) => ({ j, s: scoreJob(j, profile) }));
    } catch (e) {
      console.log(`✗ ${src.name}: ${e instanceof Error ? e.message : e}`);
      return [];
    }
  })
).flat();

const shown = rows.filter((r) => showAll || !r.s.rejected).sort((a, b) => b.s.score - a.s.score);
for (const { j, s } of shown) {
  const tag = s.rejected ? `REJECT (${s.rejected})` : String(s.score).padStart(3);
  console.log(`${tag}  ${j.company} | ${j.title} | ${j.cities.join(',')}\n      ${s.reasons.join(', ')}\n      ${j.url}`);
}
const passing = rows.filter((r) => !r.s.rejected);
console.log(
  `\n${rows.length} roles in target cities, ${passing.length} pass filters, ` +
    `${passing.filter((r) => r.s.score >= profile.notifyThreshold).length} at or above notify threshold ${profile.notifyThreshold}.`,
);
