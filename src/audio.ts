// Game audio: recorded CC0 samples (public/audio, see CREDITS.md) for kicks, the
// referee's whistle, goal cheers, the crowd bed and menu music, with synthesised
// fallbacks while samples load or if a file is missing. Starts on the first user
// gesture, as browsers require.
let ctx: AudioContext | null = null;
let noise: AudioBuffer | null = null;
let crowd: { gain: GainNode } | null = null;
let music: { stop: () => void; synth: boolean } | null = null;
export const audio = { sound: true, music: true };

const FILES = { kick: 'kick.ogg', kick2: 'kick2.ogg', whistle: 'whistle.ogg', goal: 'goal.ogg', crowd: 'crowd.ogg', menu: 'menu.ogg' };
type Sample = keyof typeof FILES;
const samples: Partial<Record<Sample, AudioBuffer>> = {};

let unlocked = false, wantMusic = false;
for (const ev of ['pointerdown', 'keydown']) {
  addEventListener(ev, () => {
    if (unlocked) return;
    unlocked = true;
    const c = ac();
    if (c) load(c);
    menuMusic(wantMusic);
  }, { capture: true });
}

function ac(): AudioContext | null {
  if (!unlocked || (!audio.sound && !audio.music)) return null;
  if (!ctx) {
    try { ctx = new AudioContext(); } catch { return null; }
    noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

function load(c: AudioContext) {
  for (const [name, file] of Object.entries(FILES) as [Sample, string][]) {
    fetch(`audio/${file}`)
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(file))))
      .then((b) => c.decodeAudioData(b))
      .then((buf) => {
        samples[name] = buf;
        if (name === 'menu' && wantMusic && music?.synth) { music.stop(); music = null; menuMusic(true); }
      })
      .catch(() => { /* keep the synthesised fallback */ });
  }
}

/** Play a sample once; returns false when it is not loaded (caller falls back to synthesis). */
function play(name: Sample, volume = 1, rate = 1, at = 0): boolean {
  const c = audio.sound && ac(), buf = samples[name];
  if (!c || !buf) return false;
  const src = c.createBufferSource(), g = c.createGain();
  src.buffer = buf; src.playbackRate.value = rate; g.gain.value = volume;
  src.connect(g).connect(c.destination);
  src.start(c.currentTime + at);
  return true;
}

function env(c: AudioContext, g: GainNode, peak: number, attack: number, decay: number, at = c.currentTime) {
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(peak, at + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, at + attack + decay);
}

let kickAlt = false;
export function kick(power: number) {
  kickAlt = !kickAlt;
  if (play(kickAlt ? 'kick' : 'kick2', 0.35 + power * 0.65, 0.9 + (1 - power) * 0.25)) return;
  const c = audio.sound && ac();
  if (!c) return;
  const o = c.createOscillator(), g = c.createGain();
  o.frequency.setValueAtTime(140 + power * 60, c.currentTime);
  o.frequency.exponentialRampToValueAtTime(50, c.currentTime + 0.12);
  env(c, g, 0.25 + power * 0.25, 0.005, 0.15);
  o.connect(g).connect(c.destination);
  o.start(); o.stop(c.currentTime + 0.2);
}

/** Referee: one blast for a foul or kick-off, two for half-time, three for full time. */
export function whistle(blasts = 1) {
  if (samples.whistle) {
    for (let i = 0; i < blasts; i++) play('whistle', 0.7, 1, i * 0.42);
    return;
  }
  const c = audio.sound && ac();
  if (!c) return;
  for (let i = 0; i < blasts; i++) {
    const at = c.currentTime + i * 0.45, o = c.createOscillator(), lfo = c.createOscillator(), lg = c.createGain(), g = c.createGain();
    o.type = 'square'; o.frequency.value = 2600;
    lfo.frequency.value = 38; lg.gain.value = 120;
    lfo.connect(lg).connect(o.frequency);
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(0.06, at + 0.02);
    g.gain.setValueAtTime(0.06, at + 0.3);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.38);
    o.connect(g).connect(c.destination);
    o.start(at); lfo.start(at); o.stop(at + 0.5); lfo.stop(at + 0.5);
  }
}

function noiseBurst(c: AudioContext, peak: number, freq: number, attack: number, decay: number) {
  const src = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
  src.buffer = noise; f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = 0.6;
  env(c, g, peak, attack, decay);
  src.connect(f).connect(g).connect(c.destination);
  src.start(); src.stop(c.currentTime + attack + decay + 0.1);
}

export function cheer() {
  if (play('goal', 0.8)) return;
  const c = audio.sound && ac();
  if (c) noiseBurst(c, 0.35, 900, 0.15, 2.8);
}

/** A disappointed "ooh": the cheer, quieter and lower. */
export function groan() {
  if (play('goal', 0.25, 0.75)) return;
  const c = audio.sound && ac();
  if (c) noiseBurst(c, 0.15, 400, 0.1, 1.2);
}

/** Continuous crowd bed; level 0..1 follows how close play is to a goal. */
export function crowdLevel(level: number) {
  const c = audio.sound && ac();
  if (!c) { if (crowd) crowd.gain.gain.value = 0; return; }
  if (!crowd && (samples.crowd || noise)) {
    const src = c.createBufferSource(), gain = c.createGain();
    src.buffer = samples.crowd ?? noise; src.loop = true; gain.gain.value = 0;
    if (samples.crowd) src.connect(gain).connect(c.destination);
    else { const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 700; src.connect(f).connect(gain).connect(c.destination); }
    src.start();
    crowd = { gain };
  }
  if (crowd) crowd.gain.gain.setTargetAtTime(samples.crowd ? 0.25 + level * 0.6 : 0.02 + level * 0.07, c.currentTime, 0.4);
}

const TUNE = [64, 67, 71, 72, 71, 67, 64, 62, 64, 67, 69, 67, 64, 60, 62, 64];
export function menuMusic(on: boolean) {
  wantMusic = on;
  if (!on || !audio.music) { music?.stop(); music = null; return; }
  const c = ac();
  if (!c || music) return;
  if (samples.menu) {
    const src = c.createBufferSource(), g = c.createGain();
    src.buffer = samples.menu; src.loop = true; g.gain.value = 0.5;
    src.connect(g).connect(c.destination);
    src.start();
    music = { stop: () => src.stop(), synth: false };
    return;
  }
  let step = 0, stopped = false;
  const tick = () => {
    if (stopped) return;
    const at = c.currentTime + 0.02, note = TUNE[step % TUNE.length];
    for (const [semi, type, vol] of [[0, 'triangle', 0.05], [-24, 'sine', 0.06]] as const) {
      if (semi && step % 2) continue;
      const o = c.createOscillator(), g = c.createGain();
      o.type = type; o.frequency.value = 440 * 2 ** ((note + semi - 69) / 12);
      env(c, g, vol, 0.01, 0.3, at);
      o.connect(g).connect(c.destination);
      o.start(at); o.stop(at + 0.35);
    }
    step++;
    setTimeout(tick, 250);
  };
  tick();
  music = { stop: () => { stopped = true; }, synth: true };
}
