// Deterministic match simulation. All state is plain integers (1 m = M units,
// 60 ticks/s) and step() is the only mutator, so the same setup, seed and per-tick
// input words replay the same match on any device. Lockstep multiplayer, replays
// and highlights rely on that contract; keep floats and wall-clock time out of here.

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

// Input word: bits 0-4 controls, 5-7 command, 8-15 and 16-23 command arguments.
export const UP = 1, DOWN = 2, LEFT = 4, RIGHT = 8, KICK = 16;
export const CMD_PAUSE = 1, CMD_SUB = 2, CMD_TACTIC = 3;
export const cmd = (c: number, a = 0, b = 0) => (c << 5) | (a << 8) | (b << 16);

export interface Skills { pos: number; pa: number; sh: number; he: number; ta: number; co: number; sp: number; gk: number }

// Formation slots: [x across 0..1000, depth from own goal 0..1000]. Slot 0 = keeper, slot 10 = striker.
export const FORMATIONS: { name: string; pos: number[][] }[] = [
  { name: '4-4-2', pos: [[500, 0], [150, 220], [380, 190], [620, 190], [850, 220], [150, 450], [380, 420], [620, 420], [850, 450], [380, 650], [620, 650]] },
  { name: '5-4-1', pos: [[500, 0], [100, 240], [300, 200], [500, 180], [700, 200], [900, 240], [150, 440], [380, 420], [620, 420], [850, 440], [500, 650]] },
  { name: '4-5-1', pos: [[500, 0], [150, 220], [380, 190], [620, 190], [850, 220], [100, 450], [300, 430], [500, 400], [700, 430], [900, 450], [500, 650]] },
  { name: '5-3-2', pos: [[500, 0], [100, 240], [300, 200], [500, 180], [700, 200], [900, 240], [250, 430], [500, 410], [750, 430], [380, 650], [620, 650]] },
  { name: '3-5-2', pos: [[500, 0], [250, 200], [500, 180], [750, 200], [100, 450], [300, 430], [500, 400], [700, 430], [900, 450], [380, 650], [620, 650]] },
  { name: '4-3-3', pos: [[500, 0], [150, 220], [380, 190], [620, 190], [850, 220], [250, 430], [500, 410], [750, 430], [200, 660], [800, 660], [500, 680]] },
  { name: '4-2-4', pos: [[500, 0], [150, 220], [380, 190], [620, 190], [850, 220], [380, 420], [620, 420], [100, 640], [900, 640], [380, 680], [620, 680]] },
  { name: '5-2-3', pos: [[500, 0], [100, 240], [300, 200], [500, 180], [700, 200], [900, 240], [380, 430], [620, 430], [200, 660], [800, 660], [500, 680]] },
  { name: 'Libero', pos: [[500, 0], [500, 120], [200, 240], [500, 250], [800, 240], [150, 450], [380, 420], [620, 420], [850, 450], [380, 650], [620, 650]] },
];
/** Line of a formation slot: 0 keeper, 1 defence, 2 midfield, 3 attack. */
export const lineOf = (slot: number[], i: number) => (i === 0 ? 0 : slot[1] < 330 ? 1 : slot[1] < 600 ? 2 : 3);

// Pitch surfaces: rolling friction (‰ kept per tick), bounce %, run speed %, grip % (velocity response).
export const PITCHES = [
  { name: 'Zamarznięta', roll: 993, bounce: 62, run: 96, grip: 22 },
  { name: 'Błotnista', roll: 972, bounce: 28, run: 86, grip: 70 },
  { name: 'Mokra', roll: 990, bounce: 40, run: 96, grip: 55 },
  { name: 'Miękka', roll: 981, bounce: 38, run: 95, grip: 90 },
  { name: 'Normalna', roll: 985, bounce: 45, run: 100, grip: 100 },
  { name: 'Sucha', roll: 987, bounce: 52, run: 100, grip: 100 },
  { name: 'Twarda', roll: 989, bounce: 60, run: 101, grip: 100 },
];

export interface TeamSetup { squad: Skills[]; lineup: number[]; tactics: number[][][]; tactic: number }
export interface MatchSetup {
  teams: TeamSetup[];
  minutes: number; // real minutes for 90 game minutes
  extraTime: boolean;
  penalties: boolean; // shootout when still level
  pitch: number;
  /** Second leg of a two-legged tie: first-leg goals per team (this match's order) and away-goals rule. */
  tie?: { agg: number[]; awayGoals: boolean };
}

export interface Player extends Skills {
  n: number; // squad index
  x: number; y: number;
  vx: number; vy: number; // wanted velocity
  ax: number; ay: number; // actual velocity (pitch grip blends towards wanted)
  fx: number; fy: number; // facing ×1000
  slide: number; down: number; cool: number;
  yel: number; off: number; // yellow cards, sent off
}
export interface Ball { x: number; y: number; z: number; vx: number; vy: number; vz: number }
export interface Goal { t: number; n: number; min: number; og: number; pen: number }
export type Phase = 'kickoff' | 'play' | 'out' | 'goal' | 'half' | 'shootout' | 'end';
export type RestartType = 'throw' | 'corner' | 'goalkick' | 'free' | 'penalty';

