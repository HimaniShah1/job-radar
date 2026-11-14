import type { Job, Profile, ScoreResult } from '../types.js';
import { parseYears } from './experience.js';
import { titleAdjustment, type TitleModel } from './learn.js';

const has = (haystack: string, needle: string) => {
  // Word-ish boundaries so "go" doesn't match "google" and "sde" doesn't match "sdet".
  const esc = needle.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${esc}($|[^a-z0-9])`, 'i').test(haystack);
};

/**
 * Rule-based scoring, 0-100. Hard filters reject; everything else adds or subtracts
 * with a human-readable reason, so every alert explains itself.
 */
export function scoreJob(job: Job, profile: Profile, model: TitleModel | null = null, now = new Date()): ScoreResult {
  const title = job.title.toLowerCase();
  const reasons: string[] = [];

  // ---- hard filters
  if (!job.cities.some((c) => profile.cities.includes(c))) return reject('location not in target cities');
  const excluded = profile.titleExclude.find((w) => has(title, w));
  if (excluded) return reject(`title has "${excluded}"`);
  if (!profile.titleInclude.some((w) => has(title, w))) return reject('title is not an engineering role I target');

  const years = parseYears(`${job.title}\n${job.description}`);
  if (years && years.min > profile.yearsOfExperience + 2) return reject(`needs ${years.min}+ yrs`);

  // ---- soft scoring
  let score = 30;
  reasons.push('role match');

  for (const [w, pts] of Object.entries(profile.titleBoost)) {
    if (has(title, w)) {
      score += pts;
      reasons.push(`+${pts} "${w}"`);
      break;
    }
  }
  for (const [w, pts] of Object.entries(profile.titlePenalty)) {
    if (has(title, w)) {
      score -= pts;
      reasons.push(`-${pts} "${w}"`);
    }
  }

  if (!years) {
    score += 8;
    reasons.push('exp not stated');
  } else if (years.min <= profile.yearsOfExperience + 1) {
    score += 20;
    reasons.push(`exp ${years.min}${years.max ? `-${years.max}` : '+'} yrs fits`);
  } else {
    score += 4;
    reasons.push(`exp ${years.min}+ yrs is a stretch`);
  }

  const text = `${title}\n${job.description.toLowerCase()}`;
  const matched = Object.entries(profile.skills).filter(([skill]) => has(text, skill));
  const skillPts = Math.min(30, matched.reduce((s, [, w]) => s + w, 0));
  if (skillPts > 0) {
    score += skillPts;
    reasons.push(`stack: ${matched.map(([s]) => s).slice(0, 5).join(', ')}`);
  }

  if (job.postedAt) {
    const ageH = (now.getTime() - job.postedAt.getTime()) / 3_600_000;
    if (ageH <= 6) {
      score += 10;
      reasons.push('posted <6h ago');
    } else if (ageH <= 24) {
      score += 5;
      reasons.push('posted <24h ago');
    } else if (ageH > 24 * 14) {
      score -= 10;
      reasons.push('posted >2 weeks ago');
    }
  }

  const adj = titleAdjustment(model, job.title);
  if (adj !== 0) {
    score += adj;
    reasons.push(`${adj > 0 ? '+' : ''}${adj} from your feedback`);
  }

  return { score: Math.max(0, Math.min(100, Math.round(score))), reasons, rejected: null };

  function reject(why: string): ScoreResult {
    return { score: 0, reasons: [], rejected: why };
  }
}
