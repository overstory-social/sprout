import { describe, expect, it } from 'vitest';

import { blocks, code, fenced, heading, listed, table } from './markdown.js';

describe('the skill’s Markdown', () => {
  it('fences inline code longer than any run of backticks inside it', () => {
    expect(code('self')).toBe('`self`');
    expect(code('say `x`')).toBe('`` say `x` ``');
    expect(code('a `` b')).toBe('```a `` b```');
  });

  it('fences a block longer than any fence inside it, and ends it on its own line', () => {
    expect(fenced('sprout', 'kind Lamp { }')).toBe('```sprout\nkind Lamp { }\n```');
    expect(fenced('text', 'a\n```\nb\n')).toBe('````text\na\n```\nb\n````');
  });

  it('keeps a table a table whatever its cells hold', () => {
    expect(table(['a', 'b'], [['x | y', 'one\n  two']])).toBe(
      '| a | b |\n| --- | --- |\n| x \\| y | one two |',
    );
  });

  it('writes headings by level, joins blocks with a blank line and leaves empty ones out', () => {
    expect(heading(2, 'Limits')).toBe('## Limits');
    expect(blocks('a', '', 'b')).toBe('a\n\nb');
  });

  it('lists as a sentence does, with `and` or `or`', () => {
    expect(listed([])).toBe('nothing');
    expect(listed(['a'])).toBe('a');
    expect(listed(['a', 'b', 'c'])).toBe('a, b and c');
    expect(listed(['a', 'b'], 'or')).toBe('a or b');
  });
});
