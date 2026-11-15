/**
 * The slice of D1 this app uses. Three backends implement it:
 *   d1.ts      the Worker's D1 binding (dashboard)
 *   http.ts    D1's HTTP API (poller running in GitHub Actions)
 *   sqlite.ts  node:sqlite (tests, and `poll:local` against wrangler's local D1 file)
 * All three speak SQLite, so the SQL is shared.
 */
export type Param = string | number | null;

export interface Stmt {
  sql: string;
  params?: Param[];
}

export interface Db {
  all<T = Record<string, unknown>>(sql: string, params?: Param[]): Promise<T[]>;
  /** Runs statements in order, in one transaction where the backend supports it. */
  batch(stmts: Stmt[]): Promise<void>;
}

/** ISO-8601 UTC, the format every timestamp column uses. */
export const iso = (d: Date) => d.toISOString();
