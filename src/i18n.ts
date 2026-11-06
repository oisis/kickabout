// UI translations. Keys are the Polish texts (with {0}, {1} placeholders), so Polish
// needs no dictionary and a missing translation falls back to readable Polish.
// The language is fixed for the page's lifetime; changing it reloads the page.
import { DICT } from './lang.ts';
import type { EventCode } from './sim.ts';

export type Lang = 'pl' | 'en' | 'fr' | 'de' | 'it' | 'es' | 'nl';
export const LANGS: [Lang, string][] = [['pl', 'Polski'], ['en', 'English'], ['fr', 'Français'], ['de', 'Deutsch'], ['it', 'Italiano'], ['es', 'Español'], ['nl', 'Nederlands']];

function detect(): Lang {
  try {
    // The game was called Kopanka: carry saves over to the new key prefix once.
    for (const k of Object.keys(localStorage)) if (k.startsWith('kopanka.') && localStorage.getItem(`kickabout.${k.slice(8)}`) === null) localStorage.setItem(`kickabout.${k.slice(8)}`, localStorage.getItem(k)!);
    const saved = localStorage.getItem('kickabout.lang') as Lang | null;
    if (saved && LANGS.some(([l]) => l === saved)) return saved;
  } catch { /* storage unavailable */ }
  const nav = (globalThis.navigator?.language ?? 'pl').slice(0, 2) as Lang;
  return LANGS.some(([l]) => l === nav) ? nav : 'en';
}

const current: Lang = typeof document === 'undefined' ? 'pl' : detect(); // tests and the server run in Polish
export const lang = () => current;

export function t(key: string, ...args: (string | number)[]): string {
  const s = current === 'pl' ? key : DICT[current]?.[key] ?? key;
  return args.length ? s.replace(/\{(\d)\}/g, (_, i: string) => String(args[+i] ?? '')) : s;
}

export function setLang(l: Lang) {
  try { localStorage.setItem('kickabout.lang', l); } catch { /* storage unavailable */ }
  location.reload();
}

/** Match events from the simulation, shown on the pitch. */
export const EVENT_TEXT: Record<EventCode, string> = {
  goal: 'GOL!', miss: 'Pudło!', save: 'Obrona!', parry: 'Parada!', foul: 'Faul', free: 'Rzut wolny', penalty: 'Rzut karny!',
  yellow: 'Żółta kartka', red: 'Czerwona kartka!', throw: 'Aut', corner: 'Rzut rożny', goalkick: 'Od bramki',
  half: 'Przerwa', et: 'Dogrywka', shootout: 'Rzuty karne', end: 'Koniec meczu', sub: 'Zmiana',
};
