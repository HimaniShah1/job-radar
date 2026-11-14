/**
 * Learns from your thumbs up/down. Deliberately simple: per-token log-odds over job titles
 * with Laplace smoothing. With tens of labels, anything fancier would just overfit.
 *
 * It only nudges the score (±MAX_ADJUST); the rule-based scorer stays in charge.
 */
export interface Label {
  title: string;
  verdict: 1 | -1;
}

export interface TitleModel {
  weights: Map<string, number>;
  labelCount: number;
}

const MIN_LABELS = 10;
const MAX_ADJUST = 12;
const STOP = new Set(['and', 'or', 'the', 'of', 'for', 'to', 'a', 'an', 'in', 'at', 'with', '-', '|', 'india', 'bengaluru', 'bangalore', 'hyderabad', 'pune', 'remote']);

export function tokenize(title: string): string[] {
  const words = title
    .toLowerCase()
    .replace(/[()[\],/]/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !STOP.has(w));
  // Bigrams catch "full stack", "sde 2", "software engineer" as units.
  const bigrams = words.slice(1).map((w, i) => `${words[i]} ${w}`);
  return [...new Set([...words, ...bigrams])];
}

export function trainTitleModel(labels: Label[]): TitleModel {
  const pos = new Map<string, number>();
  const neg = new Map<string, number>();
  let nPos = 0;
  let nNeg = 0;
  for (const l of labels) {
    const bucket = l.verdict === 1 ? pos : neg;
    l.verdict === 1 ? nPos++ : nNeg++;
    for (const t of tokenize(l.title)) bucket.set(t, (bucket.get(t) ?? 0) + 1);
  }
  const weights = new Map<string, number>();
  for (const t of new Set([...pos.keys(), ...neg.keys()])) {
    const p = ((pos.get(t) ?? 0) + 1) / (nPos + 2);
    const n = ((neg.get(t) ?? 0) + 1) / (nNeg + 2);
    weights.set(t, Math.log(p / n));
  }
  return { weights, labelCount: labels.length };
}

/** Score adjustment in [-MAX_ADJUST, MAX_ADJUST]; 0 until there are enough labels to mean anything. */
export function titleAdjustment(model: TitleModel | null, title: string): number {
  if (!model || model.labelCount < MIN_LABELS) return 0;
  const sum = tokenize(title).reduce((s, t) => s + (model.weights.get(t) ?? 0), 0);
  return Math.round(Math.max(-MAX_ADJUST, Math.min(MAX_ADJUST, sum * 4)));
}
