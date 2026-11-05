import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DICT } from '../src/lang.ts';
import { EVENT_TEXT } from '../src/i18n.ts';
import { PITCHES } from '../src/sim.ts';
import { POS } from '../src/data.ts';

const SRC = join(import.meta.dirname, '..', 'src');
const LANGS = ['en', 'fr', 'de', 'it', 'es', 'nl'];

/** Every Polish UI key: literal t()/tr() arguments plus the tables translated at display time. */
export function uiKeys(): string[] {
  const keys = new Set<string>([...Object.values(EVENT_TEXT), ...PITCHES.map((p) => p.name), ...POS]);
  for (const f of readdirSync(SRC).filter((x) => x.endsWith('.ts') && x !== 'lang.ts')) {
    const src = readFileSync(join(SRC, f), 'utf8');
    for (const m of src.matchAll(/\btr?\(\s*'((?:[^'\\]|\\.)*)'/g)) keys.add(m[1].replace(/\\'/g, "'"));
    // Tables of Polish texts translated later: { code: 'Tekst', ... } maps and [code, 'Nazwa', ...] rows.
    for (const block of src.matchAll(/const (?:LEDGER|BYE)[^=]*=\s*\{([^\n]*)\};/g)) for (const m of block[1].matchAll(/:\s*'((?:[^'\\]|\\.)*)'/g)) keys.add(m[1]);
    for (const m of src.matchAll(/\['[a-z]{2}', '([A-ZĄĆĘŁŃÓŚŹŻ][^']+)', '(?:[A-Z]{3}|[a-z]{2})'/g)) keys.add(m[1]);
  }
  return [...keys].sort();
}

const placeholders = (s: string) => [...s.matchAll(/\{\d\}/g)].map((m) => m[0]).sort().join();

test('every UI text has a translation in all six languages with the same placeholders', () => {
  const keys = uiKeys();
  assert.ok(keys.length > 250, `found only ${keys.length} keys`);
  const problems: string[] = [];
  for (const l of LANGS) {
    for (const k of keys) {
      const v = DICT[l]?.[k];
      if (!v) problems.push(`${l}: missing "${k}"`);
      else if (placeholders(v) !== placeholders(k)) problems.push(`${l}: placeholders differ in "${k}" → "${v}"`);
    }
  }
  assert.deepEqual(problems.slice(0, 20), [], `${problems.length} problems`);
});
