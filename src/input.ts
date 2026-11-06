// Touch (floating stick left, PASS and SHOT buttons right, pause button), keyboard and
// gamepads → one control word per local player. Player 1 also gets touch and arrows;
// in a two-player game player 2 uses WASD + F/G or the second gamepad.
//
// The simulation knows a single KICK bit: a short press passes, a longer one shoots
// (PASS_MAX_HOLD frames). The two buttons shape that bit here, so replays and online
// play see ordinary input words: PASS sends a short pulse, SHOT holds KICK at least
// long enough to shoot (longer = harder). Without the ball either one slides.
import { UP, DOWN, LEFT, RIGHT, KICK, vecBits } from './sim.ts';

export const STICK_R = 60; // CSS px
export const PAUSE_BTN = { x: -44, y: 44, r: 30 }; // CSS px from the top-right corner
/** Button centres in CSS px from the bottom-right corner. */
export const SHOT_BTN = { x: -78, y: -100, r: 52 };
export const PASS_BTN = { x: -190, y: -62, r: 44 };

export const PASS = 32, SHOT = 64; // local-only bits, turned into KICK by shape()
const PASS_PULSE = 3, SHOT_MIN = 10; // frames; the simulation passes below 9 held frames

const KEYS: Record<string, [number, number]> = {
  ArrowUp: [0, UP], ArrowDown: [0, DOWN], ArrowLeft: [0, LEFT], ArrowRight: [0, RIGHT],
  Space: [0, PASS], Enter: [0, PASS], ControlRight: [0, SHOT], ShiftRight: [0, SHOT], KeyM: [0, SHOT],
  KeyW: [1, UP], KeyS: [1, DOWN], KeyA: [1, LEFT], KeyD: [1, RIGHT], KeyF: [1, PASS], KeyG: [1, SHOT], ShiftLeft: [1, SHOT], ControlLeft: [1, SHOT],
};

/** Per player: frames of KICK still owed for a pass pulse or a minimum-length shot. */
export class KickShaper {
  private prev = 0;
  private pulse = 0;
  private shot = 0;
  shape(raw: number): number {
    const pass = raw & PASS && !(this.prev & PASS), shooting = raw & SHOT;
    if (pass) this.pulse = Math.max(this.pulse, PASS_PULSE);
    if (shooting) this.shot++;
    else if (this.prev & SHOT && this.shot < SHOT_MIN) this.pulse = Math.max(this.pulse, SHOT_MIN - this.shot);
    if (!shooting && !(this.prev & SHOT)) this.shot = 0;
    this.prev = raw;
    const kick = shooting || this.pulse > 0;
    if (this.pulse > 0) this.pulse--;
    return (raw & 15) | (kick ? KICK : 0);
  }
  reset() { this.prev = this.pulse = this.shot = 0; }
}

export class Controls {
  touch = false;
  stick: { id: number; ox: number; oy: number; x: number; y: number } | null = null;
  passes = new Set<number>(); // pointer ids on the PASS button
  shots = new Set<number>(); // pointer ids on the SHOT button
  private shapers = [new KickShaper(), new KickShaper()];
  private tapped = 0; // PASS/SHOT pressed since the last frame: a tap shorter than a frame still counts
  keys = new Set<string>();
  twoPlayers = false;
  onPause = () => {};
  private padStart = [false, false];

  constructor(el: HTMLElement) {
    addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      if (KEYS[e.code]) e.preventDefault();
      if ((e.code === 'Escape' || e.code === 'KeyP') && !e.repeat) this.onPause();
      this.keys.add(e.code);
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.reset());
    el.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse') return;
      this.touch = true;
      if (Math.hypot(e.clientX - (innerWidth + PAUSE_BTN.x), e.clientY - PAUSE_BTN.y) < PAUSE_BTN.r + 10) return this.onPause();
      el.setPointerCapture(e.pointerId);
      if (e.clientX > innerWidth * 0.55) {
        // Right side: whichever button is nearer.
        const d = (b: { x: number; y: number }) => Math.hypot(e.clientX - (innerWidth + b.x), e.clientY - (innerHeight + b.y));
        const shot = d(SHOT_BTN) <= d(PASS_BTN);
        (shot ? this.shots : this.passes).add(e.pointerId);
        this.tapped |= shot ? SHOT : PASS;
      }
      // A new left-side touch always takes over: a stale stick can survive when a
      // dialog swallows the pointerup.
      else this.stick = { id: e.pointerId, ox: e.clientX, oy: e.clientY, x: e.clientX, y: e.clientY };
    });
    el.addEventListener('pointermove', (e) => {
      const s = this.stick;
      if (!s || s.id !== e.pointerId) return;
      s.x = e.clientX; s.y = e.clientY;
      // Floating stick: drag the origin along when the thumb overshoots.
      const dx = s.x - s.ox, dy = s.y - s.oy, d = Math.hypot(dx, dy);
      if (d > STICK_R) { s.ox = s.x - (dx * STICK_R) / d; s.oy = s.y - (dy * STICK_R) / d; }
    });
    const up = (e: PointerEvent) => {
      this.passes.delete(e.pointerId);
      this.shots.delete(e.pointerId);
      if (this.stick?.id === e.pointerId) this.stick = null;
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  }

  reset() {
    this.keys.clear();
    this.passes.clear();
    this.shots.clear();
    this.stick = null;
    for (const s of this.shapers) s.reset();
  }

  /** Control bits (0-4) for local player 0 or 1, called once per simulated frame. Also polls gamepad start for pause. */
  bits(player: number): number {
    let b = 0;
    for (const k of this.keys) {
      const m = KEYS[k];
      if (m && (m[0] === player || !this.twoPlayers)) b |= m[1];
    }
    if (player === 0) {
      const s = this.stick;
      if (s) b |= vecBits(s.x - s.ox, s.y - s.oy, 14);
      if (this.passes.size) b |= PASS;
      if (this.shots.size) b |= SHOT;
      b |= this.tapped;
      this.tapped = 0;
    }
    const pad = navigator.getGamepads?.()[this.twoPlayers ? player : 0];
    if (pad && (player === 0 || this.twoPlayers)) {
      const [ax = 0, ay = 0] = pad.axes, pr = (i: number) => !!pad.buttons[i]?.pressed;
      b |= vecBits(Math.abs(ax) > 0.4 ? ax : 0, Math.abs(ay) > 0.4 ? ay : 0, 0);
      if (pr(12)) b |= UP;
      if (pr(13)) b |= DOWN;
      if (pr(14)) b |= LEFT;
      if (pr(15)) b |= RIGHT;
      if (pr(0)) b |= PASS; // A
      if (pr(1) || pr(2)) b |= SHOT; // B, X
      const start = pr(9);
      if (start && !this.padStart[player]) this.onPause();
      this.padStart[player] = start;
    }
    return this.shapers[player].shape(b);
  }
}
