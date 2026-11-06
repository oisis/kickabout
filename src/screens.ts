// Menu screens. Each function renders one screen into the #ui overlay.
import { FORMATIONS, PITCHES, CMD_SUB, CMD_TACTIC, cmd, lineOf, type State } from './sim.ts';
import { TEAMS, POS, LEAGUE_COUNTRIES, leagueLabel, type TeamDef, team, rating, pickLineup, onlineMatch } from './data.ts';
import { type MatchRun, type Side, makeSpec, choosePitch } from './match.ts';
import { type Options, options, saveOptions, minuteOptions, MATCH_MINUTES, highlights, deleteHighlight, addHighlights, download, upload, customTeams, customTactics, type Highlight } from './store.ts';
import { statRows } from './render.ts';
import { Net, savedServer, serverUrl, siteUrl, liveServer } from './net.ts';
import { h, show, title, btn, row, back, select, toggle, input, table, toast } from './ui.ts';
import type { App } from './main.ts';
import { compMenu } from './compScreens.ts';
import { clubMenu } from './clubScreens.ts';
import { token } from './api.ts';
import { careerMenu } from './careerScreens.ts';
import { editorMenu } from './editors.ts';
import { t as tr, lang, setLang, LANGS } from './i18n.ts';
import pkg from '../package.json' with { type: 'json' };

export function mainMenu(app: App) {
  show(
    logo(),
    h('nav', {},
      btn(tr('Mecz towarzyski'), () => friendly(app), 'big'),
      btn(tr('Rozgrywki'), () => compMenu(app), 'big'),
      btn(tr('Kariera'), () => careerMenu(app), 'big'),
      btn(tr('Edytory drużyn i taktyk'), () => editorMenu(app)),
      btn(tr('Gra online'), () => online(app), 'big'),
      btn(tr('Mój klub (online)'), () => clubMenu(app), 'big'),
      btn(tr('Najlepsze momenty'), () => highlightsScreen(app)),
      btn(tr('Opcje'), () => optionsScreen(app)),
      // The app opens it in the system browser (Capacitor hands off external URLs).
      siteUrl() && btn(tr('Strona www i konto'), () => { location.href = siteUrl(); }, 'ghost'),
    ),
    h('p', { className: 'hint' }, `Kickabout ${pkg.version}`),
    h('p', { className: 'hint' }, tr('Dotyk: lewa strona – bieg, po prawej PODANIE i STRZAŁ (przytrzymaj = mocniej), bez piłki – wślizg. Klawiatura: strzałki, spacja = podanie, M = strzał (gracz 2: WASD, F = podanie, G = strzał). Pad: drążek, A = podanie, B = strzał, Start = pauza.')),
  );
}

/** KICKABOUT with a football for the O (static SVG markup). */
const BALL_SVG = '<svg class="ball" viewBox="-50 -50 100 100" aria-hidden="true"><defs><clipPath id="ball-clip"><circle r="46"/></clipPath></defs><circle r="46" fill="#fff"/><g clip-path="url(#ball-clip)" fill="#111"><polygon points="0.0,-16.0 15.2,-4.9 9.4,12.9 -9.4,12.9 -15.2,-4.9"/><polygon points="0.0,-34.0 -12.4,-43.0 -7.6,-57.5 7.6,-57.5 12.4,-43.0"/><polygon points="32.3,-10.5 37.1,-25.0 52.3,-25.0 57.1,-10.5 44.7,-1.5"/><polygon points="20.0,27.5 35.3,27.5 40.0,42.0 27.6,51.0 15.3,42.0"/><polygon points="-20.0,27.5 -15.3,42.0 -27.6,51.0 -40.0,42.0 -35.3,27.5"/><polygon points="-32.3,-10.5 -44.7,-1.5 -57.1,-10.5 -52.3,-25.0 -37.1,-25.0"/><path d="M0.0 -16.0L0.0 -36.0 M15.2 -4.9L34.2 -11.1 M9.4 12.9L21.2 29.1 M-9.4 12.9L-21.2 29.1 M-15.2 -4.9L-34.2 -11.1" stroke="#333" stroke-width="2.5"/></g><circle r="46" fill="none" stroke="#111" stroke-width="4"/></svg>';
function logo() {
  const el = h('div', { className: 'logo', role: 'img', ariaLabel: 'Kickabout' });
  el.innerHTML = `KICKAB${BALL_SVG}UT`;
  return el;
}

