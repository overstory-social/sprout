import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { compileSprout, compileSproutKind, sproutSkill, sproutSkillExamples } from './index.js';

// The skill (#347) is generated from the compiler's own definitions and
// its example is compiled before it goes in; the checked-in copy is
// pinned to the generator so neither can drift.

describe('sproutSkill', () => {
  it('opens with the frontmatter and the one rule about whose words are whose', () => {
    const skill = sproutSkill();
    expect(skill.startsWith('---\nname: sprout\n')).toBe(true);
    expect(skill).toContain('The builder writes the prose and describes the interaction.');
    expect(skill).toContain('Only `self` may be written.');
  });

  it('lists every well-known property and every reserved name', () => {
    const skill = sproutSkill();
    for (const p of ['takeable', 'hidden', 'scenery', 'illuminated', 'open', 'capacity', 'image']) {
      expect(skill).toContain(`| \`:${p}\` |`);
    }
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

  it('matches the checked-in copy at skills/sprout/SKILL.md (regenerate with `npm run sprout:skill`)', () => {
    const checkedIn = readFileSync(resolve(__dirname, '../../../skills/sprout/SKILL.md'), 'utf8');
    expect(checkedIn).toBe(sproutSkill());
  });
});
