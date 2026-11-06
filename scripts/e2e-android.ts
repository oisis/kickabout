// End-to-end multiplayer test on two Android emulators (debug APK, WebView debugging on).
// Drives both apps through the Chrome DevTools protocol with real touch events, plays
// several online matches through the game server and checks both devices stay identical.
//
// Usage: scripts/start-server.sh (port 8787), two booted emulators with the debug APK, then
//   node scripts/e2e-android.ts [emulator-5554] [emulator-5556]
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const ADB = `${process.env.ANDROID_HOME ?? `${process.env.HOME}/Android/Sdk`}/platform-tools/adb`;
const SERVER = '10.0.2.2:8787'; // the host machine as seen from an emulator
const [SERIAL_A = 'emulator-5554', SERIAL_B = 'emulator-5556'] = process.argv.slice(2);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const adb = (serial: string, ...args: string[]) => execFileSync(ADB, ['-s', serial, ...args], { encoding: 'utf8' });
const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a);
const results: [string, boolean, string][] = [];
const check = (name: string, ok: boolean, detail = '') => { results.push([name, ok, detail]); log(ok ? 'OK  ' : 'FAIL', name, detail); };

class Device {
  ws!: WebSocket;
  private id = 0;
  private pending = new Map<number, (v: any) => void>();
  readonly name: string;
  readonly serial: string;
  readonly port: number;
  constructor(name: string, serial: string, port: number) { this.name = name; this.serial = serial; this.port = port; }

  async launch(lang: string) {
    adb(this.serial, 'shell', 'am', 'force-stop', 'pl.kopanka.game');
    adb(this.serial, 'shell', 'am', 'start', '-n', 'pl.kopanka.game/.MainActivity');
    await sleep(3000);
    const pid = adb(this.serial, 'shell', 'pidof', 'pl.kopanka.game').trim();
    try { adb(this.serial, 'forward', '--remove', `tcp:${this.port}`); } catch { /* not forwarded yet */ }
    adb(this.serial, 'forward', `tcp:${this.port}`, `localabstract:webview_devtools_remote_${pid}`);
    const pages = await (await fetch(`http://127.0.0.1:${this.port}/json`)).json();
    this.ws = new WebSocket(pages.find((p: { url: string }) => p.url.startsWith('http://localhost')).webSocketDebuggerUrl);
    await new Promise((r) => (this.ws.onopen = r));
    this.ws.onmessage = (e) => { const m = JSON.parse(String(e.data)); this.pending.get(m.id)?.(m); this.pending.delete(m.id); };
    await this.js(`localStorage.setItem('kopanka.lang', '${lang}')`);
    await this.cdp('Page.navigate', { url: 'http://localhost/?debug' });
    await sleep(2500);
  }

  cdp(method: string, params: object = {}) {
    return new Promise<any>((r) => { const i = ++this.id; this.pending.set(i, r); this.ws.send(JSON.stringify({ id: i, method, params })); });
  }

  async js<T = any>(expr: string): Promise<T> {
    const r = await this.cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result?.exceptionDetails) throw new Error(`${this.name}: ${r.result.exceptionDetails.exception?.description ?? 'error'} in ${expr.slice(0, 80)}`);
    return r.result?.result?.value as T;
  }

  touch(type: string, points: { x: number; y: number; id: number }[]) { return this.cdp('Input.dispatchTouchEvent', { type, touchPoints: points }); }
  screenshot(file: string) { execFileSync('sh', ['-c', `"${ADB}" -s ${this.serial} exec-out screencap -p > "${file}"`]); }

  /** Main menu → online screen, fill the form and connect. mode: quick | host | join. */
  async goOnline(mode: 'quick' | 'host' | 'join', opts: { code?: string; extra?: boolean; team?: number } = {}) {
    await this.js(`(async () => {
      const ui = document.querySelector('#ui'), wait = (ms) => new Promise((r) => setTimeout(r, ms));
      ui.querySelectorAll('nav button')[4].click(); await wait(150);
      const set = (el, ev, v) => { if ('selectedIndex' in el && typeof v === 'number') el.selectedIndex = v; else if (typeof v === 'boolean') el.checked = v; else el.value = v; el.dispatchEvent(new Event(ev)); };
      set(ui.querySelector('input'), 'input', '${SERVER}');
      const team = ui.querySelectorAll('select')[0];
      set(team, 'change', ${opts.team ?? 0});
      set(ui.querySelectorAll('select')[1], 'change', ${['quick', 'host', 'join'].indexOf(mode)}); await wait(150);
      if (${mode === 'join'}) { const c = ui.querySelectorAll('input')[1]; set(c, 'input', '${opts.code ?? ''}'); }
      else if (${!!opts.extra}) { const boxes = ui.querySelectorAll('input[type=checkbox]'); set(boxes[0], 'change', true); set(boxes[1], 'change', true); }
      ui.querySelector('button.primary').click();
    })()`);
  }

  state() { return this.js<any>(`(() => { const r = kopanka.app.run, s = r?.s, n = r?.spec.net; return s ? { phase: s.phase, frame: s.frame, tick: s.tick, score: s.score, paused: s.paused, subsLeft: s.subsLeft, period: s.period, so: s.so, status: n?.status, room: n?.room, side: n?.side, message: n?.message, names: r.info.names } : { status: n?.status }; })()`); }
  /** Simulation state with the per-device fields (frame counter after full time, last input) removed. */
  fingerprint() { return this.js<string>(`JSON.stringify({ ...kopanka.app.run.s, frame: 0, prevInput: [0, 0], eventFrame: 0 })`).then((j) => createHash('sha256').update(j).digest('hex').slice(0, 16)); }
}