export const allTeams = (): TeamDef[] => TEAMS.map((t) => team(t.id, customTeams()));
const COUNTRY_NAME = new Map(LEAGUE_COUNTRIES.map((c) => [c.code, c.name]));
/** Team picker options grouped by league division and national-team region. */
export const teamOptions = (): [string, string, string][] => allTeams().map((x) => [x.id, x.name,
  x.national ? (x.country === 'eu' ? tr('Reprezentacje – Europa') : tr('Reprezentacje – reszta świata')) : leagueLabel(COUNTRY_NAME.get(x.country) ?? x.country, x.division)]);
const CONTROL: [number, string][] = [[1, tr('Gracz 1')], [2, tr('Gracz 2')], [0, tr('Komputer')]];

function friendly(app: App, state = { home: TEAMS[0].id, away: TEAMS[1].id, hh: 1, ah: 0, pitch: options().pitch, sides: [{}, {}] as Partial<Side>[] }) {
  const again = () => friendly(app, state);
  const o = options();
  show(
    title(tr('Mecz towarzyski')),
    select(tr('Gospodarze'), state.home, teamOptions(), (v) => { state.home = v; state.sides[0] = {}; again(); }),
    select(tr('Steruje'), state.hh, CONTROL, (v) => { state.hh = v; }),
    btn(tr('Skład i taktyka gospodarzy'), () => lineupScreen(team(state.home, customTeams()), state.sides[0], again), 'ghost'),
    select(tr('Goście'), state.away, teamOptions(), (v) => { state.away = v; state.sides[1] = {}; again(); }),
    select(tr('Steruje'), state.ah, CONTROL, (v) => { state.ah = v; }),
    btn(tr('Skład i taktyka gości'), () => lineupScreen(team(state.away, customTeams()), state.sides[1], again), 'ghost'),
    select(tr('Murawa'), state.pitch, pitchOptions(), (v) => { state.pitch = v; }),
    h('p', { className: 'hint' }, tr('Długość: {0} min • dogrywka: {1} • karne: {2} (zmień w Opcjach)', o.minutes, o.extraTime ? 'tak' : 'nie', o.penalties ? 'tak' : 'nie')),
    row(back(() => app.menu()), btn(tr('Graj!'), () => {
      const custom = customTeams();
      const spec = makeSpec(
        { team: team(state.home, custom), human: state.hh, ...state.sides[0] },
        { team: team(state.away, custom), human: state.ah, ...state.sides[1] },
        { ...o, pitch: state.pitch },
      );
      app.startMatch(spec, () => friendly(app, state));
    }, 'primary')),
  );
}

export const pitchOptions = (): [number, string][] => [...PITCHES.map((p, i): [number, string] => [i, tr(p.name)]), [7, tr('Losowa')], [8, tr('Zależna od pory roku')]];

export function optionsScreen(app: App) {
  const o = options();
  const set = <K extends keyof Options>(k: K) => (v: Options[K]) => { o[k] = v; saveOptions(o); app.applyOptions(); };
  show(
    title(tr('Opcje')),
    select(tr('Długość meczu'), o.minutes, minuteOptions(), set('minutes')),
    toggle(tr('Dogrywka przy remisie'), o.extraTime, set('extraTime')),
    toggle(tr('Rzuty karne przy remisie'), o.penalties, set('penalties')),
    select(tr('Murawa (domyślna)'), o.pitch, pitchOptions(), set('pitch')),
    toggle(tr('Automatyczne powtórki goli'), o.autoReplay, set('autoReplay')),
    toggle(tr('Zapisuj najlepsze momenty'), o.autoSaveHighlights, set('autoSaveHighlights')),
    toggle(tr('Dźwięk'), o.sound, set('sound')),
    toggle(tr('Muzyka w menu'), o.music, set('music')),
    select(tr('Język / Language'), lang(), LANGS, (v) => setLang(v)),
    back(() => app.menu()),
  );
}

const SKILLS: [keyof TeamDef['players'][0], string][] = [['pa', tr('Pod')], ['sh', tr('Str')], ['he', tr('Gło')], ['ta', tr('Odb')], ['co', tr('Kon')], ['sp', tr('Szy')]];
const tacticNames = () => [...FORMATIONS.map((f) => f.name), ...customTactics().map((c) => c.name)];
const tacticShapes = () => [...FORMATIONS.map((f) => f.pos), ...customTactics().map((c) => c.pos)];

