// Canvas renderer: top-down pitch with a slight oblique look (height draws upward).
// Reads state only; camera smoothing lives here and never feeds back into the sim.
import {
  type State, type Player, W, H, M, GOAL_HALF, CROSSBAR, BOX_HALF, BOX_DEPTH,
  AREA_HALF, AREA_DEPTH, CIRCLE_R, PEN_SPOT, minute,
} from './sim.ts';
import { type Controls, STICK_R, PAUSE_BTN, MIC_BTN, SHOT_BTN, PASS_BTN } from './input.ts';
import type { MatchInfo } from './store.ts';
import { t, EVENT_TEXT } from './i18n.ts';

export interface View { humans: number[]; me: number; overlay: string; replay: string; voice?: { muted: boolean; state: string }; live?: string }

// Grass stripe colours per pitch surface (see PITCHES).
const GRASS = [['#a7c4c9', '#b7d2d6'], ['#5b6b2f', '#66763a'], ['#256f33', '#2b7a39'], ['#2c8035', '#328a3c'], ['#2a8235', '#2f8f3a'], ['#4f8a2c', '#588f33'], ['#6b8c35', '#76963d']];
const MARK = ['#facc15', '#22d3ee'];
const cam = { x: W / 2, y: H / 2 };

export function render(ctx: CanvasRenderingContext2D, s: State, info: MatchInfo, c: Controls, view: View) {
  const cw = ctx.canvas.width, ch = ctx.canvas.height, dpr = devicePixelRatio || 1;
  // px per unit: portrait shows 44 m of pitch top to bottom; landscape fits ~24 m vertically (and most of the width).
  const k = cw > ch ? ch / (24 * M) : ch / (44 * M);
  const b = s.ball;
  cam.x += (b.x - cam.x) * 0.12;
  cam.y += (b.y - b.z - cam.y) * 0.12;
  const hw = cw / 2 / k, hh = ch / 2 / k, mg = 6 * M;
  cam.x = hw * 2 > W + 2 * mg ? W / 2 : Math.min(Math.max(cam.x, hw - mg), W + mg - hw);
  cam.y = hh * 2 > H + 2 * mg ? H / 2 : Math.min(Math.max(cam.y, hh - mg), H + mg - hh);

  ctx.setTransform(k, 0, 0, k, cw / 2 - cam.x * k, ch / 2 - cam.y * k);
  pitch(ctx, s.pitch);
  boards(ctx, info);
  const things: [number, () => void][] = [[b.y, () => ball(ctx, s)]];
  s.teams.forEach((team, t) => team.forEach((p, i) => { if (!p.off) things.push([p.y, () => player(ctx, s, info, view, p, t, i)]); }));
  things.sort((a, z) => a[0] - z[0]).forEach(([, draw]) => draw());
  goalFrame(ctx, H); // near crossbar is drawn over players

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  hud(ctx, s, info, cw, ch, dpr, view);
  if (c.touch && !view.overlay && !view.replay && !view.live) touchControls(ctx, c, cw, ch, dpr);
}

function pitch(ctx: CanvasRenderingContext2D, surface: number) {
  const ext = 12 * M, [a, b] = GRASS[surface] ?? GRASS[4];
  for (let y = -ext, i = 0; y < H + ext; y += 5 * M, i++) {
    ctx.fillStyle = i % 2 ? b : a;
    ctx.fillRect(-ext, y, W + 2 * ext, 5 * M);
  }
  ctx.strokeStyle = surface === 0 ? 'rgba(80,90,120,0.8)' : 'rgba(255,255,255,0.9)';
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
    const a2 = Math.acos((BOX_DEPTH - PEN_SPOT) / CIRCLE_R);
    if (d > 0) ctx.arc(W / 2, gy + PEN_SPOT, CIRCLE_R, Math.PI / 2 - a2, Math.PI / 2 + a2);
    else ctx.arc(W / 2, gy - PEN_SPOT, CIRCLE_R, -Math.PI / 2 - a2, -Math.PI / 2 + a2);
    ctx.stroke();
  }
  net(ctx, W / 2 - GOAL_HALF, -2 * M - CROSSBAR, GOAL_HALF * 2, 2 * M);
  net(ctx, W / 2 - GOAL_HALF, H - CROSSBAR, GOAL_HALF * 2, 2 * M + CROSSBAR);
  goalFrame(ctx, 0);
}

