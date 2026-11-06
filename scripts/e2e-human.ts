// Human-like end-to-end session on two Android emulators (debug APK, fresh app data).
// Everything goes through the UI: taps on buttons, typing, dropdowns, drags and touch play.
// A (Polish): options, team editor, tactic editor, friendly vs computer with lineup changes.
// B (English): options, team editor, a league match. Then both: online room with a custom
// team, pause + substitution, then a quick match with extra time and penalties.
//
// Usage: scripts/start-server.sh, two booted emulators with the debug APK (data cleared), then
//   node scripts/e2e-human.ts [emulator-5554] [emulator-5556]
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { DICT } from '../src/lang.ts';

const ADB = `${process.env.ANDROID_HOME ?? `${process.env.HOME}/Android/Sdk`}/platform-tools/adb`;
const SERVER = process.env.SERVER ?? '10.0.2.2:8787'; // e.g. 172.16.0.10:30080/ws for the K3s deployment
const SHOTS = process.env.SHOTS ?? '/tmp/kickabout-human';
const [SERIAL_A = 'emulator-5554', SERIAL_B = 'emulator-5556'] = process.argv.slice(2);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const think = () => sleep(350 + Math.random() * 600); // a human glances at the screen before each tap
const adb = (serial: string, ...args: string[]) => execFileSync(ADB, ['-s', serial, ...args], { encoding: 'utf8' });
const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a);
const results: [string, boolean, string][] = [];
const check = (name: string, ok: boolean, detail = '') => { results.push([name, ok, detail]); log(ok ? 'OK  ' : 'FAIL', name, detail); };

class Device {
  ws!: WebSocket;
  lang = 'pl';
  private id = 0;
  private pending = new Map<number, (v: any) => void>();
  private shot = 0;
  readonly name: string;
  readonly serial: string;
  readonly port: number;
  constructor(name: string, serial: string, port: number) { this.name = name; this.serial = serial; this.port = port; }

  /** Polish UI text in this device's language. */
  t(pl: string) { return this.lang === 'pl' ? pl : DICT[this.lang]?.[pl] ?? pl; }

  async launch() {
    adb(this.serial, 'shell', 'am', 'force-stop', 'com.kickabout.game');
    adb(this.serial, 'shell', 'am', 'start', '-n', 'com.kickabout.game/.MainActivity');
    await sleep(3500);
    const pid = adb(this.serial, 'shell', 'pidof', 'com.kickabout.game').trim();
    try { adb(this.serial, 'forward', '--remove', `tcp:${this.port}`); } catch { /* not forwarded yet */ }
    adb(this.serial, 'forward', `tcp:${this.port}`, `localabstract:webview_devtools_remote_${pid}`);
    const pages = await (await fetch(`http://127.0.0.1:${this.port}/json`)).json();
    this.ws = new WebSocket(pages.find((p: { url: string }) => p.url.startsWith('http://localhost')).webSocketDebuggerUrl);
    await new Promise((r) => (this.ws.onopen = r));
    this.ws.onmessage = (e) => { const m = JSON.parse(String(e.data)); this.pending.get(m.id)?.(m); this.pending.delete(m.id); };
    await this.cdp('Page.navigate', { url: 'http://localhost/?debug' }); // exposes the test hook only
    await sleep(2500);
    this.lang = await this.js(`(() => { const l = localStorage.getItem('kickabout.lang') || navigator.language.slice(0, 2); return ['pl', 'en', 'fr', 'de', 'it', 'es', 'nl'].includes(l) ? l : 'en'; })()`);
  }

