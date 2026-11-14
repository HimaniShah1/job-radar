import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { adapters } from '../src/adapters/index.js';
import { toJob } from '../src/config.js';
import type { AtsKind, CompanySource } from '../src/types.js';

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'));
const parse = (ats: AtsKind, src: Partial<CompanySource> = {}) => {
  const source: CompanySource = { name: 'Acme', ats, slug: 'acme', ...src };
  return adapters[ats].parse(fixture(ats), source).map((r) => toJob(r, source));
};

describe('greenhouse', () => {
  const jobs = parse('greenhouse');
  it('decodes double-escaped HTML content', () => {
    expect(jobs[0]!.description).toBe('We need 2-4 years of experience with Node.js & TypeScript and PostgreSQL.');
  });
  it('prefers first_published over updated_at', () => {
    expect(jobs[0]!.postedAt?.toISOString()).toBe('2026-11-13T13:30:00.000Z');
  });
  it('merges office locations and maps cities', () => {
    expect(jobs[0]!.locations).toContain('Bengaluru, India');
    expect(jobs[0]!.cities).toEqual(['bengaluru']);
    expect(jobs[1]!.cities).toEqual([]);
  });
});

describe('lever', () => {
  const jobs = parse('lever');
  it('reads allLocations, epoch-ms createdAt and list content', () => {
    expect(jobs[0]!.cities.sort()).toEqual(['bengaluru', 'pune']);
    expect(jobs[0]!.postedAt?.getTime()).toBe(1763020800000);
    expect(jobs[0]!.description).toContain('1-3 years backend experience');
    expect(jobs[0]!.applyUrl).toMatch(/apply$/);
  });
  it('keeps the ATS slug in the dedupe key, case-insensitively', () => {
    const [a] = parse('lever', { slug: 'HevoData' });
    expect(a!.key).toBe('lever:hevodata:6cbbe304-e065-4711-bf3e-756795d2bc2a');
  });
});

describe('ashby', () => {
  const jobs = parse('ashby');
  it('drops unlisted roles and includes secondary locations', () => {
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.cities.sort()).toEqual(['bengaluru', 'hyderabad']);
  });
});

describe('workable', () => {
  it('builds location strings and uses shortcode as id', () => {
    const [j] = parse('workable');
    expect(j!.externalId).toBe('52D18CB3E4');
    expect(j!.cities).toEqual(['pune']);
    expect(j!.postedAt?.toISOString().slice(0, 10)).toBe('2026-11-12');
  });
});

describe('recruitee', () => {
  it('parses "UTC"-suffixed timestamps and skips drafts', () => {
    const jobs = parse('recruitee');
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.postedAt?.toISOString()).toBe('2026-11-13T08:23:10.000Z');
  });
});

describe('keka (experimental)', () => {
  it('builds the public jobdetails URL from tenant + id', () => {
    const [j] = parse('keka', { slug: 'prismforce', portal: 'abc' });
    expect(j!.url).toBe('https://prismforce.keka.com/careers/jobdetails/158948');
    expect(j!.cities.sort()).toEqual(['bengaluru', 'pune']);
  });
  it('refuses to build a URL without a portal id', () => {
    expect(() => adapters.keka.url({ name: 'x', ats: 'keka', slug: 'x' })).toThrow(/portal/);
  });
});