function playerRow(t: TeamDef, n: number, label: string) {
  const p = t.players[n];
  return [label, tr(POS[p.pos]), p.name, ...SKILLS.map(([k]) => (p.pos === 0 && k !== 'sp' ? '–' : p[k] as number)), p.pos === 0 ? p.gk : rating(p)];
}

/** Pre-match lineup: pick a tactic and swap any two players (starters or bench). */
export function lineupScreen(t: TeamDef, side: Partial<Side>, done: () => void) {
  side.tactic ??= t.formation;
  side.lineup ??= pickLineup(t.players, tacticShapes()[side.tactic]);
  let picked = -1;
  const draw = () => {
    const lineup = side.lineup!, bench = t.players.map((_, i) => i).filter((i) => !lineup.includes(i));
    const order = [...lineup, ...bench];
    const shape = tacticShapes()[side.tactic!];
    show(
      title(t.name, tr('Dotknij dwóch zawodników, aby zamienić ich miejscami')),
      select(tr('Taktyka'), side.tactic!, tacticNames().map((n, i): [number, string] => [i, n]), (v) => { side.tactic = v; side.lineup = pickLineup(t.players, tacticShapes()[v]); draw(); }),
      table(['', tr('Poz'), tr('Zawodnik'), ...SKILLS.map(([, l]) => l), tr('Oc')],
        order.map((n, i) => playerRow(t, n, i < 11 ? tr(POS[lineOf(shape[i], i)]) : tr('ław'))),
        (i) => {
          if (picked < 0) { picked = i; return draw(); }
          const a = order[picked], b = order[i];
          const la = lineup.indexOf(a), lb = lineup.indexOf(b);
          if (la >= 0) lineup[la] = b;
          if (lb >= 0) lineup[lb] = a;
          picked = -1;
          draw();
        },
        (i) => i === picked),
      row(btn(tr('Najlepszy skład'), () => { side.lineup = pickLineup(t.players, shape); draw(); }, 'ghost'), btn(tr('Gotowe'), done, 'primary')),
    );
  };
  draw();
}

/** In-match squad: tactic changes and substitutions go through the simulation as commands. */
function liveSquad(app: App, run: MatchRun, t: number) {
  const s = run.s;
  let picked = -1;
  const names = run.info.players[t];
  const draw = () => {
    const shape = s.tactics[t][s.tactic[t]];
    const rows = s.teams[t].map((p, i) => [tr(POS[lineOf(shape[i], i)]), names[p.n] + (p.off ? ` (${tr('cz. k.')})` : p.yel ? ' 🟨' : ''), p.pos === 0 ? p.gk : rating(p)]);
    const bench = s.bench[t].map((n) => [tr('ław'), names[n], s.squads[t][n].pos === 0 ? s.squads[t][n].gk : rating(s.squads[t][n])]);
    show(
      title(tr('Zmiany i taktyka'), tr('Pozostałe zmiany: {0} — dotknij zawodnika na boisku, potem rezerwowego', s.subsLeft[t])),
      select(tr('Taktyka'), s.tactic[t], tacticNames().slice(0, s.tactics[t].length).map((n, i): [number, string] => [i, n]), (v) => { run.command(t, cmd(CMD_TACTIC, v)); setTimeout(draw, 50); }),
      table(['', tr('Zawodnik'), tr('Oc')], [...rows, ...bench], (i) => {
        if (i < 11) { picked = i; return draw(); }
        if (picked < 0) return toast(tr('Najpierw wybierz zawodnika na boisku'));
        if (!s.subsLeft[t]) return toast(tr('Wykorzystano wszystkie zmiany'));
        run.command(t, cmd(CMD_SUB, picked, s.bench[t][i - 11]));
        picked = -1;
        setTimeout(draw, 50);
      }, (i) => i === picked),
      btn(tr('Gotowe'), () => pauseMenu(app, run), 'primary'),
    );
  };
  draw();
}

