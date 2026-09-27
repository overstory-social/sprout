import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SYNTAXES, corpusFiles, corpusText, scopesAt, tokenise } from './fixtures/tokenise.ts';
import { syntaxWords } from './keywords.ts';
import { sproutGrammar } from './sprout.ts';

const SHOP = 'good/printers_shop/printers_shop.sprout';

describe('the .sprout grammar', () => {
  it('is what syntaxes/ holds: `npm run generate -w editors/vscode` writes it', () => {
    const written = JSON.parse(readFileSync(join(SYNTAXES, 'sprout.tmLanguage.json'), 'utf8'));
    expect(written).toEqual(JSON.parse(JSON.stringify(sproutGrammar())));
  });

  it('colours every reserved word of the syntax as a keyword', async () => {
    const words = syntaxWords();
    const lines = await tokenise('source.sprout', words.join('\n'));
    const keywords = lines.flat().filter((t) => t.scopes.includes('keyword.other.sprout'));
    expect(keywords.map((t) => t.text)).toEqual(words);
  });

  it('reads every corpus file without an error scope', async () => {
    const files = corpusFiles().filter((f) => f.endsWith('.sprout'));
    expect(files.length).toBeGreaterThan(100);
    for (const file of files) {
      const lines = await tokenise('source.sprout', corpusText(file));
      for (const t of lines.flat()) {
        expect(
          t.scopes.filter((s) => s.startsWith('invalid')),
          file,
        ).toEqual([]);
      }
    }
  });

  it.each([
    [SHOP, 'visitors arrive at', 'visitors', 'keyword.other.sprout'],
    [SHOP, ':season Season', ':', 'punctuation.definition.symbol.sprout'],
    [SHOP, ':season Season', 'season', 'constant.other.symbol.sprout'],
    [SHOP, ':season Season', 'Season', 'entity.name.type.sprout'],
    [SHOP, 'sprout.Container', 'sprout', 'entity.name.namespace.sprout'],
    [SHOP, 'sprout.Container', 'Container', 'entity.name.type.sprout'],
    [
      'good/printers_shop/creature.sprout',
      'kind Creature',
      'Creature',
      'entity.name.type.kind.sprout',
    ],
    [SHOP, 'enum Ward', 'Ward', 'entity.name.type.enum.sprout'],
    [SHOP, 'enum Ward', 'iron', 'variable.other.enummember.sprout'],
    [SHOP, ':ward     iron', 'iron', 'variable.other.sprout'],
    [SHOP, 'verb work', 'work', 'entity.name.function.verb.sprout'],
    [SHOP, '"work [target] with [tools]"', 'tools', 'variable.parameter.role.sprout'],
    [SHOP, '"work [target] with [tools]"', 'tools', 'string.quoted.double.phrase.sprout'],
    [SHOP, 'exit out "out to the press yard"', '->', 'keyword.operator.arrow.sprout'],
    [SHOP, 'exit out "out to the press yard"', 'out', 'entity.name.label.sprout'],
    [SHOP, 'as target for lower', 'lower', 'entity.name.function.verb.sprout'],
    [SHOP, 'passage immovable', 'immovable', 'entity.name.function.passage.sprout-prose'],
    [
      SHOP,
      'The ladder is chained',
      'The ladder is chained to the shelving.',
      'meta.embedded.block.sprout-prose',
    ],
    [SHOP, 'tell "{actor} lets', 'actor', 'variable.language.sprout-prose'],
    [SHOP, 'tell "{one of}The cat', 'one of', 'keyword.control.choice.sprout-prose'],
    [SHOP, 'tell "{one of}The cat', 'one of', 'string.quoted.double.sprout'],
    [SHOP, 'object cabinet', 'cabinet', 'entity.name.tag.object.sprout'],
    [
      'good/verbs/phrases.sprout',
      '"yell \\"hey\\" at [target]"',
      '\\"',
      'constant.character.escape.sprout',
    ],
    [
      'good/declarations/kinds.sprout',
      '/* A comment may run',
      '/*',
      'punctuation.definition.comment.begin.sprout',
    ],
    [
      'good/declarations/kinds.sprout',
      '/* A comment may run',
      'A comment may run',
      'comment.block.sprout',
    ],
    ['good/prose/press.sprout', '\\{Its maker}', '\\{', 'constant.character.escape.sprout-prose'],
    [
      'bad/extension-list/album.sprout',
      'extension media 1',
      'media',
      'entity.name.namespace.sprout',
    ],
    ['bad/extension-list/album.sprout', '[media.Image]', 'Image', 'entity.name.type.sprout'],
  ])('%s: in `%s`, `%s` is %s', async (file, line, token, scope) => {
    expect(await scopesAt(file, line, token)).toContain(scope);
  });

  it('leaves the quoted text of a name, a noun or a label plain', async () => {
    const scopes = await scopesAt(SHOP, 'name    "composing room"', 'composing room');
    expect(scopes).toContain('string.quoted.double.sprout');
    expect(scopes.some((s) => s.includes('sprout-prose'))).toBe(false);
  });

  it('ends a slot in quoted text at the closing quote, so what follows is code again', async () => {
    const [tokens] = await tokenise('source.sprout', 'say "{self" if (x) {}');
    const iff = tokens!.find((t) => t.text === 'if');
    expect(iff?.scopes).toContain('keyword.other.sprout');
    expect(iff?.scopes.some((s) => s.startsWith('string'))).toBe(false);
  });

  it('ends quoted text that is never closed at the end of its line', async () => {
    const lines = await tokenise('source.sprout', 'say "never closed\nkind Key');
    expect(lines[1]!.find((t) => t.text === 'Key')?.scopes).toContain(
      'entity.name.type.kind.sprout',
    );
  });
});