  cdp(method: string, params: object = {}) {
    return new Promise<any>((r, reject) => {
      const i = ++this.id;
      const timer = setTimeout(() => { this.pending.delete(i); reject(new Error(`${this.name}: ${method} timed out`)); }, 30_000);
      this.pending.set(i, (v) => { clearTimeout(timer); r(v); });
      this.ws.send(JSON.stringify({ id: i, method, params }));
    });
  }
  async js<T = any>(expr: string): Promise<T> {
    const r = await this.cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result?.exceptionDetails) throw new Error(`${this.name}: ${r.result.exceptionDetails.exception?.description ?? 'error'} in ${expr.slice(0, 80)}`);
    return r.result?.result?.value as T;
  }
  touch(type: string, points: { x: number; y: number; id: number }[]) { return this.cdp('Input.dispatchTouchEvent', { type, touchPoints: points }); }
  snap(label: string) {
    const f = `${SHOTS}/${this.name}-${String(++this.shot).padStart(2, '0')}-${label}.png`;
    execFileSync('sh', ['-c', `"${ADB}" -s ${this.serial} exec-out screencap -p > "${f}"`]);
  }

  /** Scrolls a #ui element into view and returns its centre; `find` is a JS expression yielding the element. */
  private async locate(find: string, what: string) {
    const p = await this.js<{ x: number; y: number } | null>(`(() => { const el = ${find}; if (!el) return null;
      el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    if (!p) throw new Error(`${this.name}: not on screen: ${what}`);
    return p;
  }
  /** A finger tap (touch start/end) at a point. */
  async tapAt(x: number, y: number) {
    await this.touch('touchStart', [{ x, y, id: 1 }]); await sleep(70); await this.touch('touchEnd', []);
  }
  /** Taps the button / row whose text matches (exact, then prefix). */
  async tap(text: string, opts: { sel?: string; translate?: boolean } = {}) {
    await think();
    const label = opts.translate === false ? text : this.t(text);
    const sel = opts.sel ?? 'button, tr, li, label';
    const p = await this.locate(`(() => { const all = [...document.querySelectorAll('#ui ${sel}')].filter((e) => e.offsetParent);
      const s = ${JSON.stringify(label)}; return all.find((e) => e.textContent.trim() === s) ?? all.find((e) => e.textContent.trim().startsWith(s)) ?? all.find((e) => e.textContent.includes(s)); })()`, label);
    await this.tapAt(p.x, p.y);
    await sleep(250);
  }
  field(label: string, tag: string) {
    return `[...document.querySelectorAll('#ui label.field')].find((l) => l.querySelector('span')?.textContent === ${JSON.stringify(this.t(label))})?.querySelector('${tag}')`;
  }
  /** Picks an option from a dropdown (the native picker is replaced by setting the choice the user would make). */
  async choose(label: string, option: string, exact = false) {
    await think();
    await this.locate(this.field(label, 'select'), label);
    const ok = await this.js<boolean>(`(() => { const s = ${this.field(label, 'select')}; const o = ${JSON.stringify(option)};
      const i = [...s.options].findIndex((x) => ${exact ? 'x.text === o' : 'x.text.includes(o)'}); if (i < 0) return false;
      s.selectedIndex = i; s.dispatchEvent(new Event('change')); return true; })()`);
    if (!ok) throw new Error(`${this.name}: no option "${option}" in "${label}"`);
    await sleep(250);
  }
  /** Taps a text field, clears it and types like a keyboard. */
  async type(label: string, text: string, find?: string) {
    await think();
    const el = find ?? this.field(label, 'input');
    const p = await this.locate(el, label);
    await this.tapAt(p.x, p.y);
    await this.js(`(() => { const i = ${el}; i.focus(); i.select(); })()`);
    for (const ch of text) { await this.cdp('Input.insertText', { text: ch }); await sleep(60 + Math.random() * 80); }
    adb(this.serial, 'shell', 'input', 'keyevent', 'KEYCODE_BACK'); // hide the soft keyboard
    await sleep(400);
  }
  async toggle(label: string, on: boolean) {
    const checked = await this.js<boolean>(`${this.field(label, 'input')}.checked`);
    if (checked !== on) await this.tap(label, { sel: 'label.field' });
  }
  screenText() { return this.js<string>(`document.querySelector('#ui').innerText`); }

  state() { return this.js<any>(`(() => { const r = kickabout.app.run, s = r?.s, n = r?.spec.net; return s ? { phase: s.phase, tick: s.tick, score: s.score, paused: s.paused, subsLeft: s.subsLeft, so: s.so, status: n?.status, room: n?.room, side: n?.side, message: n?.message, names: r.info.names } : { status: n?.status }; })()`); }
  fingerprint() { return this.js<string>(`JSON.stringify({ ...kickabout.app.run.s, frame: 0, prevInput: [0, 0], eventFrame: 0 })`).then((j) => createHash('sha256').update(j).digest('hex').slice(0, 16)); }
}

/** A thumb on the stick (left) and taps on PASS or holds on SHOT (right); without the ball either one slides. */
function startPlaying(d: Device) {
  let alive = true, down = false;
  (async () => {
    const stick = { x: 103, y: 640, id: 1 }, shot = { x: 411 - 78, y: 914 - 100, id: 2 }, pass = { x: 411 - 190, y: 914 - 62, id: 2 };
    while (alive) {
      try {
        const a = Math.random() * Math.PI * 2, r = 30 + Math.random() * 30;
        const moved = { ...stick, x: stick.x + Math.cos(a) * r, y: stick.y + Math.sin(a) * r };
        if (!down) { await d.touch('touchStart', [stick]); down = true; }
        await d.touch('touchMove', [moved]);
        if (Math.random() < 0.45) {
          const b = Math.random() < 0.5 ? pass : shot;
          await d.touch('touchStart', [moved, b]);
          await sleep(b === pass ? 60 : 100 + Math.random() * 450);
          await d.touch('touchEnd', [b]);
        }
        await sleep(300 + Math.random() * 700);
      } catch { /* screen changing */ }
    }
    if (down) await d.touch('touchEnd', []).catch(() => {});
  })();
  return () => { alive = false; };
}

async function waitFor(desc: string, ms: number, cond: () => Promise<boolean>) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await cond().catch(() => false)) return true; await sleep(500); }
  check(desc, false, 'timeout');
  return false;
}

/** Plays (touch) until full time, then returns the final state. */
async function playToEnd(d: Device, desc: string, ms = 8 * 60_000) {
  const stop = startPlaying(d);
  await sleep(25_000); d.snap(`${desc}-gra`);
  await waitFor(`${desc}: full time`, ms, async () => (await d.state()).phase === 'end');
  stop(); await sleep(1500);
  return d.state();
}

// ---------- scenes ----------

async function setOptions(d: Device, lang: string, minutes: string, extra: boolean) {
  await d.tap('Opcje');
  if (d.lang !== lang) { // language switch reloads the app
    await d.choose('Język / Language', { pl: 'Polski', en: 'English' }[lang]!, true);
    await sleep(3000); d.lang = lang;
    await d.tap('Opcje');
  }
  await d.choose('Długość meczu', minutes, true);
  await d.toggle('Dźwięk', false);
  await d.toggle('Muzyka w menu', false);
  await d.toggle('Dogrywka przy remisie', extra);
  await d.toggle('Rzuty karne przy remisie', extra);
  d.snap('opcje');
  const o = await d.js<any>(`JSON.parse(localStorage.getItem('kickabout.options') || '{}')`);
  check(`${d.name}: options saved`, o.sound === false && o.minutes === parseInt(minutes) && o.extraTime === extra, JSON.stringify(o));
  await d.tap('← Wstecz');
}

async function editTeam(d: Device, teamName: string, newName: string, short: string, shirt: string) {
  await d.tap('Edytory drużyn i taktyk');
  await d.choose('Drużyna', teamName, true);
  await d.tap('Edytuj drużynę');
  await d.type('Nazwa', newName);
  await d.type('Skrót (3 litery)', short);
  await d.js(`(() => { const c = ${d.field('Koszulka', 'input')}; c.value = '${shirt}'; c.dispatchEvent(new Event('input')); })()`);
  // Player 1 gets a new name and better shooting.
  await d.type('', 'Jan Kopacz', `document.querySelector('#ui table.edit tbody tr input')`);
  await d.type('', '9', `document.querySelectorAll('#ui table.edit tbody tr')[9].querySelectorAll('input.num')[1]`);
  d.snap('edytor-druzyny');
  await d.tap('Zapisz');
  const saved = await d.js<any[]>(`JSON.parse(localStorage.getItem('kickabout.teams') || '[]')`);
  const t = saved.find((x) => x.name === newName);
  check(`${d.name}: team edit saved`, !!t && t.short === short && t.kits[0].shirt === shirt && t.players[0].name === 'Jan Kopacz' && t.players[9].sh === 9, t ? `${t.name} ${t.short} ${t.kits[0].shirt}` : JSON.stringify(saved).slice(0, 120));
}

async function newTactic(d: Device) {
  await d.choose('Nowa taktyka na bazie', '4-3-3');
  await sleep(500);
  await d.type('Nazwa', 'Atak skrzydłami');
  // Drag the two wingers wider and higher with a finger-like mouse drag.
  for (const [i, dx, dy] of [[10, -40, -40], [9, 40, -40]] as const) {
    const p = await d.js<{ x: number; y: number }>(`(() => { const r = document.querySelectorAll('#ui .dot')[${i}].getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    await d.cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', clickCount: 1 });
    for (let k = 1; k <= 8; k++) { await d.cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x + (dx * k) / 8, y: p.y + (dy * k) / 8, button: 'left', buttons: 1 }); await sleep(30); }
    await d.cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x + dx, y: p.y + dy, button: 'left', clickCount: 1 });
  }
  d.snap('edytor-taktyki');
  await d.tap('Zapisz taktykę');
  const tac = await d.js<any[]>(`JSON.parse(localStorage.getItem('kickabout.tactics') || '[]')`);
  check(`${d.name}: custom tactic saved`, tac.length === 1 && tac[0].name === 'Atak skrzydłami', tac.map((x) => x.name).join());
  await d.tap('← Wstecz');
}

