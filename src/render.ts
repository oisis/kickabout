// Canvas renderer: top-down pitch with a slight oblique look (height draws upward).
// Reads state only; camera smoothing lives here and never feeds back into the sim.
import {
  type State, type Player, W, H, M, GOAL_HALF, CROSSBAR, BOX_HALF, BOX_DEPTH,
  AREA_HALF, AREA_DEPTH, CIRCLE_R, PEN_SPOT,
} from './sim.ts';
import { type Controls, STICK_R } from './input.ts';

export const TEAMS = [
  { short: 'CZE', shirt: '#dc2626', shorts: '#f8fafc', keeper: '#22c55e' },
  { short: 'NIE', shirt: '#2563eb', shorts: '#0f172a', keeper: '#f59e0b' },
];
const HUMAN = 0;
const cam = { x: W / 2, y: H / 2 };

export function render(ctx: CanvasRenderingContext2D, s: State, c: Controls, mode: 'title' | 'match') {
  const cw = ctx.canvas.width, ch = ctx.canvas.height, dpr = devicePixelRatio || 1;
  const k = Math.max(cw, ch) / (44 * M); // px per unit
  const b = s.ball;
  cam.x += (b.x - cam.x) * 0.12;
  cam.y += (b.y - b.z - cam.y) * 0.12;
  const hw = cw / 2 / k, hh = ch / 2 / k, mg = 6 * M;
  cam.x = hw * 2 > W + 2 * mg ? W / 2 : Math.min(Math.max(cam.x, hw - mg), W + mg - hw);
  cam.y = hh * 2 > H + 2 * mg ? H / 2 : Math.min(Math.max(cam.y, hh - mg), H + mg - hh);

  ctx.setTransform(k, 0, 0, k, cw / 2 - cam.x * k, ch / 2 - cam.y * k);
  pitch(ctx);
  const things: [number, () => void][] = [[b.y, () => ball(ctx, s)]];
  s.teams.forEach((team, t) => team.forEach((p, i) => things.push([p.y, () => player(ctx, s, p, t, i)])));
  things.sort((a, z) => a[0] - z[0]).forEach(([, draw]) => draw());
  goalFrame(ctx, H); // near crossbar is drawn over players

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  hud(ctx, s, cw, ch, mode);
  if (c.touch && mode === 'match') touchControls(ctx, c, cw, ch, dpr);
}

function pitch(ctx: CanvasRenderingContext2D) {
  const ext = 12 * M;
  for (let y = -ext, i = 0; y < H + ext; y += 5 * M, i++) {
    ctx.fillStyle = i % 2 ? '#2f8f3a' : '#2a8235';
    ctx.fillRect(-ext, y, W + 2 * ext, 5 * M);
  }
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.lineWidth = 0.12 * M;
  ctx.strokeRect(0, 0, W, H);
  line(ctx, 0, H / 2, W, H / 2);
  circle(ctx, W / 2, H / 2, CIRCLE_R, false);
  circle(ctx, W / 2, H / 2, 0.25 * M, true);
  for (const [gy, d] of [[0, 1], [H, -1]]) {
    ctx.strokeRect(W / 2 - BOX_HALF, Math.min(gy, gy + d * BOX_DEPTH), BOX_HALF * 2, BOX_DEPTH);
    ctx.strokeRect(W / 2 - AREA_HALF, Math.min(gy, gy + d * AREA_DEPTH), AREA_HALF * 2, AREA_DEPTH);
    circle(ctx, W / 2, gy + d * PEN_SPOT, 0.25 * M, true);
    ctx.beginPath();
    const a = Math.acos((BOX_DEPTH - PEN_SPOT) / CIRCLE_R);
    if (d > 0) ctx.arc(W / 2, gy + PEN_SPOT, CIRCLE_R, Math.PI / 2 - a, Math.PI / 2 + a);
    else ctx.arc(W / 2, gy - PEN_SPOT, CIRCLE_R, -Math.PI / 2 - a, -Math.PI / 2 + a);
    ctx.stroke();
  }
  // Nets
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  ctx.fillRect(W / 2 - GOAL_HALF, -2 * M - CROSSBAR, GOAL_HALF * 2, 2 * M);
  ctx.fillRect(W / 2 - GOAL_HALF, H - CROSSBAR, GOAL_HALF * 2, 2 * M + CROSSBAR);
  goalFrame(ctx, 0);
}

