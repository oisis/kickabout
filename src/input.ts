// Touch (floating stick on the left, kick on the right) and keyboard → one input word.
import { UP, DOWN, LEFT, RIGHT, KICK, vecBits } from './sim.ts';

export const STICK_R = 60; // CSS px

const KEYS: Record<string, number> = {
  ArrowUp: UP, KeyW: UP, ArrowDown: DOWN, KeyS: DOWN, ArrowLeft: LEFT, KeyA: LEFT, ArrowRight: RIGHT, KeyD: RIGHT,
  Space: KICK, KeyX: KICK, KeyJ: KICK, ControlLeft: KICK, ControlRight: KICK,
};

export class Controls {
  touch = false;
  stick: { id: number; ox: number; oy: number; x: number; y: number } | null = null;
  kicks = new Set<number>();
  keys = new Set<string>();

  constructor(el: HTMLElement) {
    addEventListener('keydown', (e) => {
      if (KEYS[e.code]) e.preventDefault();
      this.keys.add(e.code);
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => { this.keys.clear(); this.kicks.clear(); this.stick = null; });
    el.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse') return;
      this.touch = true;
      el.setPointerCapture(e.pointerId);
      if (e.clientX > innerWidth * 0.55) this.kicks.add(e.pointerId);
      else if (!this.stick) this.stick = { id: e.pointerId, ox: e.clientX, oy: e.clientY, x: e.clientX, y: e.clientY };
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

  bits(): number {
    let b = 0;
    for (const k of this.keys) b |= KEYS[k] ?? 0;
    const s = this.stick;
    if (s) b |= vecBits(s.x - s.ox, s.y - s.oy, 14);
    if (this.kicks.size) b |= KICK;
    return b;
  }
}
