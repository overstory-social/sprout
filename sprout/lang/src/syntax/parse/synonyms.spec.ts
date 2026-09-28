import { describe, expect, it } from 'vitest';

import { Diagnostics } from '../../source/diagnostics.js';
import { locationOf, SourceFile } from '../../source/source.js';
import type { VerbDeclaration } from '../ast-verbs.js';
import type { WorldDeclaration } from '../ast.js';
import { parseDeclarations } from '../parse.js';

/** What `text` declares, and what reading it said, as `line:col message`. */
function read(text: string) {
  const diagnostics = new Diagnostics();
  const declared = parseDeclarations(new SourceFile('s.sprout', text), diagnostics);
  const said = diagnostics.refusals.map(
    (d) => `${locationOf(d.at).slice('s.sprout:'.length)} ${d.message}`,
  );
  return { declared, said };
}

describe('a verb’s own synonyms', () => {
  it('are words in quotes after `synonyms`, the next after a comma, beside its roles and phrases', () => {
    const { declared, said } = read(
      'verb open {\n  role target\n  synonyms "unseal", "prise   open"\n  "open [target]"\n}\n',
    );
    expect(said).toEqual([]);
    const verb = declared[0] as VerbDeclaration;
    expect(verb.synonyms.map((one) => one.text)).toEqual(['unseal', 'prise open']);
    expect(verb.phrases.map((one) => one.text)).toEqual(['open [target]']);
  });

  it('may be written on several lines, which add', () => {
    const { declared } = read(
      'verb open { role target  "open [target]"  synonyms "unseal"  synonyms "jimmy" }\n',
    );
    expect((declared[0] as VerbDeclaration).synonyms.map((one) => one.text)).toEqual([
      'unseal',
      'jimmy',
    ]);
  });

  it('are refused without words in quotes, or holding a slot, or no words, each costing only itself', () => {
    const { declared, said } = read(
      'verb open {\n  role target\n  synonyms unseal\n  synonyms "pry [target]", " ", "jimmy"\n  "open [target]"\n}\n',
    );
    expect(said).toEqual([
      '3:12 `synonyms` needs the words, in quotes.',
      '4:17 A synonym is the words a visitor types in place of the verb’s name, and holds no slot.',
      '4:28 This synonym has no words in it.',
    ]);
    const verb = declared[0] as VerbDeclaration;
    expect(verb.synonyms.map((one) => one.text)).toEqual(['jimmy']);
    expect(verb.phrases.map((one) => one.text)).toEqual(['open [target]']);
  });
});

describe('a world’s and an object’s synonyms', () => {
  it('name the verb, a colon, then words in quotes', () => {
    const { declared, said } = read(
      'world w is sprout.World {\n  synonyms open: "jimmy", "force"\n  object chest is K { synonyms open: "prise" }\n}\n',
    );
    expect(said).toEqual([]);
    const world = declared[0] as WorldDeclaration;
    const [own] = world.members;
    expect(own).toMatchObject({ kind: 'synonyms', verb: { text: 'open' } });
    expect(own!.kind === 'synonyms' && own.words.map((one) => one.text)).toEqual([
      'jimmy',
      'force',
    ]);
    const [chest] = world.objects[0]!.members;
    expect(chest!.kind === 'synonyms' && chest.words.map((one) => one.text)).toEqual(['prise']);
  });

  it('are refused without the verb and its colon, and the body reads on', () => {
    const { declared, said } = read(
      'world w is sprout.World {\n  synonyms "jimmy"\n  synonyms open "force"\n  :lit true\n}\n',
    );
    expect(said).toEqual([
      '2:12 `synonyms` in a body names the verb they are for, then a colon.',
      '3:17 `synonyms` in a body names the verb they are for, then a colon.',
    ]);
    const world = declared[0] as WorldDeclaration;
    expect(world.members.map((one) => one.kind)).toEqual(['property']);
  });
});
