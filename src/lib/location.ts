import type { City } from '../types.js';

/**
 * Postings spell the same city a dozen ways. Word boundaries stop "Pune" matching
 * inside other words, and "hyd"/"blr" cover the shorthand recruiters use.
 */
const CITY_PATTERNS: Array<[Exclude<City, 'remote-india'>, RegExp]> = [
  ['bengaluru', /\b(bengaluru|bangalore|bengalore|blr|whitefield|koramangala|hsr layout|electronic city|bellandur|marathahalli)\b/i],
  ['hyderabad', /\b(hyderabad|secunderabad|hyd|gachibowli|hitec ?city|madhapur|kondapur)\b/i],
  ['pune', /\b(pune|hinjewadi|hinjawadi|kharadi|baner|magarpatta|viman nagar)\b/i],
];

const INDIA_WORD = /\bindia\b/i;
/** Country code only in caps, so the English word "in" ("work in any timezone") doesn't match. */
const INDIA_CODE = /\bIN\b/;
const INDIA = { test: (s: string) => INDIA_WORD.test(s) || INDIA_CODE.test(s) };
const REMOTE = /\b(remote|work from home|wfh|anywhere)\b/i;
const PAN_INDIA = /\bpan[\s-]?india\b|\banywhere in india\b/i;
/** Remote postings scoped to another country. "Remote - USA" must not count as remote-india. */
const OTHER_REGION = /\b(us|usa|united states|uk|united kingdom|canada|europe|emea|eu|germany|latam|americas|australia|singapore|philippines)\b/i;

export function matchCities(locations: string[], remoteFlag: boolean | null = null): City[] {
  const found = new Set<City>();
  for (const raw of locations) {
    const loc = raw.trim();
    if (!loc) continue;
    for (const [city, re] of CITY_PATTERNS) if (re.test(loc)) found.add(city);

    const isRemote = REMOTE.test(loc) || PAN_INDIA.test(loc);
    if (PAN_INDIA.test(loc) || (isRemote && INDIA.test(loc) && !OTHER_REGION.test(loc))) found.add('remote-india');
  }
  // ATS says remote and every listed location is in India (e.g. "Bengaluru" + isRemote=true).
  if (remoteFlag === true && found.size > 0) found.add('remote-india');
  // ATS says remote and the only location given is the country (Lever: "India" + workplaceType=remote).
  const listed = locations.map((l) => l.trim()).filter(Boolean);
  if (remoteFlag === true && listed.length > 0 && listed.every((l) => INDIA.test(l) && !OTHER_REGION.test(l))) {
    found.add('remote-india');
  }
  return [...found];
}
