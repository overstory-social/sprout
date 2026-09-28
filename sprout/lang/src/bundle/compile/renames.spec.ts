import { describe, expect, it } from 'vitest';

import type { KindDeclaration } from '../../syntax/ast.js';
import { Diagnostics } from '../../source/diagnostics.js';
import { nodesOf } from '../../source/nodes.js';
import { SourceFile } from '../../source/source.js';
import { parseDeclarations } from '../../syntax/parse.js';
import { libraryScope, rewrite } from './renames.js';

/** A single quote, as an import's specifier is written between them. */
const Q = "'";

const read = (text: string) =>
  parseDeclarations(new SourceFile('crate.sprout', text), new Diagnostics());
const composes = (declared: KindDeclaration) =>
  declared.composes.map((one) => `${one.library?.text ?? ''}.${one.name.text}`);

describe('a file’s names as its imports from libraries mean them', () => {
  const written = read(
    `import {Container as Box, take} from ${Q}sprout${Q}\nimport * as lib from ${Q}sprout${Q}\nimport {Key} from ${Q}key${Q}\nkind Crate is Box, lib.Fixture, Key, Other { as actor for take { } }\n`,
  );
  const scope = libraryScope(written, new Set(['sprout']));
  const crate = rewrite(written.at(-1) as KindDeclaration, scope);

  it('reads only what comes from a library, and each name by what it goes by here', () => {
    expect([...scope.names.keys()]).toEqual(['Box', 'take']);
    expect([...scope.namespaces]).toEqual([['lib', 'sprout']]);
  });

  it('writes a library’s name with its library, a namespace’s member in its library, and leaves the rest', () => {
    expect(composes(crate)).toEqual(['sprout.Container', 'sprout.Fixture', '.Key', '.Other']);
  });

  it('keeps where each name was written, and every node it did not change', () => {
    const original = written.at(-1) as KindDeclaration;
    expect(crate.composes[0]!.at).toBe(original.composes[0]!.at);
    expect(crate.composes[2]).toBe(original.composes[2]);
    expect(rewrite(original, { names: new Map(), namespaces: new Map() })).toBe(original);
  });
});

describe('a verb and a message under another name', () => {
  const written = read(
    'kind Crate {\n  as actor for grab { do { send self :shake  broadcast :shake } }\n  on :shake { act grab (target: self) }\n}\n',
  );
  const scope = {
    names: new Map([
      ['grab', { library: 'sprout', name: 'take', fromLibrary: true, object: null }],
      ['shake', { library: 'shop', name: 'stir', fromLibrary: false, object: null }],
    ]),
    namespaces: new Map<string, string>(),
  };
  const crate = rewrite(written[0] as KindDeclaration, scope);
  const named = (field: 'verb' | 'message') =>
    [...nodesOf([crate])].flatMap((node) => {
      const value = (node as unknown as Record<string, unknown>)[field];
      return value !== null && typeof value === 'object' && 'text' in value
        ? [`${node.kind} ${(value as { text: string }).text}`]
        : [];
    });

  it('reads a play’s and an `act`’s verb as the one imported', () => {
    expect(named('verb')).toEqual(['role-ref take', 'act take']);
  });

  it('reads a send’s, a broadcast’s and a handler’s message as the one imported', () => {
    expect(named('message').sort()).toEqual(['broadcast stir', 'handler stir', 'send stir'].sort());
  });
});
