import test from 'node:test';
import assert from 'node:assert/strict';
import { TEAMS } from '../src/data.ts';
import { playerPrice, teamRating, clubPrice, matchReward, swapPrice, newSquad, START_COINS, BUY_MARKUP, DAILY_REWARDS } from '../src/economy.ts';

const clubs = TEAMS.filter((t) => !t.national);
const top = clubs.find((t) => t.division === 1)!, bottom = clubs.filter((t) => t.division === 4).at(-1)!;

test('a new club is weak and cheap, top clubs are far out of reach at the start', () => {
  const squad = { ...bottom, players: newSquad('test-club', 'en') };
  assert.equal(squad.players.length, 16);
  assert.ok(teamRating(squad) <= 3.5, `new club rating ${teamRating(squad)}`);
  assert.ok(teamRating(squad) < teamRating(top) - 3);
  assert.ok(clubPrice(top) > 50 * START_COINS, `top club ${clubPrice(top)}`);
  assert.ok(clubPrice(squad) > START_COINS, 'not even a new club is affordable straight away');
});

test('prices grow with skill and fall with age', () => {
  const p = { name: 'x', pos: 2, pa: 5, sh: 5, he: 5, ta: 5, co: 5, sp: 5, gk: 0, age: 25 };
  assert.ok(playerPrice({ ...p, pa: 9, sh: 9 }) > playerPrice(p));
  assert.ok(playerPrice({ ...p, age: 34 }) < playerPrice(p));
  assert.ok(swapPrice(p, { ...p, sh: 9 }) > 0 && swapPrice({ ...p, sh: 9 }, p) < 0);
});

test('rewards: winning pays more for better teams, a decent player takes days of wins', () => {
  assert.ok(matchReward(6, 6, 2, 0, true) > matchReward(3, 3, 2, 0, true));
  assert.ok(matchReward(3, 3, 1, 0, true) > matchReward(3, 3, 1, 1, true));
  assert.ok(matchReward(3, 3, 1, 0, true) > matchReward(3, 3, 1, 0, false));
  const decent = { name: 'x', pos: 2, pa: 5, sh: 5, he: 5, ta: 5, co: 5, sp: 5, gk: 0, age: 25 };
  const winsNeeded = (playerPrice(decent) * BUY_MARKUP) / matchReward(2.5, 2.5, 2, 0, false);
  assert.ok(winsNeeded > DAILY_REWARDS.cpu, `a rating-5 player costs ${winsNeeded.toFixed(1)} computer wins`);
});
