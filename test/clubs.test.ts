import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { startServer } from '../server/server.ts';
import { accounts } from '../server/accounts.ts';
import { clubs } from '../server/clubs.ts';
import { newMatch, step, type MatchSetup } from '../src/sim.ts';
import { teamSetup, onlineMatch } from '../src/data.ts';
import { cpuInput } from '../src/ai.ts';
import { START_COINS, playerPrice, BUY_MARKUP, SELL_RATE, SPONSOR_MIN, KIT_PRICE } from '../src/economy.ts';

/** A signed-in player (dev login) talking JSON to the API with a cookie. */
async function player(base: string, name: string) {
  const r = await fetch(`${base}/api/auth/dev`, { method: 'POST', body: JSON.stringify({ name }) });
  const cookie = r.headers.getSetCookie()[0].split(';')[0];
  const call = async (path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST') => {
    const res = await fetch(`${base}/api${path}`, { method, headers: { cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, data: await res.json().catch(() => ({})) as any };
  };
  return { call, cookie, me: async () => (await call('/me/club')).data };
}

test('clubs: create, buy and sell, swap, offers that need consent, sponsors, buying a club', async (t) => {
  const http = startServer(0, { devLogin: true });
  t.after(() => { http.closeAllConnections(); http.close(); });
  await once(http, 'listening');
  const base = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
  const ala = await player(base, 'Ala'), bob = await player(base, 'Bob');

  assert.equal((await ala.me()).coins, START_COINS);
  assert.equal((await ala.call('/me/club', { name: 'Orły Kickabout', short: 'O1' })).data.error, 'short');
  const created = await ala.call('/me/club', { name: 'Orły Kickabout', short: 'ork', shirt: '#ff6600', lang: 'pl' });
  assert.equal(created.status, 200, JSON.stringify(created.data));
  assert.equal((await ala.call('/me/club', { name: 'Second Club', short: 'SEC' })).data.error, 'has-club');
  let a = await ala.me();
  assert.equal(a.club.team.players.length, 16);
  assert.ok(a.club.rating <= 3.5);

  // Buy from a computer club: pay the markup, the player moves, the computer club stays at 16.
  const target = (await ala.call('/clubs?group=pl:4')).data.at(-1);
  const tc = (await ala.call(`/clubs/${target.id}`)).data;
  const cheapest = [...tc.players].sort((x: any, y: any) => x.price - y.price)[0];
  const buy = await ala.call(`/clubs/${target.id}/buy-player`, { player: cheapest.name });
  assert.equal(buy.status, 200, JSON.stringify(buy.data));
  assert.equal(buy.data.coins, START_COINS - Math.round(cheapest.price * BUY_MARKUP));
  assert.equal((await ala.call(`/clubs/${target.id}`)).data.players.length, 16);
  a = await ala.me();
  assert.ok(a.club.team.players.some((p: any) => p.name === cheapest.name));

  // New kits cost KIT_PRICE per changed set; nothing changed is refused.
  const kitsBefore = (await ala.me()).coins;
  const k = await ala.call('/me/club/kits', { home: { shirt: '#123456', shorts: '#FFFFFF' }, keeper: '#00ff00' });
  assert.equal(k.status, 200, JSON.stringify(k.data));
  assert.equal(k.data.coins, kitsBefore - 2 * KIT_PRICE);
  assert.deepEqual(k.data.club.team.kits[0], { shirt: '#123456', shorts: '#ffffff' });
  assert.equal((await ala.call('/me/club/kits', { home: { shirt: '#123456', shorts: '#ffffff' } })).data.error, 'unchanged');

  // Sell to the market at 60%.
  const sold = a.club.players.find((p: any) => p.pos === 3);
  const sale = await ala.call('/me/club/sell', { player: sold.name });
  assert.equal(sale.data.paid, Math.round(playerPrice(sold) * SELL_RATE));

  // Swap with a computer club: settled at once, both squads keep their size.
  a = await ala.me();
  const give = a.club.players.find((p: any) => p.pos === 2), takeP = tc.players.find((p: any) => p.pos === 2 && p.name !== cheapest.name);
  const before = a.coins, swap = await ala.call(`/clubs/${target.id}/swap`, { give: give.name, take: takeP.name });
  assert.equal(swap.status, 200, JSON.stringify(swap.data));
  assert.notEqual(swap.data.coins, before);
  assert.ok((await ala.me()).club.team.players.some((p: any) => p.name === takeP.name));

  // Bob's club: buying from a player needs the owner's consent.
  await bob.call('/me/club', { name: 'Harbour Lions', short: 'HLI' });
  const b = await bob.me();
  const wanted = b.club.players.find((p: any) => p.pos === 1);
  const off = await ala.call(`/clubs/${b.club.id}/buy-player`, { player: wanted.name, price: 300 });
  assert.ok(off.data.offer, JSON.stringify(off.data));
  assert.ok(!(await ala.me()).club.team.players.some((p: any) => p.name === wanted.name), 'nothing moves before consent');
  const incoming = (await bob.me()).offers.find((o: any) => o.incoming);
  assert.equal(incoming.kind, 'player');
  const coinsA = (await ala.me()).coins;
  assert.equal((await bob.call(`/offers/${incoming.id}/accept`, {})).status, 200);
  assert.equal((await ala.me()).coins, coinsA - 300);
  assert.equal((await bob.me()).coins, START_COINS + 300);
  assert.ok((await ala.me()).club.team.players.some((p: any) => p.name === wanted.name));
  // A swap offer that Bob turns down changes nothing.
  const swapOffer = await ala.call(`/clubs/${b.club.id}/swap`, { give: cheapest.name, take: b.club.players[0].name });
  assert.ok(swapOffer.data.offer);
  await bob.call(`/offers/${swapOffer.data.offer}/reject`, {});
  assert.equal((await bob.me()).offers.length, 0);

  // Sponsors: coins go to the club owner and the name shows up with the club.
  assert.equal((await bob.call(`/clubs/${(await ala.me()).club.id}/sponsor`, { amount: SPONSOR_MIN - 1 })).status, 409);
  const coinsBefore = (await ala.me()).coins;
  assert.equal((await bob.call(`/clubs/${(await ala.me()).club.id}/sponsor`, { amount: 200 })).status, 200);
  a = await ala.me();
  assert.equal(a.coins, coinsBefore + 200);
  assert.deepEqual(a.club.sponsors.map((s: any) => s.name), ['Bob']);

  // Buying a whole club: only without a club of your own, and another player's club needs consent.
  assert.equal((await bob.call(`/clubs/${a.club.id}/buy`, { price: 500 })).data.error, 'has-club');
  await bob.call('/me/club/leave', {});
  const bid = await bob.call(`/clubs/${a.club.id}/buy`, { price: 500 });
  assert.ok(bid.data.offer, JSON.stringify(bid.data));
  await ala.call(`/offers/${bid.data.offer}/accept`, {});
  assert.equal((await bob.me()).club.id, a.club.id);
  assert.equal((await ala.me()).club, null);
  // A computer club is bought outright for its price; Ala cannot afford a top club.
  const top = (await ala.call('/clubs?group=pl:1')).data[0];
  assert.equal((await ala.call(`/clubs/${top.id}/buy`, {})).data.error, 'coins');

});

/** Run-length encoded input words, as the game sends them. */
function rle(words: number[]) {
  const out: [number, number][] = [];
  for (const w of words) { const last = out.at(-1); if (last && last[0] === w) last[1]++; else out.push([w, 1]); }
  return out;
}

test('a match against the computer pays only after the server replays it', async (t) => {
  const http = startServer(0, { devLogin: true });
  t.after(() => { http.closeAllConnections(); http.close(); });
  await once(http, 'listening');
  const base = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
  const ala = await player(base, 'Ala');
  assert.equal((await ala.call('/me/matches', {})).data.error, 'no-club');
  await ala.call('/me/club', { name: 'Orły Kickabout', short: 'ORK' });
  const m = (await ala.call('/me/matches', { minutes: 5 })).data;
  assert.ok(m.id && m.seed && m.home.name === 'Orły Kickabout', JSON.stringify(m).slice(0, 200));

  // The "player" is the computer AI on our side; record its input words like the game does.
  const setup: MatchSetup = { teams: [teamSetup(m.home), teamSetup(m.away)], minutes: m.minutes, extraTime: false, penalties: false, pitch: m.pitch };
  const s = newMatch(m.seed, setup), words: number[] = [];
  while (s.phase !== 'end') { const w = cpuInput(s, 0); words.push(w); step(s, [w, s.paused ? 0 : cpuInput(s, 1)]); }

  // Cutting the match short is refused, and a match id is good for one attempt only.
  const cheat = await ala.call(`/me/matches/${m.id}`, { inputs: rle(words.slice(0, 1000)) });
  assert.equal(cheat.data.error, 'incomplete');
  assert.equal((await ala.call(`/me/matches/${m.id}`, { inputs: rle(words) })).status, 404);

  const m2 = (await ala.call('/me/matches', { minutes: 5 })).data;
  const s2 = newMatch(m2.seed, { ...setup, teams: [teamSetup(m2.home), teamSetup(m2.away)], pitch: m2.pitch }), w2: number[] = [];
  while (s2.phase !== 'end') { const w = cpuInput(s2, 0); w2.push(w); step(s2, [w, s2.paused ? 0 : cpuInput(s2, 1)]); }
  const done = await ala.call(`/me/matches/${m2.id}`, { inputs: rle(w2) });
  assert.equal(done.status, 200, JSON.stringify(done.data));
  assert.deepEqual(done.data.score, s2.score, 'the server got the same result');
  assert.ok(done.data.reward >= 10);
  assert.equal(done.data.coins, START_COINS + done.data.reward);
});

test('an online match between two clubs pays both owners (app token and browser cookie)', async (t) => {
  const { Net } = await import('../src/net.ts');
  const http = startServer(0, { devLogin: true });
  t.after(() => { http.closeAllConnections(); http.close(); });
  await once(http, 'listening');
  const port = (http.address() as AddressInfo).port, base = `http://127.0.0.1:${port}`;
  const ala = await player(base, 'Ala'), bob = await player(base, 'Bob');
  await ala.call('/me/club', { name: 'Orły Kickabout', short: 'ORK' });
  await bob.call('/me/club', { name: 'Harbour Lions', short: 'HLI' });
  // Ala links "the app" with a one-time code; Bob plays in the browser with his cookie.
  const code = (await ala.call('/me/app-code', {})).data.code;
  // The app's WebView sends Origin: http://localhost and has no cookie.
  const token = (await (await fetch(`${base}/api/app-token`, { method: 'POST', headers: { origin: 'http://localhost' }, body: JSON.stringify({ code: code.toLowerCase() }) })).json()).token;
  assert.ok(token);
  assert.equal((await fetch(`${base}/api/app-token`, { method: 'POST', body: JSON.stringify({ code }) })).status, 404, 'codes work once');
  assert.equal((await (await fetch(`${base}/api/me/club`, { headers: { authorization: `Bearer ${token}` } })).json()).club.team.short, 'ORK');

  const { WebSocket: WS } = await import('ws');
  const browserWs = class extends WS { constructor(url: string) { super(url, { headers: { cookie: bob.cookie } }); } };
  const url = `ws://127.0.0.1:${port}`;
  const config = { club: true, team: { id: 'fake', name: 'Cheaters', players: [] }, minutes: 5 };
  const a = new Net(url, { config, token });
  await new Promise((r) => setTimeout(r, 100));
  const g = globalThis as any, native = g.WebSocket;
  g.WebSocket = browserWs; const b = new Net(url, { config }); g.WebSocket = native;
  const peers = [a, b].map((net) => ({ net, s: null as any }));
  for (const p of peers) p.net.onStart = () => { p.s = newMatch(p.net.seed, onlineMatch(p.net.config).setup); };
  while (peers.some((p) => !p.s)) await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(peers.map((p) => p.s && onlineMatch(p.net.config).home.short), ['ORK', 'ORK'], 'the server used the real clubs');

  while (peers.some((p) => p.s.phase !== 'end' || p.net.reward === null)) {
    for (const { net, s } of peers) {
      while (net.frames.has(s.frame) && s.phase !== 'end') {
        const k = s.frame;
        step(s, net.frames.get(k)!);
        net.frames.delete(k);
        net.input(k + net.delay, cpuInput(s, net.side));
      }
    }
    await new Promise((r) => setImmediate(r));
  }
  assert.ok(a.reward! > 0 && b.reward! > 0, `rewards ${a.reward}, ${b.reward}`);
  assert.equal((await ala.me()).coins, START_COINS + a.reward!);
  assert.equal((await bob.me()).coins, START_COINS + b.reward!);
  a.close(); b.close();
});

test('an owner idle for a month loses the club to the computer', () => {
  const { db } = accounts();
  let now = Date.UTC(2026, 0, 1);
  const c = clubs(db, () => now);
  db.prepare("INSERT INTO users (id, name, created) VALUES (1, 'Ala', 0)").run();
  db.prepare("INSERT INTO clubs (id, owner_id, team, custom, created, active) VALUES ('pl-x', 1, '{}', 1, ?, ?)").run(now, now);
  now += 29 * 864e5;
  assert.equal(c.sweep(), 0);
  now += 2 * 864e5;
  assert.equal(c.sweep(), 1);
  assert.equal((db.prepare("SELECT owner_id FROM clubs WHERE id = 'pl-x'").get() as any).owner_id, null);
});