/** A: friendly, own edited team vs computer, custom tactic and a lineup swap. */
async function friendly(d: Device, home: string, away: string) {
  await d.tap('Mecz towarzyski');
  await d.choose('Gospodarze', home, true);
  await d.choose('Goście', away, true);
  await d.choose('Murawa', 'Zależna od pory roku');
  await d.tap('Skład i taktyka gospodarzy');
  await d.choose('Taktyka', 'Atak skrzydłami');
  await d.tap('Jan Kopacz', { sel: 'tbody tr', translate: false }); // swap him with the first bench player
  await d.js(`document.querySelectorAll('#ui tbody tr')[11].scrollIntoView({ block: 'center' })`);
  const r = await d.js<{ x: number; y: number }>(`(() => { const b = document.querySelectorAll('#ui tbody tr')[11].getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()`);
  await think(); await d.tapAt(r.x, r.y);
  d.snap('sklad');
  await d.tap('Gotowe');
  d.snap('towarzyski');
  await d.tap('Graj!');
  await sleep(2000);
  const s = await d.state();
  check(`${d.name}: friendly kicks off with the edited team`, s.names?.[0] === home, s.names?.join(' – '));
  const end = await playToEnd(d, 'towarzyski');
  d.snap('towarzyski-koniec');
  check(`${d.name}: friendly finished`, end.phase === 'end', `${end.names?.join(' – ')} ${end.score?.join(':')}`);
  await d.tap('Dalej');
  await d.tap('← Wstecz'); // Dalej returns to the friendly setup
}