/** A thumb on the stick and occasional kicks: realistic, varied input for one device. */
function startPlaying(d: Device) {
  let alive = true, stickDown = false;
  const W = 411, H = 914;
  (async () => {
    const stick = { x: W * 0.25, y: H * 0.7, id: 1 }, kick = { x: W * 0.8, y: H * 0.85, id: 2 };
    while (alive) {
      try {
        const a = Math.random() * Math.PI * 2, r = 30 + Math.random() * 30;
        const moved = { ...stick, x: stick.x + Math.cos(a) * r, y: stick.y + Math.sin(a) * r };
        if (!stickDown) { await d.touch('touchStart', [stick]); stickDown = true; }
        await d.touch('touchMove', [moved]);
        if (Math.random() < 0.45) {
          await d.touch('touchStart', [moved, kick]);
          await sleep(Math.random() < 0.5 ? 60 : 200 + Math.random() * 350); // pass or shot
          await d.touch('touchEnd', [kick]);
        }
        await sleep(300 + Math.random() * 700);
      } catch { /* page navigating */ }
    }
    if (stickDown) await d.touch('touchEnd', [stick]).catch(() => {});
  })();
  return () => { alive = false; };
}

async function waitFor(desc: string, ms: number, cond: () => Promise<boolean>) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await cond().catch(() => false)) return true; await sleep(500); }
  check(desc, false, 'timeout');
  return false;
}

async function finishMatch(name: string, a: Device, b: Device) {
  const stopA = startPlaying(a), stopB = startPlaying(b);
  await waitFor(`${name}: both reach full time`, 9 * 60_000, async () => (await a.state()).phase === 'end' && (await b.state()).phase === 'end');
  stopA(); stopB();
  await sleep(800);
  const [sa, sb] = [await a.state(), await b.state()];
  const [fa, fb] = [await a.fingerprint(), await b.fingerprint()];
  check(`${name}: identical final state on both devices`, fa === fb, `${fa} / ${fb}`);
  check(`${name}: same score`, JSON.stringify(sa.score) === JSON.stringify(sb.score), `${sa.names?.join(' – ')} ${sa.score?.join(':')}${sa.so ? ` (k. ${sa.so.goals.join(':')})` : ''}`);
  check(`${name}: no desync or disconnect`, sa.status === 'playing' && sb.status === 'playing', `${sa.status}/${sb.status} ${sa.message ?? ''}${sb.message ?? ''}`);
  return { sa, sb };
}

