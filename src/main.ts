import { newMatch, step, TICK_HZ, type State } from './sim.ts';
import { cpuInput } from './ai.ts';
import { Controls } from './input.ts';
import { render } from './render.ts';

const canvas = document.querySelector('canvas')!;
const ctx = canvas.getContext('2d')!;
const controls = new Controls(canvas);
const seed = () => (Math.random() * 2 ** 32) >>> 0 || 1;

let s: State = newMatch(seed());
let mode: 'title' | 'match' = 'title';

function resize() {
  const d = devicePixelRatio || 1;
  canvas.width = Math.round(innerWidth * d);
  canvas.height = Math.round(innerHeight * d);
}
addEventListener('resize', resize);
resize();

function start() {
  if (mode === 'match' && s.phase !== 'end') return;
  s = newMatch(seed());
  mode = 'match';
  document.documentElement.requestFullscreen?.().catch(() => {});
}
canvas.addEventListener('pointerdown', start);
addEventListener('keydown', (e) => { if (e.code === 'Enter' || e.code === 'Space') start(); });

// Fixed 60 Hz simulation, rendering at display rate.
const DT = 1000 / TICK_HZ;
let acc = 0, last = performance.now();
function frame(now: number) {
  acc += Math.min(now - last, 250);
  last = now;
  for (; acc >= DT; acc -= DT) if (mode === 'match') step(s, [controls.bits(), cpuInput(s, 1)]);
  render(ctx, s, controls, mode);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

if (import.meta.env.PROD && 'serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