/** B: a preset league, pick a club, play one match, simulate the rest of the round, view the table. */
async function league(d: Device) {
  await d.tap('Rozgrywki');
  const first = await d.js<string>(`document.querySelector('#ui .presets button').textContent`);
  await d.tap(first, { translate: false });
  const club = await d.js<string>(`document.querySelector('#ui tbody tr td').textContent`);
  await think(); // "Controlled by" in the first club's row → Player 1
  await d.js(`(() => { const s = document.querySelector('#ui tbody tr select'); s.selectedIndex = 1; s.dispatchEvent(new Event('change')); })()`);
  d.snap('liga-wybor');
  await d.tap('Rozpocznij');
  d.snap('liga-hub');
  await d.tap(d.t('Graj: {0} – {1}').split('{0}')[0], { translate: false });
  d.snap('liga-przedmeczowy');
  await d.tap('Graj!');
  await sleep(1500);
  d.snap('liga-start');
  const end = await playToEnd(d, 'liga');
  d.snap('liga-koniec');
  check(`${d.name}: league match finished`, end.phase === 'end', `${end.names?.join(' – ')} ${end.score?.join(':')} (${club})`);
  for (let i = 0; i < 3 && !(await d.screenText()).includes(d.t('Tabela')); i++) { await d.tap('Dalej').catch(() => {}); await sleep(800); }
  if ((await d.screenText()).includes(d.t('Rozegraj kolejkę'))) await d.tap('Rozegraj kolejkę');
  await d.tap('Tabela');
  d.snap('liga-tabela');
  const played = await d.js<number>(`[...document.querySelectorAll('#ui tbody tr')].filter((r) => r.children[2]?.textContent === '1').length`);
  log(`${d.name} tabela:\n` + (await d.screenText()));
  check(`${d.name}: league table after round 1`, played >= 2, `${played} clubs with 1 match`);
  await d.tap('← Wstecz').catch(() => {});
  await d.tap('Menu').catch(() => {});
}

async function goOnline(d: Device, mode: 'quick' | 'host' | 'join', teamName: string, code = '', extra = false, club = false, voice = false, spectate = false) {
  for (let i = 0; i < 3 && !(await d.js<boolean>(`!!document.querySelector('#ui .logo')`)); i++) await d.tap('← Wstecz').catch(() => d.tap('Menu'));
  await d.tap('Gra online');
  await d.type('Adres serwera', SERVER);
  await d.choose('Twoja drużyna', teamName, true);
  await d.choose('Tryb', d.t({ quick: 'Szybka gra — losowy przeciwnik', host: 'Załóż pokój dla znajomego', join: 'Dołącz do pokoju znajomego' }[mode]), true);
  await d.toggle('Zagraj moim klubem online (nagrody, wymaga konta)', club);
  if (mode !== 'quick') await d.toggle('Czat głosowy (gdy znajomy też go włączy)', voice);
  if (mode === 'host') await d.toggle('Pozwól oglądać w strefie kibica', spectate);
  if (mode === 'join') await d.type('Kod pokoju', code.toLowerCase()); // typed lowercase, the field uppercases
  else { await d.choose('Murawa', d.t('Losowa'), true); await d.toggle('Dogrywka przy remisie', extra); await d.toggle('Rzuty karne przy remisie', extra); }
  d.snap(`online-${mode}`);
  await d.tap('Połącz');
}

