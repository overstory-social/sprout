import { describe, expect, it } from 'vitest';

import { compileSnippet } from './bench.js';
import {
  DECLARATION_TABLE,
  declarationsSection,
  extensionsSection,
  limitsSection,
  manifestSection,
  MEMBER_TABLE,
  membersProbe,
  reservedSection,
} from './reference.js';
import { MEDIA } from '../../fixtures/extensions.js';
import { DEFAULT_LIMITS, LIMIT_TABLE, limitsFrom } from '../limits.js';
import { MANIFEST_FIELDS } from '../manifest.js';
import { DECLARATION_READERS } from '../../syntax/parse/declarations.js';
import { MEMBER_WORDS, RESERVED_WORDS } from '../../syntax/reserved.js';

describe('the skill’s reference sections', () => {
  it('lists every field of the manifest, in its own words', () => {
    const section = manifestSection();
    for (const [field, write] of Object.entries(MANIFEST_FIELDS)) {
      expect(section).toContain(`| \`${field}\` | ${write} |`);
    }
  });

  it('describes exactly the declarations the parser reads', () => {
    expect(DECLARATION_TABLE.map((entry) => entry.word).sort()).toEqual(
      [...DECLARATION_READERS.keys()].sort(),
    );
    const section = declarationsSection();
    for (const entry of DECLARATION_TABLE) expect(section).toContain(`| \`${entry.example}\` |`);
  });

  it('describes every member a body’s readers answer to, where each may stand', () => {
    const section = declarationsSection();
    for (const entry of MEMBER_TABLE) expect(section).toContain(`| \`${entry.example}\` |`);
    expect(section).toContain(
      '| `describe { text "A probe." }` | what whoever looks at it reads | yes | — |',
    );
    expect(section).toContain('| `visitors are Person` |');
    expect(section).toMatch(/\| `visitors are Person` \| .* \| — \| yes \|/);
  });

  it('shows members by examples the compiler accepts', () => {
    const { diagnostics } = compileSnippet(membersProbe());
    expect(diagnostics.filter((d) => d.severity === 'refusal')).toEqual([]);
  });

  it('gives every limit at the host’s figure, and says a limit the host leaves unset is its to set', () => {
    const section = limitsSection(limitsFrom({ budgets: { steps: 123 } }));
    for (const limit of LIMIT_TABLE) expect(section).toContain(`| \`${limit.name}\` |`);
    expect(section).toContain('| `steps` |');
    expect(section).toMatch(/\| `steps` \| [^|]+ \| 123 \| the turn faults/);
    expect(section).toMatch(
      /\| `places` \| [^|]+ \| the host’s to set; none by default \| the world is refused \|/,
    );
    expect(limitsSection(DEFAULT_LIMITS)).toMatch(/\| `steps` \| [^|]+ \| 50,000 \|/);
  });

  it('lists every reserved word, and the member words no message or verb may take', () => {
    const section = reservedSection();
    for (const word of RESERVED_WORDS) expect(section).toContain(`\`${word}\``);
    expect(section).toContain(`\`${[...MEMBER_WORDS].at(-1)}\`.`);
    expect(section).toContain(' or `');
  });

  it('describes each extension the host installs, in its own paragraph, and says when there is none', () => {
    expect(extensionsSection([])).toContain('None.');
    const section = extensionsSection([MEDIA]);
    expect(section).toContain('### `media 2`');
    expect(section).toContain('`extension media 2`');
    expect(section).toContain('| `media.show(image: media.Image, caption: string)` | yes |');
    expect(section).toContain('| `media.play(sound: media.Sound)` | — |');
    expect(section).toContain(MEDIA.skill);
  });
});
