// Competition screens: presets and DIY setup, the hub, tables, scorers, playing fixtures.
import { create, record, roundFixtures, simulate, standings, topScorers, stageName, isHuman, decisive, firstLeg, PRESETS, DEFAULT_RULES, type Competition, type Fixture, type Kind, type Rules } from './competition.ts';
import { team, type TeamDef } from './data.ts';
import { makeSpec, type Side } from './match.ts';
import { options, slots, saveSlot, deleteSlot, customTeams, download, upload } from './store.ts';
import { h, show, title, btn, row, back, select, toggle, input, table, toast } from './ui.ts';
import { allTeams, lineupScreen } from './screens.ts';
import { LEAGUE_COUNTRIES, leagueLabel } from './data.ts';
import type { App } from './main.ts';
import { t as tr } from './i18n.ts';

type Comp = Competition & { lineups?: Record<string, Partial<Side>> };
const T = (id: string): TeamDef => team(id, customTeams());
const name = (id: string) => (id ? T(id).name : '—');

export function compMenu(app: App) {
  const saved = slots<Comp>('comps');
  show(
    title(tr('Rozgrywki')),
    h('nav', {},
      ...[...new Set(PRESETS.map((p) => p.group))].flatMap((group) => [
        h('h3', {}, group),
        h('div', { className: 'presets' }, ...PRESETS.map((p, i) => [p, i] as const).filter(([p]) => p.group === group).map(([p, i]) => btn(p.name.startsWith(`${group} – `) ? p.name.slice(group.length + 3) : p.name, () => chooseHumans(app, preset(i))))),
      ]),
      btn(tr('Własne rozgrywki…'), () => diy(app), 'primary'),
    ),
    saved.length > 0 && h('h3', {}, tr('Zapisane')),
    h('ul', { className: 'list' }, ...saved.map((x) => h('li', {},
      h('span', {}, `${x.name} — ${x.date}`),
      btn('▶', () => hub(app, x.data)),
      btn('✕', () => { if (confirm(tr('Usunąć „{0}”?', x.name))) { deleteSlot('comps', x.name); compMenu(app); } }, 'ghost'),
    ))),
    row(btn(tr('Importuj'), async () => {
      try { const c = (await upload()) as Comp; if (!c?.fixtures) throw 0; hub(app, c); } catch { toast(tr('To nie jest plik rozgrywek')); }
    }, 'ghost'), back(() => app.menu())),
  );
}

function preset(i: number): Comp {
  const p = PRESETS[i];
  return create(p.name, p.kind, p.teams(allTeams()), {}, { ...DEFAULT_RULES, ...p.rules });
}

function chooseHumans(app: App, c: Comp) {
  const draw = () => show(
    title(c.name, tr('Wybierz drużyny, którymi grasz (pozostałe prowadzi komputer)')),
    table([tr('Drużyna'), tr('Steruje')], c.teams.map((id) => [name(id), select('', c.humans[id] ?? 0, [[0, tr('Komputer')], [1, tr('Gracz 1')], [2, tr('Gracz 2')]], (v) => { if (v) c.humans[id] = v; else delete c.humans[id]; })])),
    row(back(() => compMenu(app)), btn(tr('Rozpocznij'), () => {
      if (!Object.keys(c.humans).length && !confirm(tr('Nie wybrano żadnej drużyny — tylko oglądać wyniki?'))) return;
      save(c);
      hub(app, c);
    }, 'primary')),
  );
  draw();
}

