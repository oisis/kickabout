// Player accounts: sign-in with Google or GitHub (OAuth 2.0 authorization code flow),
// cookie sessions and account management, stored in SQLite (node:sqlite, no extra deps).
// All routes live under /api; the website (web/) calls them from the same origin.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, createHash } from 'node:crypto';

export interface Provider {
  authorize: string; token: string;
  scope: string;
  clientId: string; clientSecret: string;
  /** Turns an access token into a stable identity. */
  profile(token: string, api: string): Promise<{ subject: string; name: string; email: string; avatar: string }>;
  api: string;
}

export interface AccountOptions {
  db?: string; // file path, ':memory:' in tests
  publicUrl?: string; // the website, e.g. https://www.example.pl (where sign-in returns to)
  /** The API's own address when it has a subdomain (https://api.example.pl); default: <publicUrl>/api behind the website. */
  apiUrl?: string;
  /** Cookie domain shared by the website and the API subdomain, e.g. example.pl. */
  cookieDomain?: string;
  providers?: Record<string, Provider>;
  devLogin?: boolean; // POST /auth/dev signs in by name: local testing only
}

export interface User { id: number; hash: string; via: 'cookie' | 'bearer' }
/** One API request, handed to route modules (see clubs.ts). */
export interface Ctx {
  req: IncomingMessage; res: ServerResponse; url: URL;
  method: string; path: string; // path without the optional /api prefix
  user: User | null;
  body(limit?: number): Promise<any>;
  send(status: number, body?: unknown, headers?: Record<string, string | string[]>): void;
}
export type Route = (c: Ctx) => Promise<boolean> | boolean;

const SESSION_DAYS = 30;
const json = async (r: Response) => { if (!r.ok) throw new Error(`${r.url} → ${r.status}`); return r.json() as Promise<any>; };

/** Google and GitHub, configured from the environment; a provider without credentials is hidden. */
export function envProviders(env = process.env): Record<string, Provider> {
  const all: Record<string, Provider> = {
    google: {
      authorize: 'https://accounts.google.com/o/oauth2/v2/auth', token: 'https://oauth2.googleapis.com/token', api: 'https://openidconnect.googleapis.com',
      scope: 'openid email profile', clientId: env.GOOGLE_CLIENT_ID ?? '', clientSecret: env.GOOGLE_CLIENT_SECRET ?? '',
      async profile(token, api) {
        const u = await json(await fetch(`${api}/v1/userinfo`, { headers: { authorization: `Bearer ${token}` } }));
        return { subject: String(u.sub), name: u.name ?? u.email ?? 'Player', email: u.email_verified === false ? '' : u.email ?? '', avatar: u.picture ?? '' };
      },
    },
    github: {
      authorize: 'https://github.com/login/oauth/authorize', token: 'https://github.com/login/oauth/access_token', api: 'https://api.github.com',
      scope: 'read:user user:email', clientId: env.GITHUB_CLIENT_ID ?? '', clientSecret: env.GITHUB_CLIENT_SECRET ?? '',
      async profile(token, api) {
        const headers = { authorization: `Bearer ${token}`, 'user-agent': 'kickabout', accept: 'application/vnd.github+json' };
        const u = await json(await fetch(`${api}/user`, { headers }));
        let email = u.email ?? '';
        if (!email) email = ((await json(await fetch(`${api}/user/emails`, { headers }))) as any[]).find((e) => e.primary && e.verified)?.email ?? '';
        return { subject: String(u.id), name: u.name || u.login, email, avatar: u.avatar_url ?? '' };
      },
    },
  };
  return Object.fromEntries(Object.entries(all).filter(([, p]) => p.clientId && p.clientSecret));
}

