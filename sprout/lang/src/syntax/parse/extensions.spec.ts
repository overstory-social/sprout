import { describe, expect, it } from 'vitest';

import type { Declaration, KindDeclaration, Statement } from '../ast.js';
import { Diagnostics } from '../../source/diagnostics.js';
import { nodesOf } from '../../source/nodes.js';
import { locationOf, SourceFile, textOf } from '../../source/source.js';
import { chooser, read } from '../../fixtures/parse.js';
import { DECLARATION_READERS } from './declarations.js';
import { atExtensionStatement, extensionStatement, extensionUse } from './extensions.js';
import { Parser } from './parser.js';

const USE_EXAMPLE =
  'Write the extension and the major version the manifest pins, as in `extension media 2`.';

/** What reading `text` as a file said, where and in what words. */
const said = (text: string) =>
  read(text, 'painting.sprout').refusals.map((d) => [locationOf(d.at), d.message, d.remedy]);

/** The kinds of every statement a file's bodies hold, in the order written. */
const statementsIn = (declarations: readonly Declaration[]): string[] =>
  [...nodesOf(declarations)]
    .filter((node): node is Statement =>
      ['extension-statement', 'expression-statement', 'say'].includes(node.kind),
    )
    .map((node) => node.kind);

describe('`extension media 2`, at the top of a file', () => {
  it('reads each line naming an extension and its major, before the declarations', () => {
    const { declarations, refusals } = read(
      'extension media 2\nextension maps 0\n\nkind Painting { }\n',
      'painting.sprout',
    );
    expect(refusals).toEqual([]);
    expect(declarations.map((d) => d.kind)).toEqual(['extension-use', 'extension-use', 'kind']);
    expect(declarations.slice(0, 2).map((d) => textOf(d.at))).toEqual([
      'extension media 2',
      'extension maps 0',
    ]);
  });

  it('is only a line at the top: after a declaration it is refused, and what follows reads', () => {
    const text = 'kind Painting { }\nextension media 2\nkind Frame { }\n';
    expect(said(text)).toEqual([
      [
        'painting.sprout:2:1',
        '`extension` belongs at the top of the file, before anything it declares.',
        'Move this line above the first declaration.',
      ],
    ]);
    expect(read(text, 'painting.sprout').declarations.map((d) => d.kind)).toEqual(['kind', 'kind']);
  });

  it('says what is missing or wrong, at the word, and what to write', () => {
    expect(said('extension\nkind Painting { }')).toEqual([
      ['painting.sprout:1:10', '`extension` does not say which extension.', USE_EXAMPLE],
    ]);
    expect(said('extension Media 2')).toEqual([
      [
        'painting.sprout:1:11',
        "An extension's name is lower-case, and `Media` starts with a capital.",
        USE_EXAMPLE,
      ],
    ]);
    expect(said('extension self 2')).toEqual([
      [
        'painting.sprout:1:11',
        '`self` is a name the language binds, so it cannot name an extension.',
        USE_EXAMPLE,
      ],
    ]);
    expect(said('extension move 2')).toEqual([
      [
        'painting.sprout:1:11',
        '`move` is a word of the language, so it cannot name an extension.',
        USE_EXAMPLE,
      ],
    ]);
    expect(said('extension media\nkind Painting { }')).toEqual([
      ['painting.sprout:1:16', '`extension media` does not say which major version.', USE_EXAMPLE],
    ]);
    expect(said('extension media two')).toEqual([
      ['painting.sprout:1:17', '`extension media` does not say which major version.', USE_EXAMPLE],
    ]);
  });

  it('reads through the reader alone, and names the extension for the file’s statements', () => {
    const p = new Parser(
      new SourceFile('p.sprout', 'extension media 2'),
      new Diagnostics(),
      DECLARATION_READERS,
    );
    const used = extensionUse(p, true);
    expect(used).toMatchObject({ name: { text: 'media' }, major: { value: 2 } });
    expect([...p.extensions]).toEqual(['media']);
  });
});

