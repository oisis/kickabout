// Career screens: start, club hub, squad and transfers, market, inbox, tables, finances, history.
import { newCareer, finishStep, userFixture, teamOf, division, month, leaguePosition, expectedPosition, buy, acceptSale, acceptJob, freeTransfer, SEASONS, type Career } from './career.ts';
import { simulate, standings, roundFixtures, stageName, decisive, type Fixture } from './competition.ts';
import { TEAMS, POS, LEAGUE_COUNTRIES, DIVISIONS, ROMAN, rating, value } from './data.ts';
import { makeSpec } from './match.ts';
import { options, slots, saveSlot, deleteSlot } from './store.ts';
import { h, show, title, btn, row, back, select, input, table, toast } from './ui.ts';
import { lineupScreen } from './screens.ts';
import type { App } from './main.ts';
import { t as tr, lang } from './i18n.ts';

const money = (k: number) => tr('{0} tys.', `${k < 0 ? '−' : ''}${Math.abs(k).toLocaleString(lang())}`);
const save = (c: Career) => saveSlot('careers', c.name, c) || toast(tr('Brak miejsca na zapis'));

export function careerMenu(app: App) {
  const saved = slots<Career>('careers').filter((x) => Array.isArray(x.data.calendar)); // saves from before per-country careers are not loadable
  const state = { name: tr('Kariera {0}', saved.length + 1), country: LEAGUE_COUNTRIES[0].code, club: '', mode: 'player' as Career['mode'] };
  const clubs = () => TEAMS.filter((x) => !x.national && x.country === state.country);
  state.club = clubs()[0].id;
  const draw = () => show(
    title(tr('Kariera'), tr('Prowadź klub przez 20 sezonów: liga, puchar, transfery i finanse')),
    input(tr('Nazwa zapisu'), state.name, (v) => { state.name = v; }),
    select(tr('Liga'), state.country, LEAGUE_COUNTRIES.map((x): [string, string] => [x.code, x.name]), (v) => { state.country = v; state.club = clubs()[0].id; draw(); }),
    select(tr('Klub'), state.club, clubs().map((x): [string, string] => [x.id, tr('{0} ({1} liga, siła {2})', x.name, ROMAN[x.division - 1], x.level)]), (v) => { state.club = v; }),
    select(tr('Rola'), state.mode, [['player', tr('Grający trener — sterujesz drużyną w meczach')], ['coach', tr('Trener — ustalasz skład, taktykę i zmiany')]], (v) => { state.mode = v; }),
    btn(tr('Rozpocznij karierę'), () => {
      if (saved.some((x) => x.name === state.name) && !confirm(tr('Zapis o tej nazwie zostanie nadpisany. Kontynuować?'))) return;
      const c = newCareer(state.name.trim() || tr('Kariera'), state.club, state.mode);
      save(c);
      hub(app, c);
    }, 'primary'),
    saved.length > 0 && h('h3', {}, tr('Zapisane kariery')),
    h('ul', { className: 'list' }, ...saved.map((x) => h('li', {},
      h('span', {}, tr('{0} — {1}, sezon {2}', x.name, x.data.club ? teamOf(x.data, x.data.club).name : tr('bez klubu'), x.data.season)),
      btn('▶', () => hub(app, x.data)),
      btn('✕', () => { if (confirm(tr('Usunąć „{0}”?', x.name))) { deleteSlot('careers', x.name); careerMenu(app); } }, 'ghost'),
    ))),
    back(() => app.menu()),
  );
  draw();
}

const fixtureName = (c: Career, f: Fixture) => `${teamOf(c, f.home)?.name ?? '—'} – ${teamOf(c, f.away)?.name ?? '—'}`;