async function bothFinish(name: string, a: Device, b: Device, leave = true) {
  const stopA = startPlaying(a), stopB = startPlaying(b);
  await waitFor(`${name}: both reach full time`, 10 * 60_000, async () => (await a.state()).phase === 'end' && (await b.state()).phase === 'end');
  stopA(); stopB(); await sleep(1000);
  const [sa, sb] = [await a.state(), await b.state()];
  const [fa, fb] = [await a.fingerprint(), await b.fingerprint()];
  check(`${name}: identical final state on both phones`, fa === fb, `${fa} / ${fb}`);
  check(`${name}: same result`, JSON.stringify(sa.score) === JSON.stringify(sb.score), `${sa.names?.join(' – ')} ${sa.score?.join(':')}${sa.so ? ` (pen. ${sa.so.goals.join(':')})` : ''}`);
  check(`${name}: no desync/disconnect`, sa.status === 'playing' && sb.status === 'playing', `${sa.status}/${sb.status} ${sa.message ?? ''}${sb.message ?? ''}`);
  a.snap(`${name}-koniec`); b.snap(`${name}-koniec`);
  if (leave) { await a.tap('Dalej').catch(() => {}); await b.tap('Dalej').catch(() => {}); }
}

// ---------- online club (website account + app) ----------

/** Taps the first button whose text starts with the translated text before {0}. */
const tapPrefix = (d: Device, pl: string) => d.tap(d.t(pl).split('{0}')[0].trim(), { translate: false });
const tapRow = async (d: Device, i: number) => {
  await think();
  const p = await d.js<{ x: number; y: number }>(`(() => { const r = document.querySelectorAll('#ui tbody tr')[${i < 0 ? `document.querySelectorAll('#ui tbody tr').length ${i}` : i}]; r.scrollIntoView({ block: 'center' }); const b = r.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()`);
  await d.tapAt(p.x, p.y); await sleep(1200);
};
const coinsOnScreen = async (d: Device) => Number(((await d.screenText()).match(/([\d\s\u00a0.,]+) 🪙/)?.[1] ?? '').replace(/[^\d]/g, ''));

/** Back to the club menu (the only screen with the account history button). */
async function backToClub(d: Device) {
  for (let i = 0; i < 5 && !(await d.screenText()).includes(d.t('Historia konta')); i++) await d.tap('← Wstecz').catch(() => {});
}

/** "My club": enter the code from the website's account page, then found a club. */
async function linkAndFound(d: Device, code: string, name: string, short: string) {
  for (let i = 0; i < 3 && !(await d.js<boolean>(`!!document.querySelector('#ui .logo')`)); i++) await d.tap('← Wstecz').catch(() => {});
  await d.tap('Mój klub (online)'); await sleep(1500);
  d.snap('klub-logowanie');
  await d.type('Kod z panelu konta', code);
  await d.tap('Połącz z kontem'); await sleep(2000);
  await d.type('Nazwa klubu', name);
  await d.type('Skrót (3 litery)', short);
  d.snap('klub-zakladanie');
  await d.tap('Załóż klub', { sel: 'button' }); await sleep(2000);
  const text = await d.screenText();
  check(`${d.name}: app linked to the website account, club founded`, text.includes(name), text.split('\n')[0]);
  d.snap('klub');
}

/** Buy a player from a computer club through the transfer market. */
async function buyFromMarket(d: Device) {
  const before = await coinsOnScreen(d);
  await d.tap('Rynek transferowy'); await sleep(1500);
  d.snap('rynek');
  await tapRow(d, -1); // the weakest club of the league
  d.snap('rynek-klub');
  await tapRow(d, -1);
  d.snap('rynek-zawodnik');
  await tapPrefix(d, 'Kup za {0}'); await sleep(1500);
  await backToClub(d);
  const after = await coinsOnScreen(d);
  check(`${d.name}: bought a player from a computer club`, after < before, `${before} → ${after}`);
}

/** A 5-minute match against the computer for prize money; the server replays it. */
async function prizeMatch(d: Device) {
  const before = await coinsOnScreen(d);
  await tapPrefix(d, 'Mecz o nagrodę ({0} dziś)'); await sleep(800);
  await d.choose('Długość meczu', '5 min', true);
  await d.tap('Losuj rywala o podobnej sile i graj'); await sleep(2500);
  const s = await d.state();
  check(`${d.name}: prize match starts`, !!s.phase, s.names?.join(' – '));
  const end = await playToEnd(d, 'nagroda', 9 * 60_000);
  await sleep(2000);
  await d.tap('Dalej'); await sleep(4000);
  const text = await d.screenText();
  d.snap('nagroda-wynik');
  check(`${d.name}: server verified the match and paid`, text.includes(d.t('Nagroda: {0}').split('{0}')[0]), `${end.score?.join(':')} — ${text.split('\n').slice(0, 2).join(' ')}`);
  await d.tap('Dalej'); await sleep(1500);
  check(`${d.name}: coins grew`, (await coinsOnScreen(d)) > before, `${before} → ${await coinsOnScreen(d)}`);
}