function diy(app: App) {
  const state = { show: `${LEAGUE_COUNTRIES[0].code}:1`, name: tr('Moje rozgrywki'), kind: 'league' as Kind, rules: { ...DEFAULT_RULES, minutes: options().minutes } as Rules, teams: new Set<string>() };
  const draw = () => {
    const all = allTeams();
    const groups: [string, string][] = [
      ...LEAGUE_COUNTRIES.flatMap(({ code, name: n }) => [1, 2, 3, 4].map((d): [string, string] => [`${code}:${d}`, leagueLabel(n, d)])),
      ['n:eu', tr('Reprezentacje – Europa')], ['n:world', tr('Reprezentacje – reszta świata')],
    ];
    const pick = (k: string) => {
      const [a, b] = k.split(':');
      return all.filter((x) => (a === 'n' ? x.national && x.country === b : !x.national && x.country === a && x.division === Number(b)));
    };
    show(
      title(tr('Własne rozgrywki')),
      input(tr('Nazwa'), state.name, (v) => { state.name = v; }),
      select(tr('Rodzaj'), state.kind, [['league', tr('Liga')], ['cup', tr('Puchar')], ['tournament', tr('Turniej (grupy + puchar)')]], (v) => { state.kind = v; draw(); }),
      state.kind === 'league' && select(tr('Rundy'), state.rules.rounds, [[1, tr('Jedna runda')], [2, tr('Mecz i rewanż')]], (v) => { state.rules.rounds = v; }),
      state.kind !== 'league' && select(tr('Mecze w pucharze'), state.rules.legs, [[1, tr('Jeden mecz')], [2, tr('Dwumecz')]], (v) => { state.rules.legs = v; }),
      state.kind === 'tournament' && select(tr('Grupy'), state.rules.groups, [[2, '2 grupy'], [4, '4 grupy'], [8, '8 grup']], (v) => { state.rules.groups = v; }),
      state.kind === 'tournament' && select(tr('Awans z grupy'), state.rules.advance, [[1, tr('1 drużyna')], [2, tr('2 drużyny')]], (v) => { state.rules.advance = v; }),
      state.kind !== 'cup' && select(tr('Punkty za zwycięstwo'), state.rules.win, [[3, '3'], [2, '2']], (v) => { state.rules.win = v; }),
      state.kind !== 'league' && toggle(tr('Bramki na wyjeździe'), state.rules.awayGoals, (v) => { state.rules.awayGoals = v; }),
      state.kind !== 'league' && toggle(tr('Dogrywka'), state.rules.extraTime, (v) => { state.rules.extraTime = v; }),
      state.kind !== 'league' && toggle(tr('Rzuty karne'), state.rules.penalties, (v) => { state.rules.penalties = v; }),
      select(tr('Długość meczu'), state.rules.minutes ?? 3, [[3, '3 min'], [5, '5 min'], [7, '7 min'], [10, '10 min']], (v) => { state.rules.minutes = v; }),
      h('p', { className: 'sub' }, tr('Drużyny ({0}):', state.teams.size)),
      // Whole leagues or national-team pools are added at once; the list below shows one group at a time.
      select(tr('Dodaj drużyny'), '', [['', tr('— wybierz —')], ...groups.map(([k, label]): [string, string] => [k, label])], (k) => { pick(k).forEach((x) => state.teams.add(x.id)); state.show = k; draw(); }),
      select(tr('Pokaż'), state.show, groups.map(([k, label]): [string, string] => [k, label]), (k) => { state.show = k; draw(); }),
      btn(tr('Wyczyść'), () => { state.teams.clear(); draw(); }, 'ghost'),
      h('div', { className: 'checks' }, ...pick(state.show).map((x) => toggle(x.name, state.teams.has(x.id), (v) => { if (v) state.teams.add(x.id); else state.teams.delete(x.id); draw(); }))),
      row(back(() => compMenu(app)), btn(tr('Dalej'), () => {
        const ids = all.filter((t) => state.teams.has(t.id)).map((t) => t.id);
        const min = state.kind === 'tournament' ? state.rules.groups * 2 : 2;
        if (ids.length < min) return toast(tr('Wybierz co najmniej {0} drużyny', min));
        if (slots('comps').some((x) => x.name === state.name) && !confirm(tr('Zapis o tej nazwie zostanie nadpisany. Kontynuować?'))) return;
        chooseHumans(app, create(state.name.trim() || tr('Rozgrywki'), state.kind, ids, {}, state.rules));
      }, 'primary')),
    );
  };
  draw();
}

const save = (c: Comp) => saveSlot('comps', c.name, c) || toast(tr('Brak miejsca na zapis'));

function resultText(f: Fixture) {
  if (!f.home || !f.away) return tr('wolny los');
  if (!f.result) return '–';
  const r = f.result;
  return `${r.h}:${r.a}${r.et ? ` ${tr('pd.')}` : ''}${r.pens ? ` (${tr('k.')} ${r.pens[0]}:${r.pens[1]})` : ''}`;
}

export function hub(app: App, c: Comp) {
  const fixtures = roundFixtures(c);
  const next = fixtures.find((f) => !f.result && isHuman(c, f) && f.home && f.away);
  show(
    title(c.name, c.winner ? tr('🏆 Zwycięzca: {0}', name(c.winner)) : stageName(c)),
    !c.winner && table([tr('Gospodarze'), '', tr('Goście')], fixtures.map((f) => [name(f.home), resultText(f), name(f.away)])),
    !c.winner && next && btn(tr('Graj: {0} – {1}', name(next.home), name(next.away)), () => prematch(app, c, next), 'primary big'),
    !c.winner && !next && btn(tr('Rozegraj kolejkę'), () => { simulateRound(c); save(c); hub(app, c); }, 'primary big'),
    !c.winner && next && btn(tr('Symuluj mój mecz'), () => {
      const { result, goals } = simulate(c, next, T(next.home), T(next.away));
      record(c, next, result, goals);
      save(c); hub(app, c);
    }, 'ghost'),
    h('nav', {},
      c.kind !== 'cup' && btn(c.kind === 'tournament' ? tr('Grupy') : tr('Tabela'), () => tables(app, c)),
      btn(tr('Terminarz i wyniki'), () => results(app, c)),
      btn(tr('Strzelcy'), () => scorers(app, c)),
      row(btn(tr('Eksportuj'), () => download(`${c.name}.json`, c), 'ghost'), btn(tr('Menu'), () => app.menu(), 'ghost')),
    ),
  );
}

