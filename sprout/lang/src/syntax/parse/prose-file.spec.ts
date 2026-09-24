import { describe, expect, it } from 'vitest';

import type { KindDeclaration } from '../ast.js';
import { Diagnostics } from '../../source/diagnostics.js';
import { unspanned } from '../../source/nodes.js';
import { locationOf, SourceFile, textOf } from '../../source/source.js';
import { read } from '../../fixtures/parse.js';
import { Parser } from './parser.js';
import { proseFile, proseFileBody, PROSE_FILE } from './prose-file.js';

function body(text: string) {
  const diagnostics = new Diagnostics();
  const passages = proseFileBody(
    new Parser(new SourceFile('mirror.prose', text), diagnostics, new Map()),
  );
  return { passages, said: diagnostics.refusals.map((d) => [locationOf(d.at), d.message]) };
}

function member(text: string) {
  const diagnostics = new Diagnostics();
  const p = new Parser(new SourceFile('mirror.sprout', text), diagnostics, new Map());
  const read = proseFile(p);
  return {
    read,
    p,
    said: diagnostics.refusals.map((d) => [locationOf(d.at), d.message, d.remedy]),
  };
}

describe('`prose "…"` names the file a kind’s longer passages live in', () => {
  it('reads the name in quotes, spanned', () => {
    const { read, said } = member('prose "mirror.prose"');
    expect(said).toEqual([]);
    expect(read).toMatchObject({ kind: 'prose-file', file: { value: 'mirror.prose' } });
    expect(textOf(read!.at)).toBe('prose "mirror.prose"');
    expect(unspanned(read!)).toEqual([]);
  });

  it('is a member of a kind’s, an object’s and the world’s body', () => {
    const { declarations, refusals } = read(
      'kind Mirror { prose "mirror.prose" }\nworld w is sprout.World { prose "w.prose"\n  object o is Mirror { prose "o.prose" } }',
    );
    expect(refusals).toEqual([]);
    const [kind, world] = declarations as [
      KindDeclaration,
      { members: { kind: string }[]; objects: KindDeclaration[] },
    ];
    expect(kind.members.map((m) => m.kind)).toEqual(['prose-file']);
    expect(world.members.map((m) => m.kind)).toEqual(['prose-file']);
    expect(world.objects[0]!.members.map((m) => m.kind)).toEqual(['prose-file']);
  });

  it('refuses a name not in quotes, and leaves what follows to be read', () => {
    const { read, p, said } = member('prose mirror');
    expect(read).toBeNull();
    expect(said).toEqual([
      [
        'mirror.sprout:1:6',
        '`prose` names the file its passages are in, in quotes.',
        'Write `prose "mirror.prose"`, naming a `.prose` file of this world.',
      ],
    ]);
    expect(p.peek().text).toBe('mirror');
  });

  it(`refuses a file that is not a ${PROSE_FILE} file`, () => {
    for (const named of ['"mirror.txt"', '".prose"', '"mirror.sprout"']) {
      const { read, said } = member(`prose ${named}`);
      expect(read, named).toBeNull();
      expect(said.map(([, message]) => message)).toEqual([
        `\`prose\` names a \`.prose\` file, and ${named} is not one.`,
      ]);
    }
  });
});

describe('a `.prose` file holds passages and nothing else', () => {
  it('reads each passage, its comments aside, with its words read as prose', () => {
    const { passages, said } = body(
      '// The mirror’s words.\npassage greeting {\n  Hello, {actor}.\n}\n\npassage shrug default { Nothing. }\n',
    );
    expect(said).toEqual([]);
    expect(passages.map((one) => [one.name.text, one.yields])).toEqual([
      ['greeting', false],
      ['shrug', true],
    ]);
    expect(passages[0]!.body.prose.pieces.map((piece) => piece.kind)).toEqual([
      'prose-words',
      'prose-slot',
      'prose-words',
    ]);
  });

  it('refuses anything else once, where it starts, and reads the passages after it', () => {
    const { passages, said } = body(
      ':mood 1\nkind K { }\npassage greeting { Hi. }\nnonsense\npassage shrug { No. }',
    );
    expect(said).toEqual([
      ['mirror.prose:1:1', 'A `.prose` file holds passages, and nothing else.'],
      ['mirror.prose:4:1', 'A `.prose` file holds passages, and nothing else.'],
    ]);
    expect(passages.map((one) => one.name.text)).toEqual(['greeting', 'shrug']);
  });

  it('holds nothing when it is empty, which is not a problem', () => {
    expect(body('')).toEqual({ passages: [], said: [] });
  });
});
