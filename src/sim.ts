// Deterministic match simulation. All state is plain integers (1 m = M units,
// 60 ticks/s) and step() is the only mutator, so the same seed plus the same
// per-tick input words replays the same match on any device. That is the
// contract a lockstep multiplayer server will rely on.

export const TICK_HZ = 60;
export const M = 1024;
export const W = 68 * M;
export const H = 105 * M;
export const GOAL_HALF = 3748; // 7.32 m goal
export const CROSSBAR = 2499; // 2.44 m
export const BOX_HALF = 20644;
export const BOX_DEPTH = 16896;
export const AREA_HALF = 9380;
export const AREA_DEPTH = 5632;
export const CIRCLE_R = 9370;
export const PEN_SPOT = 11264;

// One input word per team per tick.
export const UP = 1, DOWN = 2, LEFT = 4, RIGHT = 8, KICK = 16;

const RUN = 110; // units/tick ≈ 6.4 m/s
const DRIBBLE = 96;
const GRAVITY = 3;
const REACH = 520;
const PASS_MAX_HOLD = 9; // shorter press = pass, longer = shot

// [x across 0..1000, depth from own goal 0..1000]; index 0 is the goalkeeper. 4-4-2.
const FORM = [
  [500, 0], [150, 220], [380, 190], [620, 190], [850, 220],
  [150, 450], [380, 420], [620, 420], [850, 450], [380, 650], [620, 650],
];
const STRIKER = 9;

export interface Player { x: number; y: number; vx: number; vy: number; fx: number; fy: number; slide: number; down: number; cool: number }
export interface Ball { x: number; y: number; z: number; vx: number; vy: number; vz: number }
export type Phase = 'kickoff' | 'play' | 'out' | 'goal' | 'half' | 'end';

export interface State {
  frame: number; // every step
  tick: number; // match clock, runs only in play
  matchTicks: number;
  rng: number;
  phase: Phase;
  timer: number;
  kickoffTeam: number;
  restart: { team: number; idx: number; x: number; y: number } | null;
  score: [number, number];
  teams: Player[][];
  ball: Ball;
  ownerTeam: number; // -1 = loose ball
  ownerIdx: number;
  lastTouch: number;
  controlled: [number, number];
  prevInput: [number, number];
  hold: [number, number];
  keeperHold: number;
  event: string;
  eventFrame: number;
}

const div = (a: number, b: number) => Math.trunc(a / b);
const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
export const isqrt = (n: number) => Math.floor(Math.sqrt(n));
const dist2 = (p: { x: number; y: number }, x: number, y: number) => (p.x - x) ** 2 + (p.y - y) ** 2;
export const atk = (t: number) => (t === 0 ? -1 : 1); // team 0 attacks up (towards y = 0)
export const ownGoalY = (t: number) => (t === 0 ? H : 0);

function rnd(s: State, n: number): number {
  let x = s.rng;
  x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
  s.rng = x >>> 0;
  return s.rng % n;
}

/** Unit vector (×1000) for the direction bits of an input word. */
export function dirVec(bits: number): [number, number] {
  const x = (bits & RIGHT ? 1 : 0) - (bits & LEFT ? 1 : 0);
  const y = (bits & DOWN ? 1 : 0) - (bits & UP ? 1 : 0);
  const k = x && y ? 707 : 1000;
  return [x * k, y * k];
}

/** Nearest of the 8 directions as input bits (0 inside the dead zone). */
export function vecBits(dx: number, dy: number, dead: number): number {
  const ax = Math.abs(dx), ay = Math.abs(dy);
  if (ax <= dead && ay <= dead) return 0;
  let b = 0;
  if (ax * 1000 > 414 * ay) b |= dx < 0 ? LEFT : RIGHT;
  if (ay * 1000 > 414 * ax) b |= dy < 0 ? UP : DOWN;
  return b;
}

export function newMatch(seed: number, matchTicks = 300 * TICK_HZ): State {
  const s: State = {
    frame: 0, tick: 0, matchTicks, rng: seed >>> 0 || 1,
    phase: 'kickoff', timer: 0, kickoffTeam: 0, restart: null, score: [0, 0],
    teams: [0, 1].map(() => FORM.map(() => ({ x: 0, y: 0, vx: 0, vy: 0, fx: 0, fy: 0, slide: 0, down: 0, cool: 0 }))),
    ball: { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 },
    ownerTeam: -1, ownerIdx: -1, lastTouch: 0, controlled: [STRIKER, STRIKER],
    prevInput: [0, 0], hold: [0, 0], keeperHold: 0, event: '', eventFrame: 0,
  };
  kickoff(s, 0);
  return s;
}

