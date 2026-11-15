/**
 * Cloudflare Worker: dashboard page (static assets in public/) + API, backed by D1.
 * Every request, the page included, goes through the Access check first (run_worker_first).
 */
import type { MiddlewareHandler } from 'hono';
import { verifyAccessJwt } from './access.js';
import { createApp } from './api.js';
import { fromD1, type D1Binding } from './db/d1.js';

export interface WorkerEnv {
  DB: D1Binding;
  ASSETS: { fetch(req: Request): Promise<Response> };
  /** e.g. "himani.cloudflareaccess.com" */
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  /** Local `wrangler dev` only (set in .dev.vars). Never set this on the deployed Worker. */
  DEV_NO_AUTH?: string;
}

const access: MiddlewareHandler<{ Bindings: WorkerEnv }> = async (c, next) => {
  const { ACCESS_TEAM_DOMAIN: teamDomain, ACCESS_AUD: aud, DEV_NO_AUTH } = c.env;
  const host = new URL(c.req.url).hostname;
  if (DEV_NO_AUTH === '1' && (host === 'localhost' || host === '127.0.0.1')) return next();
  // Fail closed: no Access config means nobody gets in, not everybody.
  if (!teamDomain || !aud) return c.text('Cloudflare Access is not configured for this Worker (ACCESS_TEAM_DOMAIN, ACCESS_AUD).', 503);
  try {
    await verifyAccessJwt(c.req.header('cf-access-jwt-assertion'), { teamDomain, aud });
  } catch (e) {
    return c.text(`Forbidden: ${e instanceof Error ? e.message : 'invalid Access token'}`, 403);
  }
  return next();
};

const app = createApp<WorkerEnv>({ db: (env) => fromD1(env.DB), auth: access as MiddlewareHandler });
app.all('*', (c) => c.env.ASSETS.fetch(c.req.raw));

export default app;