function goalFrame(ctx: CanvasRenderingContext2D, gy: number) {
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 0.15 * M;
  ctx.beginPath();
  ctx.moveTo(W / 2 - GOAL_HALF, gy);
  ctx.lineTo(W / 2 - GOAL_HALF, gy - CROSSBAR);
  ctx.lineTo(W / 2 + GOAL_HALF, gy - CROSSBAR);
  ctx.lineTo(W / 2 + GOAL_HALF, gy);
  ctx.stroke();
}

function line(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number) {
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
}

function circle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, fill: boolean) {
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
  if (fill) { ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.fill(); } else ctx.stroke();
}

function ellipse(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, color: string) {
  ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill();
}

function player(ctx: CanvasRenderingContext2D, s: State, p: Player, t: number, i: number) {
  const kit = TEAMS[t], shirt = i === 0 ? kit.keeper : kit.shirt;
  ellipse(ctx, p.x + 0.15 * M, p.y, 0.5 * M, 0.22 * M, 'rgba(0,0,0,0.3)');
  if (p.slide || p.down) { // lying along the facing direction
    ctx.save();
    ctx.translate(p.x, p.y - 0.3 * M);
    ctx.rotate(Math.atan2(p.fy, p.fx));
    ellipse(ctx, 0, 0, 0.9 * M, 0.35 * M, shirt);
    ellipse(ctx, 0.9 * M, 0, 0.26 * M, 0.26 * M, '#e8b98a');
    ctx.restore();
    return;
  }
  const moving = p.vx || p.vy, step = moving && (s.frame >> 3) & 1 ? 0.12 * M : 0;
  ctx.fillStyle = '#1f2937';
  ctx.fillRect(p.x - 0.22 * M, p.y - 0.8 * M + step, 0.16 * M, 0.8 * M - step);
  ctx.fillRect(p.x + 0.06 * M, p.y - 0.8 * M + (0.12 * M - step) * (moving ? 1 : 0), 0.16 * M, 0.8 * M);
  ctx.fillStyle = kit.shorts;
  ctx.fillRect(p.x - 0.28 * M, p.y - 1.05 * M, 0.56 * M, 0.32 * M);
  ellipse(ctx, p.x, p.y - 1.35 * M, 0.42 * M, 0.45 * M, shirt);
  const hx = p.x + (p.fx / 1000) * 0.08 * M, hy = p.y - 2.0 * M + (p.fy / 1000) * 0.05 * M;
  ellipse(ctx, hx, hy, 0.25 * M, 0.26 * M, '#e8b98a');
  ellipse(ctx, hx - (p.fx / 1000) * 0.08 * M, hy - (p.fy / 1000) * 0.08 * M - 0.08 * M, 0.21 * M, 0.17 * M, '#3b2416');
  if (t === HUMAN && i === s.controlled[t]) {
    ctx.beginPath();
    ctx.moveTo(p.x, p.y - 2.45 * M);
    ctx.lineTo(p.x - 0.3 * M, p.y - 2.95 * M);
    ctx.lineTo(p.x + 0.3 * M, p.y - 2.95 * M);
    ctx.closePath();
    ctx.fillStyle = '#facc15'; ctx.fill();
    ctx.lineWidth = 0.06 * M; ctx.strokeStyle = '#000'; ctx.stroke();
  }
}

function ball(ctx: CanvasRenderingContext2D, s: State) {
  const b = s.ball, r = 0.24 * M * (1 + b.z / (8 * M));
  ellipse(ctx, b.x + b.z * 0.3, b.y, 0.22 * M, 0.12 * M, 'rgba(0,0,0,0.35)');
  ctx.beginPath(); ctx.arc(b.x, b.y - b.z - 0.22 * M, r, 0, Math.PI * 2);
  ctx.fillStyle = '#fff'; ctx.fill();
  ctx.lineWidth = 0.05 * M; ctx.strokeStyle = '#111'; ctx.stroke();
  ellipse(ctx, b.x - r * 0.25, b.y - b.z - 0.22 * M - r * 0.2, r * 0.32, r * 0.32, '#111');
}

