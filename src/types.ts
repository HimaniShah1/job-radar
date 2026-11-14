export type AtsKind = 'greenhouse' | 'lever' | 'ashby' | 'workable' | 'recruitee' | 'keka';

export type City = 'bengaluru' | 'hyderabad' | 'pune' | 'remote-india';

/** One company career board we poll. Lives in config/companies.json. */
export interface CompanySource {
  name: string;
  ats: AtsKind;
  /** Board token / account slug as it appears in the careers URL. */
  slug: string;
  /** Keka only: the portal id in /careers/api/jobs/{portal}/active. */
  portal?: string;
  enabled?: boolean;
  notes?: string;
}

/** What an adapter returns: the posting as the ATS describes it, nothing interpreted yet. */
export interface RawJob {
  externalId: string;
  title: string;
  locations: string[];
  /** true/false when the ATS says so, null when it doesn't. */
  remote: boolean | null;
  url: string;
  applyUrl?: string;
  postedAt: Date | null;
  description: string;
  department?: string;
}

export interface Job extends RawJob {
  key: string;
  company: string;
  ats: AtsKind;
  cities: City[];
}

export interface Profile {
  cities: City[];
  yearsOfExperience: number;
  /** A title must contain at least one of these to be considered. */
  titleInclude: string[];
  /** A title containing any of these is rejected outright. */
  titleExclude: string[];
  /** Title words that lower the score but don't reject (e.g. "senior"). */
  titlePenalty: Record<string, number>;
  /** Title words that raise the score (e.g. "sde-1", "sde 2"). */
  titleBoost: Record<string, number>;
  /** Skill keyword -> weight, matched against title + description. */
  skills: Record<string, number>;
  /** Notify only at or above this score. */
  notifyThreshold: number;
}

export interface ScoreResult {
  score: number;
  reasons: string[];
  /** Set when the job fails a hard filter; score is then irrelevant. */
  rejected: string | null;
}