function openDb(path: string) {
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL DEFAULT '', avatar TEXT NOT NULL DEFAULT '', created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS identities (provider TEXT NOT NULL, subject TEXT NOT NULL, user_id INTEGER NOT NULL REFERENCES users ON DELETE CASCADE, email TEXT NOT NULL DEFAULT '', created INTEGER NOT NULL, PRIMARY KEY (provider, subject));
    CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users ON DELETE CASCADE, created INTEGER NOT NULL, expires INTEGER NOT NULL, agent TEXT NOT NULL DEFAULT '');
    CREATE TABLE IF NOT EXISTS app_codes (code TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users ON DELETE CASCADE, expires INTEGER NOT NULL);`);
  return db;
}

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const cookies = (req: IncomingMessage) => Object.fromEntries((req.headers.cookie ?? '').split(';').map((c) => c.trim().split('=')).filter((p) => p.length === 2).map(([k, v]) => [k, decodeURIComponent(v)]));
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/**
 * Accounts and the shared API plumbing. Routes answer under /api/... (website proxy)
 * and, for an API subdomain, without the prefix. `routes` are extra modules tried
 * before the sign-in check (they check ctx.user themselves).
 */
export function accounts(opts: AccountOptions = {}, routes: Route[] = []) {
  const db = openDb(opts.db ?? ':memory:');
  const providers = opts.providers ?? {};
  const site = (opts.publicUrl ?? '').replace(/\/$/, '');
  const siteOrigin = URL.parse(site)?.origin ?? '';
  const apiBase = (opts.apiUrl ?? (site ? `${site}/api` : '')).replace(/\/$/, '');
  const secure = (apiBase || site).startsWith('https:');
  const cookie = (name: string, value: string, maxAge: number) =>
    `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}${opts.cookieDomain ? `; Domain=${opts.cookieDomain}` : ''}`;

  const q = {
    user: db.prepare('SELECT id, name, email, avatar, created FROM users WHERE id = ?'),
    session: db.prepare('SELECT user_id FROM sessions WHERE hash = ? AND expires > ?'),
    addSession: db.prepare('INSERT INTO sessions (hash, user_id, created, expires, agent) VALUES (?, ?, ?, ?, ?)'),
    identity: db.prepare('SELECT user_id FROM identities WHERE provider = ? AND subject = ?'),
    addIdentity: db.prepare('INSERT INTO identities (provider, subject, user_id, email, created) VALUES (?, ?, ?, ?, ?)'),
    addUser: db.prepare('INSERT INTO users (name, email, avatar, created) VALUES (?, ?, ?, ?)'),
  };

  /** Returns the raw session token. */
  function newToken(userId: number, agent: string) {
    const token = randomBytes(32).toString('base64url'), now = Date.now();
    q.addSession.run(sha(token), userId, now, now + SESSION_DAYS * 864e5, agent.slice(0, 200));
    return token;
  }
  const newSession = (userId: number, agent: string) => cookie('sid', newToken(userId, agent), SESSION_DAYS * 86400);

  /** The signed-in user: a Bearer token (the app) or the session cookie (website, browser game). */
  function userOf(req: IncomingMessage, token?: string): User | null {
    const bearer = /^Bearer (\S+)$/.exec(req.headers.authorization ?? '')?.[1] ?? token;
    const raw = bearer ?? cookies(req).sid;
    if (!raw) return null;
    const row = q.session.get(sha(raw), Date.now()) as { user_id: number } | undefined;
    return row ? { id: row.user_id, hash: sha(raw), via: bearer ? 'bearer' : 'cookie' } : null;
  }
  /** Finds or creates the user behind an external identity; links it to `linkTo` when given. */
  function signIn(provider: string, p: { subject: string; name: string; email: string; avatar: string }, linkTo: number | null): number | 'taken' {
    const known = q.identity.get(provider, p.subject) as { user_id: number } | undefined;
    if (linkTo !== null) {
      if (known && known.user_id !== linkTo) return 'taken';
      if (!known) q.addIdentity.run(provider, p.subject, linkTo, p.email, Date.now());
      return linkTo;
    }
    if (known) return known.user_id;
    const id = Number(q.addUser.run(p.name.slice(0, 40) || 'Player', p.email, p.avatar, Date.now()).lastInsertRowid);
    q.addIdentity.run(provider, p.subject, id, p.email, Date.now());
    return id;
  }
  function me(userId: number, hash: string) {
    return {
      ...(q.user.get(userId) as object),
      identities: db.prepare('SELECT provider, email, created FROM identities WHERE user_id = ? ORDER BY created').all(userId),
      sessions: (db.prepare('SELECT hash, created, agent FROM sessions WHERE user_id = ? AND expires > ? ORDER BY created DESC').all(userId, Date.now()) as { hash: string; created: number; agent: string }[])
        .map((s) => ({ created: s.created, agent: s.agent, current: s.hash === hash })),
      providers: Object.keys(providers),
    };
  }

  const redirect = (res: ServerResponse, to: string, setCookie: string[] = []) => { res.writeHead(302, { location: to, 'set-cookie': setCookie, 'cache-control': 'no-store' }).end(); };
  const account = (query = '') => `${site}/account.html${query}`;

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const url = new URL(req.url ?? '/', 'http://x');
    const path = url.pathname.startsWith('/api/') ? url.pathname.slice(4) : url.pathname;
    if (path === '/') return false;
    const method = req.method ?? 'GET';
    const origin = req.headers.origin;
    const host = req.headers['x-forwarded-host'] ?? req.headers.host;
    // CORS: the website (when the API has its own subdomain) may send cookies; anyone may call with a Bearer token.
    const cors: Record<string, string> = origin && origin === siteOrigin
      ? { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true', vary: 'Origin' }
      : { 'access-control-allow-origin': '*' };
    const send = (status: number, body?: unknown, headers: Record<string, string | string[]> = {}) => {
      res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', ...cors, ...headers }).end(body === undefined ? '' : JSON.stringify(body));
    };
    if (method === 'OPTIONS') {
      res.writeHead(204, { ...cors, 'access-control-allow-methods': 'GET, POST, PATCH, DELETE', 'access-control-allow-headers': 'content-type, authorization', 'access-control-max-age': '600' }).end();
      return true;
    }
    const user = userOf(req);
    // Cookies are SameSite=Lax; also refuse changes from other sites that ride on the session cookie.
    // Requests without it (the app's code exchange, Bearer calls) carry nothing to forge.
    const cookieAuth = !!cookies(req).sid && user?.via !== 'bearer';
    if (method !== 'GET' && origin && cookieAuth && URL.parse(origin)?.host !== host && origin !== siteOrigin) { send(403, { error: 'origin' }); return true; }
    const body = async (limit = 4096) => {
      let s = '';
      for await (const c of req) { s += c; if (s.length > limit) throw new Error('too large'); }
      return s ? JSON.parse(s) : {};
    };
    const ctx: Ctx = { req, res, url, method, path, user, body, send };
    try {
      let m: RegExpMatchArray | null;
      if (path === '/config' && method === 'GET') send(200, { providers: Object.keys(providers), devLogin: !!opts.devLogin });

      else if ((m = path.match(/^\/auth\/(\w+)$/)) && method === 'GET' && providers[m[1]]) {
        const p = providers[m[1]], state = randomBytes(16).toString('base64url');
        const link = url.searchParams.get('link') === '1' && user ? '1' : '0';
        const to = new URL(p.authorize);
        for (const [k, v] of Object.entries({ client_id: p.clientId, redirect_uri: `${apiBase}/auth/${m[1]}/callback`, response_type: 'code', scope: p.scope, state })) to.searchParams.set(k, v);
        redirect(res, to.href, [cookie('oauth', `${m[1]}.${state}.${link}`, 600)]);
      }

      else if ((m = path.match(/^\/auth\/(\w+)\/callback$/)) && method === 'GET' && providers[m[1]]) {
        const p = providers[m[1]], [prov, state, link] = (cookies(req).oauth ?? '').split('.');
        const clear = cookie('oauth', '', 0);
        if (!state || prov !== m[1] || url.searchParams.get('state') !== state || !url.searchParams.get('code')) { redirect(res, account('?error=state'), [clear]); return true; }
        const tok = await json(await fetch(p.token, {
          method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ code: url.searchParams.get('code')!, client_id: p.clientId, client_secret: p.clientSecret, redirect_uri: `${apiBase}/auth/${m[1]}/callback`, grant_type: 'authorization_code' }),
        }));
        if (!tok.access_token) throw new Error('no access token');
        const id = signIn(m[1], await p.profile(tok.access_token, p.api), link === '1' && user ? user.id : null);
        if (id === 'taken') redirect(res, account('?error=taken'), [clear]);
        else if (link === '1' && user) redirect(res, account('?linked=' + m[1]), [clear]);
        else redirect(res, account(), [clear, newSession(id, String(req.headers['user-agent'] ?? ''))]);
      }

      else if (path === '/auth/dev' && method === 'POST' && opts.devLogin) {
        const name = String((await body()).name ?? '').trim().slice(0, 40);
        if (!name) { send(400, { error: 'name' }); return true; }
        const id = signIn('dev', { subject: name.toLowerCase(), name, email: '', avatar: '' }, null) as number;
        send(200, { ok: true }, { 'set-cookie': newSession(id, String(req.headers['user-agent'] ?? '')) });
      }

      // The app signs in with a one-time code shown on the website's account page.
      else if (path === '/app-token' && method === 'POST') {
        const code = String((await body()).code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
        const row = db.prepare('SELECT user_id FROM app_codes WHERE code = ? AND expires > ?').get(code, Date.now()) as { user_id: number } | undefined;
        if (!row) { send(404, { error: 'code' }); return true; }
        db.prepare('DELETE FROM app_codes WHERE code = ?').run(code);
        send(200, { token: newToken(row.user_id, 'Kickabout app') });
      }

      else {
        for (const r of routes) if (await r(ctx)) return true;
        if (!user) send(401, { error: 'signed-out' });

        else if (path === '/me' && method === 'GET') send(200, me(user.id, user.hash));
        else if (path === '/me' && method === 'PATCH') {
          const name = String((await body()).name ?? '').trim();
          if (!name || name.length > 40) { send(400, { error: 'name' }); return true; }
          db.prepare('UPDATE users SET name = ? WHERE id = ?').run(name, user.id);
          send(200, me(user.id, user.hash));
        }
        else if (path === '/me' && method === 'DELETE') {
          db.prepare('DELETE FROM users WHERE id = ?').run(user.id); // identities, sessions and the rest cascade
          send(200, { ok: true }, { 'set-cookie': cookie('sid', '', 0) });
        }
        else if ((m = path.match(/^\/me\/identities\/(\w+)$/)) && method === 'DELETE') {
          const count = (db.prepare('SELECT COUNT(*) AS n FROM identities WHERE user_id = ?').get(user.id) as { n: number }).n;
          if (count < 2) { send(409, { error: 'last-identity' }); return true; }
          db.prepare('DELETE FROM identities WHERE user_id = ? AND provider = ?').run(user.id, m[1]);
          send(200, me(user.id, user.hash));
        }
        else if (path === '/me/app-code' && method === 'POST') {
          db.prepare('DELETE FROM app_codes WHERE user_id = ? OR expires < ?').run(user.id, Date.now());
          let code = '';
          do code = Array.from({ length: 6 }, () => CODE_CHARS[randomBytes(1)[0] % CODE_CHARS.length]).join('');
          while (db.prepare('SELECT 1 FROM app_codes WHERE code = ?').get(code));
          db.prepare('INSERT INTO app_codes (code, user_id, expires) VALUES (?, ?, ?)').run(code, user.id, Date.now() + 10 * 60_000);
          send(200, { code, expires: Date.now() + 10 * 60_000 });
        }
        else if (path === '/logout' && method === 'POST') {
          db.prepare('DELETE FROM sessions WHERE hash = ?').run(user.hash);
          send(200, { ok: true }, { 'set-cookie': cookie('sid', '', 0) });
        }
        else if (path === '/logout-others' && method === 'POST') {
          db.prepare('DELETE FROM sessions WHERE user_id = ? AND hash != ?').run(user.id, user.hash);
          send(200, me(user.id, user.hash));
        }
        else send(404, { error: 'not-found' });
      }
    } catch (e) {
      console.error(new Date().toISOString(), 'api', path, (e as Error).message);
      if (path.includes('/callback')) redirect(res, account('?error=provider'), [cookie('oauth', '', 0)]);
      else if (!res.headersSent) send(400, { error: 'bad-request' });
    }
    return true;
  }

  return { db, handle, userOf };
}
