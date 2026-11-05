// DOM menus layered over the match canvas. Plain elements, no framework.
import { t } from './i18n.ts';
export type Child = Node | string | number | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, unknown> = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k in el && k !== 'list') (el as unknown as Record<string, unknown>)[k] = v;
    else el.setAttribute(k, String(v));
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
}

const root = () => document.getElementById('ui')!;

/** Replace the current menu screen (or hide menus with no arguments). */
export function show(...children: Child[]) {
  const r = root();
  r.replaceChildren(...children.filter((c): c is Node | string => !!c || c === 0).map((c) => (c instanceof Node ? c : String(c))));
  r.hidden = children.length === 0;
  r.scrollTop = 0;
}

export const title = (text: string, sub?: string) => h('header', {}, h('h1', {}, text), sub && h('p', { className: 'sub' }, sub));
export const btn = (label: Child, onclick: () => void, cls = '') => h('button', { className: cls, onclick }, label);
export const row = (...c: Child[]) => h('div', { className: 'row' }, ...c);
export const back = (onclick: () => void) => btn(t('← Wstecz'), onclick, 'ghost');

/** Options may carry a third element: a group label, rendered as <optgroup>. */
export function select<T extends string | number>(label: string, value: T, opts: ([T, string] | [T, string, string])[], onchange: (v: T) => void) {
  const s = h('select', { onchange: () => onchange(opts[s.selectedIndex][0]) });
  let group = null as HTMLOptGroupElement | null;
  for (const [v, l, g] of opts) {
    const o = h('option', { selected: v === value }, l);
    if (g && group?.label !== g) s.append((group = h('optgroup', { label: g })));
    (g && group ? group : s).append(o);
  }
  return h('label', { className: 'field' }, h('span', {}, label), s);
}

export function toggle(label: string, value: boolean, onchange: (v: boolean) => void) {
  const c = h('input', { type: 'checkbox', checked: value, onchange: () => onchange(c.checked) });
  return h('label', { className: 'field check' }, c, h('span', {}, label));
}

export function input(label: string, value: string, onchange: (v: string) => void, attrs: Record<string, unknown> = {}) {
  const i = h('input', { value, oninput: () => onchange(i.value), ...attrs });
  return h('label', { className: 'field' }, h('span', {}, label), i);
}

export function table(head: Child[], rows: Child[][], onRow?: (i: number) => void, highlight?: (i: number) => boolean) {
  return h('table', {},
    h('thead', {}, h('tr', {}, ...head.map((c) => h('th', {}, c)))),
    h('tbody', {}, ...rows.map((r, i) => h('tr', { className: `${onRow ? 'click' : ''} ${highlight?.(i) ? 'hl' : ''}`, onclick: onRow ? () => onRow(i) : undefined }, ...r.map((c) => h('td', {}, c))))));
}

export function toast(text: string) {
  const t = h('div', { className: 'toast' }, text);
  document.body.append(t);
  setTimeout(() => t.remove(), 2200);
}

export function confirmBox(text: string): boolean {
  return confirm(text);
}
