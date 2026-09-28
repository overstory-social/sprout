import { describe, expect, it } from 'vitest';

import type { ImportDeclaration } from './ast-imports.js';
import { Diagnostics } from '../source/diagnostics.js';
import { unspanned } from '../source/nodes.js';
import { parseDeclarations } from './parse.js';
import { SourceFile, textOf } from '../source/source.js';

/** A single quote, as an import's specifier is written between them. */
const Q = "'";

describe('the nodes of a file’s imports keep the rule every node keeps', () => {
  const diagnostics = new Diagnostics();
  const declared = parseDeclarations(
    new SourceFile(
      'shop.sprout',
      `import {Key, Ward as Guard, :stir} from ${Q}blacksmith/key${Q}\nimport * as sprout from ${Q}sprout${Q}\nkind Crate { }\n`,
    ),
    diagnostics,
  );
  const [named, whole] = declared as [ImportDeclaration, ImportDeclaration];

  it('reads clean, and every node carries a span', () => {
    expect(diagnostics.all).toEqual([]);
    expect(unspanned(declared)).toEqual([]);
  });

  it('spans each name at what was written, its `as` with it, and the specifier at its quotes', () => {
    expect(textOf(named.at)).toBe(`import {Key, Ward as Guard, :stir} from ${Q}blacksmith/key${Q}`);
    expect(named.names?.map((one) => textOf(one.at))).toEqual(['Key', 'Ward as Guard', ':stir']);
    expect(
      named.names?.map((one) => [one.name.text, one.alias?.text ?? null, one.message]),
    ).toEqual([
      ['Key', null, false],
      ['Ward', 'Guard', false],
      ['stir', null, true],
    ]);
    expect(named.namespace).toBeNull();
    expect([named.from.text, textOf(named.from.at)]).toEqual([
      'blacksmith/key',
      "'blacksmith/key'",
    ]);
  });

  it('keeps a namespace import’s name and no list', () => {
    expect(whole.names).toBeNull();
    expect(whole.namespace?.text).toBe('sprout');
    expect(whole.from.text).toBe('sprout');
  });
});