export function step(s: State, inputs: readonly number[]): void {
  s.frame++;
  if (s.phase === 'end') return;
  if (s.phase === 'play') live(s, inputs);
  else deadBall(s);
  s.prevInput = [inputs[0] | 0, inputs[1] | 0];
}

function say(s: State, text: string) {
  s.event = text;
  s.eventFrame = s.frame;
}

function home(s: State, t: number, i: number): [number, number] {
  const [fx, fd] = FORM[i];
  const b = s.ball;
  let d = fd, x = t === 0 ? fx : 1000 - fx;
  if (s.phase === 'kickoff') d = Math.min(div(fd * 55, 100), 400);
  else {
    const ballD = t === 0 ? div((H - b.y) * 1000, H) : div(b.y * 1000, H);
    d += div((ballD - 500) * 45, 100) + (s.ownerTeam === t ? 80 : -40);
    x += div((div(b.x * 1000, W) - 500) * 30, 100);
  }
  d = clamp(d, 30, 950);
  x = clamp(x, 40, 960);
  return [div(x * W, 1000), t === 0 ? H - div(d * H, 1000) : div(d * H, 1000)];
}

function steer(p: Player, tx: number, ty: number, max: number) {
  const dx = tx - p.x, dy = ty - p.y, d = isqrt(dx * dx + dy * dy);
  if (d < 160) { p.vx = p.vy = 0; return; }
  const v = Math.min(max, div(d, 5));
  p.vx = div(dx * v, d); p.vy = div(dy * v, d);
  p.fx = div(dx * 1000, d); p.fy = div(dy * 1000, d);
}

function kickoff(s: State, team: number) {
  s.phase = 'kickoff'; s.timer = 70; s.kickoffTeam = team; s.restart = null;
  Object.assign(s.ball, { x: W / 2, y: H / 2, z: 0, vx: 0, vy: 0, vz: 0 });
  s.ownerTeam = s.ownerIdx = -1; s.hold = [0, 0]; s.keeperHold = 0;
  for (let t = 0; t < 2; t++) {
    s.teams[t].forEach((p, i) => {
      const [x, y] = home(s, t, i);
      Object.assign(p, { x, y, vx: 0, vy: 0, fx: 0, fy: atk(t) * 1000, slide: 0, down: 0, cool: 0 });
    });
  }
  const f = s.teams[team][STRIKER];
  f.x = W / 2 - 300; f.y = H / 2 - atk(team) * 600;
  s.controlled = [STRIKER, STRIKER];
}

function give(s: State, t: number, i: number) {
  s.ownerTeam = t; s.ownerIdx = i; s.lastTouch = t;
  if (i > 0) s.controlled[t] = i;
  else s.keeperHold = 0;
  dribble(s);
}

function movePlayers(s: State) {
  for (const team of s.teams) {
    for (const p of team) {
      p.x = clamp(p.x + p.vx, -3 * M, W + 3 * M);
      p.y = clamp(p.y + p.vy, -3 * M, H + 3 * M);
    }
  }
}

function deadBall(s: State) {
  s.hold = [0, 0];
  if (--s.timer > 0) {
    if (s.phase === 'goal') {
      freeBall(s);
      const b = s.ball;
      if (b.y < -2 * M || b.y > H + 2 * M) { b.vx = b.vy = 0; b.y = clamp(b.y, -2 * M, H + 2 * M); }
    }
    const r = s.restart;
    for (let t = 0; t < 2; t++) {
      s.teams[t].forEach((p, i) => {
        if (r && r.team === t && r.idx === i) steer(p, r.x, r.y, RUN);
        else { const [x, y] = home(s, t, i); steer(p, x, y, RUN); }
      });
    }
    if (s.phase !== 'kickoff') movePlayers(s);
    return;
  }
  switch (s.phase) {
    case 'kickoff':
      s.phase = 'play';
      give(s, s.kickoffTeam, STRIKER);
      break;
    case 'out': {
      const r = s.restart!;
      const p = s.teams[r.team][r.idx];
      const dx = W / 2 - r.x, dy = H / 2 - r.y, d = isqrt(dx * dx + dy * dy) || 1;
      Object.assign(p, { x: r.x, y: r.y, vx: 0, vy: 0, fx: div(dx * 1000, d), fy: div(dy * 1000, d) });
      s.restart = null; s.phase = 'play';
      give(s, r.team, r.idx);
      break;
    }
    case 'goal':
      kickoff(s, s.kickoffTeam);
      break;
    case 'half':
      kickoff(s, 1);
      break;
  }
}