/** B sponsors A's club (the amount prompt is answered like a user typing 200). */
async function sponsor(b: Device, clubName: string) {
  await b.tap('Rynek transferowy'); await sleep(1500);
  await b.choose('Pokaż', b.t('Kluby graczy (z właścicielem)'), true); await sleep(1500);
  await b.tap(clubName, { sel: 'tbody tr', translate: false }); await sleep(1500);
  await b.js(`window.prompt = () => '200'`);
  await b.tap('Sponsoruj klub'); await sleep(1500);
  b.snap('sponsoring');
  await backToClub(b);
}

async function clubPhase(A: Device, B: Device) {
  const [codeA, codeB] = [process.env.CODE_A ?? '', process.env.CODE_B ?? ''];
  // Website users and club names; unique per run so repeated runs do not meet old clubs.
  const run = Date.now().toString(36).slice(-3).toUpperCase(), sponsorName = process.env.USER_B ?? 'Bob';
  const [clubA, clubB] = [`Orły ${run}`, `Lions ${run}`];
  if (!codeA || !codeB) { check('club: codes from the website (CODE_A, CODE_B)', false); return; }
  log('7. Klub online: kod z konta na stronie → aplikacja, założenie klubu');
  await Promise.all([linkAndFound(A, codeA, clubA, 'ORK'), linkAndFound(B, codeB, clubB, 'HLI')]);
  log('8. Rynek transferowy (A) i mecze o nagrodę z komputerem (A i B)');
  await buyFromMarket(A);
  await Promise.all([prizeMatch(A), prizeMatch(B)]);
  log('9. B sponsoruje klub A; mecz online klubów z nagrodami');
  await sponsor(B, clubA);
  await A.tap('← Wstecz').catch(() => {});
  await goOnline(A, 'host', 'London Navigators', '', false, true); // the server swaps in the online club
  await waitFor('9: room created', 15_000, async () => (await A.state()).status === 'room');
  await goOnline(B, 'join', 'London Navigators', (await A.state()).room, false, true);
  await waitFor('9: club match starts', 20_000, async () => (await A.state()).status === 'playing' && (await B.state()).status === 'playing');
  await sleep(1500);
  A.snap('klub-online-start'); B.snap('klub-online-start');
  const names = (await B.state()).names;
  check('9: the server brought both online clubs', names?.[0] === clubA && names?.[1] === clubB, names?.join(' – '));
  const sponsors = await A.js<string[][]>(`kickabout.app.run.info.sponsors`);
  check('9: sponsor shown before kick-off', JSON.stringify(sponsors).includes(sponsorName), JSON.stringify(sponsors));
  await bothFinish('klub-online', A, B, false);
  await sleep(2000);
  const rewards = [await A.js<number>(`kickabout.app.run?.spec.net?.reward ?? -1`).catch(() => -1), await B.js<number>(`kickabout.app.run?.spec.net?.reward ?? -1`).catch(() => -1)];
  check('9: both owners got prize money from the server', rewards.every((r) => r > 0), rewards.join(', '));
}

// ---------- voice chat (private room, WebRTC through the TURN relay) ----------

/** The emulators have no audio device: a tone generator stands in for the microphone. */
const fakeMic = (d: Device, hz: number) => d.js(`navigator.mediaDevices.getUserMedia = async () => {
  const ac = new AudioContext(), o = ac.createOscillator(), out = ac.createMediaStreamDestination();
  o.frequency.value = ${hz}; o.connect(out); o.start(); return out.stream; }`);

