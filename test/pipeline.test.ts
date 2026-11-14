/**
 * End-to-end over a real Postgres (PGlite, in-process): fetch -> score -> upsert -> alert -> close.
 * Only the network is faked.
 */
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDb } from '../src/db.js';
import { pollSource } from '../src/poller.js';
import { loadProfile } from '../src/config.js';
import type { CompanySource } from '../src/types.js';

const schema = readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8');
const pg = new PGlite();
const profile = loadProfile();
const src: CompanySource = { name: 'Hevo Data', ats: 'lever', slug: 'hevodata' };

const posting = (id: string, title: string, hoursAgo = 1) => ({
  id, text: title, createdAt: Date.now() - hoursAgo * 3_600_000,
  categories: { location: 'Bengaluru, India' },
  hostedUrl: `https://jobs.lever.co/hevodata/${id}`,
  descriptionPlain: '1-3 years of Node.js, TypeScript and PostgreSQL. REST APIs on AWS.',
});

let board: unknown[] = [];
const alerts: string[] = [];

beforeAll(async () => {
  await pg.exec(schema);
  useDb({
    query: async (text, params) => {
      const r = await pg.query<any>(text, params as any[]);
      return { rows: r.rows, rowCount: r.affectedRows ?? null };
    },
  });
  vi.stubGlobal('fetch', async (url: string) => {
    if (String(url).includes('api.lever.co')) return new Response(JSON.stringify(board), { status: 200 });
    throw new Error(`unexpected fetch ${url}`);
  });
  vi.spyOn(console, 'log').mockImplementation((msg: unknown) => {
    if (String(msg).startsWith('[alert')) alerts.push(String(msg));
  });
});
afterAll(() => vi.unstubAllGlobals());
beforeEach(() => {
  alerts.length = 0;
});

describe('poll pipeline', () => {
  it('first poll stores everything but sends no alerts (bootstrap)', async () => {
    board = [posting('a', 'SDE I - Backend'), posting('b', 'Engineering Manager')];
    const r = await pollSource(src, profile, null);
    expect(r).toMatchObject({ ok: true, total: 2, inTarget: 2, alerts: 0 });
    const { rows } = await pg.query<{ n: number }>('select count(*)::int as n from jobs');
    expect(rows[0]!.n).toBe(2);
  });

  it('a new matching posting on the next poll triggers exactly one alert', async () => {
    board = [posting('a', 'SDE I - Backend'), posting('b', 'Engineering Manager'), posting('c', 'SDE 2 - Backend (Node.js)')];
    const r = await pollSource(src, profile, null);
    expect(r.alerts).toBe(1);
    expect(alerts[0]).toContain('SDE 2 - Backend (Node.js)');

    // Seeing it again must not re-alert.
    const again = await pollSource(src, profile, null);
    expect(again.alerts).toBe(0);
  });

  it('new but rejected postings are stored with a reason and never alert', async () => {
    board = [...board, posting('d', 'Principal Engineer')];
    const r = await pollSource(src, profile, null);
    expect(r.alerts).toBe(0);
    const { rows } = await pg.query<{ rejected_reason: string }>(`select rejected_reason from jobs where external_id = 'd'`);
    expect(rows[0]!.rejected_reason).toMatch(/principal/);
  });

  it('does not alert on a "new" posting the ATS says is weeks old', async () => {
    board = [...board, posting('e', 'Backend Engineer', 24 * 20)];
    expect((await pollSource(src, profile, null)).alerts).toBe(0);
  });

  it('marks postings that disappear as closed, and reopens them if they come back', async () => {
    board = (board as Array<{ id: string }>).filter((p) => p.id !== 'a');
    await pollSource(src, profile, null);
    let { rows } = await pg.query<{ closed_at: Date | null }>(`select closed_at from jobs where external_id = 'a'`);
    expect(rows[0]!.closed_at).not.toBeNull();

    board = [...board, posting('a', 'SDE I - Backend')];
    await pollSource(src, profile, null);
    ({ rows } = await pg.query<{ closed_at: Date | null }>(`select closed_at from jobs where external_id = 'a'`));
    expect(rows[0]!.closed_at).toBeNull();
  });

  it('a failing board is recorded and leaves existing jobs open', async () => {
    vi.stubGlobal('fetch', async () => new Response('gone', { status: 404 }));
    const r = await pollSource(src, profile, null);
    expect(r.ok).toBe(false);
    const { rows } = await pg.query<{ n: number }>(`select count(*)::int as n from jobs where closed_at is null`);
    expect(rows[0]!.n).toBeGreaterThan(0);
    const runs = await pg.query<{ ok: boolean; error: string }>(`select ok, error from source_runs order by id desc limit 1`);
    expect(runs.rows[0]).toMatchObject({ ok: false, error: expect.stringContaining('404') });
  });
});
