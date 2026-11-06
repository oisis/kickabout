import test from 'node:test';
import assert from 'node:assert/strict';
import { KickShaper, PASS, SHOT } from '../src/input.ts';
import { KICK } from '../src/sim.ts';

/** Feeds raw button states frame by frame and returns how many frames KICK was held in one press. */
function kickFrames(frames: number[]): number[] {
  const k = new KickShaper();
  return [...frames, ...Array(20).fill(0)].map((raw) => (k.shape(raw) & KICK ? 1 : 0));
}
const held = (f: number[]) => f.reduce((a, b) => a + b, 0);

test('PASS sends a short pulse however long it is held; SHOT holds long enough to shoot', () => {
  assert.equal(held(kickFrames([PASS])), 3);
  assert.equal(held(kickFrames(Array(30).fill(PASS))), 3); // still a pass
  assert.equal(held(kickFrames([SHOT])), 10); // a tap still shoots (simulation: 9+ frames)
  assert.equal(held(kickFrames(Array(25).fill(SHOT))), 25); // longer = harder
  const f = kickFrames([SHOT, SHOT, 0, 0, PASS]);
  assert.ok(f.slice(0, 10).every((x) => x === 1), 'the shot completes before anything else');
});
