// Leagues, cups (one or two legs, away goals) and tournaments (groups + knockout).
// Pure data and rules; screens and match running live elsewhere. Computer-only
// fixtures get a quick statistical result instead of a full simulation.
import { type TeamDef, rating, LEAGUE_COUNTRIES, byStrength, leagueLabel } from './data.ts';
import { t } from './i18n.ts';

export type Kind = 'league' | 'cup' | 'tournament';
export interface Rules {
  minutes?: number;
  rounds: number; // league: 1 or 2 round robins
  legs: number; // cup ties: 1 or 2
  awayGoals: boolean;
  extraTime: boolean;
  penalties: boolean;
  win: number; // points for a win (draw = 1)
  groups: number; // tournament group count
  advance: number; // tournament: teams per group into the knockout
}
export interface Result { h: number; a: number; pens?: number[]; et?: boolean }
export interface Fixture { home: string; away: string; round: number; stage: 'league' | 'group' | 'cup'; group?: number; tie?: number; leg?: number; result?: Result }
export interface Scorer { team: string; name: string; goals: number }
export interface Competition {
  name: string;
  kind: Kind;
  teams: string[];
  humans: Record<string, number>; // team id -> 1 or 2
  rules: Rules;
  fixtures: Fixture[];
  round: number;
  groups: string[][];
  winner: string | null;
  scorers: Record<string, Scorer>;
  month: number; // for seasonal pitches
}

export const DEFAULT_RULES: Rules = { rounds: 2, legs: 1, awayGoals: true, extraTime: true, penalties: true, win: 3, groups: 4, advance: 2 };

const shuffle = <T>(a: T[]) => { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };

/** Circle-method round robin; second cycle swaps home and away. */
export function roundRobin(teams: string[], cycles: number, stage: Fixture['stage'] = 'league', group?: number, firstRound = 0): Fixture[] {
  const list = teams.length % 2 ? [...teams, ''] : [...teams];
  const n = list.length, out: Fixture[] = [];
  for (let c = 0; c < cycles; c++) {
    const rot = [...list];
    for (let r = 0; r < n - 1; r++) {
      for (let i = 0; i < n / 2; i++) {
        let [home, away] = [rot[i], rot[n - 1 - i]];
        if ((r + i + c) % 2) [home, away] = [away, home];
        if (home && away) out.push({ home, away, round: firstRound + c * (n - 1) + r, stage, group });
      }
      rot.splice(1, 0, rot.pop()!);
    }
  }
  return out;
}

function cupRound(c: Competition, teams: string[], round: number): Fixture[] {
  const out: Fixture[] = [];
  for (let i = 0; i + 1 < teams.length; i += 2) {
    const tie = i / 2;
    out.push({ home: teams[i], away: teams[i + 1], round, stage: 'cup', tie, leg: 1 });
    if (c.rules.legs === 2) out.push({ home: teams[i + 1], away: teams[i], round: round + 1, stage: 'cup', tie, leg: 2 });
  }
  return out;
}

export function create(name: string, kind: Kind, teams: string[], humans: Record<string, number>, rules: Rules): Competition {
  const c: Competition = { name, kind, teams, humans, rules, fixtures: [], round: 0, groups: [], winner: null, scorers: {}, month: 8 };
  if (kind === 'league') c.fixtures = roundRobin(shuffle(teams), rules.rounds);
  if (kind === 'cup') c.fixtures = cupRound(c, padToPowerOfTwo(shuffle(teams)), 0);
  if (kind === 'tournament') {
    const s = shuffle(teams);
    c.groups = Array.from({ length: rules.groups }, (_, g) => s.filter((_, i) => i % rules.groups === g));
    c.fixtures = c.groups.flatMap((g, i) => roundRobin(g, rules.rounds, 'group', i));
  }
  return c;
}

/** Cups need 2^n teams: the strongest get byes is overkill here, so extra slots become walkovers. */
function padToPowerOfTwo(teams: string[]): string[] {
  let n = 1;
  while (n < teams.length) n *= 2;
  const out = [...teams];
  for (let i = teams.length; i < n; i++) out.splice((i - teams.length) * 2 + 1, 0, '');
  return out;
}

export const roundFixtures = (c: Competition, round = c.round) => c.fixtures.filter((f) => f.round === round);
export const isHuman = (c: Competition, f: Fixture) => !!(c.humans[f.home] || c.humans[f.away]);

/** First-leg goals for a second leg, in the second leg's team order. */
export function firstLeg(c: Competition, f: Fixture): Fixture | undefined {
  return f.leg === 2 ? c.fixtures.find((x) => x.stage === 'cup' && x.tie === f.tie && x.leg === 1 && x.round === f.round - 1) : undefined;
}