/** Computer-only fixtures of the current round; human ones are left to be played. */
function simulateRound(c: Comp) {
  const round = c.round;
  for (const f of roundFixtures(c, round)) {
    if (f.result || isHuman(c, f)) continue;
    if (!f.home || !f.away) { record(c, f, { h: 0, a: 0 }, []); continue; }
    const { result, goals } = simulate(c, f, T(f.home), T(f.away));
    record(c, f, result, goals);
    if (c.round !== round) break;
  }
}

function prematch(app: App, c: Comp, f: Fixture) {
  c.lineups ??= {};
  const sides = [f.home, f.away].map((id) => (c.lineups![id] ??= {}));
  const leg1 = firstLeg(c, f);
  show(
    title(`${name(f.home)} – ${name(f.away)}`, `${stageName(c)}${leg1?.result ? tr(' • pierwszy mecz {0}:{1}', leg1.result.h, leg1.result.a) : ''}`),
    ...[f.home, f.away].map((id, i) => c.humans[id] && btn(tr('Skład i taktyka: {0}', name(id)), () => lineupScreen(T(id), sides[i], () => prematch(app, c, f)))),
    row(back(() => hub(app, c)), btn(tr('Graj!'), () => play(app, c, f), 'primary')),
  );
}

function play(app: App, c: Comp, f: Fixture) {
  const o = options(), must = decisive(c, f), leg1 = firstLeg(c, f);
  const spec = makeSpec(
    { team: T(f.home), human: c.humans[f.home] ?? 0, ...c.lineups?.[f.home] },
    { team: T(f.away), human: c.humans[f.away] ?? 0, ...c.lineups?.[f.away] },
    o,
    { minutes: c.rules.minutes, extraTime: must && c.rules.extraTime, penalties: must && (c.rules.penalties || !c.rules.extraTime), month: c.month },
  );
  if (leg1?.result) spec.setup.tie = { agg: [leg1.result.a, leg1.result.h], awayGoals: c.rules.awayGoals };
  app.startMatch(spec, (s, run) => {
    const result = { h: s.score[0], a: s.score[1], et: s.tick > s.regTicks || undefined, pens: s.so?.goals };
    // Own goals count for the score but not for the scorers' table.
    const goals = s.stats.goals.filter((g) => !g.og).map((g) => ({ team: g.t === 0 ? f.home : f.away, name: run.info.players[g.t][g.n] }));
    record(c, f, result, goals);
    simulateRound(c);
    save(c);
    hub(app, c);
  });
}

function tables(app: App, c: Comp) {
  const groups = c.kind === 'tournament' ? c.groups : [c.teams];
  show(
    title(c.kind === 'tournament' ? tr('Grupy') : tr('Tabela')),
    ...groups.flatMap((g, gi) => [
      groups.length > 1 && h('h3', {}, tr('Grupa {0}', String.fromCharCode(65 + gi))),
      table(['#', tr('Drużyna'), 'M', 'Z', 'R', 'P', tr('Bramki'), tr('Pkt')], standings(c, g).map((r, i) => [i + 1, name(r.team), r.p, r.w, r.d, r.l, `${r.gf}:${r.ga}`, r.pts]), undefined, (i) => !!c.humans[standings(c, g)[i].team]),
    ]),
    back(() => hub(app, c)),
  );
}

function results(app: App, c: Comp) {
  const rounds = [...new Set(c.fixtures.map((f) => f.round))];
  show(
    title(tr('Terminarz i wyniki')),
    ...rounds.flatMap((r) => [h('h3', {}, stageName(c, r)), table([tr('Gospodarze'), '', tr('Goście')], roundFixtures(c, r).map((f) => [name(f.home), resultText(f), name(f.away)]))]),
    back(() => hub(app, c)),
  );
}

function scorers(app: App, c: Comp) {
  const list = topScorers(c);
  show(
    title(tr('Najlepsi strzelcy')),
    list.length ? table(['#', tr('Zawodnik'), tr('Drużyna'), tr('Gole')], list.map((s, i) => [i + 1, s.name, T(s.team).short, s.goals])) : h('p', { className: 'sub' }, tr('Jeszcze nikt nie strzelił gola.')),
    back(() => hub(app, c)),
  );
}
