import { describe, expect, it } from 'vitest';

import { withImports } from './edits.js';

/** A single quote, as an import's specifier is written between them. */
const Q = "'";

describe('an import a scaffold adds', () => {
  it('goes after the file’s own imports, and past a comment heading it, once', () => {
    const text = `// The shop's keys.\nimport * as sprout from ${Q}sprout${Q}\n\nkind Key { }\n`;
    expect(
      withImports(text, [
        `import {Lock} from ${Q}lock${Q}`,
        `import * as sprout from ${Q}sprout${Q}`,
      ]),
    ).toBe(
      `// The shop's keys.\nimport * as sprout from ${Q}sprout${Q}\nimport {Lock} from ${Q}lock${Q}\n\nkind Key { }\n`,
    );
    expect(withImports(text, [`import * as sprout from ${Q}sprout${Q}`])).toBe(text);
  });

  it('opens a file with none', () => {
    expect(withImports('kind Key { }\n', [`import {Lock} from ${Q}lock${Q}`])).toBe(
      `import {Lock} from ${Q}lock${Q}\nkind Key { }\n`,
    );
  });
});