export interface State {
  frame: number;
  tick: number; // match clock, runs only in play
  rng: number;
  regTicks: number; extraTime: boolean; penalties: boolean; pitch: number;
  tie: { agg: number[]; awayGoals: boolean } | null;
  period: number; // 0,1 halves, 2,3 extra time, 4 shootout
  sides: number[]; // attack direction per team: -1 = towards y = 0
  firstKickoff: number;
  phase: Phase;
  timer: number;
  kickoffTeam: number;
  restart: { type: RestartType; team: number; idx: number; x: number; y: number } | null;
  pk: { team: number; idx: number; kicked: number; t: number } | null; // penalty in progress
  so: { goals: number[]; taken: number[]; turn: number; next: number[] } | null; // shootout
  score: number[];
  teams: Player[][];
  ball: Ball;
  ownerTeam: number; ownerIdx: number; // -1 = loose ball
  lastTouch: number; lastIdx: number;
  controlled: number[];
  prevInput: number[];
  hold: number[];
  keeperHold: number;
  paused: boolean;
  squads: Skills[][];
  bench: number[][];
  subsLeft: number[];
  tactics: number[][][][];
  tactic: number[];
  stats: { shots: number[]; onTarget: number[]; corners: number[]; fouls: number[]; yellow: number[]; red: number[]; poss: number[]; goals: Goal[] };
  /** Aftertouch window after a kick: the kicking team's stick bends or lifts the ball. */
  after: { team: number; ticks: number } | null;
  event: EventCode | '';
  eventFrame: number;
}
/** Language-neutral match events; the UI translates them. */
export type EventCode = 'goal' | 'miss' | 'save' | 'parry' | 'foul' | 'free' | 'penalty' | 'yellow' | 'red' | 'throw' | 'corner' | 'goalkick' | 'half' | 'et' | 'shootout' | 'end' | 'sub';

const div = (a: number, b: number) => Math.trunc(a / b);
const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
export const isqrt = (n: number) => Math.floor(Math.sqrt(n));
const dist2 = (p: { x: number; y: number }, x: number, y: number) => (p.x - x) ** 2 + (p.y - y) ** 2;
export const atk = (s: State, t: number) => s.sides[t];
export const ownGoalY = (s: State, t: number) => (s.sides[t] === -1 ? H : 0);
const GRAVITY = 3, REACH = 520, PASS_MAX_HOLD = 9, STRIKER = 10;
const AFTERTOUCH_TICKS = 24, CURVE = 22, LIFT = 3; // 0.4 s window; sideways bend ‰ of speed per tick; lift/dip per tick

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

const runSpeed = (s: State, p: Player) => div((88 + p.sp * 5) * PITCHES[s.pitch].run, 100);
const dribbleSpeed = (s: State, p: Player) => div(runSpeed(s, p) * (80 + p.co * 2), 100);

export function newMatch(seed: number, setup: MatchSetup): State {
  const s: State = {
    frame: 0, tick: 0, rng: seed >>> 0 || 1,
    regTicks: setup.minutes * 60 * TICK_HZ, extraTime: setup.extraTime, penalties: setup.penalties, pitch: setup.pitch,
    tie: setup.tie ?? null,
    period: 0, sides: [-1, 1], firstKickoff: 0, phase: 'kickoff', timer: 0, kickoffTeam: 0,
    restart: null, pk: null, so: null, score: [0, 0], teams: [],
    ball: { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 },
    ownerTeam: -1, ownerIdx: -1, lastTouch: 0, lastIdx: STRIKER, controlled: [STRIKER, STRIKER],
    prevInput: [0, 0], hold: [0, 0], keeperHold: 0, paused: false,
    squads: setup.teams.map((t) => t.squad.map((p) => ({ ...p }))),
    bench: setup.teams.map((t) => t.squad.map((_, i) => i).filter((i) => !t.lineup.includes(i))),
    subsLeft: [3, 3],
    tactics: setup.teams.map((t) => t.tactics),
    tactic: setup.teams.map((t) => t.tactic),
    stats: { shots: [0, 0], onTarget: [0, 0], corners: [0, 0], fouls: [0, 0], yellow: [0, 0], red: [0, 0], poss: [0, 0], goals: [] },
    after: null, event: '', eventFrame: 0,
  };
  s.teams = setup.teams.map((t, ti) => t.lineup.map((n) => ({
    ...s.squads[ti][n], n, x: 0, y: 0, vx: 0, vy: 0, ax: 0, ay: 0, fx: 0, fy: 0, slide: 0, down: 0, cool: 0, yel: 0, off: 0,
  })));
  s.firstKickoff = rnd(s, 2);
  startPeriod(s, 0);
  return s;
}

/** Game minute shown on the clock (90 regular, up to 120 with extra time). */
export function minute(s: State): number {
  const r = s.regTicks;
  return s.tick <= r ? Math.floor((s.tick * 90) / r) : 90 + Math.floor(((s.tick - r) * 90) / r);
}

export function step(s: State, inputs: readonly number[]): void {
  s.frame++;
  commands(s, inputs);
  if (!s.paused && s.phase !== 'end') {
    if (s.phase === 'play') live(s, inputs);
    else deadBall(s);
  }
  s.prevInput = [inputs[0] & 31, inputs[1] & 31];
}