function text(ctx: CanvasRenderingContext2D, str: string, x: number, y: number, size: number, color = '#fff') {
  ctx.font = `800 ${size}px system-ui, sans-serif`;
  ctx.lineJoin = 'round'; ctx.lineWidth = size / 6; ctx.strokeStyle = 'rgba(0,0,0,0.75)'; ctx.strokeText(str, x, y);
  ctx.fillStyle = color; ctx.fillText(str, x, y);
}

function hud(ctx: CanvasRenderingContext2D, s: State, cw: number, ch: number, mode: 'title' | 'match') {
  const u = Math.min(cw, ch) / 20;
  ctx.textBaseline = 'middle';
  if (mode === 'title') {
    ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(0, 0, cw, ch);
    ctx.textAlign = 'center';
    text(ctx, 'KOPANKA', cw / 2, ch * 0.32, u * 2.6, '#facc15');
    text(ctx, 'Dotknij, aby zagrać', cw / 2, ch * 0.5, u);
    text(ctx, 'lewa strona: bieg • prawa: podanie / strzał', cw / 2, ch * 0.62, u * 0.55);
    text(ctx, 'przytrzymaj = mocniej i wyżej • bez piłki = wślizg', cw / 2, ch * 0.67, u * 0.55);
    text(ctx, 'klawiatura: strzałki/WASD + spacja', cw / 2, ch * 0.72, u * 0.55);
    return;
  }
  const min = Math.min(90, Math.floor((s.tick * 90) / s.matchTicks));
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(u * 0.4, u * 0.4, u * 7.2, u * 1.3);
  ctx.textAlign = 'left';
  text(ctx, TEAMS[0].short, u * 0.7, u * 1.05, u * 0.75, TEAMS[0].shirt);
  text(ctx, `${s.score[0]}:${s.score[1]}`, u * 2.5, u * 1.05, u * 0.75);
  text(ctx, TEAMS[1].short, u * 3.9, u * 1.05, u * 0.75, '#60a5fa');
  text(ctx, `${min}'`, u * 5.8, u * 1.05, u * 0.75);

  ctx.textAlign = 'center';
  const age = s.frame - s.eventFrame;
  if (s.event && (age < 110 || s.phase === 'end')) {
    const big = s.event === 'GOL!' || s.phase === 'end';
    text(ctx, s.event, cw / 2, ch * 0.3, big ? u * 2 : u, big ? '#facc15' : '#fff');
  }
  if (s.phase === 'end') {
    text(ctx, `${TEAMS[0].short} ${s.score[0]} : ${s.score[1]} ${TEAMS[1].short}`, cw / 2, ch * 0.42, u * 1.2);
    text(ctx, 'Dotknij, aby zagrać ponownie', cw / 2, ch * 0.55, u * 0.8);
  }
  const hold = s.hold[HUMAN];
  if (hold > 0 && s.ownerTeam === HUMAN && s.ownerIdx === s.controlled[HUMAN]) {
    const bw = u * 6, f = Math.min(hold, 40) / 40, shot = hold >= 9;
    ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(cw / 2 - bw / 2, ch - u * 1.6, bw, u * 0.5);
    ctx.fillStyle = shot ? '#ef4444' : '#22c55e'; ctx.fillRect(cw / 2 - bw / 2, ch - u * 1.6, bw * f, u * 0.5);
    text(ctx, shot ? 'strzał' : 'podanie', cw / 2, ch - u * 2.1, u * 0.55);
  }
}

function touchControls(ctx: CanvasRenderingContext2D, c: Controls, cw: number, ch: number, dpr: number) {
  const s = c.stick;
  if (s) {
    ctx.beginPath(); ctx.arc(s.ox * dpr, s.oy * dpr, STICK_R * dpr, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.15)'; ctx.fill();
    ctx.beginPath(); ctx.arc(s.x * dpr, s.y * dpr, 26 * dpr, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.45)'; ctx.fill();
  }
  ctx.beginPath(); ctx.arc(cw - 90 * dpr, ch - 110 * dpr, 55 * dpr, 0, Math.PI * 2);
  ctx.fillStyle = c.kicks.size ? 'rgba(250,204,21,0.6)' : 'rgba(255,255,255,0.2)'; ctx.fill();
  ctx.textAlign = 'center';
  text(ctx, 'KOP', cw - 90 * dpr, ch - 110 * dpr, 20 * dpr);
}
