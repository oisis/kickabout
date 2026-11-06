// Kickabout API server: accounts and clubs (accounts.ts, clubs.ts) and online matches over
// WebSocket (any path; the website proxies /ws here). Matches are a lockstep relay: frame k
// is broadcast once both players have sent their input for tick k. The server also simulates
// every match from those frames: for the fan zone (live.ts: score, minute, the state a
// spectator starts from) and to pay prize money for club matches. The website and the game
// are served by web/.
import { createServer, type Server } from 'node:http';
import { networkInterfaces } from 'node:os';
import { randomInt } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'node:http';
import { accounts, envProviders, type AccountOptions, type Route } from './accounts.ts';
import { admin, type Online } from './admin.ts';
import { iceServers, voiceFromEnv, MAX_SIGNAL, MAX_SIGNALS, type VoiceOptions } from './voice.ts';
import { clubs } from './clubs.ts';
import { live, type LiveMatch } from './live.ts';
import { matchMinutes } from '../src/store.ts';
import { onlineMatch } from '../src/data.ts';
import { newMatch, step, type State } from '../src/sim.ts';
import pkg from '../package.json' with { type: 'json' };

export const VERSION: string = pkg.version;

const DELAY = 6; // input delay in ticks (100 ms at 60 Hz)
const MAX_AHEAD = 600; // 10 s of buffered inputs before we give up on a lagging peer
const HEARTBEAT_MS = 30_000; // ping every socket; one that misses a pong is gone (half-open behind proxies)

interface Match {
  players: WebSocket[]; inputs: Map<number, number>[]; next: number; hashes: Map<number, number>;
  /** Prize money: the signed-in owner of each side's club (or null) and the server's own copy of the match. */
  users: (number | null)[]; ratings: number[]; sim: State; note: string; rewarded: boolean;
  /** Fan zone entry (null when the players did not allow spectators). */
  live: LiveMatch | null;
  /** Voice chat: both players of a private room switched it on; signalling messages relayed so far. */
  voice: boolean; signals: number;
}

const log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a);
const send = (ws: WebSocket, msg: object) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg)); };
const isTick = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;

