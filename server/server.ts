// Kopanka multiplayer server: serves the built game over HTTP and pairs players
// over WebSocket. It never simulates; it only orders input words (lockstep relay):
// frame k is broadcast once both players have sent their input for tick k.
import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, normalize, extname } from 'node:path';
import { networkInterfaces } from 'node:os';
import { randomInt } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';

const DIST = join(import.meta.dirname, '..', 'dist');
const DELAY = 6; // input delay in ticks (100 ms at 60 Hz)
const MAX_AHEAD = 600; // 10 s of buffered inputs before we give up on a lagging peer
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.ogg': 'audio/ogg', '.md': 'text/markdown; charset=utf-8',
};

interface Match { players: WebSocket[]; inputs: Map<number, number>[]; next: number; hashes: Map<number, number> }

const log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a);
const send = (ws: WebSocket, msg: object) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg)); };
const isTick = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;

export function startServer(port: number): Server {
  const http = createServer(async (req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname));
    const file = join(DIST, path === '/' ? 'index.html' : path);
    if (!file.startsWith(DIST)) { res.writeHead(404).end(); return; }
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(body);
    } catch {
      res.writeHead(404).end('Nie znaleziono (czy uruchomiono "npm run build"?)');
    }
  });

  const matches = new Map<WebSocket, Match>();
  // Lobby: one quick-match slot and private rooms keyed by a short code. A host's
  // match settings and each player's own team travel in the join message.
  type Lobby = { ws: WebSocket; config: Record<string, unknown> };
  let waiting: Lobby | null = null;
  const rooms = new Map<string, Lobby>();
  const lobbyOf = new Map<WebSocket, string>();

  function end(m: Match, why: string) {
    log('koniec meczu:', why);
    for (const p of m.players) { matches.delete(p); send(p, { t: 'bye', why }); p.close(); }
  }

  function start(host: Lobby, guest: Lobby) {
    const [a, b] = [host.ws, guest.ws];
    const m: Match = { players: [a, b], inputs: [new Map(), new Map()], next: 0, hashes: new Map() };
    const seed = randomInt(1, 2 ** 32 - 1);
    // The host's settings win; the guest only brings its team. Clients validate what they receive.
    const config = { ...host.config, home: host.config.team, away: guest.config.team };
    m.players.forEach((p, side) => { matches.set(p, m); lobbyOf.delete(p); send(p, { t: 'start', seed, side, delay: DELAY, config }); });
    log('nowy mecz, ziarno', seed, '— aktywnych meczów:', new Set(matches.values()).size);
  }

  function onMessage(ws: WebSocket, m: Match, msg: { t?: unknown; k?: unknown; b?: unknown; h?: unknown }) {
    const side = m.players.indexOf(ws);
    if (msg.t === 'in' && isTick(msg.k) && Number.isInteger(msg.b)) {
      if (msg.k < m.next || msg.k > m.next + MAX_AHEAD) return end(m, 'lag');
      if (!m.inputs[side].has(msg.k)) m.inputs[side].set(msg.k, (msg.b as number) & 0xffffff); // controls + commands
      while (m.inputs[0].has(m.next) && m.inputs[1].has(m.next)) {
        const b = [m.inputs[0].get(m.next), m.inputs[1].get(m.next)];
        m.inputs[0].delete(m.next); m.inputs[1].delete(m.next);
        for (const p of m.players) send(p, { t: 'f', k: m.next, b });
        m.next++;
      }
    } else if (msg.t === 'hash' && isTick(msg.k) && Number.isInteger(msg.h)) {
      const other = m.hashes.get(msg.k);
      if (other === undefined) m.hashes.set(msg.k, msg.h as number);
      else if (other !== msg.h) { log('rozjazd stanów w klatce', msg.k); end(m, 'desync'); }
      else m.hashes.delete(msg.k);
    }
  }

  function enterLobby(ws: WebSocket, msg: { room?: unknown; config?: unknown }) {
    const me: Lobby = { ws, config: msg.config && typeof msg.config === 'object' ? (msg.config as Record<string, unknown>) : {} };
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
      return start(host, me);
    }
    if (waiting && waiting.ws.readyState === WebSocket.OPEN) { const host = waiting; waiting = null; return start(host, me); }
    waiting = me;
    send(ws, { t: 'wait' });
  }

  const wss = new WebSocketServer({ server: http, maxPayload: 64 * 1024 });
  wss.on('connection', (ws) => {
    ws.on('message', (data) => {
      let msg: Record<string, unknown>;
      try { msg = JSON.parse(String(data)); } catch { return; }
      const m = matches.get(ws);
      if (m) onMessage(ws, m, msg);
      else if (msg.t === 'join' && !lobbyOf.has(ws) && waiting?.ws !== ws) enterLobby(ws, msg);
    });
    ws.on('close', () => {
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
  const port = Number(process.env.PORT ?? 8787);
  startServer(port).on('listening', () => {
    const ips = Object.values(networkInterfaces()).flat().filter((i) => i?.family === 'IPv4' && !i.internal).map((i) => i!.address);
    log(`Serwer Kopanki działa na porcie ${port}.`);
    for (const ip of ips) log(`  w przeglądarce telefonu: http://${ip}:${port}   •   w aplikacji podaj: ${ip}:${port}`);
  });
}