function commands(s: State, inputs: readonly number[]) {
  for (let t = 0; t < 2; t++) {
    const w = inputs[t] | 0, c = (w >> 5) & 7, a = (w >> 8) & 255, b = (w >> 16) & 255;
    if (c === CMD_PAUSE) { s.paused = !s.paused; continue; }
    if (s.phase === 'end') continue;
    if (c === CMD_TACTIC && a < s.tactics[t].length) s.tactic[t] = a;
    if (c === CMD_SUB && a < 11 && s.subsLeft[t] > 0 && s.bench[t].includes(b) && !s.teams[t][a].off) {
      const p = s.teams[t][a];
      Object.assign(p, s.squads[t][b], { n: b, yel: 0, down: 0, slide: 0 });
      s.bench[t] = s.bench[t].filter((x) => x !== b);
      s.subsLeft[t]--;
      say(s, 'sub');
    }
  }
}

function say(s: State, text: EventCode) {
  s.event = text;
  s.eventFrame = s.frame;
}

const active = (p: Player) => !p.off;

function home(s: State, t: number, i: number): [number, number] {
  const [fx, fd] = s.tactics[t][s.tactic[t]][i];
  const b = s.ball, a = atk(s, t), goalY = ownGoalY(s, t);
  let d = fd, x = a === -1 ? fx : 1000 - fx;
  if (s.phase === 'kickoff') d = Math.min(div(fd * 55, 100), 400);
  else {
    const ballD = a === -1 ? div((H - b.y) * 1000, H) : div(b.y * 1000, H);
    d += div((ballD - 500) * 45, 100) + (s.ownerTeam === t ? 80 : -40);
    x += div((div(b.x * 1000, W) - 500) * 30, 100);
  }
  d = clamp(d, 30, 950);
  x = clamp(x, 40, 960);
  return [div(x * W, 1000), goalY + a * div(d * H, 1000)];
}

function steer(p: Player, tx: number, ty: number, max: number) {
  const dx = tx - p.x, dy = ty - p.y, d = isqrt(dx * dx + dy * dy);
  if (d < 160) { p.vx = p.vy = 0; return; }
  const v = Math.min(max, div(d, 5));
  p.vx = div(dx * v, d); p.vy = div(dy * v, d);
  p.fx = div(dx * 1000, d); p.fy = div(dy * 1000, d);
}

function startPeriod(s: State, period: number) {
  s.period = period;
  s.sides = period % 2 === 0 ? [-1, 1] : [1, -1];
  kickoff(s, period % 2 === 0 ? s.firstKickoff : 1 - s.firstKickoff);
}

function placeBall(s: State, x: number, y: number) {
  Object.assign(s.ball, { x, y, z: 0, vx: 0, vy: 0, vz: 0 });
  s.ownerTeam = s.ownerIdx = -1;
  s.after = null;
}

function kickoff(s: State, team: number) {
  s.phase = 'kickoff'; s.timer = 70; s.kickoffTeam = team; s.restart = null; s.pk = null;
  placeBall(s, W / 2, H / 2);
  s.hold = [0, 0]; s.keeperHold = 0;
  for (let t = 0; t < 2; t++) {
    s.teams[t].forEach((p, i) => {
      if (p.off) return;
      const [x, y] = home(s, t, i);
      Object.assign(p, { x, y, vx: 0, vy: 0, ax: 0, ay: 0, fx: 0, fy: atk(s, t) * 1000, slide: 0, down: 0, cool: 0 });
    });
  }
  const f = s.teams[team][STRIKER].off ? s.teams[team].find((p, i) => i > 0 && !p.off)! : s.teams[team][STRIKER];
  f.x = W / 2 - 300; f.y = H / 2 - atk(s, team) * 600;
  s.controlled = [STRIKER, STRIKER].map((c, t) => (s.teams[t][c].off ? s.teams[t].findIndex((p, i) => i > 0 && !p.off) : c));
}

function give(s: State, t: number, i: number) {
  s.ownerTeam = t; s.ownerIdx = i; s.lastTouch = t; s.lastIdx = i;
  s.after = null;
  if (i > 0) s.controlled[t] = i;
  else s.keeperHold = 0;
  dribble(s);
}