/** Voice chat button: a microphone (struck through when muted) and a dot for the connection. */
function mic(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, v: { muted: boolean; state: string }) {
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = v.muted ? 'rgba(127,29,29,0.75)' : 'rgba(0,0,0,0.45)'; ctx.fill();
  ctx.fillStyle = '#fff'; ctx.strokeStyle = '#fff'; ctx.lineWidth = r * 0.1; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.roundRect(x - r * 0.18, y - r * 0.55, r * 0.36, r * 0.65, r * 0.18); ctx.fill();
  ctx.beginPath(); ctx.arc(x, y - r * 0.05, r * 0.33, 0, Math.PI); ctx.stroke();
  line(ctx, x, y + r * 0.28, x, y + r * 0.48);
  if (v.muted) { ctx.strokeStyle = '#f87171'; ctx.lineWidth = r * 0.14; line(ctx, x - r * 0.5, y - r * 0.5, x + r * 0.5, y + r * 0.5); }
  ctx.lineCap = 'butt';
  ctx.beginPath(); ctx.arc(x + r * 0.7, y - r * 0.7, r * 0.2, 0, Math.PI * 2);
  ctx.fillStyle = v.state === 'connected' ? '#4ade80' : v.state === 'failed' ? '#f87171' : '#facc15'; ctx.fill();
}

/** Advertising boards beyond both touchlines: the home side's sponsors on the left, the away side's on the right. */
function boards(ctx: CanvasRenderingContext2D, info: MatchInfo) {
  const len = 8 * M, gap = 1.5 * M;
  ctx.font = `800 ${0.55 * M}px system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  [[-2.4 * M, info.sponsors?.[0]], [W + 1.6 * M, info.sponsors?.[1]]].forEach(([x, list], side) => {
    const names = (list as string[] | undefined)?.length ? (list as string[]) : ['KICKABOUT'];
    for (let y = 0, i = 0; y + len <= H; y += len + gap, i++) {
      ctx.fillStyle = '#0f172a'; ctx.fillRect(x as number, y, 0.8 * M, len);
      ctx.save(); ctx.translate((x as number) + 0.4 * M, y + len / 2); ctx.rotate(side ? Math.PI / 2 : -Math.PI / 2);
      ctx.fillStyle = i % 2 ? '#facc15' : '#f8fafc'; ctx.fillText(names[i % names.length].toUpperCase(), 0, 0, len - M);
      ctx.restore();
    }
  });
  ctx.textAlign = 'start'; ctx.textBaseline = 'alphabetic';
}

/** Goal net behind the frame: a light veil with a thin square mesh. */
function net(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  const step = 0.4 * M;
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  ctx.lineWidth = 0.03 * M;
  ctx.beginPath();
  for (let i = x; i <= x + w + 1; i += step) { ctx.moveTo(i, y); ctx.lineTo(i, y + h); }
  for (let j = y; j <= y + h + 1; j += step) { ctx.moveTo(x, j); ctx.lineTo(x + w, j); }
  ctx.stroke();
  ctx.lineWidth = 0.06 * M;
  ctx.strokeRect(x, y, w, h);
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

function player(ctx: CanvasRenderingContext2D, s: State, info: MatchInfo, view: View, p: Player, t: number, i: number) {
  const kit = info.kits[t], shirt = i === 0 ? info.keepers[t] : kit.shirt;
  ellipse(ctx, p.x + 0.15 * M, p.y, 0.5 * M, 0.22 * M, 'rgba(0,0,0,0.3)');
  if (p.slide || p.down) {
    lying(ctx, p, shirt, kit.shorts, !!p.slide || !p.fell);
    return;
  }
  // Running: legs swing gently along the facing direction, the body bobs a little.
  const speed = Math.min(1, Math.hypot(p.ax, p.ay) / 110);
  const phase = s.frame * 0.3 + i * 1.3 + t * 0.7, swing = Math.sin(phase) * speed;
  const fx = p.fx / 1000, fy = p.fy / 1000, bob = Math.abs(Math.sin(phase)) * speed * 0.06 * M;
  ctx.strokeStyle = '#1f2937'; ctx.lineWidth = 0.16 * M; ctx.lineCap = 'round';
  for (const [side, dir] of [[-0.12, 1], [0.12, -1]]) {
    const reach = swing * dir * 0.24 * M, lift = Math.max(0, swing * dir) * 0.1 * M;
    line(ctx, p.x + side * M, p.y - 0.78 * M - bob, p.x + side * M + fx * reach, p.y - 0.06 * M + fy * reach * 0.5 - lift);
  }
  ctx.lineCap = 'butt';
  ctx.fillStyle = kit.shorts;
  ctx.fillRect(p.x - 0.28 * M, p.y - 1.05 * M - bob, 0.56 * M, 0.32 * M);
  ellipse(ctx, p.x, p.y - 1.35 * M - bob, 0.42 * M, 0.45 * M, shirt);
  shirtNumber(ctx, p.n + 1, p.x, p.y - 1.32 * M - bob, shirt);
  if (p.yel) { ctx.fillStyle = '#facc15'; ctx.fillRect(p.x + 0.2 * M, p.y - 1.6 * M - bob, 0.14 * M, 0.2 * M); }
  const hx = p.x + fx * 0.08 * M, hy = p.y - 2.0 * M + fy * 0.05 * M - bob;
  ellipse(ctx, hx, hy, 0.25 * M, 0.26 * M, '#e8b98a');
  ellipse(ctx, hx - (p.fx / 1000) * 0.08 * M, hy - (p.fy / 1000) * 0.08 * M - 0.08 * M, 0.21 * M, 0.17 * M, '#3b2416');
  const human = view.humans[t];
  if (human && i === s.controlled[t]) {
    ctx.beginPath();
    ctx.moveTo(p.x, p.y - 2.45 * M);
    ctx.lineTo(p.x - 0.3 * M, p.y - 2.95 * M);
    ctx.lineTo(p.x + 0.3 * M, p.y - 2.95 * M);
    ctx.closePath();
    ctx.fillStyle = MARK[human - 1]; ctx.fill();
    ctx.lineWidth = 0.06 * M; ctx.strokeStyle = '#000'; ctx.stroke();
  }
}

/** Squad number on the shirt, dark or light depending on the shirt colour. */
function shirtNumber(ctx: CanvasRenderingContext2D, n: number, x: number, y: number, shirt: string) {
  const c = parseInt(shirt.slice(1), 16), light = ((c >> 16) * 299 + ((c >> 8) & 255) * 587 + (c & 255) * 114) / 1000 > 150;
  ctx.font = `800 ${0.5 * M}px system-ui, sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = light ? '#111827' : '#fff';
  ctx.fillText(String(n), x, y);
  ctx.textAlign = 'start'; ctx.textBaseline = 'alphabetic';
}

