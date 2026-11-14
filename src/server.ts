import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { basicAuth } from 'hono/basic-auth';
import { db } from './db.js';

const STATUSES = ['new', 'shortlisted', 'applied', 'recruiter_call', 'oa', 'interviewing', 'offer', 'rejected', 'ghosted', 'skipped'];
const page = readFileSync(fileURLToPath(new URL('../public/index.html', import.meta.url)), 'utf8');

export const app = new Hono();

// The dashboard holds your pipeline and notes. Never expose it without a password.
const user = process.env.DASHBOARD_USER;
const pass = process.env.DASHBOARD_PASSWORD;
if (user && pass) app.use('*', basicAuth({ username: user, password: pass }));
else console.warn('DASHBOARD_USER/DASHBOARD_PASSWORD not set: only bind to localhost.');

app.get('/', (c) => c.html(page));

app.get('/api/jobs', async (c) => {
  const status = c.req.query('status');
  const minScore = Number(c.req.query('minScore') ?? 0);
  const includeRejected = c.req.query('includeRejected') === '1';
  const includeClosed = c.req.query('includeClosed') === '1';
  const limit = Math.min(500, Number(c.req.query('limit') ?? 200));

  const where = ['score >= $1'];
  const params: unknown[] = [minScore];
  if (status) {
    params.push(status);
    where.push(`status = $${params.length}`);
  }
  if (!includeRejected) where.push('rejected_reason is null');
  if (!includeClosed) where.push('closed_at is null');
  params.push(limit);

  const r = await db().query(
    `select j.id, company, title, cities, url, apply_url, score, score_reasons, rejected_reason, status,
            posted_at, first_seen_at, closed_at, applied_at, notes, f.verdict
     from jobs j left join feedback f on f.job_id = j.id
     where ${where.join(' and ')}
     order by first_seen_at desc, score desc
     limit $${params.length}`,
    params,
  );
  return c.json(r.rows);
});

app.patch('/api/jobs/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const body = await c.req.json<{ status?: string; notes?: string }>();
  if (body.status && !STATUSES.includes(body.status)) return c.json({ error: 'bad status' }, 400);
  const r = await db().query(
    `update jobs set
       status = coalesce($2, status),
       notes = coalesce($3, notes),
       applied_at = case when $2 = 'applied' and applied_at is null then now() else applied_at end
     where id = $1 returning id, status, applied_at`,
    [id, body.status ?? null, body.notes ?? null],
  );
  return r.rowCount ? c.json(r.rows[0]) : c.json({ error: 'not found' }, 404);
});

/** Thumbs up/down. This is what the title model learns from. */
app.post('/api/jobs/:id/feedback', async (c) => {
  const id = Number(c.req.param('id'));
  const { verdict } = await c.req.json<{ verdict: number }>();
  if (verdict !== 1 && verdict !== -1) return c.json({ error: 'verdict must be 1 or -1' }, 400);
  await db().query(
    `insert into feedback (job_id, verdict) values ($1, $2)
     on conflict (job_id) do update set verdict = excluded.verdict, created_at = now()`,
    [id, verdict],
  );
  return c.json({ ok: true });
});

/** Board health plus a funnel: the numbers that tell you if the tool is working. */
app.get('/api/stats', async (c) => {
  const [sources, funnel, week] = await Promise.all([
    db().query(`
      select distinct on (company) company, ats, ok, job_count, error, ran_at
      from source_runs order by company, ran_at desc`),
    db().query(`select status, count(*)::int as n from jobs where rejected_reason is null group by status`),
    db().query(`
      select count(*) filter (where first_seen_at > now() - interval '7 days' and rejected_reason is null)::int as new_matches,
             count(*) filter (where applied_at > now() - interval '7 days')::int as applied,
             percentile_cont(0.5) within group (order by extract(epoch from applied_at - first_seen_at) / 60)
               filter (where applied_at > now() - interval '30 days') as median_minutes_to_apply
      from jobs`),
  ]);
  return c.json({ sources: sources.rows, funnel: funnel.rows, week: week.rows[0] });
});

const port = Number(process.env.PORT ?? 3000);
const hostname = process.env.HOST ?? '127.0.0.1';
serve({ fetch: app.fetch, port, hostname });
console.log(`Dashboard on http://${hostname}:${port}`);