function movePlayers(s: State) {
  const grip = PITCHES[s.pitch].grip;
  for (const team of s.teams) {
    for (const p of team) {
      if (p.off) continue;
      // Slides and standing still are not affected by grip, so ice still lets you stop a slide.
      p.ax = p.slide || grip === 100 ? p.vx : p.ax + div((p.vx - p.ax) * grip, 100);
      p.ay = p.slide || grip === 100 ? p.vy : p.ay + div((p.vy - p.ay) * grip, 100);
      p.x = clamp(p.x + p.ax, -3 * M, W + 3 * M);
      p.y = clamp(p.y + p.ay, -3 * M, H + 3 * M);
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
    if (s.phase === 'shootout' || s.phase === 'kickoff') return;
    const r = s.restart, b = s.ball;
    for (let t = 0; t < 2; t++) {
      s.teams[t].forEach((p, i) => {
        if (p.off) return;
        if (r && r.team === t && r.idx === i) return steer(p, r.x, r.y, runSpeed(s, p));
        let [x, y] = home(s, t, i);
        if (r && r.type === 'penalty' && i > 0 && Math.abs(y - ownGoalY(s, 1 - r.team)) < BOX_DEPTH + M) {
          y = ownGoalY(s, 1 - r.team) + atk(s, 1 - r.team) * (BOX_DEPTH + 2 * M);
        }
        if (r && r.type === 'penalty' && i === 0 && t !== r.team) [x, y] = [W / 2, ownGoalY(s, t)];
        if (r && t !== r.team && r.type !== 'penalty' && dist2({ x, y }, b.x, b.y) < CIRCLE_R * CIRCLE_R) {
          const dx = x - b.x, dy = y - b.y, d = isqrt(dx * dx + dy * dy) || 1;
          x = b.x + div(dx * CIRCLE_R, d); y = b.y + div(dy * CIRCLE_R, d);
        }
        steer(p, x, y, runSpeed(s, p));
      });
    }
    movePlayers(s);
    return;
  }
  switch (s.phase) {
    case 'kickoff':
      s.phase = 'play';
      give(s, s.kickoffTeam, s.controlled[s.kickoffTeam]);
      break;
    case 'out': {
      const r = s.restart!;
      const p = s.teams[r.team][r.idx];
      const gx = W / 2, gy = r.type === 'penalty' ? ownGoalY(s, 1 - r.team) : H / 2;
      const dx = gx - r.x, dy = gy - r.y, d = isqrt(dx * dx + dy * dy) || 1;
      Object.assign(p, { x: r.x - div(dx * 360, d), y: r.y - div(dy * 360, d), vx: 0, vy: 0, ax: 0, ay: 0, fx: div(dx * 1000, d), fy: div(dy * 1000, d) });
      if (r.type === 'penalty') {
        s.pk = { team: r.team, idx: r.idx, kicked: 0, t: 0 };
        Object.assign(s.teams[1 - r.team][0], { x: W / 2, y: ownGoalY(s, 1 - r.team), vx: 0, vy: 0 });
      }
      s.restart = null; s.phase = 'play';
      give(s, r.team, r.idx);
      break;
    }
    case 'goal':
      if (s.period === 4) nextPenalty(s);
      else kickoff(s, s.kickoffTeam);
      break;
    case 'half':
      if (s.period < 3) startPeriod(s, s.period + 1);
      else startShootout(s);
      break;
    case 'shootout':
      s.phase = 'play';
      break;
  }
}

function pickControlled(s: State, t: number) {
  if (s.pk) {
    s.controlled[t] = s.pk.team === t ? s.pk.idx : s.controlled[t];
    return;
  }
  if (s.ownerTeam === t) {
    if (s.ownerIdx > 0) s.controlled[t] = s.ownerIdx;
    return;
  }
  const cur = s.teams[t][s.controlled[t]];
  if (cur.slide > 0 && !cur.off) return;
  const b = s.ball, px = b.x + b.vx * 8, py = b.y + b.vy * 8;
  let best = s.controlled[t], bd = cur.off ? Infinity : dist2(cur, px, py);
  for (let i = 1; i < 11; i++) {
    const p = s.teams[t][i], d = dist2(p, px, py);
    if (active(p) && !p.down && d < bd) { bd = d; best = i; }
  }
  if (cur.off || cur.down || isqrt(bd) + 3 * M < isqrt(dist2(cur, px, py))) s.controlled[t] = best;
}

function nearestOutfield(s: State, t: number, x: number, y: number, skip: number): number {
  let best = -1, bd = Infinity;
  for (let i = 1; i < 11; i++) {
    const p = s.teams[t][i], d = dist2(p, x, y);
    if (i !== skip && active(p) && d < bd) { bd = d; best = i; }
  }
  return best;
}

function live(s: State, inputs: readonly number[]) {
  const b = s.ball;
  pickControlled(s, 0);
  pickControlled(s, 1);
  for (let t = 0; t < 2; t++) {
    // Without the ball, the second-nearest player presses too.
    const helper = s.ownerTeam === t || s.pk ? -1 : nearestOutfield(s, t, b.x, b.y, s.controlled[t]);
    s.teams[t].forEach((p, i) => {
      if (p.off) return;
      if (p.cool > 0) p.cool--;
      // During a penalty only the taker and the defending keeper move (in a shootout, until it is resolved).
      const pkActor = s.pk && ((t === s.pk.team && i === s.pk.idx) || (i === 0 && t !== s.pk.team));
      const frozen = s.pk && !pkActor && (!s.pk.kicked || s.period === 4);
      if (p.slide > 0) {
        if (--p.slide === 0) { p.down = 24; p.vx = p.vy = 0; }
      } else if (p.down > 0) {
        p.down--; p.vx = p.vy = 0;
      } else if (frozen) {
        p.vx = p.vy = 0;
      } else if (i === 0) keeper(s, t);
      else if (i === s.controlled[t]) control(s, t, p, inputs[t] | 0);
      else if (i === helper) steer(p, b.x, b.y, div(runSpeed(s, p) * 9, 10));
      else { const [x, y] = home(s, t, i); steer(p, x, y, div(runSpeed(s, p) * 85, 100)); }
    });
  }
  movePlayers(s);
  if (s.ownerTeam >= 0) dribble(s);
  else { aftertouch(s, inputs); freeBall(s); }
  contest(s);
  if (s.ownerTeam >= 0) s.stats.poss[s.ownerTeam]++;
  if (s.pk && s.pk.kicked) s.pk.t++;
  rules(s);
  if (s.phase !== 'play' || s.period === 4) return;
  s.tick++;
  const r = s.regTicks, ends = [r >> 1, r, r + div(r, 6), r + div(r, 3)];
  if (s.tick >= ends[s.period]) endPeriod(s);
}

/** Level after this match, counting a two-legged tie's aggregate and away goals. */
export function level(s: State): boolean {
  const agg = s.tie?.agg ?? [0, 0], a = s.score[0] + agg[0], b = s.score[1] + agg[1];
  if (a !== b) return false;
  // Team 1 is away in this leg, team 0 was away in the first leg (its first-leg goals are agg[0]).
  return !s.tie?.awayGoals || agg[0] === s.score[1];
}

function endPeriod(s: State) {
  const tied = level(s);
  placeBall(s, W / 2, H / 2);
  if (s.period === 0 || s.period === 2) { s.phase = 'half'; s.timer = 180; say(s, 'half'); return; }
  if (s.period === 1 && tied && s.extraTime) { s.phase = 'half'; s.timer = 180; say(s, 'et'); return; }
  if (tied && s.penalties) { s.period = 3; s.phase = 'half'; s.timer = 180; say(s, 'shootout'); return; }
  s.phase = 'end';
  say(s, 'end');
}

function startShootout(s: State) {
  s.period = 4;
  s.so = { goals: [0, 0], taken: [0, 0], turn: rnd(s, 2), next: [STRIKER, STRIKER] };
  setupPenalty(s);
}

function setupPenalty(s: State) {
  const so = s.so!, t = so.turn;
  s.sides = t === 0 ? [-1, 1] : [1, -1]; // shooter always attacks the goal at y = 0
  while (s.teams[t][so.next[t]].off || so.next[t] === 0) so.next[t] = so.next[t] <= 1 ? STRIKER : so.next[t] - 1;
  const idx = so.next[t];
  so.next[t] = idx <= 1 ? STRIKER : idx - 1;
  for (let tt = 0; tt < 2; tt++) {
    s.teams[tt].forEach((p, i) => {
      if (p.off) return;
      Object.assign(p, { x: W / 2 - 6 * M + i * M + tt * 400, y: H / 2 - tt * 2 * M, vx: 0, vy: 0, ax: 0, ay: 0, fx: 0, fy: -1000, slide: 0, down: 0, cool: 0 });
    });
  }
  Object.assign(s.teams[1 - t][0], { x: W / 2, y: 0, fy: 1000 });
  const p = s.teams[t][idx];
  Object.assign(p, { x: W / 2, y: PEN_SPOT + 360 });
  placeBall(s, W / 2, PEN_SPOT);
  s.pk = { team: t, idx, kicked: 0, t: 0 };
  s.controlled[t] = idx;
  s.phase = 'shootout'; s.timer = 60;
  give(s, t, idx);
}

function penaltyResult(s: State, scored: boolean) {
  const so = s.so!, t = so.turn;
  so.taken[t]++;
  if (scored) so.goals[t]++;
  s.phase = 'goal'; s.timer = 90; s.pk = null;
  say(s, scored ? 'goal' : 'miss');
}

function nextPenalty(s: State) {
  const so = s.so!, [g0, g1] = so.goals, [k0, k1] = so.taken;
  const left0 = Math.max(0, 5 - k0), left1 = Math.max(0, 5 - k1);
  const decided = k0 >= 5 && k1 >= 5 ? k0 === k1 && g0 !== g1 : g0 + left0 < g1 || g1 + left1 < g0;
  if (decided) { s.phase = 'end'; say(s, 'end'); return; }
  so.turn = 1 - so.turn;
  setupPenalty(s);
}

function control(s: State, t: number, p: Player, inp: number) {
  const prev = s.prevInput[t];
  const own = s.ownerTeam === t && s.ownerIdx === s.controlled[t];
  const [dx, dy] = dirVec(inp);
  const locked = s.pk && !s.pk.kicked; // penalty taker only aims
  if ((dx || dy) && !locked) {
    const v = own ? dribbleSpeed(s, p) : runSpeed(s, p);
    p.fx = dx; p.fy = dy; p.vx = div(dx * v, 1000); p.vy = div(dy * v, 1000);
  } else {
    if (dx || dy) { p.fx = dx; p.fy = dy; }
    p.vx = p.vy = 0;
  }
  if (inp & KICK) {
    s.hold[t]++;
    if (!(prev & KICK) && !own && s.ownerTeam !== t && !s.pk) {
      p.slide = 18; p.vx = div(p.fx * 190, 1000); p.vy = div(p.fy * 190, 1000);
    }
  } else {
    if (prev & KICK && own) kick(s, t, p, locked ? Math.max(s.hold[t], PASS_MAX_HOLD) : s.hold[t]);
    s.hold[t] = 0;
  }
}

function passTarget(s: State, t: number, p: Player): Player | null {
  let best: Player | null = null, bestCos = 820; // within ~35° of facing
  for (const q of s.teams[t]) {
    if (q === p || q.off) continue;
    const dx = q.x - p.x, dy = q.y - p.y, d = isqrt(dx * dx + dy * dy);
    if (d < 4 * M || d > 40 * M) continue;
    const c = div(dx * p.fx + dy * p.fy, d);
    if (c > bestCos) { bestCos = c; best = q; }
  }
  return best;
}

/** Aim point inside the goal p's team attacks, or null when not facing it in range. */
function goalAim(s: State, t: number, p: Player, from: { x: number; y: number }, skill: number): [number, number] | null {
  const gy = atk(s, t) === -1 ? 0 : H, tx = W / 2 - from.x, ty = gy - from.y, d = isqrt(tx * tx + ty * ty);
  if (d > 38 * M || tx * p.fx + ty * p.fy <= 770 * d) return null;
  const side = p.fx > 300 ? 1 : p.fx < -300 ? -1 : 0;
  const spread = div(GOAL_HALF * (16 - skill), 10);
  return [W / 2 + side * div(GOAL_HALF * 7, 10) + rnd(s, spread + 1) - div(spread, 2), gy];
}

function kick(s: State, t: number, p: Player, hold: number) {
  const b = s.ball;
  let dx = p.fx, dy = p.fy, speed: number, vz = 0;
  if (hold < PASS_MAX_HOLD) {
    const q = passTarget(s, t, p);
    if (q) {
      const e = (9 - p.pa) * 90;
      dx = q.x + q.ax * 20 - b.x + rnd(s, 2 * e + 1) - e; dy = q.y + q.ay * 20 - b.y + rnd(s, 2 * e + 1) - e;
      speed = clamp(div(isqrt(dx * dx + dy * dy) * 16, 1000) + 60, 160, 430);
    } else speed = 280;
  } else {
    const h = Math.min(hold, 40);
    speed = 320 + (h - PASS_MAX_HOLD) * 7 + p.sh * 5;
    vz = Math.max(0, (h - 16) * 6);
    const aim = goalAim(s, t, p, b, p.sh);
    if (aim) { dx = aim[0] - b.x; dy = aim[1] - b.y; s.stats.shots[t]++; }
  }
  const len = isqrt(dx * dx + dy * dy) || 1;
  b.vx = div(dx * speed, len); b.vy = div(dy * speed, len); b.vz = vz;
  s.ownerTeam = s.ownerIdx = -1; s.lastTouch = t; s.lastIdx = s.teams[t].indexOf(p); p.cool = 14;
  s.after = { team: t, ticks: AFTERTOUCH_TICKS };
  if (s.pk) s.pk.kicked = 1;
}

/**
 * Aftertouch: for a moment after a kick the kicker's stick bends the ball. Sideways
 * (relative to its flight) curves it, back lifts it, forward keeps it low. Speed is kept.
 */
function aftertouch(s: State, inputs: readonly number[]) {
  const a = s.after, b = s.ball;
  if (!a || a.ticks <= 0 || s.lastTouch !== a.team) { s.after = null; return; }
  a.ticks--;
  const [dx, dy] = dirVec(inputs[a.team] | 0);
  const speed = isqrt(b.vx * b.vx + b.vy * b.vy);
  if ((!dx && !dy) || speed < 60) return;
  const side = div(-dx * b.vy + dy * b.vx, speed); // stick across the flight (×1000); the ball bends towards the stick
  const along = div(dx * b.vx + dy * b.vy, speed); // input along the flight, ×1000
  if (Math.abs(side) > 300) {
    const k = div(side * CURVE, 1000); // ‰ of speed added sideways this tick
    const nvx = b.vx + div(-b.vy * k, 1000), nvy = b.vy + div(b.vx * k, 1000);
    const nl = isqrt(nvx * nvx + nvy * nvy) || 1;
    b.vx = div(nvx * speed, nl); b.vy = div(nvy * speed, nl);
  }
  if (along < -500 && b.vz >= -GRAVITY) b.vz += LIFT; // pull back: lift
  if (along > 500 && b.z > 0) b.vz -= LIFT; // push forward: dip
}

function dribble(s: State) {
  const p = s.teams[s.ownerTeam][s.ownerIdx], b = s.ball;
  b.x = p.x + div(p.fx * 360, 1000); b.y = p.y + div(p.fy * 360, 1000);
  b.z = 0; b.vx = p.ax; b.vy = p.ay; b.vz = 0;
}

function freeBall(s: State) {
  const b = s.ball, pitch = PITCHES[s.pitch];
  b.x += b.vx; b.y += b.vy; b.z += b.vz;
  if (b.z > 0) {
    b.vz -= GRAVITY;
    b.vx = div(b.vx * 998, 1000); b.vy = div(b.vy * 998, 1000);
    return;
  }
  b.z = 0;
  if (b.vz < 0) {
    b.vz = -div(b.vz * pitch.bounce, 100);
    if (b.vz < 8) b.vz = 0;
  }
  if (b.vz === 0) { b.vx = div(b.vx * pitch.roll, 1000); b.vy = div(b.vy * pitch.roll, 1000); }
}

function keeper(s: State, t: number) {
  const k = s.teams[t][0], b = s.ball, gy = ownGoalY(s, t), a = atk(s, t);
  if (s.ownerTeam === t && s.ownerIdx === 0) {
    k.vx = k.vy = 0; k.fx = 0; k.fy = a * 1000;
    if (++s.keeperHold > 55) {
      const outfield = s.teams[t].filter((q, i) => i > 0 && !q.off && s.tactics[t][s.tactic[t]][i][1] >= 400);
      const q = outfield.length ? outfield[rnd(s, outfield.length)] : s.teams[t][1];
      const dx = q.x - k.x, dy = q.y - k.y, d = isqrt(dx * dx + dy * dy) || 1;
      b.vx = div(dx * 430, d); b.vy = div(dy * 430, d); b.vz = 95;
      s.ownerTeam = s.ownerIdx = -1; s.lastTouch = t; s.lastIdx = 0; k.cool = 40; s.keeperHold = 0;
    }
    return;
  }
  if (s.pk && !s.pk.kicked) { k.vx = k.vy = 0; return; } // stays on the line until the kick
  const dist = Math.abs(b.y - gy);
  let tx = clamp(b.x, W / 2 - GOAL_HALF, W / 2 + GOAL_HALF), ty = gy + a * M;
  if (s.pk) ty = gy;
  else if (dist < BOX_DEPTH && Math.abs(b.x - W / 2) < BOX_HALF) {
    tx = clamp(b.x, W / 2 - AREA_HALF, W / 2 + AREA_HALF);
    ty = gy + a * Math.max(M, Math.min(div(dist * 45, 100), 6 * M));
  }
  steer(k, tx, ty, runSpeed(s, k));
}

function keeperSave(s: State, t: number) {
  const k = s.teams[t][0], b = s.ball, gy = ownGoalY(s, t);
  if (k.off || k.cool || s.ownerTeam === t || k.down) return;
  if (Math.abs(b.y - gy) > BOX_DEPTH || Math.abs(b.x - W / 2) > BOX_HALF) return;
  const d2 = dist2(k, b.x, b.y);
  if (d2 > 1300 * 1300 || b.z > CROSSBAR + 200) return;
  if (s.ownerTeam >= 0 && d2 > 600 * 600) return; // only snatch from a dribbler up close
  const speed = isqrt(b.vx * b.vx + b.vy * b.vy);
  const towardGoal = (gy === 0 ? -b.vy : b.vy) > 150;
  if (rnd(s, 100) >= clamp(130 - div(speed, 4) + (k.gk - 5) * 6, 15, 97)) { k.cool = 30; return; } // beaten
  if (towardGoal) onTarget(s, 1 - t);
  if (speed > 330) {
    b.vy = -div(b.vy * 4, 10); b.vx = div(b.vx * 6, 10) + rnd(s, 161) - 80; b.vz = 45;
    s.ownerTeam = s.ownerIdx = -1; s.lastTouch = t; s.lastIdx = 0; k.cool = 24;
    say(s, 'parry');
    return;
  }
  if (speed > 200) say(s, 'save');
  give(s, t, 0);
}

/** A save or a goal is an attempt on target even when it was not struck as a shot (a cross, a deflection). */
function onTarget(s: State, t: number) {
  s.stats.onTarget[t]++;
  s.stats.shots[t] = Math.max(s.stats.shots[t], s.stats.onTarget[t]);
}

function foul(s: State, t: number, slider: Player, victim: Player) {
  const f = 1 - t, b = s.ball;
  s.stats.fouls[t]++;
  victim.down = 45;
  const r = rnd(s, 100);
  if (r < 6 || (r < 28 && slider.yel > 0)) {
    if (r >= 6) s.stats.yellow[t]++;
    s.stats.red[t]++;
    slider.off = 1; slider.x = -4 * M; slider.vx = slider.vy = slider.ax = slider.ay = 0; slider.slide = 0;
    say(s, 'red');
  } else if (r < 28) {
    slider.yel++; s.stats.yellow[t]++;
    say(s, 'yellow');
  } else say(s, 'foul');
  const gy = ownGoalY(s, t);
  const inBox = Math.abs(b.x - W / 2) < BOX_HALF && Math.abs(b.y - gy) < BOX_DEPTH;
  const x = clamp(b.x, M, W - M), y = clamp(b.y, M, H - M);
  if (inBox) out(s, f, 'penalty', W / 2, gy + atk(s, t) * PEN_SPOT, 'penalty');
  else out(s, f, 'free', x, y, s.event === 'foul' || !s.event ? 'free' : s.event);
}

function contest(s: State) {
  const b = s.ball;
  keeperSave(s, 0);
  keeperSave(s, 1);
  const keeperHasBall = s.ownerIdx === 0;
  for (let t = 0; t < 2 && s.phase === 'play'; t++) {
    for (let i = 1; i < 11; i++) {
      const p = s.teams[t][i];
      if (!p.slide || p.off || s.ownerTeam === t || keeperHasBall) continue;
      const nearBall = b.z < 600 && dist2(p, b.x, b.y) < 650 * 650;
      const o = s.ownerTeam >= 0 ? s.teams[s.ownerTeam][s.ownerIdx] : null;
      if (o && !nearBall && dist2(p, o.x, o.y) < 500 * 500) { foul(s, t, p, o); return; }
      if (!nearBall) continue;
      if (o && rnd(s, 100) < 30 - p.ta * 3) { foul(s, t, p, o); return; } // mistimed
      if (o) o.down = 30;
      s.ownerTeam = s.ownerIdx = -1;
      b.vx = div(p.fx * 260, 1000); b.vy = div(p.fy * 260, 1000); b.vz = 20;
      s.lastTouch = t; s.lastIdx = i; p.cool = 10;
    }
  }
  if (s.ownerTeam >= 0 && !keeperHasBall && !s.pk) {
    const o = 1 - s.ownerTeam, owner = s.teams[s.ownerTeam][s.ownerIdx];
    for (let i = 1; i < 11; i++) {
      const q = s.teams[o][i];
      if (q.off || q.down || q.slide || dist2(q, b.x, b.y) > 420 * 420 || rnd(s, 1000) >= 40 + q.ta * 4 - owner.co * 3) continue;
      owner.cool = 25;
      give(s, o, i);
      break;
    }
  }
  if (s.ownerTeam < 0 && b.z >= 900 && b.z <= 2600 && !s.pk) header(s);
  if (s.ownerTeam < 0 && b.z < 800 && !(s.pk && s.period === 4)) {
    let bt = -1, bi = -1, bd = REACH * REACH;
    for (let t = 0; t < 2; t++) {
      for (let i = 1; i < 11; i++) {
        const p = s.teams[t][i], d = dist2(p, b.x, b.y);
        if (active(p) && !p.down && !p.slide && !p.cool && d < bd) { bd = d; bt = t; bi = i; }
      }
    }
    if (bt >= 0) give(s, bt, bi);
  }
}

function header(s: State) {
  const b = s.ball;
  let bt = -1, bi = -1, bd = 600 * 600;
  for (let t = 0; t < 2; t++) {
    for (let i = 1; i < 11; i++) {
      const p = s.teams[t][i], d = dist2(p, b.x, b.y);
      if (active(p) && !p.down && !p.slide && !p.cool && d < bd) { bd = d; bt = t; bi = i; }
    }
  }
  if (bt < 0) return;
  const p = s.teams[bt][bi];
  let dx = bi === s.controlled[bt] ? p.fx : 0, dy = bi === s.controlled[bt] ? p.fy : atk(s, bt) * 1000;
  const aim = goalAim(s, bt, { ...p, fx: dx || 0, fy: dy }, b, p.he);
  if (aim) { dx = aim[0] - b.x; dy = aim[1] - b.y; s.stats.shots[bt]++; }
  const len = isqrt(dx * dx + dy * dy) || 1, speed = 180 + p.he * 20;
  b.vx = div(dx * speed, len); b.vy = div(dy * speed, len); b.vz = 25;
  s.lastTouch = bt; s.lastIdx = bi; p.cool = 14;
}

function out(s: State, team: number, type: RestartType, x: number, y: number, label: EventCode, idx = -1) {
  if (idx < 0) idx = nearestOutfield(s, team, x, y, -1);
  s.phase = 'out'; s.timer = type === 'penalty' ? 90 : 60; s.restart = { type, team, idx, x, y };
  placeBall(s, x, y);
  say(s, label);
}

function rules(s: State) {
  const b = s.ball;
  if (s.period === 4 && s.pk) {
    const inGoal = b.y < 0 && Math.abs(b.x - W / 2) < GOAL_HALF && b.z < CROSSBAR;
    const stopped = s.pk.kicked && (s.pk.t > 200 || (b.vx === 0 && b.vy === 0 && b.vz === 0) || s.ownerIdx === 0);
    if (inGoal) penaltyResult(s, true);
    else if (b.y < 0 || b.x < 0 || b.x > W || stopped) penaltyResult(s, false);
    return;
  }
  if (s.pk && s.pk.kicked && s.pk.t > 30) s.pk = null; // penalty taken: play on
  if (b.x < 0 || b.x > W) return out(s, 1 - s.lastTouch, 'throw', clamp(b.x, 0, W), clamp(b.y, 0, H), 'throw');
  if (b.y >= 0 && b.y <= H) return;
  const end = b.y < 0 ? (s.sides[0] === -1 ? 1 : 0) : s.sides[0] === -1 ? 0 : 1; // team defending this end
  if (Math.abs(b.x - W / 2) < GOAL_HALF && b.z < CROSSBAR) {
    const scorer = 1 - end, scorerPlayer = s.teams[s.lastTouch][s.lastIdx];
    s.score[scorer]++;
    onTarget(s, scorer);
    s.stats.goals.push({ t: scorer, n: scorerPlayer ? scorerPlayer.n : 0, min: Math.max(1, minute(s)), og: s.lastTouch === end ? 1 : 0, pen: s.pk ? 1 : 0 });
    s.phase = 'goal'; s.timer = 150; s.kickoffTeam = end; s.pk = null;
    s.ownerTeam = s.ownerIdx = -1;
    say(s, 'goal');
    return;
  }
  const gy = ownGoalY(s, end);
  if (s.lastTouch === end) { s.stats.corners[1 - end]++; out(s, 1 - end, 'corner', b.x < W / 2 ? 0 : W, gy, 'corner'); }
  else out(s, end, 'goalkick', W / 2, gy + atk(s, end) * AREA_DEPTH, 'goalkick', 0);
}