/**
 * A player on the ground, drawn in the facing direction: a slide tackle goes feet
 * first (legs towards the ball, head behind) until they are back up; a fouled player lies head first.
 */
function lying(ctx: CanvasRenderingContext2D, p: Player, shirt: string, shorts: string, feetFirst: boolean) {
  ctx.save();
  ctx.translate(p.x, p.y - 0.3 * M);
  ctx.rotate(Math.atan2(p.fy, p.fx) + (feetFirst ? 0 : Math.PI));
  ctx.strokeStyle = '#1f2937'; ctx.lineWidth = 0.16 * M; ctx.lineCap = 'round';
  line(ctx, 0, -0.12 * M, 0.85 * M, -0.16 * M); // legs stretched out in front
  line(ctx, 0, 0.12 * M, 0.7 * M, 0.2 * M);
  ctx.lineCap = 'butt';
  ctx.fillStyle = shorts;
  ctx.fillRect(-0.2 * M, -0.26 * M, 0.34 * M, 0.52 * M);
  ellipse(ctx, -0.5 * M, 0, 0.42 * M, 0.34 * M, shirt);
  ellipse(ctx, -1.02 * M, 0, 0.25 * M, 0.25 * M, '#e8b98a');
  ellipse(ctx, -1.1 * M, 0, 0.17 * M, 0.21 * M, '#3b2416');
  ctx.restore();
}

