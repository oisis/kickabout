// Lockstep client: send our input for tick k+delay after simulating tick k,
// and simulate a tick only once the server has delivered both inputs for it.
import type { State } from './sim.ts';
import { t } from './i18n.ts';

/** Server disconnect reasons (codes) to translatable texts. */
const BYE: Record<string, string> = { 'opponent-left': 'Przeciwnik rozłączony', lag: 'Zbyt duże opóźnienie', desync: 'Rozsynchronizowano — mecz przerwany', 'no-room': 'Nie ma pokoju {0}', unknown: 'Koniec gry' };

export class Net {
  status: 'connecting' | 'waiting' | 'room' | 'playing' | 'closed' = 'connecting';
  room = '';
  config: Record<string, unknown> = {};
  message = '';
  side = 0;
  seed = 1;
  delay = 6;
  frames = new Map<number, [number, number]>();
  onStart = () => {};
  private ws: WebSocket;

  /** room: undefined = quick match, 'new' = create a private room, or a room code to join. */
  constructor(url: string, join: { room?: string; config: Record<string, unknown> } = { config: {} }) {
    this.ws = new WebSocket(url);
    this.ws.onopen = () => this.send({ t: 'join', ...join });
    this.ws.onmessage = (e) => { try { this.receive(JSON.parse(String(e.data))); } catch { /* ignore malformed */ } };
    this.ws.onerror = () => { this.message ||= t('Nie można połączyć z serwerem'); };
    this.ws.onclose = () => { this.message ||= t('Połączenie zerwane'); this.status = 'closed'; };
  }

  private receive(m: { t: string; seed?: number; side?: number; delay?: number; k?: number; b?: number[]; why?: string; room?: string; code?: string; config?: Record<string, unknown> }) {
    if (m.t === 'wait') this.status = 'waiting';
    else if (m.t === 'room') { this.status = 'room'; this.room = String(m.code ?? ''); }
    else if (m.t === 'start') {
      this.seed = m.seed! >>> 0; this.side = m.side === 1 ? 1 : 0; this.delay = m.delay! | 0;
      this.status = 'playing';
      this.config = m.config && typeof m.config === 'object' ? m.config : {};
      for (let k = 0; k < this.delay; k++) this.input(k, 0);
      this.onStart();
    } else if (m.t === 'f' && Number.isInteger(m.k)) this.frames.set(m.k!, [m.b![0] & 0xffffff, m.b![1] & 0xffffff]); // controls + commands
    else if (m.t === 'bye') { this.message = t(BYE[m.why ?? ''] ?? BYE.unknown, String(m.room ?? '')); this.status = 'closed'; }
  }

  private send(msg: object) {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  input(k: number, bits: number) { this.send({ t: 'in', k, b: bits }); }

  /** Lets the server detect diverged simulations. */
  check(k: number, s: State) {
    const str = JSON.stringify(s);
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 0x01000193);
    this.send({ t: 'hash', k, h: h >>> 0 });
  }

  close() {
    this.status = 'closed';
    this.ws.close();
  }
}

/** Last used server address, or this page's host when served by the game server. */
export function savedServer(): string {
  let saved = '';
  try { saved = localStorage.getItem('server') ?? ''; } catch { /* storage unavailable */ }
  // The Android app is served from http://localhost without a port; the game server always has one.
  const servedByGameServer = location.protocol.startsWith('http') && !!location.port;
  return saved || (servedByGameServer ? location.host : '');
}

/** Remember an address typed by the user and turn it into a WebSocket URL. */
export function serverUrl(address: string): string {
  const v = address.trim();
  try { localStorage.setItem('server', v); } catch { /* storage unavailable */ }
  return /^wss?:\/\//.test(v) ? v : `${location.protocol === 'https:' ? 'wss' : 'ws'}://${v}`;
}
