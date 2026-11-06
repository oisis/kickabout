import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { startServer } from '../server/server.ts';
import { Net } from '../src/net.ts';
import { newMatch, step, type State } from '../src/sim.ts';
import { onlineMatch, TEAMS } from '../src/data.ts';
import { cpuInput } from '../src/ai.ts';

/** Two lockstep players driven by the AI, as in server.test.ts. */
function players(url: string, config: Record<string, unknown>[]) {
  const peers = config.map((c, i) => ({ net: new Net(url, { config: { team: TEAMS[i * 7], minutes: 5, ...c } }), s: null as State | null }));
  for (const p of peers) p.net.onStart = () => { p.s = newMatch(p.net.seed, onlineMatch(p.net.config).setup); };
  const pump = () => {
    for (const { net, s } of peers) {
      while (s && net.frames.has(s.frame) && s.phase !== 'end') {
        const k = s.frame; step(s, net.frames.get(k)!); net.frames.delete(k); net.input(k + net.delay, cpuInput(s, net.side));
      }
    }
  };
  return { peers, pump };
}

/** A spectator: receives the state and batches of frames, simulates like the players. */
function spectator(url: string, id: string) {
  const ws = new WebSocket(url), frames = new Map<number, number[]>();
  const fan = { s: null as State | null, msgs: [] as any[], ws };
  ws.onopen = () => ws.send(JSON.stringify({ t: 'watch', id }));
  ws.onmessage = (e) => {
    const m = JSON.parse(String(e.data)); fan.msgs.push(m);
    if (m.t === 'watch') fan.s = m.state;
    if (m.t === 'w') for (let i = 0; i < m.b.length / 2; i++) frames.set(m.k + i, [m.b[2 * i], m.b[2 * i + 1]]);
    while (fan.s && frames.has(fan.s.frame) && fan.s.phase !== 'end') { const k = fan.s.frame; step(fan.s, frames.get(k)!); frames.delete(k); }
  };
  return fan;
}
const until = async (cond: () => boolean, tick: () => void, ms = 20000) => { const end = Date.now() + ms; while (!cond() && Date.now() < end) { tick(); await new Promise((r) => setImmediate(r)); } assert.ok(cond(), 'timed out'); };

test('fan zone: a spectator who joins mid-match sees exactly what the players see', async (t) => {
  const http = startServer(0);
  t.after(() => { http.closeAllConnections(); http.close(); });
  await once(http, 'listening');
  const port = (http.address() as AddressInfo).port, url = `ws://127.0.0.1:${port}`;
  const live = async () => (await fetch(`http://127.0.0.1:${port}/api/live`)).json() as Promise<any[]>;
  const { peers, pump } = players(url, [{}, {}]);
  await until(() => peers.every((p) => p.s && p.s.frame > 1500), pump); // ~25 s of play
  const [entry] = await live();
  assert.equal(entry.kind, 'quick');
  assert.equal(entry.home.name, TEAMS[0].name);
  assert.ok(entry.minute >= 1, `minute ${entry.minute}`);

  const fan = spectator(url, entry.id);
  await until(() => !!fan.s, pump);
  assert.ok(fan.s!.frame > 1500, 'starts from the current state, not from kick-off');
  await until(() => fan.s!.frame >= 2400 && peers.every((p) => p.s!.frame >= 2400), pump);
  assert.equal((await live())[0].spectators, 1);
  await until(() => peers.every((p) => p.s!.phase === 'end') && fan.s!.phase === 'end', pump, 60000);
  assert.deepEqual(fan.s, peers[0].s, 'identical final state');
  assert.deepEqual(peers[0].s, peers[1].s);
  for (const p of peers) p.net.close();
  await until(() => fan.msgs.some((m) => m.t === 'bye'), () => {});
  assert.equal(fan.msgs.at(-1).why, 'end');
  assert.deepEqual(await live(), [], 'gone from the list');
});

test('fan zone: hidden matches and private rooms without permission are not listed; unknown ids are refused', async (t) => {
  const http = startServer(0);
  t.after(() => { http.closeAllConnections(); http.close(); });
  await once(http, 'listening');
  const port = (http.address() as AddressInfo).port, url = `ws://127.0.0.1:${port}`;
  const live = async () => (await fetch(`http://127.0.0.1:${port}/api/live`)).json() as Promise<any[]>;
  const hidden = players(url, [{}, { hidden: true }]);
  await until(() => hidden.peers.every((p) => p.s), hidden.pump);
  assert.deepEqual(await live(), [], 'a player opted out');

  const host = new Net(url, { room: 'new', config: { team: TEAMS[0], minutes: 5 } });
  await until(() => !!host.room, () => {});
  const guest = new Net(url, { room: host.room, config: { team: TEAMS[1], minutes: 5 } });
  await until(() => host.status === 'playing' && guest.status === 'playing', () => {});
  assert.deepEqual(await live(), [], 'a private room without the host\'s permission');

  const host2 = new Net(url, { room: 'new', config: { team: TEAMS[2], minutes: 5, spectate: true } });
  await until(() => !!host2.room, () => {});
  const guest2 = new Net(url, { room: host2.room, config: { team: TEAMS[3], minutes: 5 } });
  await until(() => host2.status === 'playing', () => {});
  const list = await live();
  assert.deepEqual(list.map((m) => m.kind), ['room']);

  const fan = spectator(url, 'nope');
  await until(() => fan.msgs.length > 0, () => {});
  assert.deepEqual(fan.msgs[0], { t: 'bye', why: 'no-match' });
  for (const n of [...hidden.peers.map((p) => p.net), host, guest, host2, guest2]) n.close();
});
