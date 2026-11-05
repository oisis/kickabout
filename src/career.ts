// Career: two divisions with promotion and relegation, a domestic cup, finances,
// transfers, the board's verdict, job offers and ageing squads over 20 seasons.
// Pure rules on plain data so a career can be saved as JSON.
import { create, record, roundFixtures, simulate, standings, DEFAULT_RULES, type Competition, type Fixture, type Result } from './competition.ts';
import { TEAMS, DIVISIONS, ROMAN, makePlayers, value, strength, team, type TeamDef, type PlayerDef } from './data.ts';
import { t } from './i18n.ts';

export interface Offer { kind: 'sell' | 'job'; team: string; player?: string; fee?: number }
export interface Career {
  name: string;
  mode: 'coach' | 'player';
  club: string;
  year: number;
  season: number; // 1..SEASONS
  teams: TeamDef[]; // career copies of every club; transfers and ageing change them
  divisions: string[][];
  leagues: Competition[];
  cup: Competition;
  step: number;
  balance: number;
  startBalance: number;
  ledger: Record<string, number>;
  forSale: string[];
  market: { team: string; name: string; price: number }[];
  inbox: Offer[];
  messages: string[];
  history: { year: number; club: string; div: number; pos: number; cup: '' | 'won' | 'out' }[];
  calendar: Step[];
  lineup: { tactic?: number; lineup?: number[] };
  warned: boolean;
  over: string; // reason when the career has ended
}

export const SEASONS = 20, SQUAD_MIN = 14, SQUAD_MAX = 22;
export type Step = { kind: 'league'; round: number } | { kind: 'cup' };
/** League rounds (double round robin) with the cup rounds spread evenly between them. */
export function calendar(divisionSize: number, cupTeams: number): Step[] {
  const rounds = 2 * (divisionSize - 1), cup = Math.ceil(Math.log2(cupTeams));
  const after = Array.from({ length: cup }, (_, k) => Math.round((rounds * (k + 1)) / (cup + 1)));
  return Array.from({ length: rounds }, (_, r) => r).flatMap((r): Step[] => (after.includes(r) ? [{ kind: 'cup' }, { kind: 'league', round: r }] : [{ kind: 'league', round: r }]));
}
const pick = <T>(a: T[]) => a[Math.floor(Math.random() * a.length)];
const r10 = (x: number) => Math.round(x / 10) * 10;

export const teamOf = (c: Career, id: string): TeamDef => c.teams.find((t) => t.id === id)!;

export function newCareer(name: string, club: string, mode: Career['mode']): Career {
  // The club's country: its two divisions as they stand in the data.
  const country = team(club).country;
  const teams = structuredClone(TEAMS.filter((x) => !x.national && x.country === country));
  const c: Career = {
    name, mode, club, year: new Date().getFullYear(), season: 1, teams,
    divisions: [1, 2, 3, 4].map((d) => teams.filter((x) => x.division === d).map((x) => x.id)).filter((d) => d.length), leagues: [], cup: create('', 'cup', [], {}, DEFAULT_RULES),
    calendar: [],
    step: 0, balance: 0, startBalance: 0, ledger: {}, forSale: [], market: [], inbox: [], messages: [], history: [], lineup: {}, warned: false, over: '',
  };
  c.balance = 400 + teamOf(c, club).level * 300;
  startSeason(c);
  return c;
}

function startSeason(c: Career) {
  const humans = { [c.club]: 1 };
  c.leagues = c.divisions.map((d, i) => create(DIVISIONS[i], 'league', d, humans, { ...DEFAULT_RULES, rounds: 2 }));
  c.cup = create(t('Puchar kraju'), 'cup', c.divisions.flat(), humans, { ...DEFAULT_RULES, legs: 1 });
  c.calendar = calendar(Math.max(...c.divisions.map((d) => d.length)), c.divisions.flat().length);
  c.step = 0; c.startBalance = c.balance; c.ledger = {}; c.warned = false; c.inbox = c.inbox.filter((o) => o.kind !== 'job');
  refreshMarket(c);
}

