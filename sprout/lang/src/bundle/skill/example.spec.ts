import { describe, expect, it } from 'vitest';

import { compileExample, manifestText } from './bench.js';
import { WORKED_EXAMPLE, workedExampleSection } from './example.js';

describe('the worked example the skill opens with', () => {
  it('is a whole world that compiles with nothing at all to say', () => {
    const { bundle, diagnostics } = compileExample(WORKED_EXAMPLE);
    expect(diagnostics).toEqual([]);
    expect(bundle).not.toBeNull();
  });

  it('shows its manifest and every file exactly as compiled, and names what it declares', () => {
    const section = workedExampleSection();
    expect(section.startsWith('## A worked example\n')).toBe(true);
    expect(section).toContain(`\`\`\`json\n${manifestText(WORKED_EXAMPLE)}\`\`\``);
    for (const [name, text] of Object.entries(WORKED_EXAMPLE.files)) {
      expect(section).toContain(`\`${name}\`:\n\n\`\`\`sprout\n${text}\`\`\``);
    }
    expect(section).toContain('the kinds `Person`, `Lamp` and `Match` and the verb `light`');
  });

  it('throws rather than open the skill with a world the compiler says anything about', () => {
    const warned = {
      name: WORKED_EXAMPLE.name,
      files: { ...WORKED_EXAMPLE.files, 'lamp.prose': 'passage glow { It glows. }\n' },
    };
    expect(() => workedExampleSection(warned)).toThrow('does not compile cleanly');
  });
});
