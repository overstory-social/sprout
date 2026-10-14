import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as core from '@overstory/sprout/core';
import * as lang from '@overstory/sprout/lang';
import { describe, expect, it } from 'vitest';

// The CLI imports the Sprout packages and node:*, and nothing of any host
// at its start: the terminal client, the server and the MCP host it loads
// only when the command that needs one runs, and only where it is
// installed, as optional peers, so a CLI install need not carry Ink, `ws`
// or the MCP SDK. It plays and views a world through the player, on an
// engine, so it never imports the language's turns, polls, parser or state.

const SRC = dirname(fileURLToPath(import.meta.url));
const ALLOWED = [
  '@overstory/sprout/lang',
  '@overstory/sprout/core',
  '@overstory/sprout-player',
  '@overstory/sprout-repl',
];

/** The language's turns, polls, parser and state, which only an engine runs. */
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
  'initialState',
  'loadWorld',
  'readerOf',
  'Draft',
  'newInstance',
  'tsEngine',
  'loaded',
  'pollTurn',
  'parseCommand',
  'consentPass',
  'planIntent',
];

/** The values `text` imports by name from `from`. */
function valuesFrom(text: string, from: string): string[] {
  return [...text.matchAll(/import\s*\{([^}]*)\}\s*from\s*'([^']+)'/g)]
    .filter((m) => m[2] === from)
    .flatMap((m) => m[1]!.split(','))
    .map((name) => name.trim())
    .filter((name) => name !== '' && !name.startsWith('type '))
    .map((name) => name.split(/\s+as\s+/)[0]!);
}
/** The packages the CLI may load only by `import()`, where they are installed. */
const OPTIONAL_PEERS = [
  '@overstory/sprout-tui',
  '@overstory/sprout-server',
  '@overstory/sprout-mcp',
];
const ALLOWED_IN_SPECS = [
  'vitest',
  '@overstory/sprout-server',
  '@overstory/sprout-player/fixtures',
  '@overstory/sprout-repl/fixtures',
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

describe('@overstory/sprout-cli imports the Sprout packages and node:* only', () => {
  const files = sources(SRC);
  it('has files to check', () => expect(files.length).toBeGreaterThan(5));
  for (const file of files) {
    it(relative(SRC, file), () => {
      const text = readFileSync(file, 'utf8');
      const specifiers = [...text.matchAll(/(?:from|import)\s+'([^']+)'/g)].map((m) => m[1]!);
      const loaded = [...text.matchAll(/import\(\s*'([^']+)'\s*\)/g)].map((m) => m[1]!);
      const allowed = file.endsWith('.spec.ts') ? [...ALLOWED, ...ALLOWED_IN_SPECS] : ALLOWED;
      // An optional peer is loaded when its command runs, never imported at the start.
      expect(loaded.filter((s) => !OPTIONAL_PEERS.includes(s) && !allowed.includes(s))).toEqual([]);
      expect(
        specifiers.filter((s) => OPTIONAL_PEERS.includes(s) && !file.endsWith('.spec.ts')),
      ).toEqual([]);
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

describe('@overstory/sprout-cli runs a world only through an engine', () => {
  it('names only what the language and core export', () => {
    expect(NEVER.filter((name) => !(name in lang) && !(name in core))).toEqual([]);
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
