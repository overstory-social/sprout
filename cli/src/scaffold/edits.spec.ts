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

  it('reads an import whole across its lines and in either quotes, and a name already imported from its file', () => {
    const text = `import {\n  Person,\n  Lock\n} from "person"\nimport * as sprout from "sprout"\n\nkind Key { }\n`;
    expect(
      withImports(text, [
        `import * as sprout from ${Q}sprout${Q}`,
        `import {Lock} from ${Q}person${Q}`,
      ]),
    ).toBe(text);
    expect(withImports(text, [`import {Key} from ${Q}key${Q}`])).toBe(
      `import {\n  Person,\n  Lock\n} from "person"\nimport * as sprout from "sprout"\nimport {Key} from ${Q}key${Q}\n\nkind Key { }\n`,
    );
  });
});