async function main() {
  const A = new Device('A', SERIAL_A, 9401), B = new Device('B', SERIAL_B, 9402);
  await A.launch('pl');
  await B.launch('de');
  const shots = '/tmp/kopanka-e2e';
  execFileSync('mkdir', ['-p', shots]);

  // 1. Private room, mixed languages; pause from A, resume from B, a substitution by B.
  log('Mecz 1: pokój, A gospodarz (pl), B gość (de)');
  await A.goOnline('host', { team: 0 });
  await waitFor('1: room created', 15_000, async () => (await A.state()).status === 'room');
  const code = (await A.state()).room;
  check('1: room code has 4 letters', /^[A-Z]{4}$/.test(code), code);
  await B.goOnline('join', { code, team: 13 });
  await waitFor('1: match starts on both', 20_000, async () => (await A.state()).status === 'playing' && (await B.state()).status === 'playing');
  const s1 = await A.state();
  check('1: sides assigned (A home, B away)', s1.side === 0 && (await B.state()).side === 1, s1.names.join(' – '));
  const stopA = startPlaying(A), stopB = startPlaying(B);
  await sleep(20_000);
  stopA(); stopB(); await sleep(1500);
  await A.touch('touchStart', [{ x: 411 - 44, y: 44, id: 9 }]); await A.touch('touchEnd', [{ x: 411 - 44, y: 44, id: 9 }]); // on-screen pause button
  await waitFor('1: pause reaches both devices', 5_000, async () => (await A.state()).paused && (await B.state()).paused);
  check('1: pause reaches both devices', (await A.state()).paused && (await B.state()).paused);
  const frozen = (await B.state()).tick; await sleep(2000);
  check('1: clock stops while paused', (await B.state()).tick === frozen, String(frozen));
  A.screenshot(`${shots}/1-pause-A.png`); B.screenshot(`${shots}/1-pause-B.png`);
  // B: substitution through its pause menu (Zmiany i taktyka → player on the pitch → bench player → Gotowe).
  await B.js(`(async () => { const ui = document.querySelector('#ui'), w = (ms) => new Promise((r) => setTimeout(r, ms));
    ui.querySelectorAll('nav button')[1].click(); await w(200);
    ui.querySelectorAll('tbody tr')[6].click(); await w(150); ui.querySelectorAll('tbody tr')[12].click(); await w(400);
    ui.querySelector('button.primary').click(); })()`);
  await waitFor('1: substitution applied on both devices', 5_000, async () => (await A.state()).subsLeft[1] === 2 && (await B.state()).subsLeft[1] === 2);
  check('1: substitution applied on both devices', (await A.state()).subsLeft[1] === 2 && (await B.state()).subsLeft[1] === 2);
  await B.js(`document.querySelector('#ui button.primary').click()`); // Fortsetzen
  await waitFor('1: resume from the other device', 5_000, async () => !(await A.state()).paused && !(await B.state()).paused);
  check('1: resume from the other device', !(await A.state()).paused && !(await B.state()).paused);
  await sleep(3000);
  A.screenshot(`${shots}/1-play-A.png`); B.screenshot(`${shots}/1-play-B.png`);
  await finishMatch('1', A, B);
  A.screenshot(`${shots}/1-end-A.png`); B.screenshot(`${shots}/1-end-B.png`);
  for (const d of [A, B]) await d.js(`(() => { const b = document.querySelector('#ui button.primary'); b && b.click(); })()`); // Dalej → menu
  await sleep(2000);

  // 2. Quick match: B waits first with extra time and penalties, so its settings apply.
  log('Mecz 2: szybka gra, B czeka (dogrywka + karne), A dołącza');
  await B.launch('de'); await A.launch('pl');
  await B.goOnline('quick', { extra: true, team: 40 });
  await waitFor('2: B waits for an opponent', 15_000, async () => (await B.state()).status === 'waiting');
  await A.goOnline('quick', { team: 200 });
  await waitFor('2: match starts on both', 20_000, async () => (await A.state()).status === 'playing' && (await B.state()).status === 'playing');
  const s2 = await B.state();
  check('2: waiting player is home', s2.side === 0, s2.names.join(' – '));
  await finishMatch('2', A, B);

  // 3. Disconnect: B hosts, A joins, A's app is killed mid-match.
  log('Mecz 3: zerwane połączenie');
  await B.launch('de'); await A.launch('pl');
  await B.goOnline('host', { team: 5 });
  await waitFor('3: room created', 15_000, async () => (await B.state()).status === 'room');
  await A.goOnline('join', { code: (await B.state()).room, team: 7 });
  await waitFor('3: match starts on both', 20_000, async () => (await A.state()).status === 'playing' && (await B.state()).status === 'playing');
  const stop3 = startPlaying(B);
  await sleep(30_000);
  adb(SERIAL_A, 'shell', 'am', 'force-stop', 'pl.kopanka.game');
  const left = await waitFor('3: B learns the opponent left', 10_000, async () => (await B.state()).status === 'closed');
  stop3();
  const msg = (await B.state()).message;
  if (left) check('3: B learns the opponent left', /getrennt/i.test(msg ?? ''), msg);
  await sleep(2500);
  B.screenshot(`${shots}/3-left-B.png`);

  const failed = results.filter(([, ok]) => !ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed; screenshots in ${shots}`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
