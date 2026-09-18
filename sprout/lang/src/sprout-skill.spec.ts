import { describe, expect, it } from 'vitest';

import { MEDIA } from './fixtures/media.js';
import { compileSprout, compileSproutKind, sproutSkill, sproutSkillExamples } from './index.js';

// The skill (#347) is generated from the compiler's own definitions and
// its example is compiled before it goes in. The checked-in copy at
// skills/sprout/SKILL.md is Overstory's — rendered with the media
// extension — and is pinned in @overstory/sprout-ext-media's spec.

describe('sproutSkill', () => {
  it('opens with the frontmatter and the one rule about whose words are whose', () => {
    const skill = sproutSkill();
    expect(skill.startsWith('---\nname: sprout\n')).toBe(true);
    expect(skill).toContain('The builder writes the prose and describes the interaction.');
    expect(skill).toContain('Only `self` may be written.');
  });

  it('lists every well-known property and every reserved name', () => {
    const skill = sproutSkill();
    for (const p of ['takeable', 'hidden', 'scenery', 'illuminated', 'open', 'capacity']) {
      expect(skill).toContain(`| \`:${p}\` |`);
    }
    expect(skill).not.toContain('| `:image` |');
    expect(skill).toContain('_This host has installed none._');
    for (const m of ['describe', 'entered', 'take', 'help']) expect(skill).toContain(`\`${m}\``);
    expect(skill).toContain('`Container`, `Room`, `Actor`');
  });

  it('carries a worked example that compiles — printed by the compiler, so it is canonical', () => {
    const ex = sproutSkillExamples();
    const kind = compileSproutKind(ex.kind);
    expect(kind.problems).toEqual([]);
    const item = compileSprout(ex.item, { zoneKinds: new Map([['Torch', kind.definition!]]) });
    expect(item.problems).toEqual([]);
    const room = compileSprout(ex.room, { rooms: new Map([['hall', 'hall']]) });
    expect(room.problems).toEqual([]);
    expect(sproutSkill()).toContain(ex.item);
  });

  it('teaches an installed extension: its well-known properties, its literal, its statements', () => {
    const skill = sproutSkill(MEDIA);
    expect(skill).toContain('| `:image` | media | none | rooms, items and kinds |');
    expect(skill).toContain('### `use media`');
    expect(skill).toContain('`:name media ["…"]`');
    expect(skill).toContain('`show [<target>] [:property]` — anywhere but a guard.');
  });
});