export function pauseMenu(app: App, run: MatchRun) {
  const local = !run.spec.net;
  const humanTeams = local ? [0, 1].filter((t) => run.spec.humans[t] || run.spec.manage?.includes(t)) : [run.me];
  show(
    title(tr('Pauza'), `${run.info.shorts[0]} ${run.s.score[0]}:${run.s.score[1]} ${run.info.shorts[1]}`),
    h('nav', {},
      btn(tr('Wznów'), () => run.togglePause(), 'primary big'),
      ...humanTeams.map((t) => btn(tr('Zmiany i taktyka{0}', humanTeams.length > 1 ? ` (${run.info.shorts[t]})` : ''), () => liveSquad(app, run, t))),
      app.voice && btn(app.voice.muted ? tr('Włącz mój mikrofon') : tr('Wycisz mój mikrofon'), () => { app.voice!.toggleMute(); pauseMenu(app, run); }),
      app.voice && btn(app.voice.deaf ? tr('Słuchaj przeciwnika') : tr('Wycisz przeciwnika'), () => { app.voice!.toggleDeaf(); pauseMenu(app, run); }),
      local && btn(tr('Powtórka'), () => {
        const clip = run.clip(run.s.frame - 360, tr('Ostatnie sekundy'));
        if (clip) run.play(clip);
      }),
      btn(tr('Wyjdź z meczu'), () => { if (confirm(tr('Wyjść z meczu? Wynik nie zostanie zapisany.'))) app.quitMatch(); }, 'ghost'),
    ),
  );
}

export function fullTime(app: App, run: MatchRun, next: () => void) {
  const s = run.s, info = run.info;
  show(
    title(tr('Koniec meczu')),
    h('div', { className: 'score' }, `${info.names[0]} ${s.score[0]} : ${s.score[1]} ${info.names[1]}`),
    s.so && h('p', { className: 'sub' }, `rzuty karne ${s.so.goals[0]}:${s.so.goals[1]}`),
    scorers(s, info.players),
    table(['', info.shorts[0], info.shorts[1]], statRows(s).map(([l, a, b]) => [l, a, b])),
    run.highlights.length > 0 && btn(tr('Obejrzyj gole ({0})', run.highlights.length), () => playAll(app, run.highlights, () => fullTime(app, run, next))),
    btn(tr('Dalej'), next, 'primary'),
  );
}

function scorers(s: State, players: string[][]) {
  if (!s.stats.goals.length) return null;
  return h('ul', { className: 'scorers' }, ...s.stats.goals.map((g) => {
    const owner = g.og ? 1 - g.t : g.t;
    return h('li', { className: g.t ? 'away' : 'home' }, `${g.min}' ${players[owner][g.n]}${g.og ? ' (sam.)' : ''}${g.pen ? ' (k.)' : ''}`);
  }));
}

function playAll(app: App, list: Highlight[], done: () => void, i = 0) {
  if (i >= list.length) return done();
  app.playHighlight(list[i], () => playAll(app, list, done, i + 1));
}

export function highlightsScreen(app: App) {
  const list = highlights();
  show(
    title(tr('Najlepsze momenty'), list.length ? tr('Zapisane automatycznie po meczach') : tr('Brak zapisanych goli')),
    list.length > 0 && btn(tr('▶ Odtwórz wszystkie'), () => playAll(app, list, () => highlightsScreen(app)), 'primary'),
    h('ul', { className: 'list' }, ...list.map((x, i) => h('li', {},
      h('span', {}, x.title),
      btn('▶', () => app.playHighlight(x, () => highlightsScreen(app))),
      btn('✕', () => { deleteHighlight(i); highlightsScreen(app); }, 'ghost'),
    ))),
    row(
      list.length > 0 && btn(tr('Eksportuj'), () => download('kickabout-highlights.json', list), 'ghost'),
      btn(tr('Importuj'), async () => {
        try {
          const data = await upload();
          if (!Array.isArray(data)) throw new Error();
          addHighlights(data as Highlight[]);
          highlightsScreen(app);
        } catch { toast(tr('To nie jest plik z momentami')); }
      }, 'ghost'),
    ),
    back(() => app.menu()),
  );
}

export function message(text: string, done: () => void) {
  show(title(text), btn(tr('OK'), done, 'primary'));
}