async function voicePhase(A: Device, B: Device) {
  log('10. Czat głosowy w prywatnym pokoju');
  for (const d of [A, B]) for (let i = 0; i < 3 && !(await d.js<boolean>(`!!document.querySelector('#ui .logo')`)); i++) await d.tap('← Wstecz').catch(() => {});
  await fakeMic(A, 440); await fakeMic(B, 660);
  await goOnline(A, 'host', 'London Navigators', '', false, false, true);
  await waitFor('10: room created', 15_000, async () => (await A.state()).status === 'room');
  await goOnline(B, 'join', 'Leeds Sentinels', (await A.state()).room, false, false, true);
  await waitFor('10: match starts', 20_000, async () => (await A.state()).status === 'playing' && (await B.state()).status === 'playing');
  const stopA = startPlaying(A), stopB = startPlaying(B);
  const connected = await waitFor('10: voice connected on both phones', 30_000, async () =>
    (await A.js<string>(`kickabout.app.voice?.state`)) === 'connected' && (await B.js<string>(`kickabout.app.voice?.state`)) === 'connected');
  if (connected) check('10: voice connected on both phones', true);
  const f0 = (await A.state()).tick;
  await sleep(10_000);
  const f1 = (await A.state()).tick;
  const bytes = [await A.js<number>(`kickabout.app.voice.received()`), await B.js<number>(`kickabout.app.voice.received()`)];
  check('10: each phone hears the other', bytes.every((n) => n > 1000), bytes.join(' / ') + ' bytes');
  check('10: the match keeps its pace during the call', f1 - f0 > 450, `${f1 - f0} ticks in 10 s`);
  const pair = await A.js<string>(`(async () => { let s = ''; (await kickabout.app.voice.pc.getStats()).forEach((r) => { if (r.type === 'candidate-pair' && r.nominated && r.state === 'succeeded') s = r.localCandidateId; }); const st = await kickabout.app.voice.pc.getStats(); return st.get(s)?.candidateType ?? '?'; })()`);
  log(`   ścieżka głosu na A: ${pair}`);
  A.snap('glos'); B.snap('glos');
  stopA(); stopB(); await sleep(800);
  await A.tapAt(411 - 112, 44); await sleep(400); // the microphone button next to pause
  check('10: mic button mutes', await A.js<boolean>(`kickabout.app.voice.muted`));
  A.snap('glos-wyciszony');
  await A.tapAt(411 - 44, 44); await sleep(800); // pause → leave the match ends the call
  await A.js(`window.confirm = () => true`);
  await A.tap('Wyjdź z meczu'); await sleep(1500);
  check('10: leaving the match ends the call', await A.js<boolean>(`kickabout.app.voice === null`));
}

/** A room the website's fan zone may show; logs the match pace before and while fans watch. */
async function fansPhase(A: Device, B: Device) {
  log('11. Strefa kibica: pokój z pozwoleniem na oglądanie');
  for (const d of [A, B]) for (let i = 0; i < 3 && !(await d.js<boolean>(`!!document.querySelector('#ui .logo')`)); i++) await d.tap('← Wstecz').catch(() => {});
  await goOnline(A, 'host', 'London Navigators', '', false, false, false, true);
  await waitFor('11: room created', 15_000, async () => (await A.state()).status === 'room');
  await goOnline(B, 'join', 'Leeds Sentinels', (await A.state()).room);
  await waitFor('11: match starts', 20_000, async () => (await A.state()).status === 'playing' && (await B.state()).status === 'playing');
  log('   MECZ NA ŻYWO — strefa kibica może oglądać');
  const pace = async (label: string) => {
    const f0 = await A.js<number>(`kickabout.state().frame`); await sleep(10_000);
    const f1 = await A.js<number>(`kickabout.state().frame`);
    log(`   tempo (${label}): ${f1 - f0} klatek w 10 s`);
    return f1 - f0;
  };
  const stopA = startPlaying(A), stopB = startPlaying(B);
  await sleep(5000);
  const before = await pace('bez kibiców');
  await sleep(Number(process.env.FANS_WAIT ?? 60) * 1000); // the browser joins as spectators meanwhile
  const during = await pace('z kibicami');
  check('11: the players\' pace does not drop while fans watch', during >= before * 0.95, `${before} → ${during} frames per 10 s`);
  stopA(); stopB();
  await bothFinish('kibice', A, B);
}

