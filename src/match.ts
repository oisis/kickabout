// Runs one match: feeds the simulation (local players, CPU or the lockstep
// server), records inputs for replays and highlights, and derives sounds from
// state changes so the simulation itself stays pure.
import { newMatch, step, minute, TICK_HZ, CMD_PAUSE, cmd, isqrt, H, type State, type MatchSetup } from './sim.ts';
import { type TeamDef, kitsFor, teamSetup } from './data.ts';
import { type Options, customTactics } from './store.ts';
import { cpuInput } from './ai.ts';
import type { Controls } from './input.ts';
import type { Net } from './net.ts';
import type { Highlight, MatchInfo } from './store.ts';
import * as sfx from './audio.ts';
import { t } from './i18n.ts';

const DT = 1000 / TICK_HZ;
const SNAP_EVERY = 60, KEEP_SNAPS = 15, REPLAY_BEFORE = 360, REPLAY_AFTER = 90;

export interface MatchSpec {
  setup: MatchSetup;
  info: MatchInfo;
  seed: number;
  humans: number[]; // per team: 0 computer, 1 player one, 2 player two
  manage?: number[]; // teams whose tactics and substitutions the user controls without playing (career coach)
  net?: Net;
  autoReplay: boolean;
}

export class MatchRun {
  s: State;
  replay: { s: State; inputs: number[][]; i: number; title: string } | null = null;
  highlights: Highlight[] = [];
  private acc = 0;
  private queued = [0, 0];
  private snaps: State[] = [];
  private log: number[][] = []; // inputs by frame, trimmed to the replay window
  private logStart = 0;
  private pendingGoal = -1;
  private lastEvent = 0;
  private wasPhase = '';

  spec: MatchSpec;
  private controls: Controls;

  constructor(spec: MatchSpec, controls: Controls) {
    this.spec = spec;
    this.controls = controls;
    this.s = newMatch(spec.seed, spec.setup);
    this.wasPhase = this.s.phase;
  }

  get info(): MatchInfo { return this.spec.info; }
  /** Team the local touch/keyboard player one controls (for HUD and pause). */
  get me(): number {
    const { net, humans, manage } = this.spec;
    return net ? net.side : humans.includes(1) ? humans.indexOf(1) : manage?.[0] ?? 0;
  }

  /** Queue a command (pause, substitution, tactic) for a team; sent with its next input word. */
  command(team: number, word: number) { this.queued[team] |= word; }
  togglePause() { this.command(this.spec.net ? this.spec.net.side : this.me, cmd(CMD_PAUSE)); }

  private take(t: number) { const w = this.queued[t]; this.queued[t] = 0; return w; }

  update(dt: number) {
    this.acc += Math.min(dt, 250);
    if (this.replay) return this.stepReplay();
    const net = this.spec.net;
    if (net) return this.online(net);
    for (; this.acc >= DT; this.acc -= DT) {
      const inputs = [0, 1].map((t) => {
        const h = this.spec.humans[t];
        // A paused game still needs the unpause command from the CPU side's queue.
        return (h ? this.controls.bits(h - 1) : this.s.paused ? 0 : cpuInput(this.s, t)) | this.take(t);
      });
      this.advance(inputs);
      if (this.replay) break;
    }
  }

  private online(net: Net) {
    // Step only on frames the server delivered; run extra steps if we fell behind.
    while (net.frames.has(this.s.frame) && (this.acc >= DT || net.frames.size > net.delay + 2)) {
      const k = this.s.frame;
      this.advance(net.frames.get(k)!);
      net.frames.delete(k);
      net.input(k + net.delay, this.controls.bits(0) | this.take(net.side));
      if (k % 120 === 0) net.check(k, this.s);
      this.acc = Math.max(0, this.acc - DT);
    }
    this.acc = Math.min(this.acc, 2 * DT);
  }

  private advance(inputs: number[]) {
    const s = this.s, before = { speed: isqrt(s.ball.vx ** 2 + s.ball.vy ** 2), owner: s.ownerTeam };
    if (s.frame % SNAP_EVERY === 0) {
      this.snaps.push(structuredClone(s));
      if (this.snaps.length > KEEP_SNAPS) this.snaps.shift();
      const keepFrom = this.snaps[0].frame;
      this.log.splice(0, keepFrom - this.logStart);
      this.logStart = keepFrom;
    }
    this.log.push(inputs);
    step(s, inputs);
    this.sounds(before);
    if (s.event === 'goal' && s.eventFrame === s.frame && s.period < 4) this.pendingGoal = s.frame;
    if (this.pendingGoal >= 0 && s.frame >= this.pendingGoal + REPLAY_AFTER) {
      const g = s.stats.goals[s.stats.goals.length - 1];
      const who = g ? this.info.players[g.og ? 1 - g.t : g.t]?.[g.n] ?? '' : '';
      const h = this.clip(this.pendingGoal - REPLAY_BEFORE, `${this.info.shorts[0]} ${s.score[0]}:${s.score[1]} ${this.info.shorts[1]} — ${g?.min ?? minute(s)}' ${who}${g?.og ? ` (${t('sam.')})` : ''}`);
      this.pendingGoal = -1;
      if (h) {
        this.highlights.push(h);
        if (this.spec.autoReplay && !this.spec.net) this.play(h);
      }
    }
  }