/** Does this match have to produce a winner (single-leg cup tie or a second leg)? */
export function decisive(c: Competition, f: Fixture): boolean {
  return f.stage === 'cup' && (c.rules.legs === 1 || f.leg === 2);
}

export function record(c: Competition, f: Fixture, r: Result, goals: { team: string; name: string }[]) {
  f.result = r;
  for (const g of goals) {
    const key = `${g.team}|${g.name}`;
    (c.scorers[key] ??= { team: g.team, name: g.name, goals: 0 }).goals++;
  }
  if (roundFixtures(c).every((x) => x.result)) advance(c);
}

/** Winner of a cup tie whose fixtures are all played. */
export function tieWinner(c: Competition, round: number, tie: number): string {
  const legs = c.fixtures.filter((f) => f.stage === 'cup' && f.tie === tie && f.result && (f.round === round || (c.rules.legs === 2 && f.leg === 1 && f.round === round - 1)));
  const last = legs[legs.length - 1], r = last.result!;
  if (!last.away) return last.home;
  if (!last.home) return last.away;
  if (r.pens) return r.pens[0] > r.pens[1] ? last.home : last.away;
  const goals: Record<string, number> = { [last.home]: 0, [last.away]: 0 }, away: Record<string, number> = { [last.home]: 0, [last.away]: 0 };
  for (const l of legs) { goals[l.home] += l.result!.h; goals[l.away] += l.result!.a; away[l.away] += l.result!.a; }
  if (goals[last.home] !== goals[last.away]) return goals[last.home] > goals[last.away] ? last.home : last.away;
  if (c.rules.awayGoals && legs.length === 2 && away[last.home] !== away[last.away]) return away[last.home] > away[last.away] ? last.home : last.away;
  return r.h >= r.a ? last.home : last.away; // unreachable when the match had to produce a winner
}

function advance(c: Competition) {
  const done = roundFixtures(c);
  const next = c.round + 1;
  if (c.fixtures.some((f) => f.round === next)) { c.round = next; return; }
  if (c.kind === 'league') { c.winner = standings(c, c.teams)[0].team; return; }
  if (done[0]?.stage === 'group') {
    const qualified = c.groups.map((g) => standings(c, g).slice(0, c.rules.advance).map((r) => r.team));
    // Cross-pair: winner of group A against runner-up of group B, and so on.
    const draw: string[] = [];
    for (let g = 0; g < qualified.length; g += 2) {
      const a = qualified[g], b = qualified[g + 1] ?? [];
      for (let k = 0; k < a.length; k++) draw.push(a[k], b[a.length - 1 - k] ?? '');
    }
    c.fixtures.push(...cupRound(c, draw, next));
    c.round = next;
    return;
  }
  const ties = [...new Set(done.map((f) => f.tie!))];
  const winners = ties.map((t) => tieWinner(c, c.round, t));
  if (winners.length === 1) { c.winner = winners[0]; return; }
  c.fixtures.push(...cupRound(c, winners, next));
  c.round = next;
}

export interface Row { team: string; p: number; w: number; d: number; l: number; gf: number; ga: number; pts: number }
export function standings(c: Competition, teams: string[]): Row[] {
  const rows = new Map(teams.map((t) => [t, { team: t, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0 }]));
  for (const f of c.fixtures) {
    if (!f.result || f.stage === 'cup') continue;
    const h = rows.get(f.home), a = rows.get(f.away);
    if (!h || !a) continue;
    const { h: hg, a: ag } = f.result;
    h.p++; a.p++; h.gf += hg; h.ga += ag; a.gf += ag; a.ga += hg;
    if (hg > ag) { h.w++; a.l++; h.pts += c.rules.win; } else if (hg < ag) { a.w++; h.l++; a.pts += c.rules.win; } else { h.d++; a.d++; h.pts++; a.pts++; }
  }
  return [...rows.values()].sort((x, y) => y.pts - x.pts || y.gf - y.ga - (x.gf - x.ga) || y.gf - x.gf || x.team.localeCompare(y.team));
}

export const topScorers = (c: Competition, n = 20) => Object.values(c.scorers).sort((a, b) => b.goals - a.goals || a.name.localeCompare(b.name)).slice(0, n);

function poisson(mean: number): number {
  let k = 0, p = 1;
  const l = Math.exp(-mean);
  do { k++; p *= Math.random(); } while (p > l);
  return k - 1;
}

const strength = (t: TeamDef) => t.players.slice(0, 11).reduce((a, p) => a + rating(p), 0) / 11 + 1;

