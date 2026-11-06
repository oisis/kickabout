import { step, TICK_HZ, type State } from './sim.ts';
import { Controls } from './input.ts';
import { render, setZoom } from './render.ts';
import { MatchRun, type MatchSpec } from './match.ts';
import { type Highlight, addHighlights, options } from './store.ts';
import { show, toast } from './ui.ts';
import { audio, menuMusic, crowdLevel } from './audio.ts';
import * as screens from './screens.ts';
import { t } from './i18n.ts';
import { Voice } from './voice.ts';
import { audio as sound } from './audio.ts';

const canvas = document.querySelector('canvas')!;
const ctx = canvas.getContext('2d')!;
const controls = new Controls(canvas);

function resize() {
  const d = devicePixelRatio || 1;
  canvas.width = Math.round(innerWidth * d);
  canvas.height = Math.round(innerHeight * d);
}
addEventListener('resize', resize);
resize();

export type EndHandler = (s: State, run: MatchRun) => void;

/** App state: either a menu is shown, a match runs, or a saved highlight plays. */
export class App {
  run: MatchRun | null = null;
  voice: Voice | null = null; // voice chat of the current online match (private room, both agreed)
  viewer: { h: Highlight; s: State; i: number; done: () => void } | null = null;
  private onEnd: EndHandler | null = null;
  private ended = false;
  private pauseShown = false;

  constructor() { this.applyOptions(); }

  applyOptions() {
    const o = options();
    audio.sound = o.sound;
    audio.music = o.music;
    setZoom(o.zoom);
  }

  menu() {
    this.endVoice();
    this.run?.spec.net?.close(); // leaving a finished online match must free the opponent too
    this.run = null;
    this.viewer = null;
    crowdLevel(0);
    menuMusic(true);
    screens.mainMenu(this);
  }

  startMatch(spec: MatchSpec, onEnd: EndHandler | null = null) {
    menuMusic(false);
    show();
    controls.reset();
    controls.twoPlayers = spec.humans.includes(2);
    this.run = new MatchRun(spec, controls);
    this.onEnd = onEnd;
    this.ended = false;
    this.pauseShown = false;
    document.documentElement.requestFullscreen?.().catch(() => {});
  }

  /** Leave the running match without a result. */
  quitMatch() {
    this.endVoice();
    this.run?.spec.net?.close();
    this.run = null;
    this.menu();
  }

  /** Starts the voice chat for an online match where both players of the room chose it. */
  startVoice(net: NonNullable<MatchSpec['net']>) {
    this.endVoice();
    if (!net.voice || !globalThis.RTCPeerConnection) return;
    const v = new Voice((d) => net.signal(d), net.voice);
    net.onSignal = (d) => v.receive(d);
    this.voice = v;
    sound.duck = 0.4;
    controls.onMic = () => v.toggleMute();
    setTimeout(() => { if (v.micError && this.voice === v) toast(t('Brak dostępu do mikrofonu — słyszysz przeciwnika')); }, 3000);
  }

  endVoice() {
    this.voice?.close();
    this.voice = null;
    sound.duck = 1;
    controls.onMic = null;
  }

  playHighlight(h: Highlight, done: () => void) {
    menuMusic(false);
    show();
    this.viewer = { h, s: structuredClone(h.start), i: 0, done };
  }

  tick(dt: number) {
    const run = this.run;
    if (this.viewer) return this.stepViewer(dt);
    if (!run) return;
    run.update(dt);
    const s = run.s, net = run.spec.net;
    if (s.paused && !run.replay && !this.pauseShown && !run.spec.watch) { this.pauseShown = true; screens.pauseMenu(this, run); }
    if ((!s.paused || run.replay) && this.pauseShown) { this.pauseShown = false; show(); }
    if (s.phase === 'end' && !this.ended) {
      this.ended = true;
      if (options().autoSaveHighlights && run.highlights.length && !run.spec.watch) addHighlights(run.highlights);
      crowdLevel(0);
      setTimeout(() => this.run === run && screens.fullTime(this, run, () => (this.onEnd ? this.onEnd(s, run) : this.menu())), 1500);
    }
    if (net && net.status === 'closed' && !this.ended) {
      this.ended = true;
      setTimeout(() => this.run === run && screens.message(net.message || t('Rozłączono'), () => this.menu()), 1500);
    }
  }

  private viewerAcc = 0;
  private stepViewer(dt: number) {
    const v = this.viewer!;
    this.viewerAcc += Math.min(dt, 250);
    for (; this.viewerAcc >= 1000 / TICK_HZ; this.viewerAcc -= 1000 / TICK_HZ) {
      do step(v.s, v.h.inputs[v.i++] ?? [0, 0]); while (v.s.paused && v.i < v.h.inputs.length);
      if (v.i >= v.h.inputs.length) { this.viewer = null; this.viewerAcc = 0; v.done(); return; }
    }
  }

  draw() {
    if (this.viewer) {
      const v = this.viewer;
      return render(ctx, v.s, v.h.info, controls, { humans: [0, 0], me: 0, overlay: '', replay: v.h.title });
    }
    const run = this.run;
    if (!run) { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = '#0a2414'; ctx.fillRect(0, 0, canvas.width, canvas.height); return; }
    const r = run.replay;
    const net = run.spec.net;
    const overlay = !net || net.status === 'playing' || net.status === 'closed' ? ''
      : net.status === 'connecting' ? t('Łączenie z serwerem…') : net.status === 'room' ? t('Pokój {0} — podaj kod znajomemu', net.room) : t('Czekam na przeciwnika…');
    const watch = !!run.spec.watch;
    render(ctx, r ? r.s : run.s, run.info, controls, {
      humans: watch ? [0, 0] : net ? [net.side === 0 ? 1 : 0, net.side === 1 ? 1 : 0] : run.spec.humans,
      live: watch ? `${t('NA ŻYWO')}${run.s.paused ? ` • ${t('przerwa w grze')}` : ''}` : undefined,
      me: run.me, overlay, replay: r ? r.title : '',
      voice: this.voice && !r ? { muted: this.voice.muted, state: this.voice.state } : undefined,
    });
  }

  /** Taps on the canvas: skip a replay; leave a finished or failed online match. */
  tap() {
    if (this.viewer) { const v = this.viewer; this.viewer = null; v.done(); return; }
    const net = this.run?.spec.net;
    if (net && (net.status === 'connecting' || net.status === 'waiting' || net.status === 'room')) { this.quitMatch(); return; }
    if (this.run?.replay) this.run.stopReplay();
  }
}

const app = new App();
controls.onPause = () => { if (app.run && app.run.s.phase !== 'end' && !app.run.replay && !app.run.spec.watch) app.run.togglePause(); };
canvas.addEventListener('pointerdown', () => app.tap());

let last = performance.now();
function frame(now: number) {
  app.tick(now - last);
  last = now;
  app.draw();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
app.menu();
// The website's "My club" link opens the game on that screen.
if (new URLSearchParams(location.search).has('club')) import('./clubScreens.ts').then((m) => m.clubMenu(app));
// The website's fan zone plays a live match here (in its frame): ?watch=<match id>.
const watchId = new URLSearchParams(location.search).get('watch');
if (watchId) screens.watchMatch(app, watchId);

// On-device test hook, only when opened with ?debug: live state and controls.
if (new URLSearchParams(location.search).has('debug')) Object.assign(globalThis, { kickabout: { app, state: () => app.run?.s, controls } });

if (import.meta.env.PROD && 'serviceWorker' in navigator && location.hostname !== 'localhost') {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
