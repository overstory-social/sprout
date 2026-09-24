import { describe, expect, it } from 'vitest';

import type {
  HandlerDeclaration,
  HookDeclaration,
  KindDeclaration,
  KindMember,
  WithoutDeclaration,
} from '../ast.js';
import { unspanned } from '../../source/nodes.js';
import { locationOf } from '../../source/source.js';
import { chooser, read } from '../../fixtures/parse.js';
import { WELL_FORMED_GUARDS } from '../../fixtures/recovery.js';
import { atMember, inKindBody, readWith, rest } from '../../fixtures/readers.js';
import { handler, hook } from './handlers.js';
import type { Parser } from './parser.js';
import { without } from './without.js';
import { worldMembers } from './world.js';

/**
 * The handlers and hooks `members` starts with, and the `without`s among
 * them, each read by its own reader in the body of `kind Lamp`; what they
 * left for the body's next member, and everything said.
 */
function readMembers(members: string) {
  const { p, diagnostics, startsMember } = inKindBody(members, 'Lamp');
  const read: (HandlerDeclaration | HookDeclaration | WithoutDeclaration)[] = [];
  for (;;) {
    const word = p.peek().kind === 'name' ? p.peek().text : '';
    const one =
      word === 'on'
        ? handler(p, 'Lamp', startsMember)
        : word === 'changed'
          ? hook(p, 'Lamp', startsMember)
          : word === 'without'
            ? without(p, startsMember)
            : undefined;
    if (one === undefined) break;
    if (one !== null) read.push(one);
  }
  return {
    members: read,
    rest: rest(p),
    said: diagnostics.refusals.map((d) => [locationOf(d.at), d.message, d.remedy]),
    messages: diagnostics.refusals.map((d) => d.message),
  };
}

const handlers = (members: readonly KindMember[]) =>
  members.filter((m): m is HandlerDeclaration => m.kind === 'handler');
const hooks = (members: readonly KindMember[]) =>
  members.filter((m): m is HookDeclaration => m.kind === 'hook');
const named = (parameters: HandlerDeclaration['parameters']) =>
  parameters.map((one) => (one === null ? '_' : one.text));

/** One member read on its own by `read`, with nothing around it. */
function alone<T>(text: string, read: (p: Parser) => T): { made: T; messages: string[] } {
  const { read: made, refusals } = readWith(read, text, { name: 'k.sprout', readers: new Map() });
  return { made, messages: refusals.map((d) => d.message) };
}

describe('a handler', () => {
  it('is read as the spec writes its four', () => {
    const { members, said, rest } = readMembers(
      [
        'on :illuminating (from, value) { self.set(:illuminated, value) }',
        'on :fired (from) { }',
        'on :gust { }',
        'on :pong (_, value) { }',
      ].join('\n  '),
    );
    expect(said).toEqual([]);
    expect(rest).toBe('}\n');
    expect(unspanned(members)).toEqual([]);
    expect(handlers(members).map((h) => [h.message.text, named(h.parameters)])).toEqual([
      ['illuminating', ['from', 'value']],
      ['fired', ['from']],
      ['gust', []],
      ['pong', ['_', 'value']],
    ]);
    expect(handlers(members)[0]!.body.statements.map((s) => s.kind)).toEqual([
      'expression-statement',
    ]);
  });

  it('is read by `handler` directly, spanning its word to its block', () => {
    const { made, messages } = alone('on :stir (from) { }', (p) => handler(p, 'Lamp', () => false));
    expect(messages).toEqual([]);
    expect(made?.at.start).toBe(0);
    expect(made?.at.end).toBe('on :stir (from) { }'.length);
  });

  it('refuses a message written without its colon, naming it with one', () => {
    const { said, members, rest } = readMembers('on stir { }\n  :lit false');
    expect(said).toEqual([
      [
        'k.sprout:2:6',
        '`on` names the message a handler answers, with its colon.',
        'Write `on :stir`, as in `on :stir { … }`.',
      ],
    ]);
    // The block after it is its own, and the property after that is left to the body.
    expect(members).toEqual([]);
    expect(rest).toBe(':lit false\n}\n');
  });

  it('refuses a handler with no block, and keeps the member after it', () => {
    const { said, members, rest } = readMembers('on :stir (from)\n  :lit false');
    expect(said).toEqual([
      ['k.sprout:2:18', 'What `on :stir` does goes in braces.', 'Write `on :stir { … }`.'],
    ]);
    expect(members).toEqual([]);
    expect(rest).toBe(':lit false\n}\n');
  });

  it('refuses empty brackets, a stray comma and a word of the language as a parameter', () => {
    expect(readMembers('on :stir () { }').messages).toEqual([
      '`on :stir` names its parameters in brackets, a comma between each.',
    ]);
    expect(readMembers('on :stir (from,) { }').messages).toEqual([
      '`on :stir` names its parameters in brackets, a comma between each.',
    ]);
    expect(readMembers('on :stir (from value) { }').messages).toEqual([
      '`on :stir` names its parameters in brackets, a comma between each.',
    ]);
    expect(readMembers('on :stir (if) { }').messages).toEqual([
      '`if` is a word of the language, so it cannot name a parameter.',
    ]);
  });

  it('lets `from` and `to` name a parameter, as the spec’s own handlers do', () => {
    const { members, messages } = readMembers('on :left (item, to) { }');
    expect(messages).toEqual([]);
    expect(named(handlers(members)[0]!.parameters)).toEqual(['item', 'to']);
  });

  it('refuses brackets never closed where the block starts', () => {
    const { said } = readMembers('on :stir (from { }');
    expect(said).toEqual([
      [
        'k.sprout:2:18',
        'The brackets after `on :stir` are never closed.',
        'Add a ) after its parameters, as in `on :pong (_, value) { … }`.',
      ],
    ]);
  });

  it('is written in a world’s body and an object’s', () => {
    // An object's body is read by the one table of members a kind's is, and the world's by its own.
    const text = 'object o is K { on :gust { } }';
    const object = atMember(text, text.indexOf('on'), 'o');
    expect(object.readers.get('on')!()).toMatchObject({ kind: 'handler' });
    const { p, diagnostics } = atMember('on :gust { }', 0);
    expect(worldMembers(p, 'w').get('on')!()).toMatchObject({ kind: 'handler' });
    expect([...object.diagnostics.refusals, ...diagnostics.refusals]).toEqual([]);
  });
});