function pickControlled(s: State, t: number) {
  if (s.ownerTeam === t) {
    if (s.ownerIdx > 0) s.controlled[t] = s.ownerIdx;
    return;
  }
  const cur = s.teams[t][s.controlled[t]];
  if (cur.slide > 0) return;
  const b = s.ball, px = b.x + b.vx * 8, py = b.y + b.vy * 8;
  let best = s.controlled[t], bd = dist2(cur, px, py);
  for (let i = 1; i < 11; i++) {
    const p = s.teams[t][i], d = dist2(p, px, py);
    if (!p.down && d < bd) { bd = d; best = i; }
  }
  if (cur.down || isqrt(bd) + 3 * M < isqrt(dist2(cur, px, py))) s.controlled[t] = best;
}

function nearestOutfield(s: State, t: number, x: number, y: number, skip: number): number {
  let best = 1, bd = Infinity;
  for (let i = 1; i < 11; i++) {
    const d = dist2(s.teams[t][i], x, y);
    if (i !== skip && d < bd) { bd = d; best = i; }
  }
  return best;
}

function live(s: State, inputs: readonly number[]) {
  const b = s.ball;
  pickControlled(s, 0);
  pickControlled(s, 1);
  for (let t = 0; t < 2; t++) {
    // Without the ball, the second-nearest player presses too.
    const helper = s.ownerTeam === t ? -1 : nearestOutfield(s, t, b.x, b.y, s.controlled[t]);
    s.teams[t].forEach((p, i) => {
      if (p.cool > 0) p.cool--;
      if (p.slide > 0) {
        if (--p.slide === 0) { p.down = 24; p.vx = p.vy = 0; }
      } else if (p.down > 0) {
        p.down--; p.vx = p.vy = 0;
      } else if (i === 0) keeper(s, t);
      else if (i === s.controlled[t]) control(s, t, p, inputs[t] | 0);
      else if (i === helper) steer(p, b.x, b.y, div(RUN * 9, 10));
      else { const [x, y] = home(s, t, i); steer(p, x, y, div(RUN * 85, 100)); }
    });
  }
  movePlayers(s);
  if (s.ownerTeam >= 0) dribble(s);
  else freeBall(s);
  contest(s);
  rules(s);
  if (s.phase === 'play') {
    s.tick++;
    if (s.tick === s.matchTicks >> 1) {
      s.phase = 'half'; s.timer = 180; s.ownerTeam = s.ownerIdx = -1; say(s, 'Przerwa');
    } else if (s.tick >= s.matchTicks) {
      s.phase = 'end'; say(s, 'Koniec meczu');
    }
  }
}

function control(s: State, t: number, p: Player, inp: number) {
  const prev = s.prevInput[t];
  const own = s.ownerTeam === t && s.ownerIdx === s.controlled[t];
  const [dx, dy] = dirVec(inp);
  if (dx || dy) {
    const v = own ? DRIBBLE : RUN;
    p.fx = dx; p.fy = dy; p.vx = div(dx * v, 1000); p.vy = div(dy * v, 1000);
  } else p.vx = p.vy = 0;
  if (inp & KICK) {
    s.hold[t]++;
    if (!(prev & KICK) && !own && s.ownerTeam !== t) {
      p.slide = 18; p.vx = div(p.fx * 190, 1000); p.vy = div(p.fy * 190, 1000);
    }
  } else {
    if (prev & KICK && own) kick(s, t, p, s.hold[t]);
    s.hold[t] = 0;
  }
}

