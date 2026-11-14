import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { closeDb, db } from '../db.js';

const sql = readFileSync(fileURLToPath(new URL('../../db/schema.sql', import.meta.url)), 'utf8');
await db().query(sql);
console.log('Schema is up to date.');
await closeDb();
