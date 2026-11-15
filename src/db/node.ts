import { existsSync, readdirSync } from 'node:fs';
import { d1Http } from './http.js';
import type { Db } from './types.js';

const LOCAL_D1_DIR = '.wrangler/state/v3/d1/miniflare-D1DatabaseObject';

/**
 * Database for Node-side scripts (the poller).
 *   --local  wrangler's local D1 file, the one `npm run dev` serves
 *   default  the real D1 database over the HTTP API (CLOUDFLARE_* env vars)
 */
export async function nodeDb(local: boolean): Promise<Db> {
  if (local) {
    const file = existsSync(LOCAL_D1_DIR) && readdirSync(LOCAL_D1_DIR).find((f) => f.endsWith('.sqlite') && f !== 'metadata.sqlite');
    if (!file) throw new Error(`No local D1 database yet. Run "npm run db:migrate:local" first.`);
    const { sqliteDb } = await import('./sqlite.js'); // node:sqlite only when needed
    return sqliteDb(`${LOCAL_D1_DIR}/${file}`);
  }
  const { CLOUDFLARE_ACCOUNT_ID: accountId, D1_DATABASE_ID: databaseId, CLOUDFLARE_API_TOKEN: apiToken } = process.env;
  if (!accountId || !databaseId || !apiToken) {
    throw new Error('Set CLOUDFLARE_ACCOUNT_ID, D1_DATABASE_ID and CLOUDFLARE_API_TOKEN (see .env.example), or use --local.');
  }
  return d1Http({ accountId, databaseId, apiToken });
}
