export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly url: string,
  ) {
    super(`HTTP ${status} for ${url}`);
  }
}

const UA = process.env.HTTP_USER_AGENT ?? 'job-radar/0.1 (personal job alerts; polite polling)';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * GET JSON with a timeout and retries on 429/5xx/network errors.
 * 4xx other than 429 fails immediately: a 404 means the board moved, retrying won't help.
 */
export async function fetchJson<T = unknown>(
  url: string,
  // Large Lever boards (Pattern, ~1.6 MB) take ~14s live; 15s timed out intermittently.
  { timeoutMs = 30_000, retries = 2 }: { timeoutMs?: number; retries?: number } = {},
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { accept: 'application/json', 'user-agent': UA },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.ok) return (await res.json()) as T;
      const retryable = res.status === 429 || res.status >= 500;
      if (!retryable) throw new HttpError(res.status, url);
      lastErr = new HttpError(res.status, url);
    } catch (err) {
      if (err instanceof HttpError && !(err.status === 429 || err.status >= 500)) throw err;
      lastErr = err;
    }
    if (attempt < retries) await sleep(1000 * 2 ** attempt + Math.random() * 500);
  }
  throw lastErr;
}
