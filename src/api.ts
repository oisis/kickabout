// The game's calls to the Kickabout API (online club, coins, verified matches). The browser
// game uses the website's session cookie; the app signs in once with a code from the
// website's account page and keeps the token.
import { apiBase, inApp } from './net.ts';

const KEY = 'kickabout.token';
export const token = (): string => { try { return localStorage.getItem(KEY) ?? ''; } catch { return ''; } };
export const setToken = (v: string) => { try { if (v) localStorage.setItem(KEY, v); else localStorage.removeItem(KEY); } catch { /* storage blocked */ } };

export interface Reply<T = any> { status: number; data: T }

/** JSON request; status 0 means the server could not be reached. */
export async function api<T = any>(path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST'): Promise<Reply<T>> {
  try {
    const t = token();
    const r = await fetch(`${apiBase()}${path}`, {
      method, body: body === undefined ? undefined : JSON.stringify(body),
      headers: { 'content-type': 'application/json', ...(t ? { authorization: `Bearer ${t}` } : {}) },
      credentials: inApp() ? 'omit' : 'include',
    });
    if (r.status === 401 && t) setToken(''); // revoked on the website
    return { status: r.status, data: await r.json().catch(() => ({})) };
  } catch {
    return { status: 0, data: {} as T };
  }
}

/** Run-length pairs [word, frames] of recorded input words (what the server replays). */
export function rle(words: number[]): [number, number][] {
  const out: [number, number][] = [];
  for (const w of words) { const last = out[out.length - 1]; if (last && last[0] === w) last[1]++; else out.push([w, 1]); }
  return out;
}
