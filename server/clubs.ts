// Online clubs: ownership, coins, transfers, swaps, offers between players, sponsors and
// prize money. The server is the only place where balances and squads change; prices and
// rewards come from src/economy.ts. Clubs nobody touched live only in src/data.ts; a row in
// `clubs` is written the first time one is bought, traded with or created.
//
// Matches against the computer are verified: the server hands out the seed and both squads,
// the game sends back the player's input words, and the server replays the whole match with
// the computer's AI to get the score it pays for.
import type { DatabaseSync } from 'node:sqlite';
import { randomBytes, randomInt } from 'node:crypto';
import { TEAMS, type TeamDef, type PlayerDef, teamSetup, makePlayers } from '../src/data.ts';
import { newMatch, step, type MatchSetup } from '../src/sim.ts';
import { cpuInput } from '../src/ai.ts';
import { matchMinutes } from '../src/store.ts';
import * as E from '../src/economy.ts';
import type { Ctx } from './accounts.ts';

/** A rule the request broke; answered as 409 { error: code }. */
class Fail extends Error { code: string; constructor(code: string) { super(code); this.code = code; } }
const fail = (code: string): never => { throw new Fail(code); };

const PRESETS = new Map(TEAMS.filter((t) => !t.national).map((t) => [t.id, t]));
const COLOR = /^#[0-9a-f]{6}$/i;
const DAY = 864e5;
const startOfDay = () => Math.floor(Date.now() / DAY) * DAY; // UTC
type Row = { id: string; owner_id: number | null; team: string; custom: number; active: number };
type Club = { id: string; team: TeamDef; owner: number | null; custom: boolean };
type Offer = { id: number; from_id: number; to_id: number; club_id: string; kind: 'player' | 'swap' | 'club'; give: string; take: string; price: number; status: string; created: number };

