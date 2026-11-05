// Touch (floating stick left, kick right, pause button), keyboard and gamepads
// → one control word per local player. Player 1 also gets touch and arrows;
// in a two-player game player 2 uses WASD + F or the second gamepad.
import { UP, DOWN, LEFT, RIGHT, KICK, vecBits } from './sim.ts';

export const STICK_R = 60; // CSS px
export const PAUSE_BTN = { x: -44, y: 44, r: 30 }; // CSS px from the top-right corner

const KEYS: Record<string, [number, number]> = {
  ArrowUp: [0, UP], ArrowDown: [0, DOWN], ArrowLeft: [0, LEFT], ArrowRight: [0, RIGHT],
  Space: [0, KICK], ControlRight: [0, KICK], Enter: [0, KICK], KeyM: [0, KICK],
  KeyW: [1, UP], KeyS: [1, DOWN], KeyA: [1, LEFT], KeyD: [1, RIGHT], KeyF: [1, KICK], ShiftLeft: [1, KICK], ControlLeft: [1, KICK],
};

export class Controls {
  touch = false;
  stick: { id: number; ox: number; oy: number; x: number; y: number } | null = null;
  kicks = new Set<number>();
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
      if (e.clientX > innerWidth * 0.55) this.kicks.add(e.pointerId);
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
      this.kicks.delete(e.pointerId);
      if (this.stick?.id === e.pointerId) this.stick = null;
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  }

  reset() {
    this.keys.clear();
    this.kicks.clear();
    this.stick = null;
  }

  /** Control bits (0-4) for local player 0 or 1. Also polls gamepad start for pause. */
  bits(player: number): number {
    let b = 0;
    for (const k of this.keys) {
      const m = KEYS[k];
      if (m && (m[0] === player || !this.twoPlayers)) b |= m[1];
    }
    if (player === 0) {
      const s = this.stick;
      if (s) b |= vecBits(s.x - s.ox, s.y - s.oy, 14);
      if (this.kicks.size) b |= KICK;
    }
    const pad = navigator.getGamepads?.()[this.twoPlayers ? player : 0];
    if (pad && (player === 0 || this.twoPlayers)) {
      const [ax = 0, ay = 0] = pad.axes, pr = (i: number) => !!pad.buttons[i]?.pressed;
      b |= vecBits(Math.abs(ax) > 0.4 ? ax : 0, Math.abs(ay) > 0.4 ? ay : 0, 0);
      if (pr(12)) b |= UP;
      if (pr(13)) b |= DOWN;
      if (pr(14)) b |= LEFT;
      if (pr(15)) b |= RIGHT;
      if (pr(0) || pr(1) || pr(2)) b |= KICK;
      const start = pr(9);
      if (start && !this.padStart[player]) this.onPause();
      this.padStart[player] = start;
    }
    return b;
  }
}
