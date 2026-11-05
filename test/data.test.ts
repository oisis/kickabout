import test from 'node:test';
import assert from 'node:assert/strict';
import { TEAMS, LEAGUE_COUNTRIES, CLUBS_PER_DIVISION, leagueTeams, nationTeams } from '../src/data.ts';
import { PRESETS } from '../src/competition.ts';
import { newCareer, finishStep } from '../src/career.ts';

test('8 leagues × 4 divisions of clubs named "<city> <invented name>", 40 national teams, all unique', () => {
  assert.equal(LEAGUE_COUNTRIES.length, 8);
  for (const { code } of LEAGUE_COUNTRIES) for (const d of [1, 2, 3, 4]) assert.equal(leagueTeams(code, d).length, CLUBS_PER_DIVISION);
  assert.equal(nationTeams('eu').length, 24);
  assert.equal(nationTeams('world').length, 16);
  assert.equal(new Set(TEAMS.map((t) => t.id)).size, TEAMS.length);
  assert.equal(new Set(TEAMS.map((t) => t.name)).size, TEAMS.length);
  for (const t of TEAMS.filter((x) => !x.national)) assert.match(t.name, /^\S.* \S+$/, t.name);
  for (const t of TEAMS) assert.equal(new Set(t.players.map((p) => p.name)).size, 16, t.name);
});

test('preset competitions pick the intended teams', () => {
  const size = (name: string) => PRESETS.find((p) => p.name === name)!.teams(TEAMS).length;
  assert.equal(size('Puchar Kontynentu'), 32);
  assert.equal(size('Tarcza Kontynentu'), 32);
  assert.equal(size('Turniej Narodów Europy'), 16);
  assert.equal(size('Turniej Narodów Świata'), 32);
  assert.equal(size('Polska – I liga'), 12);
  assert.equal(size('Polska – puchar kraju'), 48);
  assert.equal(size('Polska – IV liga'), 12);
  const cont = new Set(PRESETS.find((p) => p.name === 'Puchar Kontynentu')!.teams(TEAMS));
  assert.ok(PRESETS.find((p) => p.name === 'Tarcza Kontynentu')!.teams(TEAMS).every((id) => !cont.has(id)));
});

test('a career season in every country moves two clubs up and two down between each pair of divisions', () => {
  for (const { code } of LEAGUE_COUNTRIES) {
    const c = newCareer('x', `${code}3-5`, 'coach');
    const before = c.divisions.map((d) => [...d]);
    for (let i = 0, n = c.calendar.length; i < n && !c.over && c.club; i++) finishStep(c, null);
    assert.deepEqual(c.divisions.map((d) => d.length), [12, 12, 12, 12], code);
    for (let d = 0; d < 3; d++) {
      const up = c.divisions[d].filter((id) => before[d + 1].includes(id)), down = c.divisions[d + 1].filter((id) => before[d].includes(id));
      assert.deepEqual([up.length, down.length], [2, 2], `${code} ${d}`);
    }
  }
});