export const division = (c: Career, id = c.club) => c.divisions.findIndex((d) => d.includes(id));
export const month = (c: Career) => (7 + Math.floor((c.step * 10) / c.calendar.length)) % 12; // August..May

/** The user's fixture for the current calendar step (null: knocked out of the cup / season over). */
export function userFixture(c: Career): { comp: Competition; f: Fixture } | null {
  const s = c.calendar[c.step];
  if (!s) return null;
  const comp = s.kind === 'cup' ? c.cup : c.leagues[division(c)];
  if (s.kind === 'cup' && c.cup.winner) return null;
  const f = roundFixtures(comp).find((x) => !x.result && (x.home === c.club || x.away === c.club));
  return f ? { comp, f } : null;
}

function account(c: Career, label: string, amount: number) {
  c.balance += amount;
  c.ledger[label] = (c.ledger[label] ?? 0) + amount;
}

/** Record the user's result (or null when they had no match), play the rest of the step, run the club's week. */
export function finishStep(c: Career, own: { result: Result; goals: { team: string; name: string }[] } | null) {
  const s = c.calendar[c.step];
  const mine = userFixture(c);
  if (mine && own) record(mine.comp, mine.f, own.result, own.goals);
  const comps = s.kind === 'cup' ? [c.cup] : c.leagues;
  for (const comp of comps) {
    if (comp.winner) continue;
    const round = comp.round;
    for (const f of roundFixtures(comp, round)) {
      if (f.result) continue;
      if (!f.home || !f.away) { record(comp, f, { h: 0, a: 0 }, []); continue; }
      const r = simulate(comp, f, teamOf(c, f.home), teamOf(c, f.away));
      record(comp, f, r.result, r.goals);
      if (comp.round !== round) break;
    }
  }
  if (mine?.f.home === c.club) account(c, 'gate', 30 + teamOf(c, c.club).level * 30 + [110, 40, 15, 0][division(c)]);
  account(c, 'wages', -Math.round(teamOf(c, c.club).players.reduce((a, p) => a + value(p), 0) * 0.0035));
  transferOffers(c);
  if (c.step % 3 === 2) refreshMarket(c);
  boardCheck(c);
  c.step++;
  if (c.step >= c.calendar.length) endSeason(c);
}

export function expectedPosition(c: Career): number {
  const div = c.divisions[division(c)];
  return [...div].sort((a, b) => strength(teamOf(c, b)) - strength(teamOf(c, a))).indexOf(c.club) + 1;
}

export const leaguePosition = (c: Career) => standings(c.leagues[division(c)], c.divisions[division(c)]).findIndex((r) => r.team === c.club) + 1;

function boardCheck(c: Career) {
  if (c.step === 9 && !c.warned && leaguePosition(c) > expectedPosition(c) + 2) {
    c.warned = true;
    c.messages.unshift(t('Zarząd {0}: oczekujemy miejsca w okolicach {1}. Obecne {2}. miejsce to za mało — bez poprawy rozważymy zmianę trenera.', teamOf(c, c.club).name, expectedPosition(c), leaguePosition(c)));
  }
  if (c.balance < -1500 && !c.over) {
    c.messages.unshift(t('Zarząd: zadłużenie klubu przekroczyło 1,5 mln. Sprzedaj zawodników, zanim bank przejmie klub.'));
  }
}

