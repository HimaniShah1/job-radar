import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { CompanySource, Profile, RawJob, Job, AtsKind } from './types.js';
import { matchCities } from './lib/location.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const readJson = <T>(rel: string): T => JSON.parse(readFileSync(`${root}/${rel}`, 'utf8')) as T;

const ATS: AtsKind[] = ['greenhouse', 'lever', 'ashby', 'workable', 'recruitee', 'keka'];

export function loadProfile(): Profile {
  return readJson<Profile>('config/profile.json');
}

export function loadCompanies(): CompanySource[] {
  const list = readJson<CompanySource[]>('config/companies.json');
  const seen = new Set<string>();
  for (const c of list) {
    if (!ATS.includes(c.ats)) throw new Error(`companies.json: "${c.name}" has unknown ats "${c.ats}"`);
    const k = `${c.ats}:${c.slug}`;
    if (seen.has(k)) throw new Error(`companies.json: duplicate source ${k}`);
    seen.add(k);
  }
  return list.filter((c) => c.enabled !== false);
}

export function readCandidates(): string[] {
  return readFileSync(`${root}/config/candidates.txt`, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
}

export function toJob(raw: RawJob, src: CompanySource): Job {
  return {
    ...raw,
    key: `${src.ats}:${src.slug.toLowerCase()}:${raw.externalId}`,
    company: src.name,
    ats: src.ats,
    cities: matchCities(raw.locations, raw.remote),
  };
}
