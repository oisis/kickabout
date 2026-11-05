// Computer opponent: produces the same input word a human would (controls plus
// commands), so a remote player can replace it without touching the simulation.
// Pure: reads state only; randomness comes from a hash of the frame number.
import { type State, type Player, W, H, M, KICK, GOAL_HALF, BOX_DEPTH, BOX_HALF, CMD_SUB, atk, ownGoalY, isqrt, vecBits, minute, cmd, lineOf } from './sim.ts';

function hash(n: number): number {
  n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
  n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
  return (n ^ (n >>> 16)) >>> 0;
}

const near = (p: Player, x: number, y: number, r: number) => (p.x - x) ** 2 + (p.y - y) ** 2 < r * r;

function freeMateAhead(s: State, t: number, me: Player): Player | null {
  const a = atk(s, t), opp = s.teams[1 - t];
  let best: Player | null = null, bestAdv = -8 * M;
  for (const q of s.teams[t]) {
    if (q === me || q.off) continue;
    const dx = q.x - me.x, dy = q.y - me.y, d = isqrt(dx * dx + dy * dy);
    const adv = dy * a; // how far up the pitch the mate is
    if (d < 6 * M || d > 35 * M || adv <= bestAdv || opp.some((o) => !o.off && near(o, q.x, q.y, 4 * M))) continue;
    best = q; bestAdv = adv;
  }
  return best;
}

/** Substitutions around the hour mark, like-for-like by line when possible. */
function substitution(s: State, t: number): number {
  const m = minute(s), left = s.subsLeft[t];
  if (s.phase === 'play' || !s.bench[t].length || !((left === 3 && m >= 60) || (left === 2 && m >= 75))) return 0;
  const shape = s.tactics[t][s.tactic[t]];
  const slot = 1 + (hash(s.frame + t * 7919) % 10);
  if (s.teams[t][slot].off) return 0;
  const line = lineOf(shape[slot], slot);
  const bench = s.bench[t].filter((n) => s.squads[t][n].pos !== 0);
  if (!bench.length) return 0;
  const same = bench.find((n) => s.squads[t][n].pos === line) ?? bench[0];
  return cmd(CMD_SUB, slot, same);
}

/** Aftertouch on our own shot: bend a ball heading wide of the posts back towards goal. */
function bendShot(s: State, t: number): number {
  const b = s.ball, gy = atk(s, t) === -1 ? 0 : H;
  if (!b.vy || (gy - b.y) * b.vy <= 0) return -1; // not flying at the goal we attack
  const cross = b.x + Math.trunc(((gy - b.y) * b.vx) / b.vy);
  const off = cross - W / 2;
  return Math.abs(off) > Math.trunc((GOAL_HALF * 8) / 10) ? vecBits(-off, 0, 0) : 0;
}

export function cpuInput(s: State, t: number): number {
  const sub = substitution(s, t);
  if (sub || s.phase !== 'play') return sub;
  if (s.after && s.after.team === t && s.after.ticks > 0 && s.ownerTeam < 0) {
    const bend = bendShot(s, t);
    if (bend >= 0) return bend;
  }
  const me = s.teams[t][s.controlled[t]], b = s.ball, a = atk(s, t);
  const r = hash(s.frame * 2 + t) % 1000;
  const held = s.prevInput[t] & KICK;
  const gy = a === -1 ? 0 : H; // goal we attack
  const gdx = W / 2 - me.x, gdy = gy - me.y, gd = isqrt(gdx * gdx + gdy * gdy);

  if (s.ownerTeam === t && s.ownerIdx === s.controlled[t]) {
    if (s.pk && !s.pk.kicked) {
      // Penalty: pick a corner per attempt, hold for a firm low shot.
      const side = (hash((s.pk.team + 1) * 977 + s.score[0] * 31 + s.score[1] + (s.so ? s.so.taken[t] * 13 : 0)) % 3) - 1;
      const dir = vecBits(side * 6 * M, gdy, 0);
      return s.hold[t] < 12 ? dir | KICK : dir;
    }
    const shoot = gd < 18 * M || (gd < 27 * M && r < 25);
    // Releasing with no direction keeps the facing chosen on the press tick.
    if (held) return shoot && s.hold[t] < 13 ? vecBits(gdx, gdy, 0) | KICK : 0;
    if (shoot) return vecBits(gdx, gdy, 0) | KICK;
    const threat = s.teams[1 - t].find((o) => !o.off && near(o, me.x, me.y, (45 * M) / 10) && (o.y - me.y) * a > -M);
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

  if (held || s.ownerTeam === t || s.pk) return 0;
  let bits = vecBits(b.x + b.vx * 6 - me.x, b.y + b.vy * 6 - me.y, 200);
  const og = ownGoalY(s, t);
  const inOwnBox = Math.abs(b.y - og) < BOX_DEPTH && Math.abs(b.x - W / 2) < BOX_HALF;
  if (s.ownerTeam === 1 - t && s.ownerIdx > 0 && near(me, b.x, b.y, 2250) && r < (inOwnBox ? 15 : 60)) bits |= KICK;
  return bits;
}
