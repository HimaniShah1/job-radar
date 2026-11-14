const SUFFIXES = /\b(technologies|technology|tech|labs|software|solutions|systems|india|inc|pvt|ltd|private|limited|ai|hq|app|security)\b/g;

/** "Money View" -> ["moneyview", "money-view", ...]; "Abnormal Security" -> also "abnormal". */
export function slugGuesses(name: string): string[] {
  const base = name.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9\s.-]/g, '');
  const trimmed = base.replace(SUFFIXES, '').replace(/\s+/g, ' ').trim();
  const forms = (s: string) => [s.replace(/[\s.]+/g, ''), s.replace(/[\s.]+/g, '-')];
  return [...new Set([...forms(base), ...forms(trimmed), ...forms(trimmed).map((s) => `${s}hq`)])].filter((s) => s.length > 1);
}
