import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { startServer } from '../server/server.ts';
import type { Provider } from '../server/accounts.ts';

const listen = async (s: Server) => { s.listen(0); await once(s, 'listening'); return `http://127.0.0.1:${(s.address() as AddressInfo).port}`; };

function browser(base: string) {
  const jar = new Map<string, string>();
  return async (path: string, init: RequestInit = {}) => {
    const r = await fetch(base + path, { ...init, redirect: 'manual', headers: { ...init.headers as object, cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') } });
    for (const c of r.headers.getSetCookie()) { const [kv] = c.split(';'); const [k, v] = kv.split('='); if (v) jar.set(k, v); else jar.delete(k); }
    return r;
  };
}

test('admin panel: only ADMIN_EMAILS, accounts and e-mails, add, ban, unban, delete; online count', async (t) => {
  const fake = createServer((_, res) => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ access_token: 'tok' })));
  const fakeUrl = await listen(fake);
  let who = { subject: 'admin', name: 'Admin', email: 'Boss@Example.com', avatar: '' }; // the next sign-in's profile
  const google: Provider = { authorize: `${fakeUrl}/a`, token: `${fakeUrl}/t`, api: fakeUrl, scope: 'x', clientId: 'id', clientSecret: 's', profile: async () => who };
  const github: Provider = { ...google };
  const http = startServer(0, { publicUrl: 'http://k.test', providers: { google, github }, admins: ['boss@example.com'] });
  await once(http, 'listening');
  t.after(() => { http.close(); fake.close(); });
  const base = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
  const signIn = async (b: ReturnType<typeof browser>, p = 'google') => {
    const to = new URL((await b(`/api/auth/${p}`)).headers.get('location')!);
    return (await b(`/api/auth/${p}/callback?code=c&state=${to.searchParams.get('state')}`)).headers.get('location');
  };
  const json = (body: unknown) => ({ method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });

  assert.deepEqual(await (await fetch(`${base}/api/online`)).json(), { online: 0, playing: 0, waiting: 0, watching: 0, matches: 0 });

  const boss = browser(base);
  await signIn(boss);
  assert.equal((await (await boss('/api/me')).json()).admin, true, 'e-mail match ignores case');

  who = { subject: 'u1', name: 'Ola', email: 'ola@example.com', avatar: '' };
  const ola = browser(base);
  await signIn(ola);
  assert.equal((await (await ola('/api/me')).json()).admin, false);
  assert.equal((await ola('/api/admin/users')).status, 403, 'players cannot open the panel');
  assert.equal((await fetch(`${base}/api/admin/users`)).status, 401);

  let users = await (await boss('/api/admin/users')).json();
  assert.deepEqual(users.map((u: any) => u.name), ['Ola', 'Admin']);
  assert.equal(users[0].identities[0].provider, 'google');
  assert.deepEqual((await (await boss('/api/admin/users?q=OLA@')).json()).map((u: any) => u.name), ['Ola']);
  assert.deepEqual((await (await boss('/api/admin/emails')).json()).map((e: any) => e.email), ['Boss@Example.com', 'ola@example.com']);

  // Adding: a new account by e-mail, taken over at the first sign-in with that address.
  assert.equal((await boss('/api/admin/users', json({ name: 'Jan', email: 'nope' }))).status, 400);
  assert.equal((await boss('/api/admin/users', json({ name: 'Ola 2', email: 'OLA@example.com' }))).status, 409);
  const jan = await (await boss('/api/admin/users', json({ name: 'Jan', email: 'jan@example.com' }))).json();
  assert.equal(jan.name, 'Jan');
  who = { subject: 'u2', name: 'Jan K.', email: 'jan@example.com', avatar: 'a.png' };
  const janB = browser(base);
  await signIn(janB, 'github');
  const janMe = await (await janB('/api/me')).json();
  assert.equal(janMe.id, jan.id, 'the invited account, not a new one');
  assert.equal(janMe.name, 'Jan');

  // Banning: signed out at once, sign-in refused, also with another provider under the same e-mail.
  assert.equal((await boss(`/api/admin/users/${(await (await boss('/api/me')).json()).id}/ban`, json({}))).status, 409, 'not yourself');
  const olaId = users[0].id;
  assert.equal((await boss(`/api/admin/users/${olaId}/ban`, json({ banned: true }))).status, 200);
  assert.equal((await ola('/api/me')).status, 401);
  who = { subject: 'u1', name: 'Ola', email: 'ola@example.com', avatar: '' };
  assert.match((await signIn(ola))!, /error=banned/);
  who = { subject: 'u1-gh', name: 'Ola', email: 'ola@example.com', avatar: '' };
  assert.match((await signIn(ola, 'github'))!, /error=banned/);
  assert.equal((await (await boss('/api/admin/stats')).json()).banned, 1);
  await boss(`/api/admin/users/${olaId}/ban`, json({ banned: false }));
  who = { subject: 'u1', name: 'Ola', email: 'ola@example.com', avatar: '' };
  assert.equal(await signIn(ola), 'http://k.test/account.html');
  assert.equal((await ola('/api/me')).status, 200);

  // Deleting.
  assert.equal((await boss(`/api/admin/users/${olaId}`, { method: 'DELETE' })).status, 200);
  assert.equal((await ola('/api/me')).status, 401);
  users = await (await boss('/api/admin/users')).json();
  assert.deepEqual(users.map((u: any) => u.name), ['Jan', 'Admin']);
  assert.equal((await (await boss('/api/admin/stats')).json()).users, 2);
});
