import test from 'node:test';
import assert from 'node:assert/strict';
import { newCareer, finishStep, userFixture, acceptJob, teamOf, SEASONS, SQUAD_MIN, buy, type Career } from '../src/career.ts';

function season(c: Career) {
  for (let i = 0, n = c.calendar.length; i < n && !c.over && c.club; i++) finishStep(c, null);
}

test('a career runs every season to retirement, with promotion, relegation and squads intact', () => {
  const c = newCareer('Test', 'pl1-6', 'player');
  for (let s = 0; s < SEASONS * 2 && !c.over; s++) {
    if (!c.club) { const job = c.inbox.find((o) => o.kind === 'job'); assert.ok(job); acceptJob(c, job); }
    // Play our own fixtures as simulated computer results: pass null so finishStep simulates them too.
    season(c);
  }
  assert.ok(c.over, 'career ended');
  assert.equal(c.history.length, c.season);
  assert.deepEqual(c.divisions.map((d) => d.length), [12, 12, 12, 12]);
  for (const t of c.teams) assert.ok(t.players.length >= SQUAD_MIN, `${t.name} has ${t.players.length}`);
});

test('the user always has a league fixture and the cup appears between league rounds', () => {
  const c = newCareer('Test', 'en1-0', 'coach');
  assert.equal(c.calendar.length, 22 + 6); // 22 league rounds, 6 cup rounds for 48 clubs
  assert.ok(userFixture(c));
  assert.equal(userFixture(c)!.comp.name, 'I liga');
});

test('buying a player moves him between squads and charges the fee', () => {
  const c = newCareer('Test', 'pl1-0', 'player');
  c.balance = 100000;
  const m = c.market[0], before = c.balance;
  const msg = buy(c, 0, m.price * 2);
  assert.match(msg, /dołącza/);
  assert.ok(teamOf(c, 'pl1-0').players.some((p) => p.name === m.name));
  assert.ok(!teamOf(c, m.team).players.some((p) => p.name === m.name) || teamOf(c, m.team).players.filter((p) => p.name === m.name).length === 0);
  assert.equal(c.balance, before - m.price * 2);
});
