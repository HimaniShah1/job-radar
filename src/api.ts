/**
 * Dashboard API. Pure Hono + the Db interface, so the same app runs in the Worker (D1 binding)
 * and in tests (node:sqlite). No Node APIs in here: this file is bundled into the Worker.
 */
import { Hono, type MiddlewareHandler } from 'hono';
import { iso, type Db } from './db/types.js';
import { STATUSES, type JobStatus } from './types.js';

/** Before you act on these, a vanished posting is noise. After you've applied, it's still your pipeline. */
const HIDE_CLOSED: JobStatus[] = ['to_apply', 'maybe'];
const isStatus = (s: unknown): s is JobStatus => typeof s === 'string' && (STATUSES as readonly string[]).includes(s);

type Env = { Variables: { db: Db } };

/** JSON columns -> arrays, 0/1 -> booleans, so the page gets the same shape as before. */
function decode<T extends Record<string, unknown>>(row: T) {
  const out: Record<string, unknown> = { ...row };
  for (const k of ['locations', 'cities', 'score_reasons']) if (typeof out[k] === 'string') out[k] = JSON.parse(out[k] as string);
  for (const k of ['remote', 'ok']) if (typeof out[k] === 'number') out[k] = out[k] === 1;
  return out;
}

export function createApp<E extends object>(opts: { db: (env: E) => Db; auth?: MiddlewareHandler }) {
  const app = new Hono<Env & { Bindings: E }>();
  if (opts.auth) app.use('*', opts.auth);
  app.use('/api/*', async (c, next) => {
    c.set('db', opts.db(c.env));
    await next();
  });

  app.get('/api/jobs', async (c) => {
    // ?status=oa,interviewing — one tab can cover several stages.
    const statuses = (c.req.query('status') ?? '').split(',').filter(Boolean);
    if (!statuses.every(isStatus)) return c.json({ error: 'bad status' }, 400);
    const includeClosed = c.req.query('includeClosed') === '1';
    const limit = Math.min(1000, Number(c.req.query('limit') ?? 500) || 500);

    const where = ['rejected_reason is null'];
    const params: (string | number)[] = [];
    if (statuses.length) {
      params.push(JSON.stringify(statuses));
      where.push(`status in (select value from json_each(?${params.length}))`);
      if (!includeClosed) {
        params.push(JSON.stringify(HIDE_CLOSED));
        where.push(`(closed_at is null or status not in (select value from json_each(?${params.length})))`);
      }
    } else {
      where.push(`status <> 'removed'`);
    }
    params.push(limit);

    const rows = await c.var.db.all(
      `select j.id, company, ats, title, department, locations, cities, remote, url, apply_url,
              score, score_reasons, status, posted_at, first_seen_at, closed_at, applied_at, notes, f.verdict
       from jobs j left join feedback f on f.job_id = j.id
       where ${where.join(' and ')}
       order by first_seen_at desc, score desc
       limit ?${params.length}`,
      params,
    );
    return c.json(rows.map(decode));
  });

  /** Full posting, fetched when you expand a row (descriptions are too big to send for every row). */
  app.get('/api/jobs/:id', async (c) => {
    const [row] = await c.var.db.all(`select id, description, rejected_reason from jobs where id = ?`, [Number(c.req.param('id'))]);
    return row ? c.json(row) : c.json({ error: 'not found' }, 404);
  });

  app.patch('/api/jobs/:id', async (c) => {
    const body = await c.req.json<{ status?: string; notes?: string }>();
    if (body.status !== undefined && !isStatus(body.status)) return c.json({ error: 'bad status' }, 400);
    const [row] = await c.var.db.all(
      `update jobs set
         status = coalesce(?2, status),
         notes = coalesce(?3, notes),
         applied_at = case when ?2 = 'applied' and applied_at is null then ?4 else applied_at end
       where id = ?1 returning id, status, notes, applied_at`,
      [Number(c.req.param('id')), body.status ?? null, body.notes ?? null, iso(new Date())],
    );
    return row ? c.json(row) : c.json({ error: 'not found' }, 404);
  });

  /**
   * "Remove" hides the row instead of deleting it: a deleted row would come straight back
   * as a new job on the next poll. Undo by setting a status again (Removed tab).
   */
  app.delete('/api/jobs/:id', async (c) => {
    const [row] = await c.var.db.all(`update jobs set status = 'removed' where id = ? returning id, status`, [Number(c.req.param('id'))]);
    return row ? c.json(row) : c.json({ error: 'not found' }, 404);
  });

  /** Thumbs up/down. This is what the title model learns from. */
  app.post('/api/jobs/:id/feedback', async (c) => {
    const { verdict } = await c.req.json<{ verdict: number }>();
    if (verdict !== 1 && verdict !== -1) return c.json({ error: 'verdict must be 1 or -1' }, 400);
    await c.var.db.batch([{
      sql: `insert into feedback (job_id, verdict) values (?1, ?2)
            on conflict (job_id) do update set verdict = excluded.verdict, created_at = ?3`,
      params: [Number(c.req.param('id')), verdict, iso(new Date())],
    }]);
    return c.json({ ok: true });
  });

  /** Tab counts, board health and a small funnel. */
  app.get('/api/stats', async (c) => {
    const weekAgo = iso(new Date(Date.now() - 7 * 86_400_000));
    const [sources, counts, week] = await Promise.all([
      c.var.db.all(`
        select s.company, s.ats, s.ok, s.job_count, s.error, s.ran_at
        from source_runs s join (select company, max(id) as id from source_runs group by company) m on m.id = s.id
        order by s.company`),
      c.var.db.all<{ status: string; n: number }>(`
        select status, count(*) as n from jobs
        where rejected_reason is null and (closed_at is null or status not in ('to_apply', 'maybe'))
        group by status`),
      c.var.db.all(
        `select (select count(*) from jobs where first_seen_at > ?1 and rejected_reason is null) as new_matches,
                (select count(*) from jobs where applied_at > ?1) as applied,
                (select max(ran_at) from source_runs) as last_poll`,
        [weekAgo],
      ),
    ]);
    return c.json({ sources: sources.map(decode), counts: Object.fromEntries(counts.map((r) => [r.status, r.n])), week: week[0] });
  });

  return app;
}
