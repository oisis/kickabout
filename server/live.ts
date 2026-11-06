// Fan zone: anyone may watch a live online match its players allowed. A spectator gets the
// server's own copy of the match state (a few KB) and then the players' input words in
// batches, and simulates the match locally exactly like the players do. Spectators are kept
// off the players' path: players get every frame first, spectators get batches on a timer,
// slow spectators are dropped and their number is capped.
import { WebSocket } from 'ws';
import { randomBytes } from 'node:crypto';
import { minute, type State } from '../src/sim.ts';

export const MAX_PER_MATCH = 50, MAX_TOTAL = 500;
export const FLUSH_MS = 100; // 6 frames per batch
export const SLOW_BYTES = 256 * 1024; // a spectator this far behind is cut off

export interface LiveMatch {
  id: string; kind: 'quick' | 'room' | 'club'; started: number;
  config: Record<string, unknown>; sim: State;
  spectators: Set<WebSocket>; pending: number[]; first: number;
}

type Team = { name?: unknown; short?: unknown; kits?: { shirt?: unknown }[] };
const side = (t: unknown) => { const x = (t ?? {}) as Team; return { name: String(x.name ?? '?').slice(0, 32), short: String(x.short ?? '???').slice(0, 3), shirt: String(x.kits?.[0]?.shirt ?? '#dc2626') }; };
const send = (ws: WebSocket, msg: string) => { if (ws.readyState === WebSocket.OPEN) ws.send(msg); };

export function live() {
  const matches = new Map<string, LiveMatch>();
  const watching = new Map<WebSocket, LiveMatch>();

  function flush(m: LiveMatch) {
    if (!m.pending.length) return;
    const msg = JSON.stringify({ t: 'w', k: m.first, b: m.pending });
    m.pending = [];
    for (const ws of m.spectators) {
      if (ws.bufferedAmount > SLOW_BYTES) { ws.terminate(); continue; } // never let one slow fan pile up memory
      send(ws, msg);
    }
  }
  const timer = setInterval(() => { for (const m of matches.values()) if (m.spectators.size) flush(m); }, FLUSH_MS);
  timer.unref();

  return {
    /** A new match; visible only when its players allowed spectators. */
    add(kind: LiveMatch['kind'], config: Record<string, unknown>, sim: State, visible: boolean): LiveMatch | null {
      if (!visible) return null;
      const m: LiveMatch = { id: randomBytes(6).toString('hex'), kind, started: Date.now(), config, sim, spectators: new Set(), pending: [], first: 0 };
      matches.set(m.id, m);
      return m;
    },
    /** Frame k was just simulated by the server (and sent to the players). */
    frame(m: LiveMatch | null, k: number, b: number[]) {
      if (!m || !m.spectators.size) return;
      if (!m.pending.length) m.first = k;
      m.pending.push(b[0], b[1]);
    },
    end(m: LiveMatch | null, why: string) {
      if (!m) return;
      flush(m);
      const bye = JSON.stringify({ t: 'bye', why });
      for (const ws of m.spectators) { watching.delete(ws); send(ws, bye); ws.close(); }
      matches.delete(m.id);
    },
    /** A spectator asks to watch: the current state, then batches of frames from that state on. */
    watch(ws: WebSocket, id: unknown): boolean {
      const m = typeof id === 'string' ? matches.get(id) : undefined;
      const full = !m ? 'no-match' : m.spectators.size >= MAX_PER_MATCH || watching.size >= MAX_TOTAL ? 'full' : '';
      if (full) { send(ws, JSON.stringify({ t: 'bye', why: full })); ws.close(); return false; }
      flush(m!); // others get what is pending; the newcomer starts from the state after it
      send(ws, JSON.stringify({ t: 'watch', id: m!.id, config: m!.config, state: m!.sim, spectators: m!.spectators.size + 1 }));
      m!.spectators.add(ws);
      watching.set(ws, m!);
      return true;
    },
    unwatch(ws: WebSocket) { watching.get(ws)?.spectators.delete(ws); watching.delete(ws); },
    /** The fan zone's list: teams, score, minute and how many watch. */
    list() {
      return [...matches.values()].map((m) => ({
        id: m.id, kind: m.kind, started: m.started, home: side(m.config.home), away: side(m.config.away),
        score: m.sim.score, minute: minute(m.sim), phase: m.sim.phase, period: m.sim.period, spectators: m.spectators.size,
      })).sort((a, b) => b.spectators - a.spectators || a.started - b.started);
    },
    /** How many watch any match. */
    watchers: () => watching.size,
    close() { clearInterval(timer); },
  };
}
