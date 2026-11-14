import type { AtsKind, CompanySource, RawJob } from '../types.js';
import { fetchJson } from '../lib/http.js';
import { htmlToText, parseDate } from '../lib/text.js';

/**
 * Each adapter is a URL builder plus a pure parser, so parsing is unit-tested
 * against fixtures without touching the network.
 */
export interface Adapter {
  url(src: CompanySource): string;
  parse(body: unknown, src: CompanySource): RawJob[];
}

type Obj = Record<string, any>;
const arr = (v: unknown): Obj[] => (Array.isArray(v) ? (v as Obj[]) : []);
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const uniq = (xs: string[]) => [...new Set(xs.filter(Boolean))];

/** Greenhouse Job Board API: GET boards-api.greenhouse.io/v1/boards/{token}/jobs?content=true */
export const greenhouse: Adapter = {
  url: (s) => `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(s.slug)}/jobs?content=true`,
  parse: (body) =>
    arr((body as Obj)?.jobs).map((j) => ({
      externalId: String(j.id),
      title: str(j.title),
      locations: uniq([str(j.location?.name), ...arr(j.offices).map((o) => str(o.location) || str(o.name))]),
      remote: null,
      url: str(j.absolute_url),
      // first_published is when it went live; updated_at changes on every edit.
      postedAt: parseDate(j.first_published) ?? parseDate(j.updated_at),
      description: htmlToText(j.content),
      department: str(arr(j.departments)[0]?.name) || undefined,
    })),
};

/** Lever Postings API: GET api.lever.co/v0/postings/{company}?mode=json */
export const lever: Adapter = {
  url: (s) => `https://api.lever.co/v0/postings/${encodeURIComponent(s.slug)}?mode=json`,
  parse: (body) =>
    arr(body).map((j) => {
      const c: Obj = j.categories ?? {};
      return {
        externalId: str(j.id),
        title: str(j.text),
        locations: uniq([str(c.location), ...(Array.isArray(c.allLocations) ? c.allLocations.map(str) : [])]),
        remote: typeof j.workplaceType === 'string' ? j.workplaceType.toLowerCase() === 'remote' : null,
        url: str(j.hostedUrl),
        applyUrl: str(j.applyUrl) || undefined,
        postedAt: parseDate(j.createdAt),
        description: [str(j.descriptionPlain), ...arr(j.lists).map((l) => `${str(l.text)}\n${htmlToText(l.content)}`), str(j.additionalPlain)]
          .filter(Boolean)
          .join('\n'),
        department: str(c.team) || str(c.department) || undefined,
      };
    }),
};

/** Ashby Posting API: GET api.ashbyhq.com/posting-api/job-board/{board} */
export const ashby: Adapter = {
  url: (s) => `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(s.slug)}`,
  parse: (body) =>
    arr((body as Obj)?.jobs)
      .filter((j) => j.isListed !== false)
      .map((j) => ({
        externalId: str(j.id) || str(j.jobUrl),
        title: str(j.title),
        locations: uniq([str(j.location), ...arr(j.secondaryLocations).map((l) => str(l.location))]),
        remote: typeof j.isRemote === 'boolean' ? j.isRemote : null,
        url: str(j.jobUrl),
        applyUrl: str(j.applyUrl) || undefined,
        postedAt: parseDate(j.publishedAt),
        description: str(j.descriptionPlain) || htmlToText(j.descriptionHtml),
        department: str(j.department) || undefined,
      })),
};

/** Workable widget API: GET apply.workable.com/api/v1/widget/accounts/{account}?details=true */
export const workable: Adapter = {
  url: (s) => `https://apply.workable.com/api/v1/widget/accounts/${encodeURIComponent(s.slug)}?details=true`,
  parse: (body) =>
    arr((body as Obj)?.jobs).map((j) => {
      const locs = arr(j.locations).map((l) => [str(l.city), str(l.region), str(l.country)].filter(Boolean).join(', '));
      const primary = [str(j.city), str(j.state), str(j.country)].filter(Boolean).join(', ');
      return {
        externalId: str(j.shortcode) || str(j.id),
        title: str(j.title),
        locations: uniq([primary, ...locs]),
        remote: typeof j.telecommuting === 'boolean' ? j.telecommuting : null,
        url: str(j.url) || str(j.shortlink),
        applyUrl: str(j.application_url) || undefined,
        postedAt: parseDate(j.published_on) ?? parseDate(j.created_at),
        description: htmlToText(j.description),
        department: str(j.department) || undefined,
      };
    }),
};

/** Recruitee careers site API: GET {company}.recruitee.com/api/offers/ */
export const recruitee: Adapter = {
  url: (s) => `https://${encodeURIComponent(s.slug)}.recruitee.com/api/offers/`,
  parse: (body) =>
    arr((body as Obj)?.offers)
      .filter((o) => !o.status || o.status === 'published')
      .map((o) => ({
        externalId: String(o.id ?? o.slug),
        title: str(o.title),
        locations: uniq([
          str(o.location),
          [str(o.city), str(o.country)].filter(Boolean).join(', '),
          ...arr(o.locations).map((l) => [str(l.city), str(l.country)].filter(Boolean).join(', ')),
        ]),
        remote: typeof o.remote === 'boolean' ? o.remote : null,
        url: str(o.careers_url),
        applyUrl: str(o.careers_apply_url) || undefined,
        postedAt: parseDate(o.published_at) ?? parseDate(o.created_at),
        description: htmlToText(o.description),
        department: str(o.department) || undefined,
      })),
};

/**
 * Keka Hire careers portal: GET {tenant}.keka.com/careers/api/jobs/{portal}/active
 * EXPERIMENTAL: this endpoint is what Keka's own careers page loads, documented only by
 * third-party scrapers. Field names below are defensive guesses; run `npm run dry-run -- --only <name>`
 * against a real tenant and adjust before trusting it.
 */
export const keka: Adapter = {
  url: (s) => {
    if (!s.portal) throw new Error(`Keka source "${s.name}" needs a "portal" id`);
    return `https://${encodeURIComponent(s.slug)}.keka.com/careers/api/jobs/${encodeURIComponent(s.portal)}/active`;
  },
  parse: (body, src) => {
    const list = Array.isArray(body) ? (body as Obj[]) : arr((body as Obj)?.data ?? (body as Obj)?.jobs);
    return list.map((j) => {
      const id = String(j.id ?? j.jobId ?? '');
      const locs = arr(j.jobLocations ?? j.locations).map(
        (l) => str(l.name) || [str(l.city), str(l.state), str(l.country)].filter(Boolean).join(', '),
      );
      return {
        externalId: id,
        title: str(j.title) || str(j.jobTitle) || str(j.name),
        locations: uniq([str(j.location), ...locs]),
        remote: typeof j.isRemote === 'boolean' ? j.isRemote : null,
        url: `https://${src.slug}.keka.com/careers/jobdetails/${id}`,
        postedAt: parseDate(j.publishedOn ?? j.publishedDate ?? j.createdOn ?? j.createdDate),
        description: htmlToText(j.description ?? j.jobDescription),
        department: str(j.department) || str(j.departmentName) || undefined,
      };
    });
  },
};

export const adapters: Record<AtsKind, Adapter> = { greenhouse, lever, ashby, workable, recruitee, keka };

export async function fetchSource(src: CompanySource): Promise<RawJob[]> {
  const adapter = adapters[src.ats];
  const body = await fetchJson(adapter.url(src));
  return adapter.parse(body, src).filter((j) => j.externalId && j.title && j.url);
}
