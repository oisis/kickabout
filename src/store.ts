// Persistence in localStorage (options, highlights, competitions, careers, edits).
// Every access tolerates missing or blocked storage: the game must still run.
import type { State } from './sim.ts';
import type { Kit, TeamDef } from './data.ts';
import { lang } from './i18n.ts';

export interface Options {
  minutes: number;
  extraTime: boolean;
  penalties: boolean;
  pitch: number; // 0..6, 7 = random, 8 = seasonal
  autoReplay: boolean;
  autoSaveHighlights: boolean;
  sound: boolean;
  music: boolean;
}
/** Real minutes for a whole match (90 game minutes). */
export const MATCH_MINUTES = [5, 10, 15, 20];
/** A valid match length; older saves used 3/5/7/10 and round up. */
export const matchMinutes = (m: unknown): number => MATCH_MINUTES.find((x) => x >= (Number(m) || 0)) ?? MATCH_MINUTES[MATCH_MINUTES.length - 1];
export const minuteOptions = (): [number, string][] => MATCH_MINUTES.map((m) => [m, `${m} min`]);

export const DEFAULT_OPTIONS: Options = { minutes: 5, extraTime: false, penalties: false, pitch: 4, autoReplay: true, autoSaveHighlights: true, sound: true, music: true };

/** What a renderer needs to show a match: names and kits (kept beside, not inside, the sim state). */
export interface MatchInfo { names: string[]; shorts: string[]; kits: Kit[]; keepers: string[]; players: string[][] }
export interface Highlight { info: MatchInfo; title: string; start: State; inputs: number[][] }

function load<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(`kickabout.${key}`);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}

function save(key: string, v: unknown): boolean {
  try {
    localStorage.setItem(`kickabout.${key}`, JSON.stringify(v));
    return true;
  } catch {
    return false;
  }
}

export const options = (): Options => { const o = { ...DEFAULT_OPTIONS, ...load<Partial<Options>>('options', {}) }; return { ...o, minutes: matchMinutes(o.minutes) }; };
export const saveOptions = (o: Options) => save('options', o);

const MAX_HIGHLIGHTS = 30;
export const highlights = () => load<Highlight[]>('highlights', []);
export function addHighlights(h: Highlight[]) {
  const all = [...h, ...highlights()].slice(0, MAX_HIGHLIGHTS);
  // Storage quota is small on some phones: drop the oldest until it fits.
  while (all.length && !save('highlights', all)) all.pop();
}
export const deleteHighlight = (i: number) => save('highlights', highlights().filter((_, j) => j !== i));

/** Named save slots for competitions and careers. */
export function slots<T>(kind: string): { name: string; date: string; data: T }[] {
  return load(kind, []);
}
export function saveSlot<T>(kind: string, name: string, data: T): boolean {
  const list = slots<T>(kind).filter((x) => x.name !== name);
  return save(kind, [{ name, date: new Date().toLocaleString(lang()), data }, ...list]);
}
export const deleteSlot = (kind: string, name: string) => save(kind, slots(kind).filter((x) => x.name !== name));

export const customTeams = () => load<TeamDef[]>('teams', []);
export const saveCustomTeams = (t: TeamDef[]) => save('teams', t);
export const customTactics = () => load<{ name: string; pos: number[][] }[]>('tactics', []);
export const saveCustomTactics = (t: { name: string; pos: number[][] }[]) => save('tactics', t);

/** Download a JSON file (export of saves / highlights). */
export function download(name: string, data: unknown) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** Ask the user for a JSON file and parse it. */
export function upload(): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const i = document.createElement('input');
    i.type = 'file';
    i.accept = 'application/json,.json';
    i.onchange = async () => {
      try { resolve(JSON.parse(await i.files![0].text())); } catch (e) { reject(e); }
    };
    i.click();
  });
}
