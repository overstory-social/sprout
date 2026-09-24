import { describe, expect, it } from 'vitest';

import { generateSkill } from './skill.js';
import { MEDIA } from '../../fixtures/extensions.js';
import { LANGUAGE_LEVEL } from '../bundle.js';
import { limitsFrom } from '../limits.js';

const skill = generateSkill();
const headings = (page: string): string[] =>
  page.split('\n').filter((line) => line.startsWith('## '));

describe('the generated skill', () => {
  it('is a skill: front matter naming it and saying when to use it, then its title', () => {
    expect(skill.startsWith('---\nname: sprout\ndescription: ')).toBe(true);
    expect(skill).toContain('\n---\n\n# Writing a Sprout world\n');
    expect(skill).toContain(`at language level ${LANGUAGE_LEVEL}`);
    expect(skill.endsWith('\n')).toBe(true);
  });

  it('is ordered for an author: the worked example first, composition and routing last', () => {
    expect(headings(skill)).toEqual([
      '## A worked example',
      '## The manifest',
      '## Declarations',
      '## Properties and values',
      '## Statements, and where each may stand',
      '## What a visitor can type',
      '## What the compiler warns about',
      '## Some refusals, in the compiler’s words',
      '## Limits',
      '## Reserved words',
      '## Extensions this host installs',
      '## Composing the library’s kinds',
      '## Routing: messages and pass rules',
      '## The standard library’s source',
    ]);
  });

  it('is the same page every time it is generated', () => {
    expect(generateSkill()).toBe(skill);
  });

  it('carries what the host brings: its usage, its limits and its extensions', () => {
    const hosted = generateSkill({
      usage: 'sprout check [dir]\n',
      limits: limitsFrom({ caps: { optionsPerEnum: 7 } }),
      extensions: [MEDIA],
    });
    expect(headings(hosted)[1]).toBe('## Checking what you wrote');
    expect(hosted).toContain('```text\nsprout check [dir]\n```');
    expect(hosted).toMatch(/\| `optionsPerEnum` \| [^|]+ \| 7 \|/);
    expect(hosted).toContain(MEDIA.skill);
  });
});
