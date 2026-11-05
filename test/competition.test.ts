import test from 'node:test';
import assert from 'node:assert/strict';
import { create, record, roundFixtures, simulate, standings, PRESETS, DEFAULT_RULES, roundRobin, type Competition } from '../src/competition.ts';
import { TEAMS, team } from '../src/data.ts';

function playOut(c: Competition) {
  for (let guard = 0; !c.winner && guard < 200; guard++) {
    for (const f of roundFixtures(c).filter((x) => !x.result)) {
      if (!f.home || !f.away) { record(c, f, { h: 0, a: 0 }, []); continue; }
      const { result, goals } = simulate(c, f, team(f.home), team(f.away));
      record(c, f, result, goals);
    }
  }
}

test('round robin: everyone meets everyone once per cycle, home and away swap', () => {
  const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
  const fx = roundRobin(ids, 2);
  assert.equal(fx.length, 30);
  for (const x of ids) for (const y of ids) if (x !== y) assert.equal(fx.filter((f) => f.home === x && f.away === y).length, 1);
  for (let r = 0; r < 10; r++) assert.equal(new Set(fx.filter((f) => f.round === r).flatMap((f) => [f.home, f.away])).size, 6);
});

test('every preset competition plays out to a single winner', () => {
  for (const p of PRESETS) {
    const c = create(p.name, p.kind, p.teams(TEAMS), {}, { ...DEFAULT_RULES, ...p.rules });
    playOut(c);
    assert.ok(c.winner && c.teams.includes(c.winner), p.name);
    assert.ok(c.fixtures.every((f) => f.result), p.name);
  }
});

test('league table counts points and sorts by points then goal difference', () => {
  const c = create('L', 'league', ['a', 'b', 'c'], {}, { ...DEFAULT_RULES, rounds: 1 });
  for (const f of c.fixtures) f.result = f.home === 'a' || f.away === 'a' ? (f.home === 'a' ? { h: 2, a: 0 } : { h: 0, a: 2 }) : { h: 1, a: 1 };
  const t = standings(c, c.teams);
  assert.deepEqual(t.map((r) => [r.team, r.pts]), [['a', 6], ['b', 1], ['c', 1]]);
});

test('two-legged tie: away goals decide a level aggregate', () => {
  const c = create('C', 'cup', ['a', 'b'], {}, { ...DEFAULT_RULES, legs: 2, awayGoals: true });
  const [l1, l2] = c.fixtures;
  record(c, l1, { h: 2, a: 1 }, []); // away side scored 1 away goal
  record(c, l2, { h: 1, a: 0 }, []); // 2:2 on aggregate, l2.home scored 1 away goal in leg 1
  assert.equal(c.winner, l2.home);
});