function online(app: App) {
  const o = options();
  const state = { address: savedServer(), team: TEAMS[0].id, club: false, voice: false, hidden: false, spectate: false, mode: 'quick', code: '', minutes: o.minutes, pitch: o.pitch, extraTime: o.extraTime, penalties: o.penalties };
  const draw = () => show(
    title(tr('Gra online'), tr('Obaj gracze łączą się z tym samym serwerem')),
    input(tr('Adres serwera'), state.address, (v) => { state.address = v; }, { placeholder: 'kickabout.oisis.pl', autocapitalize: 'off' }),
    select(tr('Twoja drużyna'), state.team, teamOptions(), (v) => { state.team = v; }),
    toggle(tr('Zagraj moim klubem online (nagrody, wymaga konta)'), state.club, (v) => { state.club = v; }),
    // Voice goes peer to peer (addresses are visible to the other phone): friends in a private room only.
    state.mode !== 'quick' && toggle(tr('Czat głosowy (gdy znajomy też go włączy)'), state.voice, (v) => { state.voice = v; }),
    // Fan zone on the website: quick matches are shown unless a player opts out; rooms only if the host allows it.
    state.mode === 'quick' && toggle(tr('Nie pokazuj mojego meczu w strefie kibica'), state.hidden, (v) => { state.hidden = v; }),
    state.mode === 'host' && toggle(tr('Pozwól oglądać w strefie kibica'), state.spectate, (v) => { state.spectate = v; }),
    select(tr('Tryb'), state.mode, [['quick', tr('Szybka gra — losowy przeciwnik')], ['host', tr('Załóż pokój dla znajomego')], ['join', tr('Dołącz do pokoju znajomego')]], (v) => { state.mode = v; draw(); }),
    state.mode === 'join' && input(tr('Kod pokoju'), state.code, (v) => { state.code = v.toUpperCase(); }, { maxLength: 4, autocapitalize: 'characters' }),
    // Both players propose a length; when they differ the server draws one of the two.
    select(tr('Długość meczu'), state.minutes, minuteOptions(), (v) => { state.minutes = v; }),
    state.mode !== 'join' && select(tr('Murawa'), state.pitch, pitchOptions(), (v) => { state.pitch = v; }),
    state.mode !== 'join' && toggle(tr('Dogrywka przy remisie'), state.extraTime, (v) => { state.extraTime = v; }),
    state.mode !== 'join' && toggle(tr('Rzuty karne przy remisie'), state.penalties, (v) => { state.penalties = v; }),
    h('p', { className: 'hint' }, tr('Murawę i zasady ustala gracz, który czekał pierwszy (założyciel pokoju). Gdy wybierzecie różną długość meczu, zostanie wylosowana jedna z dwóch.')),
    row(back(() => app.menu()), btn(tr('Połącz'), () => {
      if (!state.address.trim()) return toast(tr('Podaj adres serwera'));
      if (state.mode === 'join' && state.code.length !== 4) return toast(tr('Kod pokoju ma 4 litery'));
      // With `club` the server swaps in the player's online club (signed in by cookie or the app's token).
      const config = { team: team(state.team, customTeams()), club: state.club, voice: state.mode !== 'quick' && state.voice, hidden: state.hidden, spectate: state.mode === 'host' && state.spectate, minutes: state.minutes, pitch: choosePitch(state.pitch), extraTime: state.extraTime, penalties: state.penalties };
      const net = new Net(serverUrl(state.address), { room: state.mode === 'host' ? 'new' : state.mode === 'join' ? state.code : undefined, config, token: token() || undefined });
      net.onStart = () => { app.startMatch(onlineSpec(net)); app.startVoice(net); };
      app.startMatch({ ...makeSpec({ team: config.team, human: 1 }, { team: TEAMS[1], human: 0 }, o), net });
    }, 'primary')),
  );
  draw();
}

/** Fan zone: watch a live match. The server sends its copy of the state, then the players' inputs. */
export function watchMatch(app: App, id: string) {
  const net = new Net(liveServer(), { watch: id, config: {} });
  net.onStart = () => {
    const spec = onlineSpec(net);
    spec.watch = true;
    app.startMatch(spec, () => show(title(tr('Koniec meczu')), h('p', { className: 'sub' }, tr('Wybierz kolejny mecz z listy w strefie kibica.'))));
    app.run!.s = structuredClone(net.state!); // join where the match is now, not at kick-off
  };
  app.startMatch({ ...makeSpec({ team: TEAMS[0], human: 0 }, { team: TEAMS[1], human: 0 }, options()), net });
}

/** Both peers must build the same match from the server's config: presets only, validated input. */
function onlineSpec(net: Net) {
  const c = net.config, side = net.side;
  const { home, away, setup } = onlineMatch(c);
  if (c.minutesDrawn) toast(tr('Różne długości meczu — wylosowano {0} min', setup.minutes));
  const spec = makeSpec({ team: home, human: side === 0 ? 1 : 0 }, { team: away, human: side === 1 ? 1 : 0 }, { ...options(), autoReplay: false }, {}, net.seed);
  spec.setup = setup; // exactly what the other peer and the server simulate
  spec.net = net;
  return spec;
}
