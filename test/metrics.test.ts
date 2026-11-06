import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { WebSocket } from 'ws';
import { startServer } from '../server/server.ts';
import { SIM_VERSION } from '../src/sim.ts';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const value = (text: string, series: string) => Number(text.split('\n').find((l) => l.startsWith(series + ' '))?.split(' ')[1] ?? NaN);

test('Prometheus /metrics: accounts, online, matches; token; not under /api', async (t) => {
  const http = startServer(0, { devLogin: true, metricsToken: 'secret' });
  await once(http, 'listening');
  t.after(() => http.close());
  const base = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
  const scrape = async () => { const r = await fetch(`${base}/metrics`, { headers: { authorization: 'Bearer secret' } }); assert.equal(r.status, 200); return r.text(); };

  assert.equal((await fetch(`${base}/metrics`)).status, 401);
  assert.notEqual((await fetch(`${base}/api/metrics`)).status, 200, 'the website proxies /api/: metrics stay off it');

  await fetch(`${base}/api/auth/dev`, { method: 'POST', body: JSON.stringify({ name: 'Ala' }) });
  await fetch(`${base}/api/auth/dev`, { method: 'POST', body: JSON.stringify({ name: 'Ola' }) });

  // Two players: a quick match, then one leaves.
  const a = new WebSocket(`${base.replace('http', 'ws')}/ws`), b = new WebSocket(`${base.replace('http', 'ws')}/ws`);
  await Promise.all([once(a, 'open'), once(b, 'open')]);
  t.after(() => { a.terminate(); b.terminate(); });
  a.send(JSON.stringify({ t: 'join', sim: SIM_VERSION, config: {} })); await sleep(50);
  b.send(JSON.stringify({ t: 'join', sim: SIM_VERSION, config: {} })); await sleep(100);
  let m = await scrape();
  assert.match(m, /^# TYPE kickabout_users gauge$/m);
  assert.equal(value(m, 'kickabout_users'), 2);
  assert.equal(value(m, 'kickabout_users_registered{period="1d"}'), 2);
  assert.equal(value(m, 'kickabout_users_active{period="7d"}'), 2, 'sign-in counts as activity');
  assert.equal(value(m, 'kickabout_identities{provider="dev"}'), 2);
  assert.equal(value(m, 'kickabout_coins'), 6000);
  assert.equal(value(m, 'kickabout_online{activity="playing"}'), 2);
  assert.equal(value(m, 'kickabout_live_matches'), 1);
  assert.equal(value(m, 'kickabout_matches_started_total{kind="quick"}'), 1);
  assert.equal(value(m, 'kickabout_connections_total'), 2);
  assert.match(m, /^kickabout_info\{version="\d+\.\d+\.\d+"\} 1$/m);

  a.close(); await sleep(100);
  m = await scrape();
  assert.equal(value(m, 'kickabout_matches_finished_total{kind="quick",result="player-left"}'), 1, 'counted once for both players');
  assert.equal(value(m, 'kickabout_online{activity="playing"}'), 0);
  b.close();
  // Every sample line is "name{labels} number".
  for (const l of m.split('\n').filter((x) => x && !x.startsWith('#'))) assert.match(l, /^[a-z_]+(\{[^}]*\})? -?[\d.e+]+$/, l);
});