/** A classic black-and-white ball (centre pentagon, five patches at the rim) that turns as it rolls. */
function ball(ctx: CanvasRenderingContext2D, s: State) {
  const b = s.ball, r = 0.28 * M * (1 + b.z / (8 * M)), x = b.x, y = b.y - b.z - 0.22 * M;
  ellipse(ctx, b.x + b.z * 0.3, b.y, 0.26 * M, 0.13 * M, 'rgba(0,0,0,0.35)');
  ctx.save();
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = '#fff'; ctx.fill();
  ctx.clip();
  ctx.translate(x, y);
  ctx.rotate((b.x + b.y) / (2 * r)); // rolling distance → turn
  ctx.fillStyle = '#111'; ctx.strokeStyle = '#4b5563'; ctx.lineWidth = 0.025 * M;
  pentagon(ctx, 0, 0, r * 0.36, 0);
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
    line(ctx, Math.cos(a) * r * 0.36, Math.sin(a) * r * 0.36, Math.cos(a) * r * 0.75, Math.sin(a) * r * 0.75); // seams
    pentagon(ctx, Math.cos(a) * r * 1.02, Math.sin(a) * r * 1.02, r * 0.3, a + Math.PI);
  }
  ctx.restore();
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.lineWidth = 0.05 * M; ctx.strokeStyle = '#111'; ctx.stroke();
}

function pentagon(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, turn: number) {
  ctx.beginPath();
  for (let i = 0; i < 5; i++) {
    const a = turn - Math.PI / 2 + (i * 2 * Math.PI) / 5;
    ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
  }
  ctx.closePath(); ctx.fill();
}

function text(ctx: CanvasRenderingContext2D, str: string, x: number, y: number, size: number, color = '#fff') {
  ctx.font = `800 ${size}px system-ui, sans-serif`;
  ctx.lineJoin = 'round'; ctx.lineWidth = size / 6; ctx.strokeStyle = 'rgba(0,0,0,0.75)'; ctx.strokeText(str, x, y);
  ctx.fillStyle = color; ctx.fillText(str, x, y);
}

function hud(ctx: CanvasRenderingContext2D, s: State, info: MatchInfo, cw: number, ch: number, dpr: number, view: View) {
  const u = Math.min(cw, ch) / 20;
  ctx.textBaseline = 'middle';
  const clock = s.period === 4 && s.so ? `${t('k.')} ${s.so.goals[0]}:${s.so.goals[1]}` : `${minute(s)}'`;
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(u * 0.4, u * 0.4, u * 8.4, u * 1.3);
  ctx.textAlign = 'left';
  text(ctx, info.shorts[0], u * 0.7, u * 1.05, u * 0.75, info.kits[0].shirt);
  text(ctx, `${s.score[0]}:${s.score[1]}`, u * 2.6, u * 1.05, u * 0.75);
  text(ctx, info.shorts[1], u * 4.1, u * 1.05, u * 0.75, info.kits[1].shirt);
  text(ctx, clock, u * 6.1, u * 1.05, u * 0.65);

  // Pause button (top right); spectators cannot pause
  const px = cw + PAUSE_BTN.x * dpr, py = PAUSE_BTN.y * dpr, pr = PAUSE_BTN.r * dpr;
  if (!view.live) {
    ctx.beginPath(); ctx.arc(px, py, pr, 0, Math.PI * 2); ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.fillRect(px - pr * 0.35, py - pr * 0.4, pr * 0.22, pr * 0.8);
    ctx.fillRect(px + pr * 0.13, py - pr * 0.4, pr * 0.22, pr * 0.8);
  }
  if (view.voice) mic(ctx, cw + MIC_BTN.x * dpr, MIC_BTN.y * dpr, MIC_BTN.r * dpr, view.voice);

  ctx.textAlign = 'center';
  if (view.replay) {
    text(ctx, t('POWTÓRKA'), cw / 2, ch * 0.12, u, '#f87171');
    text(ctx, view.replay, cw / 2, ch * 0.17, u * 0.55);
    text(ctx, t('dotknij, aby pominąć'), cw / 2, ch * 0.92, u * 0.5);
    return;
  }
  if (view.overlay) {
    ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(0, 0, cw, ch);
    text(ctx, view.overlay, cw / 2, ch * 0.45, u);
    text(ctx, t('Dotknij, aby wrócić do menu'), cw / 2, ch * 0.55, u * 0.6);
    return;
  }
  if (view.live) { // fan zone: a red LIVE badge instead of "you play"
    ctx.textAlign = 'center';
    text(ctx, `● ${view.live}`, cw / 2, ch - u * 0.9, u * 0.55, '#f87171');
  } else if (s.frame < 300 && s.period === 0) {
    const name = info.names[view.me];
    text(ctx, s.sides[view.me] === -1 ? t('Grasz: {0} (atak w górę)', name) : t('Grasz: {0} (atak w dół)', name), cw / 2, ch * 0.2, u * 0.6);
    // Club sponsors are announced before kick-off.
    (info.sponsors ?? []).forEach((list, i) => list.length && text(ctx, t('Sponsorzy {0}: {1}', info.shorts[i], list.join(', ')), cw / 2, ch * (0.25 + 0.04 * i), u * 0.45, '#facc15'));
  }
  const age = s.frame - s.eventFrame;
  if (s.event && age < 110 && s.phase !== 'end') {
    const big = s.event === 'goal';
    text(ctx, t(EVENT_TEXT[s.event]), cw / 2, ch * 0.3, big ? u * 2 : u, big ? '#facc15' : s.event === 'red' ? '#f87171' : '#fff');
  }
  if (s.phase === 'half') stats(ctx, s, info, cw, ch, u);
  const me = view.me, hold = s.hold[me];
  if (hold > 0 && s.ownerTeam === me && s.ownerIdx === s.controlled[me]) {
    const bw = u * 6, f = Math.min(hold, 40) / 40, shot = hold >= 9 || !!s.pk;
    ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(cw / 2 - bw / 2, ch - u * 1.6, bw, u * 0.5);
    ctx.fillStyle = shot ? '#ef4444' : '#22c55e'; ctx.fillRect(cw / 2 - bw / 2, ch - u * 1.6, bw * f, u * 0.5);
    text(ctx, shot ? t('strzał') : t('podanie'), cw / 2, ch - u * 2.1, u * 0.55);
  }
}

