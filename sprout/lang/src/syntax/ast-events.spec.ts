import { describe, expect, it } from 'vitest';

import {
  writtenPass,
  type HandlerDeclaration,
  type HookDeclaration,
  type PassDeclaration,
} from './ast-events.js';
import type { KindDeclaration } from './ast.js';
import { Diagnostics } from '../source/diagnostics.js';
import { unspanned } from '../source/nodes.js';
import { parseDeclarations } from './parse.js';
import { SourceFile, textOf } from '../source/source.js';

const KIND = `kind Case {
  contains
  pass :illuminating (true)
  pass any (self.get(:open))
  on :gust (from, _) { }
  changed :lit (was) { }
}`;

function members(): KindDeclaration['members'] {
  const diagnostics = new Diagnostics();
  const [kind] = parseDeclarations(new SourceFile('k.sprout', KIND), diagnostics);
  expect(diagnostics.all).toEqual([]);
  return (kind as KindDeclaration).members;
}

describe('the nodes of handlers, hooks and pass rules keep the rule every node keeps', () => {
  it('spans every node', () => {
    expect(unspanned(members())).toEqual([]);
  });

  it('keeps a parameter left unnamed as null', () => {
    const on = members().find((m): m is HandlerDeclaration => m.kind === 'handler')!;
    expect(on.message.text).toBe('gust');
    expect(on.parameters.map((p) => p?.text ?? null)).toEqual(['from', null]);
    const changed = members().find((m): m is HookDeclaration => m.kind === 'hook')!;
    expect(changed.property.text).toBe('lit');
  });
});

describe('writtenPass', () => {
  const passes = () => members().filter((m): m is PassDeclaration => m.kind === 'pass');

  it('writes a pass rule for one message as `pass :m`', () => {
    const [one] = passes();
    expect(writtenPass(one!)).toBe('pass :illuminating');
    expect(textOf(one!.rule.at)).toBe('true');
  });

  it('writes the rule for every other message as `pass any`', () => {
    const [, any] = passes();
    expect(any!.message).toBeNull();
    expect(writtenPass(any!)).toBe('pass any');
  });
});