describe('`media.show(…)`, a statement of an extension the file names', () => {
  it('is read as one where the file names it, and as a call where it does not', () => {
    const body =
      'kind Painting { as target for view { do { media.show(self.get(:image), "a cat") } } }';
    const named = read(`extension media 2\n${body}`, 'painting.sprout');
    expect(named.refusals).toEqual([]);
    expect(statementsIn(named.declarations)).toEqual(['extension-statement']);
    const unnamed = read(body, 'painting.sprout');
    expect(unnamed.refusals).toEqual([]);
    expect(statementsIn(unnamed.declarations)).toEqual(['expression-statement']);
  });

  it('keeps a binding’s call a call: only the name the file names starts one', () => {
    const { declarations } = read(
      'extension media 2\nkind Painting { as target for view { do { self.set(:n, 1)  media.play(x) } } }',
      'painting.sprout',
    );
    expect(statementsIn(declarations)).toEqual(['expression-statement', 'extension-statement']);
  });

  it('is refused where it is not a name and its arguments in brackets', () => {
    expect(
      said('extension media 2\nkind Painting { as target for view { do { media.show } } }'),
    ).toEqual([
      [
        'painting.sprout:2:43',
        'A statement of the extension `media` is its name and its arguments in brackets.',
        'Write it as `media.<statement>(…)`, as in `media.show(self.get(:image))`.',
      ],
    ]);
  });

  it('starts where the name is followed by a dot, and not otherwise', () => {
    const at = (text: string) => {
      const p = new Parser(
        new SourceFile('p.sprout', text),
        new Diagnostics(),
        DECLARATION_READERS,
      );
      p.extensions.add('media');
      return atExtensionStatement(p);
    };
    expect(at('media.show()')).toBe(true);
    expect(at('media')).toBe(false);
    expect(at('maps.show()')).toBe(false);
    const p = new Parser(
      new SourceFile('p.sprout', 'media.show("cat.png", 3)'),
      new Diagnostics(),
      DECLARATION_READERS,
    );
    expect(extensionStatement(p)).toMatchObject({
      kind: 'extension-statement',
      extension: { text: 'media' },
      name: { text: 'show' },
      arguments: [{ kind: 'string' }, { kind: 'integer' }],
    });
  });
});

// --- generated input -------------------------------------------------------
//
// The parser's recovery rule, for what this module reads: a file of
// `extension` lines and declarations, any one line of which may be
// defective, keeps every well-formed declaration, says one thing for the
// defective line, and never throws.

const DEFECTIVE = [
  'extension',
  'extension Media 2',
  'extension media',
  'extension media two',
  'extension 2',
];

describe('a well-formed declaration never vanishes beside a defective `extension` line', () => {
  it('over generated files, the defective line anywhere among them', () => {
    const c = chooser(45);
    for (let run = 0; run < 300; run++) {
      const uses = Array.from({ length: c.below(3) }, (_, i) => `extension e${i} ${c.below(4)}`);
      const kinds = Array.from({ length: 1 + c.below(3) }, (_, i) => `kind K${i} { }`);
      const lines = [...uses, ...kinds];
      const where = c.below(uses.length + 1);
      lines.splice(where, 0, c.one(DEFECTIVE));
      const text = lines.join('\n');
      let result: ReturnType<typeof read> | undefined;
      expect(() => {
        result = read(text, 'g.sprout');
      }, text).not.toThrow();
      expect(result!.refusals, text).toHaveLength(1);
      const kept = result!.declarations;
      expect(
        kept.filter((d) => d.kind === 'kind').map((d) => (d as KindDeclaration).name.text),
        text,
      ).toEqual(kinds.map((_, i) => `K${i}`));
      expect(
        kept.filter((d) => d.kind === 'extension-use'),
        text,
      ).toHaveLength(uses.length);
    }
  });
});
