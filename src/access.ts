/**
 * Cloudflare Access check. Access signs every request it lets through with a JWT in the
 * Cf-Access-Jwt-Assertion header; we verify it ourselves too, so a route Access doesn't
 * cover (say, the workers.dev URL) can't reach your data.
 * Docs: https://developers.cloudflare.com/cloudflare-one/identity/authorization-cookie/validating-json/
 */
export interface AccessConfig {
  /** e.g. "himani.cloudflareaccess.com" */
  teamDomain: string;
  /** The Access application's "Application Audience (AUD) Tag". */
  aud: string;
}

interface Jwk extends JsonWebKey {
  kid: string;
}

const b64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const decodePart = <T>(s: string): T => JSON.parse(new TextDecoder().decode(b64url(s))) as T;

// Access rotates keys every ~6 weeks and serves old + new; refetch hourly or on an unknown kid.
let keyCache: { domain: string; at: number; keys: Map<string, CryptoKey> } | null = null;

async function keys(teamDomain: string, fetchImpl: typeof fetch, forceRefresh: boolean): Promise<Map<string, CryptoKey>> {
  if (keyCache && keyCache.domain === teamDomain && !forceRefresh && Date.now() - keyCache.at < 3_600_000) return keyCache.keys;
  const res = await fetchImpl(`https://${teamDomain}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error(`Access certs: HTTP ${res.status}`);
  const { keys: jwks } = (await res.json()) as { keys: Jwk[] };
  const map = new Map<string, CryptoKey>();
  for (const k of jwks) {
    map.set(k.kid, await crypto.subtle.importKey('jwk', k, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']));
  }
  keyCache = { domain: teamDomain, at: Date.now(), keys: map };
  return map;
}

/** Returns the signed-in email, or throws with the reason the token was refused. */
export async function verifyAccessJwt(
  token: string | undefined | null,
  cfg: AccessConfig,
  { fetchImpl = fetch, now = Date.now() }: { fetchImpl?: typeof fetch; now?: number } = {},
): Promise<string> {
  if (!token) throw new Error('missing Cf-Access-Jwt-Assertion');
  const [h, p, sig] = token.split('.');
  if (!h || !p || !sig) throw new Error('malformed token');
  const header = decodePart<{ alg: string; kid: string }>(h);
  if (header.alg !== 'RS256') throw new Error(`unexpected alg ${header.alg}`);

  let key = (await keys(cfg.teamDomain, fetchImpl, false)).get(header.kid);
  if (!key) key = (await keys(cfg.teamDomain, fetchImpl, true)).get(header.kid);
  if (!key) throw new Error('unknown signing key');
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64url(sig), new TextEncoder().encode(`${h}.${p}`));
  if (!ok) throw new Error('bad signature');

  const claims = decodePart<{ aud: string | string[]; iss: string; exp: number; nbf?: number; email?: string }>(p);
  const auds = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!auds.includes(cfg.aud)) throw new Error('wrong audience');
  if (claims.iss !== `https://${cfg.teamDomain}`) throw new Error('wrong issuer');
  const sec = now / 1000;
  if (claims.exp < sec - 30 || (claims.nbf && claims.nbf > sec + 30)) throw new Error('expired');
  return claims.email ?? '';
}

export function resetAccessKeyCache() {
  keyCache = null;
}
