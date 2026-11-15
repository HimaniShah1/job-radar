import type { Db, Param } from './types.js';

/** Structural type for the Worker's D1 binding, so we don't pull in @cloudflare/workers-types. */
interface D1Statement {
  bind(...values: Param[]): D1Statement;
  all<T>(): Promise<{ results: T[] }>;
}
export interface D1Binding {
  prepare(sql: string): D1Statement;
  batch(stmts: D1Statement[]): Promise<unknown>;
}

export function fromD1(d1: D1Binding): Db {
  const stmt = (sql: string, params: Param[] = []) => d1.prepare(sql).bind(...params);
  return {
    all: async <T>(sql: string, params?: Param[]) => (await stmt(sql, params).all<T>()).results,
    // db.batch() is one transaction and counts as one query against the free plan's 50-per-request limit.
    batch: async (stmts) => {
      if (stmts.length) await d1.batch(stmts.map((s) => stmt(s.sql, s.params)));
    },
  };
}