function pickScorer(t: TeamDef): string {
  const w = t.players.map((p) => (p.pos === 0 ? 0 : (p.pos === 3 ? 6 : p.pos === 2 ? 3 : 1) * (1 + p.sh)));
  let r = Math.random() * w.reduce((a, b) => a + b, 0);
  for (let i = 0; i < w.length; i++) if ((r -= w[i]) < 0) return t.players[i].name;
  return t.players[10].name;
}

/** Quick result for a computer-only fixture. */
export function simulate(c: Competition, f: Fixture, home: TeamDef, away: TeamDef): { result: Result; goals: { team: string; name: string }[] } {
  const sh = strength(home), sa = strength(away);
  const mean = (a: number, b: number, bonus: number) => 1.25 * (a / b) ** 1.6 * bonus;
  let h = poisson(mean(sh, sa, 1.15)), a = poisson(mean(sa, sh, 0.95));
  const result: Result = { h, a };
  if (decisive(c, f)) {
    const leg1 = firstLeg(c, f);
    const level = () => {
      const tot = [h + (leg1?.result?.a ?? 0), a + (leg1?.result?.h ?? 0)];
      if (tot[0] !== tot[1]) return false;
      return !(c.rules.awayGoals && leg1) || (leg1.result?.a ?? 0) === a;
    };
    if (level() && c.rules.extraTime) { h += poisson(mean(sh, sa, 0.4)); a += poisson(mean(sa, sh, 0.35)); result.et = true; }
    if (level()) {
      const p = [3 + Math.floor(Math.random() * 3), 3 + Math.floor(Math.random() * 3)];
      if (p[0] === p[1]) p[Math.random() < 0.5 ? 0 : 1]++;
      result.pens = p;
    }
    result.h = h; result.a = a;
  }
  const goals = [...Array(result.h)].map(() => ({ team: home.id, name: pickScorer(home) })).concat([...Array(result.a)].map(() => ({ team: away.id, name: pickScorer(away) })));
  return { result, goals };
}

export interface Preset { name: string; group: string; kind: Kind; teams: (all: TeamDef[]) => string[]; rules: Partial<Rules> }
const ids = (list: TeamDef[]) => list.map((x) => x.id);
const div = (all: TeamDef[], cc: string, d: number) => all.filter((x) => !x.national && x.country === cc && x.division === d);
/** The best `n` clubs of every league's top division, skipping the first `skip` of each. */
const continental = (all: TeamDef[], skip: number, n: number) => LEAGUE_COUNTRIES.flatMap((c) => byStrength(div(all, c.code, 1)).slice(skip, skip + n));

export const PRESETS: Preset[] = [
  ...LEAGUE_COUNTRIES.flatMap(({ code, name }): Preset[] => [
    ...[1, 2, 3, 4].map((d): Preset => ({ name: leagueLabel(name, d), group: name, kind: 'league', teams: (all) => ids(div(all, code, d)), rules: { rounds: 2 } })),
    { name: t('{0} – puchar kraju', name), group: name, kind: 'cup', teams: (all) => ids(all.filter((x) => !x.national && x.country === code)), rules: { legs: 1 } },
  ]),
  { name: t('Puchar Kontynentu'), group: t('Europa – kluby'), kind: 'tournament', teams: (all) => ids(continental(all, 0, 4)), rules: { groups: 8, advance: 2, rounds: 2, legs: 2 } },
  { name: t('Tarcza Kontynentu'), group: t('Europa – kluby'), kind: 'cup', teams: (all) => ids(continental(all, 4, 4)), rules: { legs: 2, awayGoals: true } },
  { name: t('Turniej Narodów Europy'), group: t('Reprezentacje'), kind: 'tournament', teams: (all) => ids(byStrength(all.filter((x) => x.national && x.country === 'eu')).slice(0, 16)), rules: { groups: 4, advance: 2, rounds: 1, legs: 1 } },
  { name: t('Turniej Narodów Świata'), group: t('Reprezentacje'), kind: 'tournament', teams: (all) => ids([...all.filter((x) => x.national && x.country === 'world'), ...byStrength(all.filter((x) => x.national && x.country === 'eu')).slice(0, 16)]), rules: { groups: 8, advance: 2, rounds: 1, legs: 1 } },
];

export function stageName(c: Competition, round = c.round): string {
  const fx = roundFixtures(c, round)[0];
  if (!fx) return '';
  if (fx.stage === 'league') return t('Kolejka {0}', round + 1);
  if (fx.stage === 'group') return t('Faza grupowa – kolejka {0}', round + 1);
  const ties = new Set(roundFixtures(c, round).map((f) => f.tie)).size;
  const name = ties === 1 ? t('Finał') : ties === 2 ? t('Półfinały') : ties === 4 ? t('Ćwierćfinały') : `1/${ties}`;
  return c.rules.legs === 2 ? t('{0} – mecz {1}', name, fx.leg ?? 1) : name;
}