export function clubs(db: DatabaseSync, now = () => Date.now()) {
  try { db.exec(`ALTER TABLE users ADD COLUMN coins INTEGER NOT NULL DEFAULT ${E.START_COINS}`); } catch { /* already there */ }
  db.exec(`
    CREATE TABLE IF NOT EXISTS clubs (id TEXT PRIMARY KEY, owner_id INTEGER UNIQUE REFERENCES users ON DELETE SET NULL, team TEXT NOT NULL, custom INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL, active INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS ledger (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users ON DELETE CASCADE, amount INTEGER NOT NULL, balance INTEGER NOT NULL, kind TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', created INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS ledger_user ON ledger (user_id, created);
    CREATE TABLE IF NOT EXISTS offers (id INTEGER PRIMARY KEY, from_id INTEGER NOT NULL REFERENCES users ON DELETE CASCADE, to_id INTEGER NOT NULL REFERENCES users ON DELETE CASCADE, club_id TEXT NOT NULL, kind TEXT NOT NULL, give TEXT NOT NULL DEFAULT '', take TEXT NOT NULL DEFAULT '', price INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'open', created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS sponsors (id INTEGER PRIMARY KEY, club_id TEXT NOT NULL, user_id INTEGER NOT NULL REFERENCES users ON DELETE CASCADE, amount INTEGER NOT NULL, created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS cpu_matches (id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users ON DELETE CASCADE, seed INTEGER NOT NULL, setup TEXT NOT NULL, own REAL NOT NULL, opp REAL NOT NULL, created INTEGER NOT NULL, done INTEGER NOT NULL DEFAULT 0);`);

  function tx<T>(fn: () => T): T {
    db.exec('BEGIN IMMEDIATE');
    try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
  }

  // --- clubs and coins ---
  const row = (id: string) => db.prepare('SELECT id, owner_id, team, custom, active FROM clubs WHERE id = ?').get(id) as Row | undefined;
  const fromRow = (r: Row): Club => ({ id: r.id, team: JSON.parse(r.team), owner: r.owner_id, custom: !!r.custom });
  function club(id: string): Club | null {
    const r = row(id);
    if (r) return fromRow(r);
    const p = PRESETS.get(id);
    return p ? { id, team: structuredClone(p), owner: null, custom: false } : null;
  }
  const mine = (user: number) => { const r = db.prepare('SELECT id, owner_id, team, custom, active FROM clubs WHERE owner_id = ?').get(user) as Row | undefined; return r ? fromRow(r) : null; };
  function save(c: Club) {
    db.prepare(`INSERT INTO clubs (id, owner_id, team, custom, created, active) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (id) DO UPDATE SET owner_id = excluded.owner_id, team = excluded.team`).run(c.id, c.owner, JSON.stringify(c.team), c.custom ? 1 : 0, now(), now());
  }
  const touch = (user: number) => db.prepare('UPDATE clubs SET active = ? WHERE owner_id = ?').run(now(), user);
  const coins = (user: number) => (db.prepare('SELECT coins FROM users WHERE id = ?').get(user) as { coins: number } | undefined)?.coins ?? 0;
  const userName = (id: number | null) => (id === null ? null : (db.prepare('SELECT name FROM users WHERE id = ?').get(id) as { name: string } | undefined)?.name ?? null);
  /** Moves coins in or out of a wallet (never below zero) and writes the ledger. */
  function pay(user: number, amount: number, kind: string, note = '') {
    const balance = coins(user) + amount;
    if (balance < 0) fail('coins');
    db.prepare('UPDATE users SET coins = ? WHERE id = ?').run(balance, user);
    db.prepare('INSERT INTO ledger (user_id, amount, balance, kind, note, created) VALUES (?, ?, ?, ?, ?, ?)').run(user, amount, balance, kind, note.slice(0, 80), now());
  }

  function sponsors(id: string) {
    return db.prepare(`SELECT u.name AS name, SUM(s.amount) AS amount FROM sponsors s JOIN users u ON u.id = s.user_id
      WHERE s.club_id = ? GROUP BY s.user_id ORDER BY amount DESC LIMIT 3`).all(id) as { name: string; amount: number }[];
  }
  /** The team as matches use it: with its top sponsors for the pre-match screen and the boards. */
  const matchTeam = (c: Club): TeamDef & { sponsors: string[] } => ({ ...c.team, sponsors: sponsors(c.id).map((s) => s.name) });
  const summary = (c: Club) => ({ id: c.id, name: c.team.name, short: c.team.short, country: c.team.country, division: c.team.division, rating: E.teamRating(c.team), price: E.clubPrice(c.team), owner: userName(c.owner), custom: c.custom });
  function detail(c: Club, viewer: number | null) {
    return {
      ...summary(c), ownerId: c.owner, mine: viewer !== null && c.owner === viewer,
      team: c.team, players: c.team.players.map((p) => ({ ...p, price: E.playerPrice(p) })), sponsors: sponsors(c.id),
      buyPrice: c.owner === null ? E.clubPrice(c.team) : null,
    };
  }

  // --- squads ---
  const find = (t: TeamDef, name: unknown) => { const i = t.players.findIndex((p) => p.name === name); return i < 0 ? fail('player') : i; };
  const keepers = (t: TeamDef) => t.players.filter((p) => p.pos === 0).length;
  function take(t: TeamDef, i: number, minSquad: number): PlayerDef {
    if (t.players.length - 1 < minSquad) fail('squad-small');
    if (t.players[i].pos === 0 && keepers(t) < 2) fail('last-keeper');
    return t.players.splice(i, 1)[0];
  }
  function put(t: TeamDef, p: PlayerDef) {
    if (t.players.length >= E.SQUAD_MAX) fail('squad-full');
    let name = p.name;
    for (let n = 2; t.players.some((q) => q.name === name); n++) name = `${p.name.slice(0, 16)} ${n}`;
    t.players.push({ ...p, name });
  }
  /** Computer clubs keep sixteen players: a youngster comes up for each one sold. */
  function refill(c: Club, pos: number) {
    if (c.owner !== null || c.team.players.length >= 16) return;
    const youth = makePlayers(`${c.id}-${now()}-${c.team.players.length}`, Math.max(1, c.team.level - 1), 'en').find((p) => p.pos === pos)!;
    put(c.team, { ...youth, age: 18 });
  }
  /** A swap must leave both squads with a keeper. */
  function swapPlayers(a: TeamDef, ai: number, b: TeamDef, bi: number) {
    const pa = a.players[ai], pb = b.players[bi];
    a.players.splice(ai, 1); b.players.splice(bi, 1);
    put(a, pb); put(b, pa);
    if (!keepers(a) || !keepers(b)) fail('last-keeper');
  }

  // --- offers between players ---
  function offer(from: number, to: number, clubId: string, kind: Offer['kind'], give: string, takeName: string, price: number) {
    if (!Number.isInteger(price) || Math.abs(price) > 10_000_000 || (kind !== 'swap' && price < 0)) fail('price');
    if (price > 0 && coins(from) < price) fail('coins');
    const id = Number(db.prepare('INSERT INTO offers (from_id, to_id, club_id, kind, give, take, price, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(from, to, clubId, kind, give, takeName, price, now()).lastInsertRowid);
    return { offer: id };
  }
  /** The seller agreed: check everything again (squads and wallets may have changed) and execute. */
  function accept(o: Offer) {
    const target = club(o.club_id);
    if (!target || target.owner !== o.to_id) fail('changed');
    if (o.kind === 'club') {
      if (mine(o.from_id)) fail('has-club');
      pay(o.from_id, -o.price, 'club-buy', target!.team.name);
      pay(o.to_id, o.price, 'club-sell', target!.team.name);
      target!.owner = o.from_id; save(target!);
      db.prepare("UPDATE clubs SET active = ? WHERE id = ?").run(now(), target!.id);
      db.prepare("UPDATE offers SET status = 'cancelled' WHERE status = 'open' AND club_id = ? AND id != ?").run(target!.id, o.id);
    } else {
      const buyer = mine(o.from_id) ?? fail('no-club');
      const ti = find(target!.team, o.take);
      const settle = () => {
        if (o.price > 0) { pay(o.from_id, -o.price, `${o.kind}-buy`, o.take); pay(o.to_id, o.price, `${o.kind}-sell`, o.take); }
        if (o.price < 0) { pay(o.to_id, o.price, `${o.kind}-buy`, o.give); pay(o.from_id, -o.price, `${o.kind}-sell`, o.give); }
      };
      if (o.kind === 'player') put(buyer.team, take(target!.team, ti, E.SQUAD_MIN));
      else swapPlayers(buyer.team, find(buyer.team, o.give), target!.team, ti);
      settle();
      save(buyer); save(target!);
    }
    db.prepare("UPDATE offers SET status = 'accepted' WHERE id = ?").run(o.id);
    touch(o.from_id); touch(o.to_id);
  }
  function offersOf(user: number) {
    const list = db.prepare("SELECT * FROM offers WHERE (from_id = ? OR to_id = ?) AND status = 'open' ORDER BY created DESC").all(user, user) as Offer[];
    return list.map((o) => ({ ...o, incoming: o.to_id === user, from: userName(o.from_id), to: userName(o.to_id), club: club(o.club_id)?.team.name ?? o.club_id }));
  }

  // --- rewards ---
  const rewardsToday = (user: number, kind: 'cpu' | 'online') =>
    (db.prepare('SELECT COUNT(*) AS n FROM ledger WHERE user_id = ? AND kind = ? AND created >= ?').get(user, `reward-${kind}`, startOfDay()) as { n: number }).n;
  /** Pays prize money for a finished match, within the daily limit. Returns the amount paid. */
  function reward(user: number, kind: 'cpu' | 'online', own: number, opp: number, goalsFor: number, goalsAgainst: number, note: string) {
    if (rewardsToday(user, kind) >= E.DAILY_REWARDS[kind]) return 0;
    const amount = E.matchReward(own, opp, goalsFor, goalsAgainst, kind === 'online');
    tx(() => { pay(user, amount, `reward-${kind}`, note); touch(user); });
    return amount;
  }

  /** Same setup the game builds for a verified match (see clubScreens.ts). */
  const cpuSetup = (s: { home: TeamDef; away: TeamDef; minutes: number; pitch: number }): MatchSetup =>
    ({ teams: [teamSetup(s.home), teamSetup(s.away)], minutes: s.minutes, extraTime: false, penalties: false, pitch: s.pitch });

  /** Owners idle for INACTIVE_DAYS lose their club to the computer. */
  function sweep() {
    const idle = db.prepare('SELECT id, owner_id FROM clubs WHERE owner_id IS NOT NULL AND active < ?').all(now() - E.INACTIVE_DAYS * DAY) as { id: string; owner_id: number }[];
    for (const c of idle) {
      db.prepare('UPDATE clubs SET owner_id = NULL WHERE id = ?').run(c.id);
      db.prepare("UPDATE offers SET status = 'cancelled' WHERE status = 'open' AND (club_id = ? OR from_id = ? OR to_id = ?)").run(c.id, c.owner_id, c.owner_id);
    }
    return idle.length;
  }

  // --- routes ---
  async function route(c: Ctx): Promise<boolean> {
    const { method, path, user, send } = c;
    let m: RegExpMatchArray | null;
    const need = () => user?.id ?? fail('signed-out');
    try {
      if (path === '/economy' && method === 'GET') {
        send(200, { startCoins: E.START_COINS, kitPrice: E.KIT_PRICE, buyMarkup: E.BUY_MARKUP, sellRate: E.SELL_RATE, swapPay: E.SWAP_PAY, swapGet: E.SWAP_GET, sponsorMin: E.SPONSOR_MIN, daily: E.DAILY_REWARDS, inactiveDays: E.INACTIVE_DAYS, squad: [E.SQUAD_MIN, E.SQUAD_MAX] });
      } else if (path === '/clubs' && method === 'GET') {
        // ?group=<country>:<division> (computer and bought clubs of a league), players (clubs players created) or owned.
        const g = c.url.searchParams.get('group') ?? 'owned';
        const stored = new Map((db.prepare('SELECT id, owner_id, team, custom, active FROM clubs').all() as Row[]).map((r) => [r.id, fromRow(r)]));
        let list: Club[];
        if (g === 'players') list = [...stored.values()].filter((x) => x.custom);
        else if (g === 'owned') list = [...stored.values()].filter((x) => x.owner !== null);
        else {
          const [country, div] = g.split(':');
          list = [...PRESETS.values()].filter((t) => t.country === country && t.division === Number(div)).map((t) => stored.get(t.id) ?? club(t.id)!);
        }
        send(200, list.map(summary).sort((a, b) => b.rating - a.rating));
      } else if ((m = path.match(/^\/clubs\/([\w-]+)$/)) && method === 'GET') {
        const x = club(m[1]);
        if (x) send(200, detail(x, user?.id ?? null)); else send(404, { error: 'club' });
      } else if (path === '/me/club' && method === 'GET') {
        const u = need(), x = mine(u);
        send(200, {
          coins: coins(u), club: x ? detail(x, u) : null, offers: offersOf(u),
          ledger: db.prepare('SELECT amount, balance, kind, note, created FROM ledger WHERE user_id = ? ORDER BY id DESC LIMIT 30').all(u),
          rewardsLeft: { cpu: Math.max(0, E.DAILY_REWARDS.cpu - rewardsToday(u, 'cpu')), online: Math.max(0, E.DAILY_REWARDS.online - rewardsToday(u, 'online')) },
        });
      } else if (path === '/me/club' && method === 'POST') {
        const u = need(), b = await c.body();
        const name = String(b.name ?? '').trim(), short = String(b.short ?? '').trim().toUpperCase();
        if (name.length < 3 || name.length > 24) fail('name');
        if (!/^[A-Z]{3}$/.test(short)) fail('short');
        const shirt = COLOR.test(b.shirt) ? b.shirt : '#dc2626', shorts = COLOR.test(b.shorts) ? b.shorts : '#f8fafc';
        const lang = /^[a-z]{2}$/.test(b.lang) ? b.lang : 'en';
        const id = `u${randomBytes(5).toString('hex')}`;
        tx(() => {
          if (mine(u)) fail('has-club');
          save({ id, owner: u, custom: true, team: { id, name, short, national: false, country: 'xx', division: 0, level: E.NEW_CLUB_LEVEL, kits: [{ shirt, shorts }, { shirt: shorts, shorts: shirt }], keeper: '#22c55e', formation: 0, players: E.newSquad(id, lang) } });
        });
        send(200, detail(club(id)!, u));
      } else if (path === '/me/club/kits' && method === 'POST') {
        // New kits: home and away (shirt + shorts) and the goalkeeper's shirt, KIT_PRICE for each one changed.
        const u = need(), b = await c.body();
        const color = (v: unknown, old: string) => (typeof v === 'string' && COLOR.test(v) ? v.toLowerCase() : old.toLowerCase());
        const cost = tx(() => {
          const x = mine(u) ?? fail('no-club'), t = x.team;
          const kits = [b.home, b.away].map((k, i) => ({ shirt: color(k?.shirt, t.kits[i].shirt), shorts: color(k?.shorts, t.kits[i].shorts) })) as TeamDef['kits'];
          const keeper = color(b.keeper, t.keeper);
          const changed = kits.filter((k, i) => k.shirt !== t.kits[i].shirt.toLowerCase() || k.shorts !== t.kits[i].shorts.toLowerCase()).length + (keeper !== t.keeper.toLowerCase() ? 1 : 0);
          if (!changed) fail('unchanged');
          pay(u, -changed * E.KIT_PRICE, 'kits', t.name);
          t.kits = kits; t.keeper = keeper; save(x); touch(u);
          return changed * E.KIT_PRICE;
        });
        send(200, { cost, coins: coins(u), club: detail(mine(u)!, u) });
      } else if (path === '/me/club/leave' && method === 'POST') {
        const u = need();
        tx(() => {
          const x = mine(u) ?? fail('no-club');
          x.owner = null; save(x);
          db.prepare("UPDATE offers SET status = 'cancelled' WHERE status = 'open' AND (club_id = ? OR from_id = ? OR to_id = ?)").run(x.id, u, u);
        });
        send(200, { ok: true });
      } else if (path === '/me/club/sell' && method === 'POST') {
        const u = need(), b = await c.body();
        const paid = tx(() => {
          const x = mine(u) ?? fail('no-club');
          const p = take(x.team, find(x.team, b.player), E.SQUAD_MIN), amount = Math.round(E.playerPrice(p) * E.SELL_RATE);
          save(x); pay(u, amount, 'player-sell', p.name); touch(u);
          return amount;
        });
        send(200, { paid, coins: coins(u) });
      } else if ((m = path.match(/^\/clubs\/([\w-]+)\/(buy-player|swap|buy|sponsor)$/)) && method === 'POST') {
        const u = need(), b = await c.body(), action = m[2];
        const result = tx(() => {
          const target = club(m![1]) ?? fail('club');
          const own = mine(u);
          if (target.owner === u) fail('own-club');
          const price = b.price === undefined ? undefined : Number(b.price);
          if (action === 'sponsor') {
            const amount = Number(b.amount);
            if (target.owner === null) fail('not-owned');
            if (!Number.isInteger(amount) || amount < E.SPONSOR_MIN) fail('amount');
            pay(u, -amount, 'sponsor', target.team.name);
            pay(target.owner!, amount, 'sponsored', userName(u) ?? '');
            db.prepare('INSERT INTO sponsors (club_id, user_id, amount, created) VALUES (?, ?, ?, ?)').run(target.id, u, amount, now());
            return { ok: true };
          }
          if (action === 'buy') {
            if (own) fail('has-club');
            if (target.owner !== null) return offer(u, target.owner, target.id, 'club', '', '', price ?? E.clubPrice(target.team));
            pay(u, -E.clubPrice(target.team), 'club-buy', target.team.name);
            target.owner = u; save(target); touch(u);
            return { ok: true };
          }
          if (!own) fail('no-club');
          const ti = find(target.team, action === 'swap' ? b.take : b.player);
          if (action === 'buy-player') {
            if (target.owner !== null) return offer(u, target.owner, target.id, 'player', '', target.team.players[ti].name, price ?? E.playerPrice(target.team.players[ti]));
            const p = target.team.players[ti], cost = Math.round(E.playerPrice(p) * E.BUY_MARKUP);
            target.team.players.splice(ti, 1);
            put(own!.team, p); refill(target, p.pos);
            pay(u, -cost, 'player-buy', p.name);
          } else {
            const gi = find(own!.team, b.give), settle = E.swapPrice(own!.team.players[gi], target.team.players[ti]);
            if (target.owner !== null) return offer(u, target.owner, target.id, 'swap', own!.team.players[gi].name, target.team.players[ti].name, price ?? settle);
            const note = `${own!.team.players[gi].name} ⇄ ${target.team.players[ti].name}`;
            swapPlayers(own!.team, gi, target.team, ti);
            pay(u, -settle, 'swap', note);
          }
          save(own!); save(target); touch(u);
          return { ok: true };
        });
        send(200, { ...result, coins: coins(u) });
      } else if ((m = path.match(/^\/offers\/(\d+)\/(accept|reject|cancel)$/)) && method === 'POST') {
        const u = need();
        tx(() => {
          const o = db.prepare("SELECT * FROM offers WHERE id = ? AND status = 'open'").get(Number(m![1])) as Offer | undefined ?? fail('offer');
          if (m![2] === 'cancel') { if (o.from_id !== u) fail('offer'); db.prepare("UPDATE offers SET status = 'cancelled' WHERE id = ?").run(o.id); return; }
          if (o.to_id !== u) fail('offer');
          if (m![2] === 'reject') db.prepare("UPDATE offers SET status = 'rejected' WHERE id = ?").run(o.id);
          else accept(o);
        });
        send(200, { ok: true, coins: coins(u) });
      } else if (path === '/me/matches' && method === 'POST') {
        // A match against the computer that pays prize money once the server has replayed it.
        const u = need(), b = await c.body(), own = mine(u) ?? fail('no-club');
        if (rewardsToday(u, 'cpu') >= E.DAILY_REWARDS.cpu) fail('limit');
        let opp: Club | null = typeof b.opponent === 'string' ? club(b.opponent) : null;
        if (!opp) { // a computer club of similar strength
          const r = E.teamRating(own.team), near = [...PRESETS.values()].filter((t) => Math.abs(E.teamRating(t) - r) <= 1.2);
          opp = club((near.length ? near : [...PRESETS.values()])[randomInt(near.length || PRESETS.size)].id);
        }
        if (!opp || opp.id === own.id) fail('club');
        const setup = { home: matchTeam(own), away: matchTeam(opp!), minutes: matchMinutes(b.minutes), pitch: randomInt(7) };
        const id = randomBytes(8).toString('hex'), seed = randomInt(1, 2 ** 31);
        db.prepare('INSERT INTO cpu_matches (id, user_id, seed, setup, own, opp, created) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, u, seed, JSON.stringify(setup), E.teamRating(own.team), E.teamRating(opp!.team), now());
        send(200, { id, seed, ...setup, reward: { win: E.matchReward(E.teamRating(own.team), E.teamRating(opp!.team), 1, 0, false), draw: E.matchReward(E.teamRating(own.team), E.teamRating(opp!.team), 0, 0, false) } });
      } else if ((m = path.match(/^\/me\/matches\/([0-9a-f]{16})$/)) && method === 'POST') {
        const u = need(), b = await c.body(2_000_000);
        const r = db.prepare('SELECT * FROM cpu_matches WHERE id = ? AND user_id = ? AND done = 0 AND created > ?').get(m[1], u, now() - 6 * 3600_000) as { seed: number; setup: string; own: number; opp: number } | undefined ?? fail('match');
        db.prepare('UPDATE cpu_matches SET done = 1 WHERE id = ?').run(m[1]); // one attempt per match
        const setup = JSON.parse(r.setup), s = newMatch(r.seed, cpuSetup(setup));
        // inputs: run-length pairs [word, frames] of the player's (home) input words.
        const runs = Array.isArray(b.inputs) ? b.inputs : [];
        const limit = setup.minutes * 60 * 60 * 3; // generous: pauses and stoppage
        let frames = 0;
        for (const run of runs) {
          const [w, n] = Array.isArray(run) ? run : [0, 0];
          if (!Number.isInteger(w) || !Number.isInteger(n) || n < 1 || (frames += n) > limit) fail('inputs');
          for (let i = 0; i < n && s.phase !== 'end'; i++) step(s, [w & 0xffffff, s.paused ? 0 : cpuInput(s, 1)]);
          if (s.phase === 'end') break;
        }
        if (s.phase !== 'end') fail('incomplete');
        const [gf, ga] = s.score;
        const paid = reward(u, 'cpu', r.own, r.opp, gf, ga, `${setup.home.short} ${gf}:${ga} ${setup.away.short}`);
        send(200, { score: s.score, reward: paid, coins: coins(u) });
      } else return false;
    } catch (e) {
      if (!(e instanceof Fail)) throw e;
      send(e.code === 'signed-out' ? 401 : e.code === 'club' || e.code === 'match' ? 404 : e.code === 'limit' ? 429 : 409, { error: e.code });
    }
    return true;
  }

  /** The club team a signed-in player brings to an online match (null without a club). */
  const onlineTeam = (user: number) => { const x = mine(user); return x ? matchTeam(x) : null; };
  return { route, reward, onlineTeam, sweep, rating: E.teamRating };
}
