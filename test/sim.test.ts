import test from 'node:test';
import assert from 'node:assert/strict';
import { newMatch, step, W, M, TICK_HZ, type State } from '../src/sim.ts';
import { cpuInput } from '../src/ai.ts';

function play(seed: number, ticks = Infinity): State {
  const s = newMatch(seed, 120 * TICK_HZ);
  for (let i = 0; i < ticks && s.phase !== 'end'; i++) step(s, [cpuInput(s, 0), cpuInput(s, 1)]);
  return s;
}

function assertIntegers(v: unknown, path = 'state'): void {
  if (typeof v === 'number') assert.ok(Number.isInteger(v), `${path} = ${v}`);
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) assertIntegers(x, `${path}.${k}`);
}

test('same seed and inputs replay the same match (lockstep contract)', () => {
  assert.deepEqual(play(42, 4000), play(42, 4000));
});

test('CPU vs CPU reaches full time with integer-only state', (t) => {
  const s = play(7);
  assert.equal(s.phase, 'end');
  assertIntegers(s);
  t.diagnostic(`score ${s.score.join(':')}`);
});

test('ball crossing the line between the posts is a goal', () => {
  const s = newMatch(1);
  s.phase = 'play';
  s.teams[1][0].x = 0; // keeper out of the way
  Object.assign(s.ball, { x: W / 2, y: M, z: 0, vx: 0, vy: -200, vz: 0 });
  for (let i = 0; i < 20; i++) step(s, [0, 0]);
  assert.deepEqual(s.score, [1, 0]);
});