export function hub(app: App, c: Career) {
  if (c.over) return over(app, c);
  if (!c.club) return inbox(app, c);
  const me = teamOf(c, c.club), mine = userFixture(c), step = c.calendar[c.step];
  const jobs = c.inbox.filter((o) => o.kind === 'job').length, offers = c.inbox.length;
  show(
    title(me.name, tr('Sezon {0}/{1} ({2}/{3}) • {4} liga, {5}. miejsce (cel: {6}.) • {7}', c.year, c.year + 1, c.season, SEASONS, ROMAN[division(c)], leaguePosition(c), expectedPosition(c), money(c.balance))),
    ...c.messages.slice(0, 2).map((m) => h('p', { className: 'msg' }, m)),
    mine
      ? h('nav', {},
        h('p', { className: 'sub' }, `${step.kind === 'cup' ? tr('Puchar kraju – {0}', stageName(c.cup)) : tr('Liga – kolejka {0}', (step as { round: number }).round + 1)}`),
        btn(tr('Graj: {0}', fixtureName(c, mine.f)), () => play(app, c, mine.f), 'primary big'),
        btn(tr('Symuluj mój mecz'), () => {
          const r = simulate(mine.comp, mine.f, teamOf(c, mine.f.home), teamOf(c, mine.f.away));
          finishStep(c, r); save(c); hub(app, c);
        }, 'ghost'))
      : btn(step?.kind === 'cup' ? tr('Dalej (nie grasz w tej rundzie pucharu)') : tr('Dalej'), () => { finishStep(c, null); save(c); hub(app, c); }, 'primary big'),
    h('nav', {},
      btn(tr('Skład i taktyka'), () => lineupScreen(me, c.lineup, () => { save(c); hub(app, c); })),
      btn(tr('Kadra i sprzedaż'), () => squad(app, c)),
      btn(tr('Rynek transferowy'), () => market(app, c)),
      btn(tr('Skrzynka{0}{1}', offers ? ` (${offers})` : '', jobs ? tr(' — oferty pracy!') : ''), () => inbox(app, c)),
      btn(tr('Tabele'), () => tables(app, c)),
      btn(tr('Puchar kraju'), () => cup(app, c)),
      btn(tr('Finanse'), () => finances(app, c)),
      btn(tr('Historia'), () => history(app, c)),
      btn(tr('Menu'), () => app.menu(), 'ghost'),
    ),
  );
}

function play(app: App, c: Career, f: Fixture) {
  const mine = userFixture(c)!, side = f.home === c.club ? 0 : 1;
  const human = c.mode === 'player' ? 1 : 0;
  const spec = makeSpec(
    { team: teamOf(c, f.home), human: side === 0 ? human : 0, ...(side === 0 ? c.lineup : {}) },
    { team: teamOf(c, f.away), human: side === 1 ? human : 0, ...(side === 1 ? c.lineup : {}) },
    options(),
    { extraTime: decisive(mine.comp, f), penalties: decisive(mine.comp, f), month: month(c) },
  );
  spec.manage = [side];
  app.startMatch(spec, (s, run) => {
    const goals = s.stats.goals.filter((g) => !g.og).map((g) => ({ team: g.t === 0 ? f.home : f.away, name: run.info.players[g.t][g.n] }));
    finishStep(c, { result: { h: s.score[0], a: s.score[1], et: s.tick > s.regTicks || undefined, pens: s.so?.goals }, goals });
    save(c);
    hub(app, c);
  });
}

function squad(app: App, c: Career) {
  const me = teamOf(c, c.club);
  show(
    title(tr('Kadra'), tr('{0} zawodników • wartość {1}', me.players.length, money(me.players.reduce((a, p) => a + value(p), 0)))),
    table([tr('Poz'), tr('Zawodnik'), tr('Wiek'), tr('Oc'), tr('Wartość'), ''], me.players.map((p) => [
      tr(POS[p.pos]), p.name, p.age, p.pos === 0 ? p.gk : rating(p), money(value(p)),
      row(
        btn(c.forSale.includes(p.name) ? tr('wycofaj') : tr('sprzedaj'), () => {
          c.forSale = c.forSale.includes(p.name) ? c.forSale.filter((n) => n !== p.name) : [...c.forSale, p.name];
          save(c); squad(app, c);
        }, 'ghost'),
        btn(tr('zwolnij'), () => { if (confirm(tr('Oddać {0} za darmo?', p.name))) { toast(freeTransfer(c, p.name)); save(c); squad(app, c); } }, 'ghost'),
      ),
    ])),
    h('p', { className: 'hint' }, tr('Zawodnicy wystawieni na sprzedaż dostają oferty w kolejnych tygodniach (Skrzynka).')),
    back(() => hub(app, c)),
  );
}

function market(app: App, c: Career) {
  show(
    title(tr('Rynek transferowy'), tr('Budżet: {0} • lista odświeża się co kilka tygodni', money(c.balance))),
    table([tr('Zawodnik'), tr('Klub'), tr('Poz'), tr('Wiek'), tr('Oc'), tr('Cena')], c.market.map((m) => {
      const p = teamOf(c, m.team).players.find((x) => x.name === m.name);
      return [m.name, teamOf(c, m.team).short, p ? tr(POS[p.pos]) : '', p?.age ?? '', p ? (p.pos === 0 ? p.gk : rating(p)) : '', money(m.price)];
    }), (i) => {
      const m = c.market[i];
      const v = prompt(tr('Oferta za {0} (tys.), cena wywoławcza {1}:', m.name, m.price), String(m.price));
      if (!v) return;
      toast(buy(c, i, Math.max(0, parseInt(v, 10) || 0)));
      c.lineup = {};
      save(c);
      market(app, c);
    }),
    h('p', { className: 'hint' }, tr('Dotknij zawodnika, aby złożyć ofertę.')),
    back(() => hub(app, c)),
  );
}

