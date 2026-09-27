import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SYNTAXES, corpusFiles, corpusText, scopesAt, tokenise } from './fixtures/tokenise.ts';
import { proseGrammar } from './prose.ts';

const ROOM = 'good/printers_shop/composing_room.prose';
const LIST = '{for thing in self}{if thing != actor}{thing}{if $last}.{else}, {/if}{/if}{/for}';

describe('the .prose grammar', () => {
  it('is what syntaxes/ holds: `npm run generate -w editors/vscode` writes it', () => {
    const written = JSON.parse(
      readFileSync(join(SYNTAXES, 'sprout-prose.tmLanguage.json'), 'utf8'),
    );
    expect(written).toEqual(JSON.parse(JSON.stringify(proseGrammar())));
  });

  it('reads every corpus file without an error scope', async () => {
    const files = corpusFiles().filter((f) => f.endsWith('.prose'));
    expect(files.length).toBeGreaterThan(5);
    for (const file of files) {
      const lines = await tokenise('source.sprout-prose', corpusText(file));
      for (const t of lines.flat()) {
        expect(
          t.scopes.filter((s) => s.startsWith('invalid')),
          file,
        ).toEqual([]);
      }
    }
  });

  it.each([
    [ROOM, 'passage arrival', 'arrival', 'entity.name.function.passage.sprout-prose'],
    [ROOM, LIST, 'thing', 'variable.other.sprout-prose'],
    [ROOM, '{thing}{if $last}', 'thing', 'meta.slot.sprout-prose'],
    [ROOM, LIST, 'for', 'keyword.control.loop.sprout-prose'],
    [ROOM, LIST, 'in', 'keyword.control.loop.sprout-prose'],
    [ROOM, LIST, '$last', 'variable.language.loop.sprout-prose'],
    [ROOM, LIST, 'else', 'keyword.control.conditional.sprout-prose'],
    [ROOM, '{if actor.recall(:visits) <= 1}', 'if', 'keyword.control.conditional.sprout-prose'],
    [ROOM, '{if actor.recall(:visits) <= 1}', 'recall', 'entity.name.function.sprout-prose'],
    [ROOM, '{if actor.recall(:visits) <= 1}', 'visits', 'constant.other.symbol.sprout-prose'],
    [ROOM, '{/if}', 'if', 'keyword.control.conditional.sprout-prose'],
    [ROOM, '{/if}', '/', 'keyword.control.conditional.sprout-prose'],
    [
      ROOM,
      'You have not stood in here',
      'You have not stood in here before, and the room somehow knows it.',
      'meta.embedded.block.sprout-prose',
    ],
  ])('%s: in `%s`, `%s` is %s', async (file, line, token, scope) => {
    expect(await scopesAt(file, line, token)).toContain(scope);
  });

  it('colours a {one of} and its choices', async () => {
    const [tokens] = await tokenise('source.sprout-prose', 'passage p { {one of}a{or}b{/one of} }');
    const choice = tokens!.filter((t) => t.scopes.includes('keyword.control.choice.sprout-prose'));
    expect(choice.map((t) => t.text)).toEqual(['one of', 'or', '/', 'one of']);
  });

  it('reads \\{ as a character, not a slot, and keeps the passage open after it', async () => {
    const [tokens] = await tokenise('source.sprout-prose', 'passage p { a \\{ b } c');
    expect(tokens!.find((t) => t.text === '\\{')?.scopes).toContain(
      'constant.character.escape.sprout-prose',
    );
    expect(tokens!.some((t) => t.scopes.includes('meta.slot.sprout-prose'))).toBe(false);
    const b = tokens!.find((t) => t.text.includes('b'));
    expect(b?.scopes).toContain('meta.embedded.block.sprout-prose');
    expect(tokens!.find((t) => t.text.includes('c'))?.scopes).not.toContain(
      'meta.passage.sprout-prose',
    );
  });

  it('reads quoted text inside a slot as text, braces and all', async () => {
    const [tokens] = await tokenise('source.sprout-prose', 'passage p { {"{thing}"} after }');
    expect(tokens!.find((t) => t.text === '{thing}')?.scopes).toContain(
      'string.quoted.double.sprout-prose',
    );
    expect(tokens!.find((t) => t.text.includes('after'))?.scopes).toContain(
      'meta.embedded.block.sprout-prose',
    );
  });

  it('treats // inside a passage as words, and outside one as a comment', async () => {
    const lines = await tokenise('source.sprout-prose', '// note\npassage p { a // b }');
    expect(lines[0]![0]!.scopes).toContain('comment.line.double-slash.sprout-prose');
    expect(lines[1]!.some((t) => t.scopes.some((s) => s.startsWith('comment')))).toBe(false);
  });
});
