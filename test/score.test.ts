import { describe, expect, it } from 'vitest';
import { loadProfile } from '../src/config.js';
import { scoreJob } from '../src/lib/score.js';
import type { Job } from '../src/types.js';

const profile = loadProfile();
const now = new Date('2026-11-14T06:00:00Z');
const job = (over: Partial<Job>): Job => ({
  key: 'k', company: 'Acme', ats: 'lever', externalId: '1', url: 'https://x', remote: null,
  title: 'Software Engineer', locations: ['Bengaluru'], cities: ['bengaluru'],
  description: '', postedAt: null, ...over,
});

describe('scoreJob with the real profile', () => {
  it('ranks a fresh SDE-2 Node/TS backend role high', () => {
    const s = scoreJob(job({
      title: 'SDE 2 - Backend',
      description: '2-4 years building REST APIs in Node.js, TypeScript, PostgreSQL on AWS.',
      postedAt: new Date('2026-11-14T03:00:00Z'),
    }), profile, null, now);
    expect(s.rejected).toBeNull();
    expect(s.score).toBeGreaterThanOrEqual(profile.toApplyThreshold);
    expect(s.reasons.join(' ')).toMatch(/posted <6h ago/);
  });

  it('keeps Member of Technical Staff (staff is a seniority word, MTS is not)', () => {
    expect(scoreJob(job({ title: 'Member of Technical Staff (MTS) – Core Full-Stack / Backend' }), profile, null, now).rejected).toBeNull();
    expect(scoreJob(job({ title: 'Staff Software Engineer- Backend' }), profile, null, now).rejected).toMatch(/staff/);
  });

  it.each([
    ['Senior Engineering Manager', /manager/],
    ['SDE- IV / Lead Engineer', /lead|sde iv/],
    ['QA Engineer - Lead', /qa|lead/],
    ['Software Engineer Intern', /intern/],
    ['Enterprise Account Executive', /not an engineering role/],
  ])('rejects %s', (title, why) => {
    expect(scoreJob(job({ title }), profile, null, now).rejected).toMatch(why);
  });

  it('does not treat SDET as SDE', () => {
    expect(scoreJob(job({ title: 'SDET II' }), profile, null, now).rejected).not.toBeNull();
  });

  it('rejects roles whose experience bar is out of reach', () => {
    const s = scoreJob(job({ title: 'Backend Engineer', description: 'Minimum of 5 years experience' }), profile, null, now);
    expect(s.rejected).toBe('needs 5+ yrs');
  });

  it('rejects locations outside India', () => {
    expect(scoreJob(job({ cities: [] }), profile, null, now).rejected).toMatch(/location/);
  });

  it('keeps other Indian cities but ranks them below the preferred ones', () => {
    const preferred = scoreJob(job({ title: 'Backend Engineer' }), profile, null, now);
    const elsewhere = scoreJob(job({ title: 'Backend Engineer', locations: ['Chennai'], cities: ['india-other'] }), profile, null, now);
    expect(elsewhere.rejected).toBeNull();
    expect(elsewhere.score).toBe(preferred.score - profile.otherCityPenalty);
    expect(elsewhere.reasons.join(' ')).toMatch(/outside preferred cities/);
  });

  it('rejects postings older than maxPostingAgeDays, keeps undated ones', () => {
    const old = new Date(now.getTime() - 240 * 86_400_000);
    expect(scoreJob(job({ postedAt: old }), profile, null, now).rejected).toBe('posted 240 days ago');
    const edge = new Date(now.getTime() - profile.maxPostingAgeDays * 86_400_000 + 3_600_000);
    expect(scoreJob(job({ postedAt: edge }), profile, null, now).rejected).toBeNull();
    expect(scoreJob(job({ postedAt: null }), profile, null, now).rejected).toBeNull();
  });

  it('scores "senior" below the plain title but does not reject it', () => {
    const plain = scoreJob(job({ title: 'Backend Engineer', description: '3+ years Node.js' }), profile, null, now);
    const senior = scoreJob(job({ title: 'Senior Backend Engineer', description: '3+ years Node.js' }), profile, null, now);
    expect(senior.rejected).toBeNull();
    expect(senior.score).toBeLessThan(plain.score);
  });

  it('does not match short skills inside longer words ("go" in "google")', () => {
    const s = scoreJob(job({ title: 'Software Engineer', description: 'We use Google Workspace' }), profile, null, now);
    expect(s.reasons.join(' ')).not.toMatch(/stack/);
  });
});
