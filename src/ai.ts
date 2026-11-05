// Computer opponent: produces the same input word a human would, so a remote
// player can replace it without touching the simulation. Pure: reads state only.
import { type State, type Player, W, H, M, KICK, atk, isqrt, vecBits } from './sim.ts';

function hash(n: number): number {
  n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
  n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
  return (n ^ (n >>> 16)) >>> 0;
}

const near = (p: Player, x: number, y: number, r: number) => (p.x - x) ** 2 + (p.y - y) ** 2 < r * r;

function freeMateAhead(s: State, t: number, me: Player): Player | null {
  const a = atk(t), opp = s.teams[1 - t];
  let best: Player | null = null, bestAdv = -8 * M;
  for (const q of s.teams[t]) {
    if (q === me) continue;
    const dx = q.x - me.x, dy = q.y - me.y, d = isqrt(dx * dx + dy * dy);
    const adv = dy * a; // how far up the pitch the mate is
    if (d < 6 * M || d > 35 * M || adv <= bestAdv || opp.some((o) => near(o, q.x, q.y, 4 * M))) continue;
    best = q; bestAdv = adv;
  }
  return best;
}

export function cpuInput(s: State, t: number): number {
  if (s.phase !== 'play') return 0;
  const me = s.teams[t][s.controlled[t]], b = s.ball, a = atk(t);
  const r = hash(s.frame * 2 + t) % 1000;
  const held = s.prevInput[t] & KICK;
  const gy = t === 0 ? 0 : H;
  const gdx = W / 2 - me.x, gdy = gy - me.y, gd = isqrt(gdx * gdx + gdy * gdy);

  if (s.ownerTeam === t && s.ownerIdx === s.controlled[t]) {
    const shoot = gd < 18 * M || (gd < 27 * M && r < 25);
    // Releasing with no direction keeps the facing chosen on the press tick.
    if (held) return shoot && s.hold[t] < 13 ? vecBits(gdx, gdy, 0) | KICK : 0;
    if (shoot) return vecBits(gdx, gdy, 0) | KICK;
    const threat = s.teams[1 - t].find((o) => near(o, me.x, me.y, 45 * M / 10) && (o.y - me.y) * a > -M);
    if (threat || r < 8) {
      const q = freeMateAhead(s, t, me);
      if (q) return vecBits(q.x - me.x, q.y - me.y, 0) | KICK;
    }
    if (threat) {
      const awayRight = me.x < 8 * M || (me.x < W - 8 * M && me.x > threat.x); // never sidestep over a touchline
      return vecBits((awayRight ? 10 : -10) * M, a * 10 * M, 0);
    }
    return vecBits(gdx, gdy, 0);
  }

  if (held || s.ownerTeam === t) return 0;
  let bits = vecBits(b.x + b.vx * 6 - me.x, b.y + b.vy * 6 - me.y, 200);
  if (s.ownerTeam === 1 - t && s.ownerIdx > 0 && near(me, b.x, b.y, 2250) && r < 60) bits |= KICK;
  return bits;
}