function passTarget(s: State, t: number, p: Player): Player | null {
  let best: Player | null = null, bestCos = 820; // within ~35° of facing
  for (const q of s.teams[t]) {
    if (q === p) continue;
    const dx = q.x - p.x, dy = q.y - p.y, d = isqrt(dx * dx + dy * dy);
    if (d < 4 * M || d > 40 * M) continue;
    const c = div(dx * p.fx + dy * p.fy, d);
    if (c > bestCos) { bestCos = c; best = q; }
  }
  return best;
}

function kick(s: State, t: number, p: Player, hold: number) {
  const b = s.ball;
  let dx = p.fx, dy = p.fy, speed: number, vz = 0;
  if (hold < PASS_MAX_HOLD) {
    const q = passTarget(s, t, p);
    if (q) {
      dx = q.x + q.vx * 20 - b.x; dy = q.y + q.vy * 20 - b.y;
      speed = clamp(div(isqrt(dx * dx + dy * dy) * 16, 1000) + 60, 160, 430);
    } else speed = 280;
  } else {
    const h = Math.min(hold, 40);
    speed = 330 + (h - PASS_MAX_HOLD) * 7;
    vz = Math.max(0, (h - 16) * 6);
    // Shot assist: roughly facing a goal in range aims inside it, with spread.
    const gy = t === 0 ? 0 : H, tx = W / 2 - b.x, ty = gy - b.y, d = isqrt(tx * tx + ty * ty);
    if (d < 38 * M && tx * p.fx + ty * p.fy > 770 * d) {
      const side = p.fx > 300 ? 1 : p.fx < -300 ? -1 : 0;
      const aim = W / 2 + side * div(GOAL_HALF * 7, 10) + rnd(s, GOAL_HALF) - div(GOAL_HALF, 2);
      dx = aim - b.x; dy = gy - b.y;
    }
  }
  const len = isqrt(dx * dx + dy * dy) || 1;
  b.vx = div(dx * speed, len); b.vy = div(dy * speed, len); b.vz = vz;
  s.ownerTeam = s.ownerIdx = -1; s.lastTouch = t; p.cool = 14;
}

function dribble(s: State) {
  const p = s.teams[s.ownerTeam][s.ownerIdx], b = s.ball;
  b.x = p.x + div(p.fx * 360, 1000); b.y = p.y + div(p.fy * 360, 1000);
  b.z = 0; b.vx = p.vx; b.vy = p.vy; b.vz = 0;
}

function freeBall(s: State) {
  const b = s.ball;
  b.x += b.vx; b.y += b.vy; b.z += b.vz;
  if (b.z > 0) {
    b.vz -= GRAVITY;
    b.vx = div(b.vx * 998, 1000); b.vy = div(b.vy * 998, 1000);
    return;
  }
  b.z = 0;
  if (b.vz < 0) {
    b.vz = -div(b.vz * 45, 100);
    if (b.vz < 8) b.vz = 0;
  }
  if (b.vz === 0) { b.vx = div(b.vx * 985, 1000); b.vy = div(b.vy * 985, 1000); }
}

function keeper(s: State, t: number) {
  const k = s.teams[t][0], b = s.ball, gy = ownGoalY(t), a = atk(t);
  if (s.ownerTeam === t && s.ownerIdx === 0) {
    k.vx = k.vy = 0; k.fx = 0; k.fy = a * 1000;
    if (++s.keeperHold > 55) {
      const q = s.teams[t][5 + rnd(s, 6)];
      const dx = q.x - k.x, dy = q.y - k.y, d = isqrt(dx * dx + dy * dy) || 1;
      b.vx = div(dx * 430, d); b.vy = div(dy * 430, d); b.vz = 95;
      s.ownerTeam = s.ownerIdx = -1; s.lastTouch = t; k.cool = 40; s.keeperHold = 0;
    }
    return;
  }
  const dist = Math.abs(b.y - gy);
  let tx = clamp(b.x, W / 2 - GOAL_HALF, W / 2 + GOAL_HALF), ty = gy + a * M;
  if (dist < BOX_DEPTH && Math.abs(b.x - W / 2) < BOX_HALF) {
    tx = clamp(b.x, W / 2 - AREA_HALF, W / 2 + AREA_HALF);
    ty = gy + a * Math.max(M, Math.min(div(dist * 45, 100), 6 * M));
  }
  steer(k, tx, ty, RUN);
}