function inbox(app: App, c: Career) {
  show(
    title(tr('Skrzynka')),
    ...c.messages.slice(0, 6).map((m) => h('p', { className: 'msg' }, m)),
    h('ul', { className: 'list' }, ...c.inbox.map((o) => h('li', {},
      h('span', {}, o.kind === 'job' ? tr('Oferta pracy: trener w {0} ({1} liga)', teamOf(c, o.team).name, ROMAN[division(c, o.team)]) : tr('{0} oferuje {1} za {2}', teamOf(c, o.team).name, money(o.fee!), o.player!)),
      btn(tr('Przyjmij'), () => {
        if (o.kind === 'job') acceptJob(c, o);
        else toast(acceptSale(c, o));
        save(c); hub(app, c);
      }, 'primary'),
      btn(tr('Odrzuć'), () => { c.inbox = c.inbox.filter((x) => x !== o); save(c); inbox(app, c); }, 'ghost'),
    ))),
    !c.inbox.length && h('p', { className: 'sub' }, tr('Brak ofert.')),
    c.club ? back(() => hub(app, c)) : btn(tr('Menu'), () => app.menu(), 'ghost'),
  );
}

function tables(app: App, c: Career) {
  show(
    title(tr('Tabele')),
    ...c.leagues.flatMap((l, i) => [h('h3', {}, DIVISIONS[i]),
      table(['#', tr('Drużyna'), tr('M'), tr('Pkt'), tr('Bramki')], standings(l, c.divisions[i]).map((r, k) => [k + 1, teamOf(c, r.team).name, r.p, r.pts, `${r.gf}:${r.ga}`]), undefined, (k) => standings(l, c.divisions[i])[k].team === c.club)]),
    h('p', { className: 'hint' }, tr('Z każdej ligi dwie ostatnie drużyny spadają, a dwie pierwsze awansują wyżej.')),
    back(() => hub(app, c)),
  );
}

function cup(app: App, c: Career) {
  const rounds = [...new Set(c.cup.fixtures.map((f) => f.round))];
  show(
    title(tr('Puchar kraju'), c.cup.winner ? tr('Zwycięzca: {0}', teamOf(c, c.cup.winner).name) : stageName(c.cup)),
    ...rounds.flatMap((r) => [h('h3', {}, stageName(c.cup, r)), table(['', '', ''], roundFixtures(c.cup, r).map((f) => [teamOf(c, f.home)?.short ?? '—', f.result ? `${f.result.h}:${f.result.a}${f.result.pens ? ` ${tr('k.')}${f.result.pens.join(':')}` : ''}` : '–', teamOf(c, f.away)?.short ?? '—']))]),
    back(() => hub(app, c)),
  );
}

const LEDGER: Record<string, string> = { gate: 'Wpływy z meczów', wages: 'Pensje zawodników', buys: 'Zakupy zawodników', sales: 'Sprzedaż zawodników', prizes: 'Nagrody' };
const cupText = (x: Career['history'][number]) => (x.cup === 'won' ? tr('zwycięstwo') : x.cup === 'out' ? tr('odpadnięcie') : '–');

function finances(app: App, c: Career) {
  show(
    title(tr('Wyciąg bankowy'), tr('Sezon {0}/{1}', c.year, c.year + 1)),
    table([tr('Pozycja'), tr('Kwota')], [[tr('Saldo na początku sezonu'), money(c.startBalance)], ...Object.entries(c.ledger).map(([k, v]) => [tr(LEDGER[k] ?? k), money(v)]), [tr('Saldo obecne'), money(c.balance)]]),
    back(() => hub(app, c)),
  );
}

function history(app: App, c: Career) {
  show(
    title(tr('Historia kariery')),
    c.history.length ? table([tr('Sezon'), tr('Klub'), tr('Liga'), tr('Miejsce'), tr('Puchar')], c.history.map((x) => [`${x.year}/${x.year + 1}`, teamOf(c, x.club).name, ROMAN[x.div], x.pos, cupText(x)])) : h('p', { className: 'sub' }, tr('Pierwszy sezon w toku.')),
    back(() => hub(app, c)),
  );
}

function over(app: App, c: Career) {
  show(
    title(tr('Koniec kariery'), c.over),
    c.history.length > 0 && table([tr('Sezon'), tr('Klub'), tr('Liga'), tr('Miejsce'), tr('Puchar')], c.history.map((x) => [`${x.year}/${x.year + 1}`, teamOf(c, x.club).name, ROMAN[x.div], x.pos, cupText(x)])),
    btn(tr('Menu'), () => app.menu(), 'primary'),
  );
}
