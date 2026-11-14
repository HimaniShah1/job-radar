export interface YearsRange {
  min: number;
  max: number | null;
}

const RANGE = /(\d{1,2}(?:\.\d)?)\s*(?:-|–|—|to)\s*(\d{1,2}(?:\.\d)?)\s*\+?\s*(?:years?|yrs?)/gi;
const MIN_ONLY = /(?:minimum(?: of)?|at least|min\.?)?\s*(\d{1,2}(?:\.\d)?)\s*\+\s*(?:years?|yrs?)|(?:minimum(?: of)?|at least|min\.?)\s*(\d{1,2}(?:\.\d)?)\s*(?:years?|yrs?)/gi;

/**
 * Pulls the required experience out of a JD.
 *
 * JDs often mention several numbers ("4+ years overall, 2+ years with Node"), so this
 * takes the LARGEST minimum found: the overall bar is the one that decides if you're
 * screened out. Numbers over 15 are ignored (usually "20 years in business" fluff).
 */
export function parseYears(text: string): YearsRange | null {
  const hits: YearsRange[] = [];
  for (const m of text.matchAll(RANGE)) {
    const min = Number(m[1]);
    const max = Number(m[2]);
    if (min <= 15 && max >= min && max <= 25) hits.push({ min, max });
  }
  for (const m of text.matchAll(MIN_ONLY)) {
    const n = Number(m[1] ?? m[2]);
    if (Number.isFinite(n) && n <= 15) hits.push({ min: n, max: null });
  }
  if (hits.length === 0) return null;
  return hits.reduce((a, b) => (b.min > a.min ? b : a));
}
