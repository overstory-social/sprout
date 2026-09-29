import { scaffoldKind, scaffoldObject } from './declarations.js';
import type { Scaffolded } from './edits.js';
import { scaffoldTest } from './test.js';
import { scaffoldWorld } from './world.js';

// `sprout scaffold <what> …`: a world, a kind, an object or a test written
// into a world folder (the first cut of what can be scaffolded). Every
// scaffold but a world is checked once written, and undone where the
// world would not compile.

export const SCAFFOLD_USAGE = `  sprout scaffold world [dir] [--author name]
                                      a folder with sprout.json, a world, a first test and a README line
  sprout scaffold kind Name [dir] [--is Kind,…] [--path file]
                                      a kind, in its own file or appended to --path, with the imports it needs
  sprout scaffold object name [dir] --in place --is Kind,… [--path file]
                                      an object placed in what --in names, in its own file or appended to --path
  sprout scaffold test name [dir]     tests/name.json, a test that arrives and expects what the visitor reads
`;

/** What `sprout scaffold` with `positional` and `flags` did. */
export function scaffold(
  positional: readonly string[],
  flags: Readonly<Record<string, string | true>>,
): Scaffolded {
  const [what, name, dir = '.'] = positional;
  const text = (flag: string): string | undefined =>
    typeof flags[flag] === 'string' ? (flags[flag] as string) : undefined;
  switch (what) {
    case 'world': {
      const folder = name ?? '.';
      const written = scaffoldWorld(folder, text('author'));
      return {
        ok: true,
        page: written
          .map((file) => `wrote ${folder === '.' ? file : `${folder}/${file}`}\n`)
          .join(''),
      };
    }
    case 'kind':
    case 'object':
    case 'test':
      if (name === undefined)
        return {
          ok: false,
          page: `Name the ${what} after it: sprout scaffold ${what} ${what === 'kind' ? 'Key' : what === 'object' ? 'brass_key --in hall --is Key' : 'opening'}\n`,
        };
      if (what === 'kind') return scaffoldKind(name, dir, text('path'), text('is'));
      if (what === 'object') return scaffoldObject(name, dir, text('in'), text('is'), text('path'));
      return scaffoldTest(name, dir);
    default:
      return {
        ok: false,
        page: `\`sprout scaffold\` makes a world, a kind, an object or a test:\n${SCAFFOLD_USAGE}`,
      };
  }
}
