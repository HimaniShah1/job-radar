/**
 * Finds which ATS each company in config/candidates.txt uses by guessing board slugs
 * and hitting the public APIs. Prints companies.json lines for every hit.
 *
 *   npm run probe                 # all candidates
 *   npm run probe -- "Razorpay"   # one company
 */
import { adapters } from '../adapters/index.js';
import { readCandidates, toJob } from '../config.js';
import { fetchJson, HttpError } from '../lib/http.js';
import { mapLimit } from '../lib/pool.js';
import { slugGuesses } from '../lib/slugs.js';
import type { AtsKind, CompanySource } from '../types.js';

const PROBED: AtsKind[] = ['greenhouse', 'lever', 'ashby', 'workable', 'recruitee'];
async function probe(name: string) {
  const hits: Array<{ src: CompanySource; total: number; india: number }> = [];
  let networkErrors = 0;
  for (const ats of PROBED) {
    for (const slug of slugGuesses(name)) {
      const src: CompanySource = { name, ats, slug };
      try {
        const body = await fetchJson(adapters[ats].url(src), { retries: 0, timeoutMs: 20_000 });
        const jobs = adapters[ats].parse(body, src);
        if (jobs.length === 0 && ats !== 'greenhouse') continue; // empty lever/workable responses are often "no such board"
        const india = jobs.map((j) => toJob(j, src)).filter((j) => j.cities.length > 0).length;
        hits.push({ src, total: jobs.length, india });
        break; // first working slug per ATS is enough
      } catch (e) {
        if (!(e instanceof HttpError)) networkErrors++;
      }
    }
  }
  return { name, hits, networkErrors };
}

const filter = process.argv[2];
const names = filter ? [filter] : readCandidates();
console.log(`Probing ${names.length} companies across ${PROBED.join(', ')}...\n`);

const results = await mapLimit(names, 4, probe);
const found = results.filter((r) => r.hits.length > 0);
for (const r of found) {
  for (const h of r.hits) {
    const note = `${h.india} of ${h.total} open roles in target cities`;
    console.log(JSON.stringify({ name: r.name, ats: h.src.ats, slug: h.src.slug, notes: note }) + ',');
  }
}
const unreachable = results.filter((r) => r.hits.length === 0 && r.networkErrors > 0).map((r) => r.name);
const missed = results.filter((r) => r.hits.length === 0 && r.networkErrors === 0).map((r) => r.name);
if (unreachable.length) console.log(`\nNetwork errors (re-run these, results unknown): ${unreachable.join(', ')}`);
console.log(`\nFound ${found.length}/${names.length}. Not on a probed ATS (custom site, Darwinbox, Zoho, Keka or a different slug):`);
console.log(missed.join(', ') || 'none');
