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
    for (const t of [0, 1]) assert.ok(s.stats.onTarget[t] <= s.stats.shots[t], `on target ${s.stats.onTarget} > shots ${s.stats.shots}`);
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
  assert.equal(s.subsLeft[0], 4);
  assert.ok(!s.bench[0].includes(benchPlayer));
});

test('substitutions follow IFAB Law 3: 5 players, 3 stoppages, half-time free, +1 of each in extra time', () => {
  const s = newMatch(7, setup({ minutes: 5, extraTime: true }));
  // Like the game: pause, substitute, resume (the clock stands still in a pause).
  const sub = (...outs: number[]) => { step(s, [cmd(CMD_PAUSE), 0]); for (const o of outs) step(s, [cmd(CMD_SUB, o, s.bench[0][0]), 0]); step(s, [cmd(CMD_PAUSE), 0]); };
  const play = (frames: number) => { for (let i = 0; i < frames && s.phase !== 'end'; i++) step(s, [cpuInput(s, 0), cpuInput(s, 1)]); };
  sub(2); // before kick-off: free
  assert.deepEqual([s.subsLeft[0], s.subWindows[0]], [4, 3]);
  play(600);
  sub(3, 4); // one stoppage, two players
  assert.deepEqual([s.subsLeft[0], s.subWindows[0]], [2, 2]);
  play(600); sub(5);
  play(600); sub(6);
  assert.deepEqual([s.subsLeft[0], s.subWindows[0]], [0, 0]);
  const before = s.teams[0][7].n;
  sub(7); // nothing left
  assert.equal(s.teams[0][7].n, before);

  // Windows run out before players do: a fourth stoppage is refused.
  const t = newMatch(8, setup({ minutes: 5 }));
  const subT = (out: number) => { step(t, [cmd(CMD_PAUSE), 0]); step(t, [cmd(CMD_SUB, out, t.bench[0][0]), 0]); step(t, [cmd(CMD_PAUSE), 0]); };
  for (const out of [2, 3, 4]) { for (let i = 0; i < 600; i++) step(t, [cpuInput(t, 0), cpuInput(t, 1)]); subT(out); }
  assert.deepEqual([t.subsLeft[0], t.subWindows[0]], [2, 0]);
  for (let i = 0; i < 600; i++) step(t, [cpuInput(t, 0), cpuInput(t, 1)]);
  const n5 = t.teams[0][5].n;
  subT(5);
  assert.equal(t.teams[0][5].n, n5, 'no fourth stoppage');
  while (t.phase !== 'half' && t.phase !== 'end') step(t, [cpuInput(t, 0), cpuInput(t, 1)]);
  if (t.phase === 'half') { subT(5); assert.notEqual(t.teams[0][5].n, n5, 'half-time does not count'); }

  // Extra time: one more substitution and one more stoppage.
  while (s.period < 2 && s.phase !== 'end') play(60);
  if (s.period === 2) assert.deepEqual([s.subsLeft[0], s.subWindows[0]], [1, 1]);
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

test('a ball kicked into touch rolls over the line, then is placed on it for the throw-in', () => {
  const s = newMatch(1, setup());
  while (s.phase !== 'play') step(s, [0, 0]);
  Object.assign(s.ball, { x: W - 100, y: 50 * M, z: 0, vx: 150, vy: 0, vz: 0 });
  s.ownerTeam = s.ownerIdx = -1; s.lastTouch = 0;
  step(s, [0, 0]);
  assert.equal(s.phase, 'out');
  assert.equal(s.restart!.type, 'throw');
  for (let i = 0; i < 10; i++) step(s, [0, 0]);
  assert.ok(s.ball.x > W + M, `still rolling beyond the touchline: ${s.ball.x - W}`);
  while (s.phase === 'out' && s.ball.x !== W) step(s, [0, 0]);
  assert.deepEqual([s.ball.x, s.ball.vx, s.phase], [W, 0, 'out']); // on the line, waiting for the taker
});

test('restarts do not loop: a 5-minute match lasts about 5 minutes', () => {
  // Throw-in takers used to stand outside the line with the ball, which went out again at once.
  for (let seed = 1; seed <= 8; seed++) {
    const s = newMatch(seed * 7919, { ...setup({ minutes: 5, pitch: seed % 7 }), teams: [teamSetup(TEAMS[300]), teamSetup(TEAMS[200 + seed])] });
    while (s.phase !== 'end' && s.frame < 60000) step(s, [cpuInput(s, 0), cpuInput(s, 1)]);
    assert.ok(s.frame < 5 * 3600 * 1.3, `seed ${seed}: ${(s.frame / 3600).toFixed(1)} min`);
  }
});

test('after a goal the ball stays inside the net', () => {
  for (const [vx, vz] of [[0, 0], [-160, 0], [160, 30], [90, 60]]) {
    const s = newMatch(1, setup());
    s.phase = 'play';
    s.teams[1][0].x = 0; s.teams[0][0].x = 0; // keepers out of the way
    Object.assign(s.ball, { x: W / 2, y: M, z: 0, vx, vy: -260, vz });
    for (let i = 0; i < 160 && s.phase !== 'kickoff'; i++) {
      step(s, [0, 0]);
      if (s.phase !== 'goal') continue;
      const b = s.ball;
      assert.ok(Math.abs(b.x - W / 2) <= 3748 && b.y >= -2 * M && b.z <= 2499, `vx ${vx}: ball at ${b.x - W / 2}, ${b.y}, ${b.z}`);
    }
    assert.equal(s.score[0] + s.score[1], 1, `vx ${vx}: a goal`);
  }
});

test('a keeper holding the ball never loses it straight to an opponent: he throws to a free mate or kicks it long', () => {
  let releases = 0;
  for (let seed = 1; seed <= 3; seed++) {
    const s = newMatch(seed, setup({ minutes: 3 }));
    while (s.phase !== 'end') {
      const held = s.ownerIdx === 0 ? s.ownerTeam : -1;
      step(s, [cpuInput(s, 0), cpuInput(s, 1)]);
      if (held >= 0 && !(s.ownerTeam === held && s.ownerIdx === 0) && s.phase === 'play') {
        releases++;
        assert.notEqual(s.ownerTeam, 1 - held, `seed ${seed} frame ${s.frame}: the ball went from the keeper's hands to an opponent`);
      }
    }
  }
  assert.ok(releases > 0, 'keepers did release the ball');
});

test('a shootout ends even if nobody presses anything (a penalty taker shoots by himself after 10 s)', () => {
  for (let seed = 1; seed <= 30; seed++) {
    const s = newMatch(seed, setup({ minutes: 1, penalties: true }));
    while (s.phase !== 'end' && s.period !== 4) step(s, [cpuInput(s, 0), cpuInput(s, 1)]);
    if (s.phase === 'end') continue; // decided in normal time
    let f = 0;
    while (s.phase !== 'end' && f++ < 60_000) step(s, [0, 0]);
    assert.equal(s.phase, 'end', `seed ${seed}: shootout never finished`);
    assert.notEqual(s.so!.goals[0], s.so!.goals[1]);
    return;
  }
  assert.fail('no seed reached a shootout');
});
