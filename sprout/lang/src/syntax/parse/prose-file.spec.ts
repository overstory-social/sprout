import { describe, expect, it } from 'vitest';

import { unspanned } from '../../source/nodes.js';
import { locationOf, textOf } from '../../source/source.js';
import { atMember, parserOver, readWith } from '../../fixtures/readers.js';
import { proseFile, proseFileBody, PROSE_FILE } from './prose-file.js';
import { worldMembers } from './world.js';

/** Every passage `proseFileBody` reads from a `.prose` file holding `text`. */
function body(text: string) {
  const { read: passages, refusals } = readWith(proseFileBody, text, {
    name: 'mirror.prose',
    readers: new Map(),
  });
  return { passages, said: refusals.map((d) => [locationOf(d.at), d.message]) };
}

/** One `prose "…"` member, read by `proseFile` from the start of `text`. */
function member(text: string) {
  const { read, p, refusals } = readWith(proseFile, text, {
    name: 'mirror.sprout',
    readers: new Map(),
  });
  return { read, p, said: refusals.map((d) => [locationOf(d.at), d.message, d.remedy]) };
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
    // A kind's body and an object's are read by one table of members, and the world's by its own.
    const text = 'kind Mirror { prose "mirror.prose" }';
    const kind = atMember(text, text.indexOf('prose'), 'Mirror');
    expect(kind.readers.get('prose')!()).toMatchObject({ kind: 'prose-file' });
    const { p, diagnostics } = parserOver('prose "w.prose"');
    expect(worldMembers(p, 'w').get('prose')!()).toMatchObject({ kind: 'prose-file' });
    expect([...kind.diagnostics.refusals, ...diagnostics.refusals]).toEqual([]);
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
