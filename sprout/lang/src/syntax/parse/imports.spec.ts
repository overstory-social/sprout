import { describe, expect, it } from 'vitest';

import type { ImportDeclaration } from '../ast-imports.js';
import { locationOf } from '../../source/source.js';
import { read } from '../../fixtures/parse.js';

/** A single quote, as an import's specifier is written between them. */
const Q = "'";

const said = (text: string) =>
  read(text, 'shop.sprout').refusals.map((d) => [locationOf(d.at), d.message]);

const EXAMPLE = `Write \`import {Key} from ${Q}blacksmith/key${Q}\`, or \`import * as sprout from ${Q}sprout${Q}\` for all of a library.`;

describe('`import` lines, at the top of a file', () => {
  it('reads names, `as`, messages and a namespace, beside `extension` lines and before the declarations', () => {
    const { declarations, refusals } = read(
      `import {Key} from ${Q}key${Q}\nextension media 2\nimport * as sprout from "sprout"\nkind Crate { }\n`,
      'shop.sprout',
    );
    expect(refusals).toEqual([]);
    expect(declarations.map((d) => d.kind)).toEqual(['import', 'extension-use', 'import', 'kind']);
    const [first, , third] = declarations as ImportDeclaration[];
    expect(first!.names?.map((one) => one.name.text)).toEqual(['Key']);
    expect(third!.namespace?.text).toBe('sprout');
  });

  it('refuses an import after a declaration, and keeps reading after it', () => {
    const { declarations, refusals } = read(
      `kind Crate { }\nimport {Key} from ${Q}key${Q}\nenum Ward { oak }\n`,
      'shop.sprout',
    );
    expect(refusals.map((d) => [locationOf(d.at), d.message])).toEqual([
      ['shop.sprout:2:1', '`import` belongs at the top of the file, before anything it declares.'],
    ]);
    expect(declarations.map((d) => d.kind)).toEqual(['kind', 'enum']);
  });

  it('refuses each malformed import in the one set of words, and loses nothing after it', () => {
    for (const [line, message] of [
      [`import Key from ${Q}key${Q}`, '`import` does not say what it brings in.'],
      [`import {} from ${Q}key${Q}`, 'This import brings in nothing.'],
      [`import {Key from ${Q}key${Q}`, 'The names this import brings in are never closed.'],
      [
        `import {Key, 4} from ${Q}key${Q}`,
        'An import lists the names it brings in, between braces.',
      ],
      [
        `import {Key as :key} from ${Q}key${Q}`,
        'An import lists the names it brings in, between braces.',
      ],
      ['import {Key} "key"', '`import` does not say where from.'],
      ['import {Key} from key', 'An import names where it is from in quotes.'],
      [`import {Key} from ${Q}${Q}`, 'An import names where it is from in quotes.'],
      [`import * sprout from ${Q}sprout${Q}`, 'A namespace import names the namespace after `as`.'],
    ] as const) {
      const { declarations, refusals } = read(`${line}\nenum Ward { oak }\n`, 'shop.sprout');
      expect(
        refusals.map((d) => d.message),
        line,
      ).toEqual([message]);
      expect(refusals[0]?.remedy ?? '', line).not.toBe('');
      expect(
        declarations.map((d) => d.kind),
        line,
      ).toEqual(['enum']);
    }
    expect(said(`import Key from ${Q}key${Q}\n`)[0]![0]).toBe('shop.sprout:1:1');
    expect(read(`import Key from ${Q}key${Q}\n`, 'shop.sprout').refusals[0]!.remedy).toBe(EXAMPLE);
  });
});