  /** Highlight from `from` frame up to now, starting at the nearest earlier snapshot. */
  clip(from: number, title: string): Highlight | null {
    const start = [...this.snaps].reverse().find((x) => x.frame <= from) ?? this.snaps[0];
    if (!start) return null;
    return { info: this.info, title, start: structuredClone(start), inputs: this.log.slice(start.frame - this.logStart) };
  }

  play(h: Highlight) {
    this.replay = { s: structuredClone(h.start), inputs: h.inputs, i: 0, title: h.title };
  }

  stopReplay() { this.replay = null; }

  private stepReplay() {
    const r = this.replay!;
    for (; this.acc >= DT; this.acc -= DT) {
      do step(r.s, r.inputs[r.i++] ?? [0, 0]); while (r.s.paused && r.i < r.inputs.length);
      if (r.i >= r.inputs.length) { this.replay = null; this.acc = 0; return; }
    }
  }

  private sounds(before: { speed: number; owner: number }) {
    const s = this.s, b = s.ball, speed = isqrt(b.vx ** 2 + b.vy ** 2);
    if (s.ownerTeam < 0 && speed > before.speed + 80) sfx.kick(Math.min(1, speed / 500));
    if (this.wasPhase === 'kickoff' && s.phase === 'play') sfx.whistle(1);
    this.wasPhase = s.phase;
    if (s.eventFrame === s.frame && s.eventFrame !== this.lastEvent) {
      this.lastEvent = s.eventFrame;
      const e = s.event;
      if (e === 'goal') { sfx.cheer(); if (s.period < 4) sfx.whistle(1); }
      else if (e === 'half' || e === 'et' || e === 'shootout') sfx.whistle(2);
      else if (e === 'end') sfx.whistle(3);
      else if (e === 'foul' || e === 'yellow' || e === 'red' || e === 'penalty' || e === 'free') sfx.whistle(1);
      else if (e === 'parry' || e === 'save' || e === 'miss') sfx.groan();
    }
    if (s.frame % 15 === 0) sfx.crowdLevel(s.phase === 'play' ? Math.max(0, 1 - Math.min(b.y, H - b.y) / (35 * 1024)) : 0.2);
  }
}

export interface Side { team: TeamDef; human: number; tactic?: number; lineup?: number[] }
export interface Rules { minutes?: number; extraTime?: boolean; penalties?: boolean; month?: number }

const SEASONAL = [[0, 1, 2], [0, 1, 2], [2, 3, 4], [3, 4, 2], [4, 3, 5], [5, 6, 4], [5, 6, 4], [6, 5, 4], [4, 3, 2], [2, 3, 1], [1, 2, 3], [0, 1, 2]];
/** Concrete surface for an options value (7 = random, 8 = by month). */
export function choosePitch(pitch: number, month = new Date().getMonth()): number {
  if (pitch < 7) return pitch;
  if (pitch === 7) return Math.floor(Math.random() * 7);
  const c = SEASONAL[month];
  return c[Math.floor(Math.random() * c.length)];
}

export function makeSpec(home: Side, away: Side, o: Options, rules: Rules = {}, seed = (Math.random() * 2 ** 32) >>> 0 || 1): MatchSpec {
  const custom = customTactics().map((c) => c.pos);
  const sides = [home, away];
  const kits = kitsFor(home.team, away.team);
  return {
    seed,
    humans: sides.map((x) => x.human),
    autoReplay: o.autoReplay,
    setup: {
      teams: sides.map((x) => teamSetup(x.team, { tactic: x.tactic, lineup: x.lineup, custom })),
      minutes: rules.minutes ?? o.minutes,
      extraTime: rules.extraTime ?? o.extraTime,
      penalties: rules.penalties ?? o.penalties,
      pitch: choosePitch(o.pitch, rules.month),
    },
    info: {
      names: sides.map((x) => x.team.name),
      shorts: sides.map((x) => x.team.short),
      kits,
      keepers: sides.map((x) => x.team.keeper),
      players: sides.map((x) => x.team.players.map((p) => p.name)),
    },
  };
}
