/**
 * End-to-end over real SQLite (node:sqlite, the engine D1 runs), using the real migrations:
 * fetch -> score -> upsert -> status -> close, then the dashboard API on the same data.
 * Only the network is faked.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/api.js';
import { loadProfile } from '../src/config.js';
import { applyMigrations, sqliteDb } from '../src/db/sqlite.js';
import { pollSource } from '../src/poller.js';
import type { CompanySource } from '../src/types.js';

const db = sqliteDb();
applyMigrations(db);
const app = createApp({ db: () => db });
const profile = loadProfile();
const src: CompanySource = { name: 'Hevo Data', ats: 'lever', slug: 'hevodata' };

const posting = (id: string, title: string, hoursAgo = 1) => ({
  id, text: title, createdAt: Date.now() - hoursAgo * 3_600_000,
  categories: { location: 'Bengaluru, India' },
  hostedUrl: `https://jobs.lever.co/hevodata/${id}`,
  descriptionPlain: '1-3 years of Node.js, TypeScript and PostgreSQL. REST APIs on AWS.',
});

let board: unknown[] = [];
const q = <T>(sql: string, ...params: (string | number | null)[]) => db.raw.prepare(sql).all(...params) as T[];
const exec = (sql: string, ...params: (string | number | null)[]) => db.raw.prepare(sql).run(...params);
const statusOf = async (externalId: string) => q<{ status: string }>(`select status from jobs where external_id = ?`, externalId)[0]?.status;
const idOf = async (externalId: string) => q<{ id: number }>(`select id from jobs where external_id = ?`, externalId)[0]!.id;
const call = (method: string, path: string, body?: unknown) =>
  app.request(path, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
const poll = (p = profile) => pollSource(db, src, p, null);

beforeAll(() => {
  vi.stubGlobal('fetch', async (url: string) => {
    if (String(url).includes('api.lever.co')) return new Response(JSON.stringify(board), { status: 200 });
    throw new Error(`unexpected fetch ${url}`);
  });
});
afterAll(() => vi.unstubAllGlobals());

describe('poll pipeline', () => {
  it('first poll puts good matches straight into To apply', async () => {
    board = [posting('a', 'SDE I - Backend'), posting('b', 'Engineering Manager')];
    const r = await poll();
    expect(r).toMatchObject({ ok: true, total: 2, inTarget: 2, toApply: 1 });
    expect(await statusOf('a')).toBe('to_apply');
  });

  it('counts each new match once, not on every poll', async () => {
    board = [...board, posting('c', 'SDE 2 - Backend (Node.js)')];
    expect((await poll()).toApply).toBe(1);
    expect((await poll()).toApply).toBe(0);
  });

  it('hard-filtered postings are stored with a reason and kept out of To apply', async () => {
    board = [...board, posting('d', 'Principal Engineer')];
    expect((await poll()).toApply).toBe(0);
    const rows = q<{ rejected_reason: string; status: string }>(`select rejected_reason, status from jobs where external_id = 'd'`);
    expect(rows[0]!.rejected_reason).toMatch(/principal/);
    expect(rows[0]!.status).toBe('maybe');
  });

  it('lower-scoring matches go to Maybe, and move up if a rescore crosses the threshold', async () => {
    board = [...board, posting('e', 'Backend Engineer', 24 * 20)];
    await poll({ ...profile, toApplyThreshold: 101 });
    expect(await statusOf('e')).toBe('maybe');

    await poll({ ...profile, toApplyThreshold: 0 });
    expect(await statusOf('e')).toBe('to_apply');
  });

  it('polling never overwrites a status you set', async () => {
    exec(`update jobs set status = 'applied' where external_id = 'a'`);
    await poll({ ...profile, toApplyThreshold: 0 });
    expect(await statusOf('a')).toBe('applied');
    exec(`update jobs set status = 'to_apply' where external_id = 'a'`);
  });

  it('marks postings that disappear as closed, and reopens them if they come back', async () => {
    board = (board as Array<{ id: string }>).filter((p) => p.id !== 'a');
    await poll();
    expect(q<{ closed_at: string | null }>(`select closed_at from jobs where external_id = 'a'`)[0]!.closed_at).not.toBeNull();

    board = [...board, posting('a', 'SDE I - Backend')];
    await poll();
    expect(q<{ closed_at: string | null }>(`select closed_at from jobs where external_id = 'a'`)[0]!.closed_at).toBeNull();
  });

  it('an unchanged board writes nothing but the run log (keeps D1 row writes low)', async () => {
    await poll();
    const before = q<{ n: number }>('select total_changes() as n')[0]!.n;
    await poll();
    const after = q<{ n: number }>('select total_changes() as n')[0]!.n;
    expect(after - before).toBe(1); // the source_runs row
  });

  it('closes vanished postings on a board bigger than D1\'s 100-parameter limit', async () => {
    const big: CompanySource = { name: 'Big Co', ats: 'lever', slug: 'bigco' };
    const saved = board;
    board = Array.from({ length: 150 }, (_, i) => posting(`big${i}`, 'Backend Engineer'));
    await pollSource(db, big, profile, null);
    board = (board as Array<{ id: string }>).filter((p) => p.id !== 'big7');
    await pollSource(db, big, profile, null);
    const open = q<{ n: number }>(`select count(*) as n from jobs where company = 'Big Co' and closed_at is null`)[0]!.n;
    expect(open).toBe(149);
    expect(q<{ closed_at: string | null }>(`select closed_at from jobs where external_id = 'big7'`)[0]!.closed_at).not.toBeNull();
    board = saved;
  });

  it('a failing board is recorded and leaves existing jobs open', async () => {
    vi.stubGlobal('fetch', async () => new Response('gone', { status: 404 }));
    const r = await poll();
    expect(r.ok).toBe(false);
    expect(q<{ n: number }>(`select count(*) as n from jobs where closed_at is null`)[0]!.n).toBeGreaterThan(0);
    const runs = q<{ ok: number; error: string }>(`select ok, error from source_runs order by id desc limit 1`);
    expect(runs[0]).toMatchObject({ ok: 0, error: expect.stringContaining('404') });
  });
});

describe('dashboard API', () => {
  it('lists To apply jobs with apply links, hiding filtered ones', async () => {
    const res = await call('GET', '/api/jobs?status=to_apply');
    expect(res.status).toBe(200);
    const rows = (await res.json()) as Array<{ id: unknown; title: string; url: string; status: string }>;
    expect(rows.length).toBeGreaterThan(0);
    // The page matches rows by numeric id; a string id silently breaks expand/undo.
    expect(typeof rows[0]!.id).toBe('number');
    expect(rows.every((r) => r.status === 'to_apply' && r.url.startsWith('https://'))).toBe(true);
    expect(rows.map((r) => r.title)).not.toContain('Principal Engineer');
  });

  it('changes status and stamps applied_at', async () => {
    const id = await idOf('c');
    const res = await call('PATCH', `/api/jobs/${id}`, { status: 'applied' });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: 'applied', applied_at: expect.anything() });
    expect((await call('PATCH', `/api/jobs/${id}`, { status: 'nonsense' })).status).toBe(400);
  });

  it('remove hides the row, survives the next poll, and can be undone', async () => {
    const id = await idOf('e');
    expect((await call('DELETE', `/api/jobs/${id}`)).status).toBe(200);
    const listed = (await (await call('GET', '/api/jobs?status=to_apply,maybe')).json()) as Array<{ id: number }>;
    expect(listed.map((r) => r.id)).not.toContain(id);

    await poll({ ...profile, toApplyThreshold: 0 });
    expect(await statusOf('e')).toBe('removed');

    await call('PATCH', `/api/jobs/${id}`, { status: 'to_apply' });
    expect(await statusOf('e')).toBe('to_apply');
  });

  it('keeps closed postings visible once you have applied', async () => {
    const id = await idOf('c');
    exec(`update jobs set closed_at = ? where id = ?`, new Date().toISOString(), id);
    const applied = (await (await call('GET', '/api/jobs?status=applied')).json()) as Array<{ id: number }>;
    expect(applied.map((r) => r.id)).toContain(id);
  });

  it('serves description on demand and per-status counts', async () => {
    const detail = (await (await call('GET', `/api/jobs/${await idOf('a')}`)).json()) as { description: string };
    expect(detail.description).toContain('Node.js');
    const stats = (await (await call('GET', '/api/stats')).json()) as { counts: Record<string, number> };
    expect(stats.counts.to_apply).toBeGreaterThan(0);
  });
});
