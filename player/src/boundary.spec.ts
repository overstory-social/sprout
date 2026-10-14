import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as lang from '@overstory/sprout/lang';
import { describe, expect, it } from 'vitest';

// The player imports the language, core and the WebAssembly engine, and
// node:* — nothing of any host or client. It runs every turn, poll and
// question through an engine (core's `Engine`), so it never imports the
// language's turns, polls or state.

const SRC = dirname(fileURLToPath(import.meta.url));
const ALLOWED = [
  '@overstory/sprout/lang',
  '@overstory/sprout/core',
  '@overstory/sprout-engine-wasm',
];
const ALLOWED_IN_SPECS = ['vitest'];

/** The language's turns, polls and state, which only an engine runs. */
const NEVER = [
  'commandTurn',
  'runLine',
  'commandsOfLine',
  'tickTurn',
  'wakeTurn',
  'maintenanceTurn',
  'arrivalTurn',
  'departureTurn',
  'writeTurn',
  'dueWakes',
  'occupiedPlaces',
  'nicknameRefusal',
  'pollView',
  'pollScene',
  'pollReadings',
  'pollTurn',
  'initialState',
  'loadWorld',
  'readerOf',
  'Draft',
  'newInstance',
  'isPlace',
  'standsInPlace',
  'renderActed',
];

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? sources(join(dir, entry.name))
      : entry.name.endsWith('.ts')
        ? [join(dir, entry.name)]
        : [],
  );
}

/** The values `text` imports by name from `from`. */
function valuesFrom(text: string, from: string): string[] {
  return [...text.matchAll(/import\s*\{([^}]*)\}\s*from\s*'([^']+)'/g)]
    .filter((m) => m[2] === from)
    .flatMap((m) => m[1]!.split(','))
    .map((name) => name.trim())
    .filter((name) => name !== '' && !name.startsWith('type '))
    .map((name) => name.split(/\s+as\s+/)[0]!);
}

describe('@overstory/sprout-player imports the language, core, the WebAssembly engine and node:* only', () => {
  const files = sources(SRC);
  it('has files to check', () => expect(files.length).toBeGreaterThan(5));
  for (const file of files) {
    it(relative(SRC, file), () => {
      const text = readFileSync(file, 'utf8');
      const specifiers = [...text.matchAll(/(?:from|import)\s+'([^']+)'/g)].map((m) => m[1]!);
      const allowed = file.endsWith('.spec.ts') ? [...ALLOWED, ...ALLOWED_IN_SPECS] : ALLOWED;
      const foreign = specifiers.filter(
        (s) =>
          !s.startsWith('./') &&
          !s.startsWith('../') &&
          !s.startsWith('node:') &&
          !allowed.includes(s),
      );
      expect(foreign).toEqual([]);
    });
  }
});

describe('@overstory/sprout-player runs the world only through an engine', () => {
  it('names only what the language and core export', () => {
    expect(NEVER.filter((name) => !(name in lang))).toEqual([]);
  });
  for (const file of sources(SRC).filter((one) => !one.endsWith('.spec.ts'))) {
    it(relative(SRC, file), () => {
      const text = readFileSync(file, 'utf8');
      const named = [
        ...valuesFrom(text, '@overstory/sprout/lang'),
        ...valuesFrom(text, '@overstory/sprout/core'),
      ];
      // Every value is imported by name, so the names above are all it imports of either.
      const whole = [
        ...text.matchAll(
          /(?:import\s*\*|export\s*(?:\*|\{[^}]*\}))[^;']*'(@overstory\/sprout\/(?:lang|core))'/g,
        ),
      ].map((m) => m[0]);
      expect(whole).toEqual([]);
      expect(named.filter((name) => NEVER.includes(name))).toEqual([]);
    });
  }
});
