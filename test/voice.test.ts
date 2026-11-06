import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createHmac } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { startServer } from '../server/server.ts';
import { SIM_VERSION } from '../src/sim.ts';
import { iceServers } from '../server/voice.ts';

function client(url: string, join: object) {
  const ws = new WebSocket(url);
  ws.onopen = () => ws.send(JSON.stringify({ t: 'join', sim: SIM_VERSION, ...join }));
  const inbox: any[] = [], waiters: ((m: any) => void)[] = [];
  ws.onmessage = (e) => { const m = JSON.parse(String(e.data)); const w = waiters.shift(); if (w) w(m); else inbox.push(m); };
  const next = (ms = 1000) => new Promise<any>((r) => { const m = inbox.shift(); if (m) return r(m); const t = setTimeout(() => r(null), ms); waiters.push((x) => { clearTimeout(t); r(x); }); });
  return { ws, next, send: (m: object) => ws.send(JSON.stringify(m)) };
}

test('voice: only in a private room where both players switched it on; signalling is relayed', async (t) => {
  const http = startServer(0, { voice: { stun: ['stun:stun.example:3478'], turn: ['turn:turn.example:3478'], turnSecret: 's3cret' } });
  t.after(() => { http.closeAllConnections(); http.close(); });
  await once(http, 'listening');
  const url = `ws://127.0.0.1:${(http.address() as AddressInfo).port}`;
  const room = async (va: boolean, vb: boolean) => {
    const host = client(url, { room: 'new', config: { voice: va } });
    const code = (await host.next()).code;
    const guest = client(url, { room: code, config: { voice: vb } });
    return { host, guest, sa: await host.next(), sb: await guest.next() };
  };

  const both = await room(true, true);
  assert.equal(both.sa.voice.initiator, true);
  assert.equal(both.sb.voice.initiator, false);
  assert.deepEqual(both.sa.voice.iceServers.map((s: any) => s.urls[0]), ['stun:stun.example:3478', 'turn:turn.example:3478']);
  both.host.send({ t: 'rtc', d: { sdp: { type: 'offer', sdp: 'v=0' } } });
  assert.deepEqual(await both.guest.next(), { t: 'rtc', d: { sdp: { type: 'offer', sdp: 'v=0' } } });
  both.guest.send({ t: 'rtc', d: { candidate: { candidate: 'x' } } });
  assert.deepEqual(await both.host.next(), { t: 'rtc', d: { candidate: { candidate: 'x' } } });

  const one = await room(true, false);
  assert.equal(one.sa.voice, null);
  one.host.send({ t: 'rtc', d: { sdp: 'x' } });
  assert.equal(await one.guest.next(300), null, 'nothing relayed without consent');

  const quick = [client(url, { config: { voice: true } }), client(url, { config: { voice: true } })];
  assert.equal((await quick[0].next()).t, 'wait');
  assert.equal((await quick[0].next()).voice, null, 'no voice with random opponents');
  for (const c of [both.host, both.guest, one.host, one.guest, ...quick]) c.ws.close();
});

test('TURN credentials expire and are signed with the shared secret (coturn use-auth-secret)', () => {
  const now = Date.UTC(2026, 10, 6, 12);
  const [, turn] = iceServers({ stun: ['stun:a'], turn: ['turn:b'], turnSecret: 'k', ttl: 600 }, now);
  assert.equal(turn.username, `${now / 1000 + 600}:kickabout`);
  assert.equal(turn.credential, createHmac('sha1', 'k').update(turn.username!).digest('base64'));
  assert.equal(iceServers({ stun: ['stun:a'], turn: ['turn:b'] }).length, 1, 'no TURN without a secret');
});