function endSeason(c: Career) {
  const pos = c.leagues.map((l, i) => standings(l, c.divisions[i]));
  const d = division(c), myPos = leaguePosition(c), expected = expectedPosition(c);
  const cupRes = c.cup.winner === c.club ? 'won' : c.cup.fixtures.some((f) => f.home === c.club || f.away === c.club) ? 'out' : '';
  c.history.push({ year: c.year, club: c.club, div: d, pos: myPos, cup: cupRes });
  account(c, 'prizes', Math.max(0, c.divisions[d].length + 1 - myPos) * [100, 50, 25, 15][d] + (c.cup.winner === c.club ? 500 : 0));
  // Promotion and relegation between each pair of neighbouring divisions: two down, two up.
  const up = pos.map((rows, i) => (i ? rows.slice(0, 2).map((r) => r.team) : []));
  const down = pos.map((rows, i) => (i < pos.length - 1 ? rows.slice(-2).map((r) => r.team) : []));
  c.divisions = c.divisions.map((ids, i) => [...ids.filter((x) => !up[i].includes(x) && !down[i].includes(x)), ...(up[i + 1] ?? []), ...(down[i - 1] ?? [])]);
  const promoted = up[d].includes(c.club), relegated = down[d].includes(c.club);
  c.messages.unshift([
    t('Sezon {0}/{1}: {2}. miejsce w lidze {3}.', c.year, c.year + 1, myPos, ROMAN[d]),
    promoted ? t('Awans!') : relegated ? t('Spadek.') : '',
    cupRes === 'won' ? t('Puchar kraju zdobyty!') : '',
  ].filter(Boolean).join(' '));
  const verdict = expected - myPos + (promoted ? 3 : 0) - (relegated ? 3 : 0) + (cupRes === 'won' ? 2 : 0);
  if (verdict <= -4 || c.balance < -1500) {
    c.messages.unshift(t('Zarząd {0} dziękuje za współpracę — zostajesz zwolniony.', teamOf(c, c.club).name));
    jobOffers(c, -1);
    if (!c.inbox.some((o) => o.kind === 'job')) c.over = t('Brak ofert pracy po zwolnieniu. Kariera zakończona.');
    c.club = '';
  } else jobOffers(c, verdict);
  ageSquads(c);
  if (c.over) return;
  if (c.season >= SEASONS) {
    c.over ||= t('Koniec kariery po {0} sezonach — zasłużona emerytura!', SEASONS);
    return;
  }
  c.season++;
  c.year++;
  if (c.club) startSeason(c);
}

/** Clubs better than the current one call after a good season; weaker ones after a sacking. */
function jobOffers(c: Career, verdict: number) {
  if (verdict < 2 && verdict >= 0) return;
  const mine = c.club ? strength(teamOf(c, c.club)) : 0;
  let pool = c.teams.filter((t) => t.id !== c.club && (verdict < 0 ? strength(t) <= mine : strength(t) > mine));
  // Even the weakest club's sacked coach hears from the bottom of the table.
  if (!pool.length && verdict < 0) pool = [...c.teams].filter((t) => t.id !== c.club).sort((a, b) => strength(a) - strength(b)).slice(0, 3);
  const n = Math.min(pool.length, verdict < 0 ? 2 : 1 + (verdict >= 4 ? 1 : 0));
  for (let i = 0; i < n; i++) {
    const t = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
    c.inbox.push({ kind: 'job', team: t.id });
  }
}

export function acceptJob(c: Career, o: Offer) {
  const from = c.club;
  c.club = o.team;
  c.inbox = c.inbox.filter((x) => x.kind !== 'job');
  c.forSale = [];
  c.lineup = {};
  c.messages.unshift(t('Przyjąłeś posadę trenera w klubie {0}.', teamOf(c, o.team).name));
  if (!from) { c.balance = 400 + teamOf(c, c.club).level * 300; startSeason(c); }
}

function ageSquads(c: Career) {
  for (const t of c.teams) {
    t.players = t.players.map((p, i) => {
      const q = { ...p, age: p.age + 1 };
      const keys = q.pos === 0 ? (['gk', 'sp'] as const) : (['pa', 'sh', 'he', 'ta', 'co', 'sp'] as const);
      const k = pick([...keys]);
      if (q.age <= 23 && Math.random() < 0.6) q[k] = Math.min(9, q[k] + 1);
      if (q.age >= 31 && Math.random() < 0.5) q[k] = Math.max(0, q[k] - 1);
      if (q.age < 35) return q;
      return youth(c, t, p.pos, i);
    });
  }
}

