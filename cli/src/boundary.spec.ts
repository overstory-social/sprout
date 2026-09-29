import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

// The CLI imports the Sprout packages and node:*, and nothing of any host
// at its start: the terminal client, the server and the MCP host it loads
// only when the command that needs one runs, and only where it is
// installed, as optional peers, so a CLI install need not carry Ink, `ws`
// or the MCP SDK.

const SRC = dirname(fileURLToPath(import.meta.url));
const ALLOWED = ['@overstory/sprout/lang', '@overstory/sprout-player', '@overstory/sprout-repl'];
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
