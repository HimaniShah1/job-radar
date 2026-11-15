import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import type { Db, Param } from './types.js';

/** node:sqlite backend. Same engine D1 runs, so tests exercise the real SQL. */
export function sqliteDb(path = ':memory:'): Db & { raw: DatabaseSync } {
  const raw = new DatabaseSync(path);
  raw.exec('pragma foreign_keys = on; pragma busy_timeout = 5000;');
  return {
    raw,
    all: async <T>(sql: string, params: Param[] = []) => raw.prepare(sql).all(...params) as T[],
    batch: async (stmts) => {
      raw.exec('begin');
      try {
        for (const s of stmts) raw.prepare(s.sql).run(...(s.params ?? []));
        raw.exec('commit');
      } catch (e) {
        raw.exec('rollback');
        throw e;
      }
    },
  };
}

/** Applies every file in migrations/ in order. For tests; real databases use `wrangler d1 migrations apply`. */
export function applyMigrations(db: { raw: DatabaseSync }) {
  const dir = fileURLToPath(new URL('../../migrations/', import.meta.url));
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) db.raw.exec(readFileSync(dir + f, 'utf8'));
}
