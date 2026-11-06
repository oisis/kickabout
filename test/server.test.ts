import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { startServer } from '../server/server.ts';

function client(url: string, join: object = {}) {
  const ws = new WebSocket(url);
  ws.onopen = () => ws.send(JSON.stringify({ t: 'join', ...join }));
  const inbox: any[] = [];
  const waiters: ((m: any) => void)[] = [];
  ws.onmessage = (e) => { const m = JSON.parse(String(e.data)); const w = waiters.shift(); if (w) w(m); else inbox.push(m); };
  const next = () => new Promise<any>((r) => { const m = inbox.shift(); if (m) r(m); else waiters.push(r); });
  return { ws, next, send: (m: object) => ws.send(JSON.stringify(m)) };
}

test('pairs two players and relays a frame once both inputs arrive', async () => {
  const http = startServer(0);
  await once(http, 'listening');
  const url = `ws://127.0.0.1:${(http.address() as AddressInfo).port}`;
  const a = client(url, { config: { team: { id: 'A' }, minutes: 5 } });
  assert.equal((await a.next()).t, 'wait');
  const b = client(url, { config: { team: { id: 'B' }, minutes: 10 } });
  const [sa, sb] = [await a.next(), await b.next()];
  assert.equal(sa.t, 'start');
  assert.equal(sa.seed, sb.seed);
  assert.deepEqual([sa.side, sb.side], [0, 1]);
  assert.deepEqual(sa.config, sb.config);
  assert.deepEqual([sa.config.home.id, sa.config.away.id, sa.config.minutes], ['A', 'B', 5]); // host settings, each brings its team

  a.send({ t: 'in', k: 0, b: 5 });
  b.send({ t: 'in', k: 0, b: 2 ** 25 + 3 }); // masked to the 24-bit input word
  assert.deepEqual(await a.next(), { t: 'f', k: 0, b: [5, 3] });
  assert.deepEqual(await b.next(), { t: 'f', k: 0, b: [5, 3] });

  a.ws.close();
  assert.deepEqual(await b.next(), { t: 'bye', why: 'opponent-left' });
  http.closeAllConnections();
  http.close();
});

test('two lockstep clients play the same match through the server', async () => {
  const { Net } = await import('../src/net.ts');
  const { newMatch, step } = await import('../src/sim.ts');
  const { TEAMS, teamSetup } = await import('../src/data.ts');
  const setup = { teams: [teamSetup(TEAMS[0]), teamSetup(TEAMS[1])], minutes: 3, extraTime: false, penalties: false, pitch: 4 };
  const { cpuInput } = await import('../src/ai.ts');
  const http = startServer(0);
  await once(http, 'listening');
  const url = `ws://127.0.0.1:${(http.address() as AddressInfo).port}`;
  const peers = [new Net(url), new Net(url)].map((net) => ({ net, s: newMatch(1, setup) }));
  for (const p of peers) p.net.onStart = () => { p.s = newMatch(p.net.seed, setup); };

  const TICKS = 1200;
  while (peers.some((p) => p.s.frame < TICKS)) {
    for (const { net, s } of peers) {
      while (net.status === 'playing' && net.frames.has(s.frame) && s.frame < TICKS) {
        const k = s.frame;
        step(s, net.frames.get(k)!);
        net.frames.delete(k);
        net.input(k + net.delay, cpuInput(s, net.side)); // each side's own AI stands in for its human
        if (k % 120 === 0) net.check(k, s);
      }
    }
    assert.ok(peers.every((p) => p.net.status !== 'closed'), peers.map((p) => p.net.message).join(' '));
    await new Promise((r) => setTimeout(r, 1));
  }
  assert.deepEqual(peers[0].s, peers[1].s);
  assert.equal(peers[0].s.frame, TICKS);
  peers.forEach((p) => p.net.close());
  http.closeAllConnections();
  http.close();
});

test('private room: host gets a code, a friend joins with it, wrong codes are refused', async () => {
  const http = startServer(0);
  await once(http, 'listening');
  const url = `ws://127.0.0.1:${(http.address() as AddressInfo).port}`;
  const host = client(url, { room: 'new', config: { team: { id: 'H' } } });
  const { t, code } = await host.next();
  assert.equal(t, 'room');
  assert.match(code, /^[A-Z]{4}$/);
  const stranger = client(url, { room: 'ZZZZ', config: {} });
  assert.equal((await stranger.next()).t, 'bye');
  const quick = client(url, { config: {} }); // quick match must not land in the private room
  assert.equal((await quick.next()).t, 'wait');
  const friend = client(url, { room: code.toLowerCase(), config: { team: { id: 'F' } } });
  const [h, f] = [await host.next(), await friend.next()];
  assert.equal(h.t, 'start');
  assert.deepEqual([h.side, f.side, f.config.home.id, f.config.away.id], [0, 1, 'H', 'F']);
  for (const c of [host, stranger, quick, friend]) c.ws.close();
  http.closeAllConnections();
  http.close();
});

test('answers health checks and keeps static files to the website', async () => {
  const http = startServer(0);
  await once(http, 'listening');
  const base = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
  assert.equal(await (await fetch(`${base}/healthz`)).text(), 'ok');
  assert.equal((await fetch(`${base}/index.html`)).status, 404);
  http.closeAllConnections();
  http.close();
});