function youth(c: Career, t: TeamDef, pos: number, i: number): PlayerDef {
  const pool = makePlayers(`${t.id}-${c.year}-${i}`, Math.max(2, t.level - 1), 'pl').filter((p) => p.pos === pos);
  return { ...(pool[0] ?? makePlayers(`${t.id}-${c.year}`, 3, 'pl')[1]), age: 17 + Math.floor(Math.random() * 3) };
}

function refreshMarket(c: Career) {
  c.market = [];
  const others = c.teams.filter((t) => t.id !== c.club);
  for (let i = 0; i < 12; i++) {
    const t = pick(others), p = pick(t.players.filter((x) => x.pos !== 0 || Math.random() < 0.3));
    if (c.market.some((m) => m.team === t.id && m.name === p.name)) continue;
    c.market.push({ team: t.id, name: p.name, price: r10(value(p) * (1.1 + Math.random() * 0.5)) });
  }
  c.market.sort((a, b) => b.price - a.price);
}

export function buy(c: Career, i: number, offer: number): string {
  const m = c.market[i], seller = teamOf(c, m.team), me = teamOf(c, c.club);
  const p = seller.players.find((x) => x.name === m.name);
  if (!p) { c.market.splice(i, 1); return t('Zawodnik nie jest już dostępny.'); }
  if (me.players.length >= SQUAD_MAX) return t('Kadra może liczyć najwyżej {0} zawodników.', SQUAD_MAX);
  if (offer > c.balance + 500) return t('Bank nie udzieli takiego kredytu.');
  if (offer < m.price * (0.85 + Math.random() * 0.15)) return t('{0} odrzuca ofertę {1} tys. — popraw ofertę.', seller.name, offer);
  seller.players = seller.players.filter((x) => x !== p);
  if (seller.players.length < SQUAD_MIN) seller.players.push(youth(c, seller, p.pos, seller.players.length));
  me.players.push(p);
  account(c, 'buys', -offer);
  c.market.splice(i, 1);
  return t('{0} dołącza do {1} za {2} tys.', p.name, me.name, offer);
}

function transferOffers(c: Career) {
  for (const name of c.forSale) {
    if (Math.random() > 0.35 || c.inbox.some((o) => o.player === name)) continue;
    const p = teamOf(c, c.club).players.find((x) => x.name === name);
    if (!p) continue;
    const buyer = pick(c.teams.filter((t) => t.id !== c.club && t.players.length < SQUAD_MAX));
    if (buyer) c.inbox.push({ kind: 'sell', team: buyer.id, player: name, fee: r10(value(p) * (0.7 + Math.random() * 0.6)) });
  }
}

export function acceptSale(c: Career, o: Offer): string {
  const me = teamOf(c, c.club), p = me.players.find((x) => x.name === o.player);
  c.inbox = c.inbox.filter((x) => x !== o);
  if (!p) return t('Tego zawodnika nie ma już w kadrze.');
  if (me.players.length <= SQUAD_MIN) return t('Kadra musi liczyć co najmniej {0} zawodników.', SQUAD_MIN);
  me.players = me.players.filter((x) => x !== p);
  teamOf(c, o.team).players.push(p);
  c.forSale = c.forSale.filter((n) => n !== p.name);
  c.lineup = {};
  account(c, 'sales', o.fee!);
  return t('{0} sprzedany do {1} za {2} tys.', p.name, teamOf(c, o.team).name, o.fee!);
}

export function freeTransfer(c: Career, name: string): string {
  const me = teamOf(c, c.club);
  if (me.players.length <= SQUAD_MIN) return t('Kadra musi liczyć co najmniej {0} zawodników.', SQUAD_MIN);
  me.players = me.players.filter((x) => x.name !== name);
  c.forSale = c.forSale.filter((n) => n !== name);
  c.lineup = {};
  return t('{0} odchodzi na wolnym transferze.', name);
}