describe('a hook', () => {
  it('is read with its previous value, or with none', () => {
    const { members, said } = readMembers('changed :lit (was) { }\n  changed :open { }');
    expect(said).toEqual([]);
    expect(hooks(members).map((h) => [h.property.text, named(h.parameters)])).toEqual([
      ['lit', ['was']],
      ['open', []],
    ]);
  });

  it('is read by `hook` directly', () => {
    const { made, messages } = alone('changed :lit { }', (p) => hook(p, 'Lamp', () => false));
    expect(messages).toEqual([]);
    expect(made?.property.text).toBe('lit');
  });

  it('refuses a property written without its colon', () => {
    expect(readMembers('changed lit { }').said).toEqual([
      [
        'k.sprout:2:11',
        '`changed` names the property a hook watches, with its colon.',
        'Write `changed :lit`, as in `changed :lit (was) { … }`.',
      ],
    ]);
  });

  it('is what `without` names when no block follows, and a member when one does', () => {
    const { members, messages, rest } = readMembers(
      'without changed :lit from Light\n  changed :lit { }\n  without on :stir from Bellows\n  on :stir { }',
    );
    expect(rest).toBe('}\n');
    expect(messages).toEqual([]);
    expect(members.map((m) => m.kind)).toEqual(['without', 'hook', 'without', 'handler']);
  });
});

// --- generated input -------------------------------------------------------
//
// The handler reader's share of the parser's recovery rule: over bodies of
// well-formed handlers, hooks and other members with one defective
// handler or hook among them, every well-formed member is kept whole, and
// nothing is said inside one because of its neighbour.

const WELL_FORMED = [
  { name: 'illuminating', text: 'on :illuminating (from, value) { self.set(:lit, value) }' },
  { name: 'gust', text: 'on :gust {\n    if (self.get(:lit)) { self.set(:lit, false) }\n  }' },
  { name: 'pong', text: 'on :pong (_, value) { }' },
  { name: 'lit', text: 'changed :lit (was) { if (was) { self.adjust(:n, 1) } }' },
];

const DEFECTS: readonly string[] = [
  'on',
  'on :stir',
  'on stir { }',
  'on :stir (',
  'on :stir () { }',
  'on :stir (from,) { }',
  'on :stir (From) { }',
  'on :stir (from value) { }',
  'on :stir (if) { }',
  'on :stir { refuse }',
  'on :stir { if () { } }',
  'on :stir { else { } }',
  'on :stir { %% }',
  'changed',
  'changed :lit (was',
  'changed lit { }',
  'changed :lit { if (a) allow }',
  'on { }',
];
const UNCLOSED = 'on :stir { if (a) { self.set(:lit, true) }';

const NEIGHBOURS = [
  ...WELL_FORMED,
  ...WELL_FORMED_GUARDS.map(({ names, text }) => ({ name: names[0], text })),
  { name: 'open', text: ':open true' },
  { name: 'passage', text: 'passage full { There is no room in {self}. }' },
  { name: 'contains', text: 'contains' },
  { name: 'pass', text: 'pass any (self.get(:open))' },
  { name: 'play', text: 'as target for pull { do { self.set(:open, true) } }' },
];

describe('a well-formed handler never vanishes, and never answers for its neighbour', () => {
  it('over generated bodies with one defective handler or hook among well-formed members', () => {
    const c = chooser(20_260_924);
    const reached = new Set<string>();
    for (let i = 0; i < 600; i++) {
      const members = c.shuffled(NEIGHBOURS).filter(() => c.below(3) !== 0);
      if (members.length === 0) continue;
      const unclosed = c.below(8) === 0;
      const defect = unclosed ? UNCLOSED : c.one(DEFECTS);
      // The unclosed handler takes the body's own `}` when it is last,
      // and then the body is never closed; that shape is the body's own.
      const at = unclosed ? c.below(members.length) : c.below(members.length + 1);
      const lines = members.map((member) => member.text);
      lines.splice(at, 0, defect);
      const text = `kind Lamp {\n  ${lines.join('\n  ')}\n}\n`;
      const { declarations, refusals } = read(text, 'g.sprout');
      const kind = declarations.find((d): d is KindDeclaration => d.kind === 'kind');
      expect(refusals.length, text).toBeGreaterThan(0);
      expect(kind, text).toBeDefined();

      for (const member of members) {
        const start = text.indexOf(member.text);
        const end = start + member.text.length;
        const kept = kind!.members.find((m) => m.at.start === start && m.at.end === end);
        expect(kept, `${text}\n  \`${member.name}\` vanished`).toBeDefined();
        if (kept?.kind === 'handler' || kept?.kind === 'hook') reached.add(`kept ${member.name}`);
        for (const d of refusals) {
          expect(d.at.start > start && d.at.start < end, `${text}\n  ${d.message}`).toBe(false);
        }
      }
      reached.add(unclosed ? 'unclosed' : 'contained');
    }
    expect([...reached].sort()).toEqual([
      'contained',
      'kept gust',
      'kept illuminating',
      'kept lit',
      'kept pong',
      'unclosed',
    ]);
  });
});
