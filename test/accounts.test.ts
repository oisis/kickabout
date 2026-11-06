import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { startServer } from '../server/server.ts';
import type { Provider } from '../server/accounts.ts';

const listen = async (s: Server) => { s.listen(0); await once(s, 'listening'); return `http://127.0.0.1:${(s.address() as AddressInfo).port}`; };

/** A browser that keeps cookies and does not follow redirects. */
function browser(base: string) {
  const jar = new Map<string, string>();
  return async (path: string, init: RequestInit = {}) => {
    const r = await fetch(path.startsWith('http') ? path : base + path, { ...init, redirect: 'manual', headers: { ...init.headers as object, cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') } });
    for (const c of r.headers.getSetCookie()) { const [kv] = c.split(';'); const [k, v] = kv.split('='); if (v) jar.set(k, v); else jar.delete(k); }
    return r;
  };
}

test('OAuth sign-in, linking a second provider, sessions and account deletion', async () => {
  // A fake provider: /authorize is never fetched (the test plays the browser), /token and /user answer.
  const fake = createServer((req, res) => {
    if (req.url === '/token') return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ access_token: 'tok' }));
    res.writeHead(404).end();
  });
  const fakeUrl = await listen(fake);
  const provider = (subject: string): Provider => ({
    authorize: `${fakeUrl}/authorize`, token: `${fakeUrl}/token`, api: fakeUrl, scope: 'x', clientId: 'id', clientSecret: 'secret',
    profile: async (token) => { assert.equal(token, 'tok'); return { subject, name: 'Ala Kowalska', email: 'ala@example.com', avatar: '' }; },
  });
  const http = startServer(0, { publicUrl: 'http://kickabout.test', providers: { google: provider('g-1'), github: provider('gh-1') } });
  await once(http, 'listening');
  const base = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
  const b = browser(base);

  assert.deepEqual((await (await b('/api/config')).json()).providers, ['google', 'github']);
  assert.equal((await b('/api/me')).status, 401);

  const signIn = async (p: string, link = false) => {
    const start = await b(`/api/auth/${p}${link ? '?link=1' : ''}`);
    assert.equal(start.status, 302);
    const to = new URL(start.headers.get('location')!);
    assert.equal(to.searchParams.get('redirect_uri'), `http://kickabout.test/api/auth/${p}/callback`);
    return b(`/api/auth/${p}/callback?code=abc&state=${to.searchParams.get('state')}`);
  };
  // A callback with a forged state is refused.
  await b('/api/auth/google');
  assert.match((await b('/api/auth/google/callback?code=abc&state=forged')).headers.get('location')!, /error=state/);

  assert.equal((await signIn('google')).headers.get('location'), '/account.html');
  let me = await (await b('/api/me')).json();
  assert.equal(me.name, 'Ala Kowalska');
  assert.deepEqual(me.identities.map((i: any) => i.provider), ['google']);

  assert.match((await signIn('github', true)).headers.get('location')!, /linked=github/);
  me = await (await b('/api/me')).json();
  assert.deepEqual(me.identities.map((i: any) => i.provider), ['google', 'github']);

  me = await (await b('/api/me', { method: 'PATCH', body: JSON.stringify({ name: 'Ala' }) })).json();
  assert.equal(me.name, 'Ala');
  assert.equal((await b('/api/me', { method: 'PATCH', body: JSON.stringify({ name: '' }) })).status, 400);
  assert.equal((await b('/api/me', { method: 'PATCH', headers: { origin: 'https://evil.example' }, body: '{"name":"x"}' })).status, 403);

  // Unlinking keeps at least one way to sign in.
  assert.equal((await b('/api/me/identities/google', { method: 'DELETE' })).status, 200);
  assert.equal((await b('/api/me/identities/github', { method: 'DELETE' })).status, 409);

  // Second device signs in with GitHub (same user), then the first device signs it out.
  const other = browser(base);
  const start = new URL((await other('/api/auth/github')).headers.get('location')!);
  await other(`/api/auth/github/callback?code=abc&state=${start.searchParams.get('state')}`);
  assert.equal((await (await other('/api/me')).json()).name, 'Ala');
  assert.equal((await (await b('/api/me')).json()).sessions.length, 2);
  await b('/api/logout-others', { method: 'POST' });
  assert.equal((await other('/api/me')).status, 401);

  assert.equal((await b('/api/me', { method: 'DELETE' })).status, 200);
  assert.equal((await b('/api/me')).status, 401);
  const again = await signIn('github'); // the identity was deleted with the account: a fresh one
  assert.equal(again.headers.get('location'), '/account.html');
  assert.equal((await (await b('/api/me')).json()).name, 'Ala Kowalska');

  for (const s of [http, fake]) { s.closeAllConnections(); s.close(); }
});

test('dev login only when enabled', async () => {
  const off = startServer(0), on = startServer(0, { devLogin: true });
  await Promise.all([once(off, 'listening'), once(on, 'listening')]);
  const url = (s: Server) => `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
  assert.equal((await fetch(`${url(off)}/api/auth/dev`, { method: 'POST', body: '{"name":"Ola"}' })).status, 401);
  const b = browser(url(on));
  assert.equal((await b('/api/auth/dev', { method: 'POST', body: '{"name":"Ola"}' })).status, 200);
  assert.equal((await (await b('/api/me')).json()).name, 'Ola');
  await b('/api/logout', { method: 'POST' });
  assert.equal((await b('/api/me')).status, 401);
  for (const s of [off, on]) { s.closeAllConnections(); s.close(); }
});