/** Half-time panel drawn over the pitch. */
function stats(ctx: CanvasRenderingContext2D, s: State, info: MatchInfo, cw: number, ch: number, u: number) {
  const rows = statRows(s);
  const top = ch * 0.38, rh = u * 0.75, w = Math.min(cw * 0.9, u * 16);
  ctx.fillStyle = 'rgba(0,0,0,0.65)';
  ctx.fillRect(cw / 2 - w / 2, top - rh, w, rh * (rows.length + 2));
  text(ctx, `${info.shorts[0]}   ${s.score[0]} : ${s.score[1]}   ${info.shorts[1]}`, cw / 2, top, u * 0.7);
  rows.forEach(([label, a, b], i) => {
    const y = top + rh * (i + 1.2);
    ctx.textAlign = 'center'; text(ctx, label, cw / 2, y, u * 0.5);
    ctx.textAlign = 'left'; text(ctx, String(a), cw / 2 - w / 2 + u * 0.6, y, u * 0.55);
    ctx.textAlign = 'right'; text(ctx, String(b), cw / 2 + w / 2 - u * 0.6, y, u * 0.55);
  });
  ctx.textAlign = 'center';
}

export function statRows(s: State): [string, string | number, string | number][] {
  const st = s.stats, total = st.poss[0] + st.poss[1] || 1;
  return [
    [t('Posiadanie'), `${Math.round((st.poss[0] * 100) / total)}%`, `${Math.round((st.poss[1] * 100) / total)}%`],
    [t('Strzały'), st.shots[0], st.shots[1]],
    [t('Celne'), st.onTarget[0], st.onTarget[1]],
    [t('Rożne'), st.corners[0], st.corners[1]],
    [t('Faule'), st.fouls[0], st.fouls[1]],
    [t('Kartki ż./cz.'), `${st.yellow[0]}/${st.red[0]}`, `${st.yellow[1]}/${st.red[1]}`],
  ];
}

function touchControls(ctx: CanvasRenderingContext2D, c: Controls, cw: number, ch: number, dpr: number) {
  const s = c.stick;
  if (s) {
    ctx.beginPath(); ctx.arc(s.ox * dpr, s.oy * dpr, STICK_R * dpr, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.15)'; ctx.fill();
    ctx.beginPath(); ctx.arc(s.x * dpr, s.y * dpr, 26 * dpr, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.45)'; ctx.fill();
  }
  ctx.textAlign = 'center';
  for (const [b, on, label, size] of [[SHOT_BTN, c.shots.size, t('STRZAŁ'), 18], [PASS_BTN, c.passes.size, t('PODANIE'), 14]] as const) {
    const x = cw + b.x * dpr, y = ch + b.y * dpr;
    ctx.beginPath(); ctx.arc(x, y, b.r * dpr, 0, Math.PI * 2);
    ctx.fillStyle = on ? 'rgba(250,204,21,0.6)' : 'rgba(255,255,255,0.2)'; ctx.fill();
    text(ctx, label, x, y, size * dpr);
  }
}
