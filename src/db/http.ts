import type { Db, Param, Stmt } from './types.js';

/**
 * D1 over Cloudflare's REST API, for the poller running outside Cloudflare (GitHub Actions).
 * POST /accounts/{account}/d1/database/{db}/query with {sql, params} or {batch: [...]}.
 * The token needs only "Account > D1 > Edit".
 */
export interface D1HttpConfig {
  accountId: string;
  databaseId: string;
  apiToken: string;
}

/** Keep each request body well under API limits even when descriptions are long. */
const MAX_BATCH = 40;

interface ApiResponse<T> {
  success: boolean;
  errors?: Array<{ code: number; message: string }>;
  result?: Array<{ results?: T[]; success: boolean }>;
}

export function d1Http(cfg: D1HttpConfig, fetchImpl: typeof fetch = fetch): Db {
  const url = `https://api.cloudflare.com/client/v4/accounts/${cfg.accountId}/d1/database/${cfg.databaseId}/query`;

  async function post<T>(body: unknown): Promise<ApiResponse<T>> {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${cfg.apiToken}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    const json = (await res.json().catch(() => null)) as ApiResponse<T> | null;
    if (!res.ok || !json?.success) {
      const msg = json?.errors?.map((e) => `${e.code}: ${e.message}`).join('; ') || `HTTP ${res.status}`;
      throw new Error(`D1 API: ${msg}`);
    }
    return json;
  }

  const norm = (params: Param[] = []) => params.map((p) => (p === undefined ? null : p));

  return {
    async all<T>(sql: string, params?: Param[]) {
      const r = await post<T>({ sql, params: norm(params) });
      return r.result?.[0]?.results ?? [];
    },
    async batch(stmts: Stmt[]) {
      for (let i = 0; i < stmts.length; i += MAX_BATCH) {
        await post({ batch: stmts.slice(i, i + MAX_BATCH).map((s) => ({ sql: s.sql, params: norm(s.params) })) });
      }
    },
  };
}
