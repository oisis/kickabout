// Team editor (names, kits, players, skills) and tactics editor (drag players on a pitch).
import { FORMATIONS } from './sim.ts';
import { TEAMS, POS, team, type TeamDef } from './data.ts';
import { customTeams, saveCustomTeams, customTactics, saveCustomTactics } from './store.ts';
import { h, show, title, btn, row, back, select, input, toast } from './ui.ts';
import { teamOptions } from './screens.ts';
import type { App } from './main.ts';
import { t as tr } from './i18n.ts';

export function editorMenu(app: App) {
  const tactics = customTactics();
  let pickTeam = TEAMS[0].id;
  show(
    title(tr('Edytory'), tr('Zmienione drużyny i taktyki są dostępne we wszystkich trybach poza karierą')),
    h('h3', {}, tr('Drużyny')),
    select(tr('Drużyna'), pickTeam, teamOptions(), (v) => { pickTeam = v; }),
    row(btn(tr('Edytuj drużynę'), () => teamEditor(app, structuredClone(team(pickTeam, customTeams()))), 'primary'),
      btn(tr('Przywróć wszystkie'), () => { if (confirm(tr('Usunąć wszystkie zmiany w drużynach?'))) { saveCustomTeams([]); toast(tr('Przywrócono oryginalne drużyny')); } }, 'ghost')),
    h('h3', {}, tr('Taktyki')),
    h('ul', { className: 'list' }, ...tactics.map((t, i) => h('li', {},
      h('span', {}, t.name),
      btn('✎', () => tacticEditor(app, structuredClone(t), i)),
      btn('✕', () => { saveCustomTactics(tactics.filter((_, j) => j !== i)); editorMenu(app); }, 'ghost'),
    ))),
    select(tr('Nowa taktyka na bazie'), -1, [[-1, tr('— wybierz —')], ...FORMATIONS.map((f, i): [number, string] => [i, f.name])], (v) => {
      if (v >= 0) tacticEditor(app, { name: tr('Moja {0}', FORMATIONS[v].name), pos: structuredClone(FORMATIONS[v].pos) }, -1);
    }),
    back(() => app.menu()),
  );
}

const clamp9 = (v: string) => Math.max(0, Math.min(9, parseInt(v, 10) || 0));

function teamEditor(app: App, t: TeamDef) {
  const num = (get: () => number, set: (v: number) => void) => h('input', { type: 'number', min: 0, max: 9, value: String(get()), className: 'num', oninput: (e: Event) => set(clamp9((e.target as HTMLInputElement).value)) });
  const color = (label: string, get: () => string, set: (v: string) => void) => h('label', { className: 'field' }, h('span', {}, label), h('input', { type: 'color', value: get(), oninput: (e: Event) => set((e.target as HTMLInputElement).value) }));
  show(
    title(tr('Edycja drużyny')),
    input(tr('Nazwa'), t.name, (v) => { t.name = v; }, { maxLength: 24 }),
    input(tr('Skrót (3 litery)'), t.short, (v) => { t.short = v.toUpperCase().slice(0, 3); }, { maxLength: 3 }),
    h('div', { className: 'colors' },
      color(tr('Koszulka'), () => t.kits[0].shirt, (v) => { t.kits[0].shirt = v; }),
      color(tr('Spodenki'), () => t.kits[0].shorts, (v) => { t.kits[0].shorts = v; }),
      color(tr('Koszulka 2'), () => t.kits[1].shirt, (v) => { t.kits[1].shirt = v; }),
      color(tr('Spodenki 2'), () => t.kits[1].shorts, (v) => { t.kits[1].shorts = v; }),
      color(tr('Bramkarz'), () => t.keeper, (v) => { t.keeper = v; }),
    ),
    select(tr('Taktyka domyślna'), t.formation, FORMATIONS.map((f, i): [number, string] => [i, f.name]), (v) => { t.formation = v; }),
    h('table', { className: 'edit' },
      h('thead', {}, h('tr', {}, ...[tr('Zawodnik'), tr('Poz'), tr('Pod'), tr('Str'), tr('Gło'), tr('Odb'), tr('Kon'), tr('Szy'), tr('Bra')].map((x) => h('th', {}, x)))),
      h('tbody', {}, ...t.players.map((p) => h('tr', {},
        h('td', {}, h('input', { value: p.name, maxLength: 28, oninput: (e: Event) => { p.name = (e.target as HTMLInputElement).value; } })),
        h('td', {}, h('select', { onchange: (e: Event) => { p.pos = (e.target as HTMLSelectElement).selectedIndex; } }, ...POS.map((x, i) => h('option', { selected: i === p.pos }, tr(x))))),
        ...(['pa', 'sh', 'he', 'ta', 'co', 'sp', 'gk'] as const).map((k) => h('td', {}, num(() => p[k], (v) => { p[k] = v; }))),
      ))),
    ),
    row(back(() => editorMenu(app)), btn(tr('Zapisz'), () => {
      const names = t.players.map((p) => p.name.trim());
      if (names.some((n) => !n) || new Set(names).size !== names.length) return toast(tr('Nazwiska muszą być niepuste i różne'));
      if (!t.players.some((p) => p.pos === 0)) return toast(tr('Drużyna potrzebuje bramkarza'));
      saveCustomTeams([...customTeams().filter((x) => x.id !== t.id), t]);
      toast(tr('Zapisano'));
      editorMenu(app);
    }, 'primary')),
    btn(tr('Przywróć oryginał tej drużyny'), () => { saveCustomTeams(customTeams().filter((x) => x.id !== t.id)); toast(tr('Przywrócono')); editorMenu(app); }, 'ghost'),
  );
}

/** Drag the ten outfield players; x is across the pitch, depth runs from our goal (bottom) upwards. */
function tacticEditor(app: App, t: { name: string; pos: number[][] }, index: number) {
  const pitch = h('div', { className: 'mini-pitch' });
  const dots = t.pos.map((p, i) => {
    const d = h('div', { className: i ? 'dot' : 'dot keeper' }, String(i ? i + 1 : 1));
    const place = () => { d.style.left = `${p[0] / 10}%`; d.style.bottom = `${p[1] / 10}%`; };
    place();
    if (i) {
      d.addEventListener('pointerdown', (e) => {
        d.setPointerCapture(e.pointerId);
        const move = (ev: PointerEvent) => {
          const r = pitch.getBoundingClientRect();
          p[0] = Math.round(Math.max(30, Math.min(970, ((ev.clientX - r.left) / r.width) * 1000)));
          p[1] = Math.round(Math.max(60, Math.min(950, ((r.bottom - ev.clientY) / r.height) * 1000)));
          place();
        };
        d.addEventListener('pointermove', move);
        d.addEventListener('pointerup', () => d.removeEventListener('pointermove', move), { once: true });
      });
    }
    return d;
  });
  pitch.append(h('div', { className: 'half' }), ...dots);
  show(
    title(tr('Edytor taktyki'), tr('Przeciągnij zawodników. Twoja bramka jest na dole. Pozycje przesuwają się w meczu za piłką.')),
    input(tr('Nazwa'), t.name, (v) => { t.name = v; }, { maxLength: 20 }),
    pitch,
    row(back(() => editorMenu(app)), btn(tr('Zapisz taktykę'), () => {
      const list = customTactics();
      if (index >= 0) list[index] = t; else list.push(t);
      saveCustomTactics(list);
      toast(tr('Zapisano taktykę'));
      editorMenu(app);
    }, 'primary')),
  );
}