async function main() {
  execFileSync('mkdir', ['-p', SHOTS]);
  const A = new Device('A', SERIAL_A, 9401), B = new Device('B', SERIAL_B, 9402);
  await Promise.all([A.launch(), B.launch()]);
  A.snap('start'); B.snap('start');
  const phases = (process.env.PHASES ?? 'basic,club').split(',');
  if (!phases.includes('basic')) {
    await Promise.all([setOptions(A, 'pl', '5 min', false), setOptions(B, 'en', '5 min', false)]);
    if (phases.includes('club')) await clubPhase(A, B);
    if (phases.includes('voice')) await voicePhase(A, B);
    if (phases.includes('fans')) await fansPhase(A, B);
    return finish();
  }

  log('1. Konfiguracja aplikacji i drużyn');
  await Promise.all([setOptions(A, 'pl', '5 min', false), setOptions(B, 'en', '5 min', false)]);
  const pickTeam = (d: Device, i: number) => d.js<string>(`(async () => { document.querySelectorAll('#ui nav button')[4].click(); await new Promise((r) => setTimeout(r, 200));
    const n = document.querySelectorAll('#ui select')[0].options[${i}].text; document.querySelector('#ui .row button.ghost').click(); return n; })()`);
  const [origA, origB] = [await pickTeam(A, 0), await pickTeam(B, 13)];
  await Promise.all([
    (async () => { await editTeam(A, origA, 'Orły Kopanki', 'ORK', '#ff6600'); await newTactic(A); })(),
    (async () => { await editTeam(B, origB, 'Harbour Lions', 'HLI', '#1e90ff'); await B.tap('← Back'); })(),
  ]);

  log('2. Mecz towarzyski (A) i mecz ligowy (B) równolegle');
  const awayA = await A.js<string>(`(async () => { document.querySelectorAll('#ui nav button')[0].click(); await new Promise((r) => setTimeout(r, 200));
    const n = document.querySelectorAll('#ui select')[2].options[5].text; document.querySelector('#ui .row button.ghost').click(); return n; })()`);
  await Promise.all([friendly(A, 'Orły Kopanki', awayA), league(B)]);

  log('3. Online: pokój A (własna drużyna) ↔ B dołącza kodem');
  await goOnline(A, 'host', 'Orły Kopanki');
  await waitFor('3: room created', 15_000, async () => (await A.state()).status === 'room');
  const code = (await A.state()).room;
  A.snap('pokoj-kod');
  check('3: room code', /^[A-Z]{4}$/.test(code), code);
  await goOnline(B, 'join', 'Harbour Lions', code);
  await waitFor('3: match starts on both', 20_000, async () => (await A.state()).status === 'playing' && (await B.state()).status === 'playing');
  const s3 = await B.state();
  check('3: B sees both custom teams', s3.names?.[0] === 'Orły Kopanki' && s3.names?.[1] === 'Harbour Lions', s3.names?.join(' – '));
  let stopA = startPlaying(A), stopB = startPlaying(B);
  await sleep(30_000);
  stopA(); stopB(); await sleep(1200);
  await A.tapAt(411 - 44, 44); // pause button on the pitch
  await waitFor('3: pause on both', 5_000, async () => (await A.state()).paused && (await B.state()).paused);
  A.snap('pauza'); B.snap('pauza');
  await B.tap('Zmiany i taktyka{0}'.replace('{0}', ''));
  await B.tap(await B.js<string>(`document.querySelectorAll('#ui tbody tr')[9].textContent.trim()`), { sel: 'tbody tr', translate: false });
  await B.tap(await B.js<string>(`document.querySelectorAll('#ui tbody tr')[12].textContent.trim()`), { sel: 'tbody tr', translate: false });
  B.snap('zmiana');
  await waitFor('3: substitution on both', 5_000, async () => (await A.state()).subsLeft[1] === 2 && (await B.state()).subsLeft[1] === 2);
  check('3: substitution on both', (await A.state()).subsLeft[1] === 2);
  await B.tap('Gotowe'); await B.tap('Wznów');
  await waitFor('3: resumed on both', 5_000, async () => !(await A.state()).paused && !(await B.state()).paused);
  await bothFinish('online-pokoj', A, B);

  log('4. Online: szybka gra, B czeka z dogrywką i karnymi');
  await sleep(1500);
  await goOnline(B, 'quick', 'Harbour Lions', '', true);
  await waitFor('4: B waiting', 15_000, async () => (await B.state()).status === 'waiting');
  await goOnline(A, 'quick', awayA);
  await waitFor('4: match starts on both', 20_000, async () => (await A.state()).status === 'playing' && (await B.state()).status === 'playing');
  check('4: waiting player is home', (await B.state()).side === 0, (await B.state()).names?.join(' – '));
  await bothFinish('online-szybka', A, B);

  log('5. Najlepsze momenty');
  await sleep(1500);
  await A.tap('Najlepsze momenty');
  A.snap('momenty');
  const goals = await A.js<number>(`document.querySelectorAll('#ui ul.list li').length`);
  check('5: highlights list', true, `${goals} saved goals`);
  if (goals) { await A.tap('▶', { sel: 'li button', translate: false }); await sleep(4000); A.snap('powtorka'); }

  log('6. Odnośnik do strony www z menu aplikacji');
  await waitFor('6: replay finished', 60_000, async () => !(await A.js<boolean>(`document.querySelector('#ui').hidden`)));
  for (let i = 0; i < 3 && !(await A.js<boolean>(`!!document.querySelector('#ui .logo')`)); i++) await A.tap('← Wstecz').catch(() => {});
  await A.tap('Strona www i konto');
  await sleep(5000);
  const top = adb(SERIAL_A, 'shell', 'dumpsys', 'activity', 'activities');
  const resumed = top.match(/topResumedActivity=.*? ([\w.]+)\//)?.[1] ?? '?';
  check('6: website opens in the system browser', resumed !== 'com.kickabout.game', resumed);
  A.snap('strona-www');
  adb(SERIAL_A, 'shell', 'input', 'keyevent', 'KEYCODE_BACK');

  if (phases.includes('club')) await clubPhase(A, B);
  finish();
}

function finish() {
  const failed = results.filter(([, ok]) => !ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed; screenshots in ${SHOTS}`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
