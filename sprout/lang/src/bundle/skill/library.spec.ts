import { describe, expect, it } from 'vitest';

import { compileSnippet } from './bench.js';
import {
  compositionSection,
  libraryKinds,
  librarySourceSection,
  libraryVerbs,
  routingSection,
  verbsSection,
} from './library.js';
import { STANDARD_LIBRARY } from '../standard-library.js';
import { ENGINE_MESSAGES } from '../../declare/engine-messages.js';
import { kindName } from '../../declare/kinds.js';
import { ENGINE_VERBS } from '../../declare/verbs.js';

const { bundle } = compileSnippet({});
const library = bundle!;

describe('the standard library as the skill describes it', () => {
  it('is the library this compiler carries: its kinds and verbs, and no world’s', () => {
    expect(libraryKinds(library).map(kindName)).toEqual([
      'sprout.World',
      'sprout.Place',
      'sprout.Actor',
      'sprout.Visitor',
      'sprout.Fixture',
      'sprout.Container',
      'sprout.Lockable',
    ]);
    expect(libraryVerbs(library).map((verb) => verb.name)).toEqual([
      ...ENGINE_VERBS,
      'take',
      'drop',
      'put',
      'give',
      'open',
      'close',
      'unlock',
      'ask',
    ]);
  });

  it('lists every verb with each of its phrases, and who answers it', () => {
    const section = verbsSection(library);
    for (const verb of libraryVerbs(library)) {
      const row = section.split('\n').find((line) => line.startsWith(`| \`${verb.name}\` |`));
      expect(row, verb.name).toBeDefined();
      for (const phrase of verb.phrases) expect(row).toContain(`\`"${phrase.text}"\``);
      if (ENGINE_VERBS.includes(verb.name)) expect(row).toContain('| the engine |');
    }
    expect(section).toContain(
      '| `open` | `target: Container` | `"open [target]"` | `sprout.Container` as `target`, `sprout.Lockable` as `target` |',
    );
  });

  it('says what each kind composes, holds, declares and says, from its own body alone', () => {
    const section = compositionSection(library);
    for (const kind of libraryKinds(library)) {
      expect(section).toContain(`### \`${kindName(kind)}\``);
      for (const passage of kind.passages.values())
        expect(section).toContain(`| \`${passage.name}\` |`);
    }
    expect(section).toContain('- composes `sprout.Actor`\n- holds things');
    expect(section).toContain('- properties `:open` boolean = `true`, `:capacity` integer = `8`');
    expect(section).toContain('- routes `pass any (self.get(:open))`');
  });

  it('lists every message the engine sends, with what a handler of it binds', () => {
    const section = routingSection(library);
    for (const message of ENGINE_MESSAGES) expect(section).toContain(`on :${message.name} (`);
    expect(section).toContain(
      '| `on :entered (item, from) { … }` | `item` object, `from` object |',
    );
    expect(section).toContain('The standard library declares no messages of its own.');
  });

  it('gives the library’s source, every file as it travels', () => {
    const section = librarySourceSection();
    for (const file of STANDARD_LIBRARY.files) {
      expect(section).toContain(`\`${file.name}\`:\n\n\`\`\`sprout\n${file.text}\`\`\``);
    }
  });
});