function keeperSave(s: State, t: number) {
  const k = s.teams[t][0], b = s.ball, gy = ownGoalY(t);
  if (k.cool || s.ownerTeam === t || k.down) return;
  if (Math.abs(b.y - gy) > BOX_DEPTH || Math.abs(b.x - W / 2) > BOX_HALF) return;
  const d2 = dist2(k, b.x, b.y);
  if (d2 > 1300 * 1300 || b.z > CROSSBAR + 200) return;
  if (s.ownerTeam >= 0 && d2 > 600 * 600) return; // only snatch from a dribbler up close
  const speed = isqrt(b.vx * b.vx + b.vy * b.vy);
  if (rnd(s, 100) >= clamp(130 - div(speed, 4), 20, 95)) { k.cool = 30; return; } // beaten
  if (speed > 330) {
    b.vy = -div(b.vy * 4, 10); b.vx = div(b.vx * 6, 10) + rnd(s, 161) - 80; b.vz = 45;
    s.ownerTeam = s.ownerIdx = -1; s.lastTouch = t; k.cool = 24;
    say(s, 'Parada!');
    return;
  }
  if (speed > 200) say(s, 'Obrona!');
  give(s, t, 0);
}

function contest(s: State) {
  const b = s.ball;
  keeperSave(s, 0);
  keeperSave(s, 1);
  const keeperHasBall = s.ownerIdx === 0;
  for (let t = 0; t < 2; t++) {
    for (let i = 1; i < 11; i++) {
      const p = s.teams[t][i];
      if (!p.slide || s.ownerTeam === t || keeperHasBall || b.z > 600 || dist2(p, b.x, b.y) > 650 * 650) continue;
      if (s.ownerTeam >= 0) s.teams[s.ownerTeam][s.ownerIdx].down = 30;
      s.ownerTeam = s.ownerIdx = -1;
      b.vx = div(p.fx * 260, 1000); b.vy = div(p.fy * 260, 1000); b.vz = 20;
      s.lastTouch = t; p.cool = 10;
    }
  }
  if (s.ownerTeam >= 0 && !keeperHasBall) {
    const o = 1 - s.ownerTeam;
    for (let i = 1; i < 11; i++) {
      const q = s.teams[o][i];
      if (q.down || q.slide || dist2(q, b.x, b.y) > 420 * 420 || rnd(s, 30)) continue;
      s.teams[s.ownerTeam][s.ownerIdx].cool = 25;
      give(s, o, i);
      break;
    }
  }
  if (s.ownerTeam < 0 && b.z < 800) {
    let bt = -1, bi = -1, bd = REACH * REACH;
    for (let t = 0; t < 2; t++) {
      for (let i = 1; i < 11; i++) {
        const p = s.teams[t][i], d = dist2(p, b.x, b.y);
        if (!p.down && !p.slide && !p.cool && d < bd) { bd = d; bt = t; bi = i; }
      }
    }
    if (bt >= 0) give(s, bt, bi);
  }
}

function out(s: State, team: number, x: number, y: number, label: string, idx = -1) {
  if (idx < 0) idx = nearestOutfield(s, team, x, y, -1);
  s.phase = 'out'; s.timer = 60; s.restart = { team, idx, x, y };
  Object.assign(s.ball, { x, y, z: 0, vx: 0, vy: 0, vz: 0 });
  s.ownerTeam = s.ownerIdx = -1;
  say(s, label);
}

function rules(s: State) {
  const b = s.ball;
  if (b.x < 0 || b.x > W) return out(s, 1 - s.lastTouch, clamp(b.x, 0, W), clamp(b.y, 0, H), 'Aut');
  if (b.y >= 0 && b.y <= H) return;
  const end = b.y < 0 ? 1 : 0; // team defending this end
  if (Math.abs(b.x - W / 2) < GOAL_HALF && b.z < CROSSBAR) {
    s.score[1 - end]++;
    s.phase = 'goal'; s.timer = 150; s.kickoffTeam = end;
    s.ownerTeam = s.ownerIdx = -1;
    say(s, 'GOL!');
    return;
  }
  const gy = ownGoalY(end);
  if (s.lastTouch === end) out(s, 1 - end, b.x < W / 2 ? 0 : W, gy, 'Rzut rożny');
  else out(s, end, W / 2, gy + atk(end) * AREA_DEPTH, 'Od bramki', 0);
}
