const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  '#39': "'",
};

export function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&([a-z0-9#]+);/gi, (m, name: string) => ENTITIES[name.toLowerCase()] ?? m);
}

/**
 * HTML -> plain text. Greenhouse double-escapes its content (&lt;p&gt;),
 * so decode once before stripping tags and once after.
 */
export function htmlToText(html: string | null | undefined): string {
  if (!html) return '';
  return decodeEntities(
    decodeEntities(html)
      .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<br\s*\/?>|<\/(p|li|div|h\d)>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

/** Accepts ISO strings, "2026-08-14 08:23:10 UTC", "2026-05-06", epoch ms. */
export function parseDate(v: unknown): Date | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? new Date(v) : null;
  if (typeof v !== 'string') return null;
  const s = v.replace(/ UTC$/, 'Z').replace(/^(\d{4}-\d{2}-\d{2}) (\d)/, '$1T$2');
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}
