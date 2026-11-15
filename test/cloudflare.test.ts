/** The two Cloudflare-facing pieces that can't run against the real service in tests. */
import { describe, expect, it } from 'vitest';
import { resetAccessKeyCache, verifyAccessJwt } from '../src/access.js';
import { d1Http } from '../src/db/http.js';

describe('d1Http', () => {
  const cfg = { accountId: 'acc', databaseId: 'db1', apiToken: 'tok' };

  it('sends one query with bearer auth and returns its rows', async () => {
    let seen: { url: string; init: RequestInit } | undefined;
    const db = d1Http(cfg, async (url, init) => {
      seen = { url: String(url), init: init! };
      return Response.json({ success: true, result: [{ success: true, results: [{ key: 'a' }] }] });
    });
    expect(await db.all('select key from jobs where company = ?', ['X'])).toEqual([{ key: 'a' }]);
    expect(seen!.url).toBe('https://api.cloudflare.com/client/v4/accounts/acc/d1/database/db1/query');
    expect(new Headers(seen!.init.headers).get('authorization')).toBe('Bearer tok');
    expect(JSON.parse(String(seen!.init.body))).toEqual({ sql: 'select key from jobs where company = ?', params: ['X'] });
  });

  it('splits large batches into several requests', async () => {
    const bodies: Array<{ batch: unknown[] }> = [];
    const db = d1Http(cfg, async (_url, init) => {
      bodies.push(JSON.parse(String(init!.body)));
      return Response.json({ success: true, result: [] });
    });
    await db.batch(Array.from({ length: 95 }, () => ({ sql: 'select 1', params: [null, 1] })));
    expect(bodies.map((b) => b.batch.length)).toEqual([40, 40, 15]);
  });

  it('surfaces Cloudflare API errors', async () => {
    const db = d1Http(cfg, async () => Response.json({ success: false, errors: [{ code: 10000, message: 'Authentication error' }] }, { status: 403 }));
    await expect(db.all('select 1')).rejects.toThrow('D1 API: 10000: Authentication error');
  });
});

describe('verifyAccessJwt', () => {
  const teamDomain = 'radar.cloudflareaccess.com';
  const aud = 'aud-tag-123';
  const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');

  async function setup() {
    resetAccessKeyCache();
    const { privateKey, publicKey } = await crypto.subtle.generateKey(
      { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
      true, ['sign', 'verify'],
    );
    const jwk = { ...(await crypto.subtle.exportKey('jwk', publicKey)), kid: 'k1' };
    const fetchImpl = (async (url: string) => {
      expect(url).toBe(`https://${teamDomain}/cdn-cgi/access/certs`);
      return Response.json({ keys: [jwk] });
    }) as typeof fetch;
    const sign = async (claims: Record<string, unknown>, kid = 'k1') => {
      const data = `${enc({ alg: 'RS256', kid })}.${enc(claims)}`;
      const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', privateKey, new TextEncoder().encode(data));
      return `${data}.${Buffer.from(sig).toString('base64url')}`;
    };
    const good = { aud: [aud], iss: `https://${teamDomain}`, exp: Math.floor(Date.now() / 1000) + 600, email: 'me@example.com' };
    return { fetchImpl, sign, good };
  }

  it('accepts a valid token and returns the email', async () => {
    const { fetchImpl, sign, good } = await setup();
    await expect(verifyAccessJwt(await sign(good), { teamDomain, aud }, { fetchImpl })).resolves.toBe('me@example.com');
  });

  it.each([
    ['wrong audience', { aud: ['other'] }],
    ['wrong issuer', { iss: 'https://evil.cloudflareaccess.com' }],
    ['expired', { exp: Math.floor(Date.now() / 1000) - 3600 }],
  ])('rejects %s', async (reason, override) => {
    const { fetchImpl, sign, good } = await setup();
    await expect(verifyAccessJwt(await sign({ ...good, ...override }), { teamDomain, aud }, { fetchImpl })).rejects.toThrow(reason);
  });

  it('rejects a missing token, a tampered payload and an unknown key', async () => {
    const { fetchImpl, sign, good } = await setup();
    await expect(verifyAccessJwt(undefined, { teamDomain, aud }, { fetchImpl })).rejects.toThrow('missing');
    const [h, , s] = (await sign(good)).split('.');
    const tampered = `${h}.${enc({ ...good, email: 'attacker@example.com' })}.${s}`;
    await expect(verifyAccessJwt(tampered, { teamDomain, aud }, { fetchImpl })).rejects.toThrow('bad signature');
    await expect(verifyAccessJwt(await sign(good, 'k-unknown'), { teamDomain, aud }, { fetchImpl })).rejects.toThrow('unknown signing key');
  });
});
