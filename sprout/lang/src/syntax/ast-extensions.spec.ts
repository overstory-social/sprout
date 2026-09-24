import { describe, expect, it } from 'vitest';

import type { ExtensionStatement, ExtensionUse } from './ast-extensions.js';
import type { KindDeclaration } from './ast.js';
import { Diagnostics } from '../source/diagnostics.js';
import { nodesOf, unspanned } from '../source/nodes.js';
import { parseDeclarations } from './parse.js';
import { SourceFile, textOf } from '../source/source.js';

describe('the nodes of what a file writes of an extension keep the rule every node keeps', () => {
  const diagnostics = new Diagnostics();
  const declared = parseDeclarations(
    new SourceFile(
      'painting.sprout',
      'extension media 2\nkind Painting { as target for view { do { media.show(self.get(:image), "a cat") } } }\n',
    ),
    diagnostics,
  );
  const [use, kind] = declared as [ExtensionUse, KindDeclaration];

  it('reads clean, and every node carries a span', () => {
    expect(diagnostics.all).toEqual([]);
    expect(unspanned(declared)).toEqual([]);
  });

  it('spans the `extension` line at what was written, with its name and major', () => {
    expect(use.kind).toBe('extension-use');
    expect(textOf(use.at)).toBe('extension media 2');
    expect(textOf(use.name.at)).toBe('media');
    expect(use.major).toMatchObject({ kind: 'integer', value: 2 });
  });

  it('spans a statement of the extension at what was written, with its parts', () => {
    const statement = [...nodesOf([kind])].find(
      (node): node is ExtensionStatement => node.kind === 'extension-statement',
    )!;
    expect(textOf(statement.at)).toBe('media.show(self.get(:image), "a cat")');
    expect(statement.extension.text).toBe('media');
    expect(statement.name.text).toBe('show');
    expect(statement.arguments.map((argument) => textOf(argument.at))).toEqual([
      'self.get(:image)',
      '"a cat"',
    ]);
  });
});