export function startServer(port: number, opts: AccountOptions & { voice?: VoiceOptions } = {}): Server {
  let club!: ReturnType<typeof clubs>, adm!: Route;
  const api = accounts(opts, [(c) => club.route(c), (c) => adm(c)]);
  club = clubs(api.db);
  adm = admin(api.db, api.isAdmin, () => onlineNow());
  club.sweep();
  const sweeper = setInterval(() => club.sweep(), 3600_000);
  sweeper.unref();
  const http = createServer(async (req, res) => {
    if (req.url === '/healthz') { res.writeHead(200).end('ok'); return; }
    if (req.url === '/live' || req.url === '/api/live') { res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store', 'access-control-allow-origin': '*' }).end(JSON.stringify(fans.list())); return; }
    if (req.url === '/online' || req.url === '/api/online') { res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store', 'access-control-allow-origin': '*' }).end(JSON.stringify(onlineNow())); return; }
    if (req.url === '/version' || req.url === '/api/version') { res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' }).end(JSON.stringify({ version: VERSION })); return; }
    if (!(await api.handle(req, res))) res.writeHead(404, { 'content-type': 'text/plain' }).end('Kickabout API');
  });
  const fans = live();
  http.on('close', () => { clearInterval(sweeper); fans.close(); });

  const matches = new Map<WebSocket, Match>();
  /** Everyone connected to the match server right now: players, players waiting for one, fans. */
  const onlineNow = (): Online => {
    const playing = matches.size, queued = (waiting ? 1 : 0) + rooms.size, watching = fans.watchers();
    return { online: playing + queued + watching, playing, waiting: queued, watching, matches: new Set(matches.values()).size };
  };
  // Lobby: one quick-match slot and private rooms keyed by a short code. A host's
  // match settings and each player's own team travel in the join message.
  type Lobby = { ws: WebSocket; config: Record<string, unknown>; user: number | null };
  const reqOf = new Map<WebSocket, IncomingMessage>();
  let waiting: Lobby | null = null;
  const rooms = new Map<string, Lobby>();
  const lobbyOf = new Map<WebSocket, string>();

  function end(m: Match, why: string) {
    log('koniec meczu:', why);
    fans.end(m.live, m.sim.phase === 'end' ? 'end' : why === 'opponent-left' ? 'player-left' : why);
    for (const p of m.players) { matches.delete(p); send(p, { t: 'bye', why }); p.close(); }
  }

  function start(host: Lobby, guest: Lobby, room: boolean) {
    const [a, b] = [host.ws, guest.ws];
    // Voice only between friends in a private room (P2P reveals addresses) and only if both want it.
    const voice = room && host.config.voice === true && guest.config.voice === true;
    const seed = randomInt(1, 2 ** 32 - 1);
    // The host's settings win, except the match length: each player proposes one and a disagreement
    // is settled by a draw between the two. Clients validate what they receive.
    const [hm, gm] = [host.config.minutes, guest.config.minutes].map(matchMinutes);
    const minutes = hm === gm ? hm : [hm, gm][randomInt(2)];
    const config = { ...host.config, minutes, minutesDrawn: hm !== gm, home: host.config.team, away: guest.config.team };
    const { home, away, setup } = onlineMatch(config);
    const rewarded = [host.user, guest.user].some((u) => u !== null) && host.user !== guest.user; // a club match between two players
    const m: Match = {
      players: [a, b], inputs: [new Map(), new Map()], next: 0, hashes: new Map(), users: [host.user, guest.user],
      ratings: rewarded ? [club.rating(home), club.rating(away)] : [0, 0], sim: newMatch(seed, setup), note: `${home.short} – ${away.short}`, rewarded, voice, signals: 0, live: null,
    };
    // Fan zone: quick matches are public unless a player opts out; a private room only if its host allows it.
    const visible = (room ? host.config.spectate === true : true) && host.config.hidden !== true && guest.config.hidden !== true;
    m.live = fans.add(rewarded ? 'club' : room ? 'room' : 'quick', config, m.sim, visible);
    const ice = voice ? iceServers(opts.voice) : [];
    m.players.forEach((p, side) => {
      matches.set(p, m); lobbyOf.delete(p);
      send(p, { t: 'start', seed, side, delay: DELAY, config, voice: voice ? { iceServers: ice, initiator: side === 0 } : null });
    });
    log('nowy mecz, ziarno', seed, '— aktywnych meczów:', new Set(matches.values()).size);
  }

  function onMessage(ws: WebSocket, m: Match, msg: { t?: unknown; k?: unknown; b?: unknown; h?: unknown; d?: unknown }) {
    const side = m.players.indexOf(ws);
    if (msg.t === 'in' && isTick(msg.k) && Number.isInteger(msg.b)) {
      if (msg.k < m.next || msg.k > m.next + MAX_AHEAD) return end(m, 'lag');
      if (!m.inputs[side].has(msg.k)) m.inputs[side].set(msg.k, (msg.b as number) & 0xffffff); // controls + commands
      while (m.inputs[0].has(m.next) && m.inputs[1].has(m.next)) {
        const b = [m.inputs[0].get(m.next), m.inputs[1].get(m.next)];
        m.inputs[0].delete(m.next); m.inputs[1].delete(m.next);
        for (const p of m.players) send(p, { t: 'f', k: m.next, b }); // the players first, always
        if (m.sim.phase !== 'end') {
          step(m.sim, b as number[]);
          fans.frame(m.live, m.next, b as number[]);
          if (m.sim.phase === 'end' && m.rewarded) payOut(m);
        }
        m.next++;
      }
    } else if (msg.t === 'rtc' && m.voice && msg.d && typeof msg.d === 'object') {
      // WebRTC signalling for the voice chat, passed to the other player untouched.
      if (++m.signals > MAX_SIGNALS || JSON.stringify(msg.d).length > MAX_SIGNAL) return;
      send(m.players[1 - side], { t: 'rtc', d: msg.d });
    } else if (msg.t === 'hash' && isTick(msg.k) && Number.isInteger(msg.h)) {
      const other = m.hashes.get(msg.k);
      if (other === undefined) m.hashes.set(msg.k, msg.h as number);
      else if (other !== msg.h) { log('rozjazd stanów w klatce', msg.k); end(m, 'desync'); }
      else m.hashes.delete(msg.k);
    }
  }

  function payOut(m: Match) {
    const s = m.sim;
    m.users.forEach((u, side) => {
      if (u === null) return;
      const paid = club.reward(u, 'online', m.ratings[side], m.ratings[1 - side], s.score[side], s.score[1 - side], `${m.note} ${s.score[0]}:${s.score[1]}`);
      send(m.players[side], { t: 'reward', amount: paid });
    });
    log('nagrody za mecz', m.note, s.score.join(':'));
  }

  function enterLobby(ws: WebSocket, msg: { room?: unknown; config?: unknown; token?: unknown }) {
    const config = msg.config && typeof msg.config === 'object' ? (msg.config as Record<string, unknown>) : {};
    // A signed-in player may bring their online club (the server's copy, not what the client sent).
    const user = config.club === true ? api.userOf(reqOf.get(ws)!, typeof msg.token === 'string' ? msg.token : undefined)?.id ?? null : null;
    const team = user === null ? null : club.onlineTeam(user);
    const me: Lobby = { ws, config: team ? { ...config, team } : config, user: team ? user : null };
    if (msg.room === 'new') {
      let code = '';
      do code = Array.from({ length: 4 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ'[randomInt(24)]).join(''); while (rooms.has(code));
      rooms.set(code, me); lobbyOf.set(ws, code);
      return send(ws, { t: 'room', code });
    }
    if (typeof msg.room === 'string' && msg.room) {
      const code = msg.room.toUpperCase(), host = rooms.get(code);
      if (!host || host.ws.readyState !== WebSocket.OPEN) { send(ws, { t: 'bye', why: 'no-room', room: code }); return ws.close(); }
      rooms.delete(code);
      return start(host, me, true);
    }
    if (waiting && waiting.ws.readyState === WebSocket.OPEN) { const host = waiting; waiting = null; return start(host, me, false); }
    waiting = me;
    send(ws, { t: 'wait' });
  }

  const wss = new WebSocketServer({ server: http, maxPayload: 64 * 1024 });
  const alive = new WeakSet<WebSocket>();
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!alive.has(ws)) { ws.terminate(); continue; } // its 'close' handler frees the match, lobby or fan slot
      alive.delete(ws);
      ws.ping();
    }
  }, HEARTBEAT_MS);
  heartbeat.unref();
  http.on('close', () => clearInterval(heartbeat));
  wss.on('connection', (ws, req) => {
    alive.add(ws);
    ws.on('pong', () => alive.add(ws));
    reqOf.set(ws, req); // cookies of the upgrade request identify players of the browser game
    ws.on('message', (data) => {
      let msg: Record<string, unknown>;
      try { msg = JSON.parse(String(data)); } catch { return; }
      const m = matches.get(ws);
      if (m) onMessage(ws, m, msg);
      else if (msg.t === 'join' && !lobbyOf.has(ws) && waiting?.ws !== ws) enterLobby(ws, msg);
      else if (msg.t === 'watch') fans.watch(ws, msg.id);
    });
    ws.on('close', () => {
      reqOf.delete(ws);
      fans.unwatch(ws);
      if (waiting?.ws === ws) waiting = null;
      const code = lobbyOf.get(ws);
      if (code) { rooms.delete(code); lobbyOf.delete(ws); }
      const m = matches.get(ws);
      if (m) end(m, 'opponent-left');
    });
  });

  http.listen(port);
  return http;
}

if (import.meta.main) {
  const env = process.env, port = Number(env.PORT ?? 8787);
  const providers = envProviders();
  startServer(port, {
    db: env.DB_PATH ?? 'kickabout.db', publicUrl: env.PUBLIC_URL ?? `http://localhost:${port}`, apiUrl: env.API_URL || undefined,
    cookieDomain: env.COOKIE_DOMAIN || undefined, providers, admins: (env.ADMIN_EMAILS ?? '').split(','), devLogin: env.DEV_LOGIN === '1', voice: voiceFromEnv(),
  }).on('listening', () => {
    const ips = Object.values(networkInterfaces()).flat().filter((i) => i?.family === 'IPv4' && !i.internal).map((i) => i!.address);
    log(`Kickabout API ${VERSION} na porcie ${port}; logowanie: ${[...Object.keys(providers), ...(env.DEV_LOGIN === '1' ? ['dev'] : [])].join(', ') || 'wyłączone'}.`);
    for (const ip of ips) log(`  w aplikacji podaj: ${ip}:${port}`);
  });
}
