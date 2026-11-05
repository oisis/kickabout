import test from 'node:test';
import assert from 'node:assert/strict';
import { newMatch, step, cmd, W, M, CMD_PAUSE, CMD_SUB, type State, type MatchSetup } from '../src/sim.ts';
import { cpuInput } from '../src/ai.ts';
import { TEAMS, teamSetup } from '../src/data.ts';

const setup = (o: Partial<MatchSetup> = {}): MatchSetup => ({
  teams: [teamSetup(TEAMS[0]), teamSetup(TEAMS[1])], minutes: 2, extraTime: false, penalties: false, pitch: 4, ...o,
});

function play(seed: number, o: Partial<MatchSetup> = {}, frames = Infinity): State {
  const s = newMatch(seed, setup(o));
  for (let i = 0; i < frames && s.phase !== 'end'; i++) step(s, [cpuInput(s, 0), cpuInput(s, 1)]);
  return s;
}

function assertIntegers(v: unknown, path = 'state'): void {
  if (typeof v === 'number') assert.ok(Number.isInteger(v), `${path} = ${v}`);
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) assertIntegers(x, `${path}.${k}`);
}

test('same seed and inputs replay the same match (lockstep contract)', () => {
  assert.deepEqual(play(42, {}, 4000), play(42, {}, 4000));
});

test('CPU vs CPU reaches full time on every pitch with integer-only state', (t) => {
  for (let pitch = 0; pitch < 7; pitch++) {
    const s = play(7 + pitch, { pitch });
    assert.equal(s.phase, 'end');
    assertIntegers(s);
    t.diagnostic(`pitch ${pitch}: ${s.score.join(':')} shots ${s.stats.shots} fouls ${s.stats.fouls} cards ${s.stats.yellow}/${s.stats.red} subs left ${s.subsLeft}`);
  }
});

test('teams switch ends at half time', () => {
  const s = newMatch(3, setup());
  assert.deepEqual(s.sides, [-1, 1]);
  while (s.period === 0) step(s, [cpuInput(s, 0), cpuInput(s, 1)]);
  assert.deepEqual(s.sides, [1, -1]);
});

test('a level cup tie goes to extra time and a shootout with a winner', () => {
  for (let seed = 1; seed <= 30; seed++) {
    const s = newMatch(seed, setup({ minutes: 1, extraTime: true, penalties: true }));
    let reachedEt = false;
    while (s.phase !== 'end') {
      step(s, [cpuInput(s, 0), cpuInput(s, 1)]);
      if (s.period === 2) reachedEt = true;
    }
    if (!s.so) continue; // decided earlier; try another seed
    assert.ok(reachedEt);
    assert.notEqual(s.so.goals[0], s.so.goals[1]);
    assert.equal(s.score[0], s.score[1]);
    return;
  }
  assert.fail('no seed reached a shootout');
});

test('ball crossing the line between the posts is a goal', () => {
  const s = newMatch(1, setup());
  s.phase = 'play';
  s.teams[1][0].x = 0; // keeper out of the way
  Object.assign(s.ball, { x: W / 2, y: M, z: 0, vx: 0, vy: -200, vz: 0 });
  for (let i = 0; i < 20; i++) step(s, [0, 0]);
  assert.deepEqual(s.score, [1, 0]);
});

test('pause and substitution commands change state deterministically', () => {
  const s = newMatch(5, setup());
  const ball = { ...s.ball };
  step(s, [cmd(CMD_PAUSE), 0]);
  for (let i = 0; i < 100; i++) step(s, [0, 0]);
  assert.ok(s.paused);
  assert.deepEqual(s.ball, ball);
  step(s, [0, cmd(CMD_PAUSE)]);
  assert.ok(!s.paused);
  const benchPlayer = s.bench[0][0];
  step(s, [cmd(CMD_SUB, 4, benchPlayer), 0]);
  assert.equal(s.teams[0][4].n, benchPlayer);
  assert.equal(s.subsLeft[0], 2);
  assert.ok(!s.bench[0].includes(benchPlayer));
});

test('a slide that takes the player instead of the ball in the box gives a penalty', () => {
  const s = newMatch(9, setup());
  s.phase = 'play';
  s.teams.flat().forEach((p) => { p.x = 0; p.y = 0; });
  const [att, def] = [s.teams[0][10], s.teams[1][3]];
  Object.assign(att, { x: W / 2, y: 8 * M, fx: 0, fy: -1000 }); // team 0 attacks y = 0; team 1's box
  s.ownerTeam = 0; s.ownerIdx = 10;
  Object.assign(def, { x: W / 2 + 300, y: 8 * M + 2 * M, fx: 0, fy: -1000, slide: 10, vx: 0, vy: -190 });
  for (let i = 0; i < 20 && s.phase === 'play'; i++) step(s, [0, 0]);
  assert.equal(s.restart?.type, 'penalty');
  assert.equal(s.stats.fouls[1], 1);
});

test('aftertouch: holding sideways after a kick curves the ball, pulling back lifts it', () => {
  const kickAndHold = (stick: number) => {
    const s = newMatch(11, setup());
    s.phase = 'play';
    s.teams.flat().forEach((p) => { p.x = 0; p.y = 0; });
    const p = s.teams[0][10];
    Object.assign(p, { x: W / 2, y: 60 * M, fx: 0, fy: -1000 });
    s.ownerTeam = 0; s.ownerIdx = 10; s.controlled[0] = 10;
    for (let i = 0; i < 12; i++) step(s, [16, 0]); // hold KICK
    step(s, [0, 0]); // release: shot up the pitch
    let maxZ = 0;
    for (let i = 0; i < 40; i++) { step(s, [stick, 0]); maxZ = Math.max(maxZ, s.ball.z); }
    return { x: s.ball.x, maxZ };
  };
  const straight = kickAndHold(0), left = kickAndHold(4), right = kickAndHold(8), back = kickAndHold(2);
  assert.ok(left.x < straight.x - M, `left ${left.x} vs ${straight.x}`);
  assert.ok(right.x > straight.x + M, `right ${right.x} vs ${straight.x}`);
  assert.ok(back.maxZ > straight.maxZ, `lift ${back.maxZ} vs ${straight.maxZ}`);
});
