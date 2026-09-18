import { describe, expect, it } from 'vitest';

import { MEDIA } from './fixtures/media.js';

import {
  ItemDefinition,
  RoomDefinition,
  SPROUT_MUTATING_STATEMENTS,
  SPROUT_WELL_KNOWN,
  sproutDefinitionIssues,
  sproutDefinitionProblems,
  sproutDefinitionWarnings,
  KindDefinition,
  resolveDefinition,
  kindAsItem,
  humaniseKind,
  wellKnownField,
  wellKnownFor,
  type ItemDefinition as Item2,
  type SproutExpr,
  type SproutStatement,
} from './index.js';

const lit = (value: boolean | number | string): SproutExpr => ({ kind: 'literal', value });
const self = (property: string): SproutExpr => ({
  kind: 'get',
  target: { kind: 'self' },
  property,
});
const eq = (left: SproutExpr, right: SproutExpr): SproutExpr => ({
  kind: 'binary',
  op: '==',
  left,
  right,
});

/** The torch from sprout.md §2.1, as the compiler will emit it. */
function torch(overrides: Partial<Item2> = {}): unknown {
  return {
    role: 'item',
    name: 'Torch',
    names: ['torch', 'brand'],
    prose: 'A pitch torch.',
    properties: [
      { type: 'boolean', name: 'on_fire', default: false },
      { type: 'boolean', name: 'illuminating', default: false },
      { type: 'boolean', name: 'takeable', default: true },
    ],
    describe: [
      {
        kind: 'if',
        cond: self('on_fire'),
        then: [{ kind: 'text', text: 'Burning steadily.' }],
        else: [{ kind: 'text', text: 'Cold. It wants a light.' }],
      },
    ],
    messages: [
      {
        name: 'use',
        args: [{ name: 'with', type: 'object' }],
        grammar: ['light [self] with [with]', 'use [with] on [self]'],
        when: null,
        abstract: false,
        body: [
          {
            kind: 'if',
            cond: { kind: 'get', target: { kind: 'name', name: 'with' }, property: 'on_fire' },
            then: [
              { kind: 'set', property: 'on_fire', value: lit(true) },
              { kind: 'set', property: 'illuminating', value: lit(true) },
              { kind: 'say', text: 'The pitch catches with a soft whump.' },
            ],
            else: [{ kind: 'say', text: 'Nothing about that will light a torch.' }],
          },
        ],
      },
    ],
    hooks: [
      {
        property: 'illuminating',
        value: 'value',
        was: null,
        body: [
          {
            kind: 'broadcast',
            message: 'illuminating',
            value: { kind: 'get', target: { kind: 'name', name: 'value' }, property: 'x' },
          },
        ],
      },
    ],
    ...overrides,
  };
}

describe('the AST', () => {
  it('parses the torch, filling the defaults', () => {
    const def = ItemDefinition.parse(torch());
    expect(def.inherit).toBeNull();
    expect(def.remembers).toEqual([]);
    expect(def.consents).toEqual([]);
    expect(sproutDefinitionProblems(def)).toEqual([]);
  });

  it('parses a room with exits and a consent guard', () => {
    const def = RoomDefinition.parse({
      role: 'room',
      name: 'Glaze cupboard',
      prose: 'Chalk, ash, a little metal.',
      exits: [{ label: 'out', toRoomId: 'r1' }],
      properties: [{ type: 'boolean', name: 'locked', default: true }],
      consents: [
        {
          guard: 'accept',
          params: ['item', 'from'],
          body: [
            {
              kind: 'if',
              cond: {
                kind: 'binary',
                op: '&&',
                left: { kind: 'is', target: { kind: 'name', name: 'item' }, kindName: 'Actor' },
                right: self('locked'),
              },
              then: [{ kind: 'refuse', text: 'The cupboard door is locked.' }],
              else: [{ kind: 'allow' }],
            },
          ],
        },
      ],
      passRules: [{ message: null, condition: lit(true) }],
    });
    expect(def.role).toBe('room');
    expect(sproutDefinitionProblems(def)).toEqual([]);
  });

  it('scopes the well-known properties by what an object is', () => {
    expect([...wellKnownFor({ role: 'room', inherit: null }).keys()]).toEqual([
      'illuminated',
      'open',
      'capacity',
    ]);
    expect([...wellKnownFor({ role: 'item', inherit: null }).keys()]).toEqual([
      'takeable',
      'hidden',
      'scenery',
    ]);
    expect(wellKnownFor({ role: 'item', inherit: 'Container' }).has('capacity')).toBe(true);
    // An extension's well-known properties join the table where they apply (§3.5): `:image` from media.
    expect([...wellKnownFor({ role: 'room', inherit: null }, MEDIA).keys()]).toEqual([
      'illuminated',
      'open',
      'capacity',
      'image',
    ]);
    expect(wellKnownFor({ role: 'item', inherit: null }, MEDIA).get('image')).toEqual({
      type: 'media',
      name: 'image',
      default: null,
    });
  });

  it('knows the well-known properties and their types', () => {
    expect(wellKnownField('takeable')).toEqual({
      type: 'boolean',
      name: 'takeable',
      default: false,
    });
    expect(wellKnownField('capacity')?.type).toBe('integer');
    expect(wellKnownField('toString')).toBeUndefined();
    expect(Object.keys(SPROUT_WELL_KNOWN)).toContain('illuminated');
  });

  it('insists kinds are capitalised', () => {
    expect(ItemDefinition.safeParse(torch({ inherit: 'container' })).success).toBe(false);
    expect(ItemDefinition.safeParse(torch({ inherit: 'Container' })).success).toBe(true);
  });
});

describe('what the compiler refuses without a parser', () => {
  const problemsOf = (overrides: Partial<Item2>): string[] => {
    const parsed = ItemDefinition.safeParse(torch(overrides));
    return parsed.success ? [] : parsed.error.issues.map((i) => i.message);
  };

  it('refuses a write to an undeclared property, and adjust on a boolean', () => {
    expect(
      problemsOf({
        messages: [
          {
            name: 'poke',
            args: [],
            grammar: [],
            when: null,
            abstract: false,
            body: [
              { kind: 'set', property: 'warmth', value: lit(1) },
              { kind: 'adjust', property: 'on_fire', by: lit(1) },
              { kind: 'set', property: 'on_fire', value: lit(3) },
            ],
          },
        ],
      }),
    ).toEqual([
      'Message "poke": "set" names a property "warmth" that self does not declare.',
      'Message "poke": "adjust" only moves integer properties; "on_fire" is boolean.',
      'Message "poke": that is not a value of "on_fire".',
    ]);
  });

  it('lets a well-known property be set undeclared, but not redeclared with another type', () => {
    expect(
      problemsOf({
        messages: [
          {
            name: 'hide',
            args: [],
            grammar: [],
            when: null,
            abstract: false,
            body: [{ kind: 'set', property: 'hidden', value: lit(true) }],
          },
        ],
      }),
    ).toEqual([]);
    expect(
      problemsOf({
        properties: [
          { type: 'boolean', name: 'on_fire', default: false },
          { type: 'boolean', name: 'illuminating', default: false },
          { type: 'integer', name: 'takeable', default: 1, min: 0, max: 2 },
        ],
      }),
    ).toEqual(['"takeable" is a well-known boolean property; it cannot be declared as integer.']);
    // `:open` applies to containers; on a plain item the name is its own.
    expect(
      problemsOf({
        properties: [
          { type: 'boolean', name: 'on_fire', default: false },
          { type: 'boolean', name: 'illuminating', default: false },
          { type: 'enum', name: 'open', default: 'lid', options: ['lid', 'tap'] },
        ],
      }),
    ).toEqual([]);
    expect(
      problemsOf({
        inherit: 'Container',
        properties: [
          { type: 'boolean', name: 'on_fire', default: false },
          { type: 'boolean', name: 'illuminating', default: false },
          { type: 'enum', name: 'open', default: 'lid', options: ['lid', 'tap'] },
        ],
      }),
    ).toEqual(['"open" is a well-known boolean property; it cannot be declared as enum.']);
  });

  it('refuses abstract messages on anything placed', () => {
    expect(
      problemsOf({
        messages: [{ name: 'use', args: [], grammar: [], when: null, abstract: true, body: [] }],
      }),
    ).toEqual([
      'Message "use" is abstract, and abstract messages belong on kinds, not on something placed in a room.',
    ]);
  });

  it('refuses writes, and anything but tests, inside a consent guard', () => {
    expect(
      problemsOf({
        consents: [
          {
            guard: 'depart',
            params: ['to'],
            body: [
              { kind: 'set', property: 'on_fire', value: lit(true) },
              { kind: 'say', text: 'ouch' },
              { kind: 'allow' },
            ],
          },
        ],
      }),
    ).toEqual([
      'Depart guard: a consent guard may only test, allow or refuse — "set" is not allowed there.',
      'Depart guard: a consent guard may only test, allow or refuse — "say" is not allowed there.',
    ]);
  });

  it('keeps allow / refuse out of verbs, text out of verbs, say out of describe', () => {
    expect(
      problemsOf({
        describe: [{ kind: 'say', text: 'no' }],
        messages: [
          {
            name: 'poke',
            args: [],
            grammar: [],
            when: null,
            abstract: false,
            body: [{ kind: 'allow' }, { kind: 'text', text: 'no' }],
          },
        ],
      }),
    ).toEqual([
      'Describe: "say" does not belong in describe — use "text".',
      'Message "poke": "allow" belongs in a depart / release / accept guard.',
      'Message "poke": "text" only belongs in describe — use "say".',
    ]);
  });

  it('§2.12 (#441): describe reads and never writes — every mutating statement is refused there, however nested', () => {
    const refused = (kind: string) =>
      `Describe: "${kind}" changes the world, and describe only reads it — put it in a message or a handler.`;
    expect(
      problemsOf({
        describe: [
          { kind: 'set', property: 'on_fire', value: lit(true) },
          { kind: 'adjust', property: 'on_fire', by: lit(1) },
          { kind: 'remember', property: 'seen', value: lit(true) },
          { kind: 'broadcast', message: 'looked', value: null },
          { kind: 'send', target: { kind: 'room' }, message: 'looked', value: null },
          { kind: 'move', what: { kind: 'self' }, to: { kind: 'actor' } },
          { kind: 'spawn', kindName: 'Lump', in: { kind: 'room' } },
          {
            kind: 'if',
            cond: lit(true),
            then: [{ kind: 'destroy' }],
            else: [
              {
                kind: 'each',
                variable: 'x',
                in: { kind: 'room' },
                body: [
                  { kind: 'send', target: { kind: 'name', name: 'x' }, message: 'hi', value: null },
                ],
              },
            ],
          },
          // what describe may do
          { kind: 'text', text: 'A torch.' },
          {
            kind: 'each',
            variable: 'y',
            in: { kind: 'room' },
            body: [{ kind: 'text', text: 'x' }],
          },
        ],
      }),
    ).toEqual([
      refused('set'),
      refused('adjust'),
      refused('remember'),
      refused('broadcast'),
      refused('send'),
      refused('move'),
      refused('spawn'),
      refused('destroy'),
      refused('send'),
    ]);
    // The set the compiler and the engine share is exactly what is refused above.
    expect([...SPROUT_MUTATING_STATEMENTS].sort()).toEqual(
      ['adjust', 'broadcast', 'destroy', 'move', 'remember', 'send', 'set', 'spawn'].sort(),
    );
  });

  it('§3.5: an extension statement is refused where its spec says — a consent guard always, describe unless marked', () => {
    const show = (where: string) => ({
      kind: 'ext' as const,
      extension: 'media',
      statement: where,
      args: {},
    });
    // `torch()` is the raw shape a saver receives; zod fills the empty lists, so fill them here.
    const filled = (overrides: Partial<Item2>, uses: string[]): Item2 => {
      const base = torch(overrides) as Partial<Item2>;
      return {
        remembers: [],
        describe: [],
        messages: [],
        handlers: [],
        hooks: [],
        passRules: [],
        consents: [],
        ...base,
        inherit: null,
        uses,
      } as Item2;
    };
    const withExt = (overrides: Partial<Item2>): string[] =>
      sproutDefinitionProblems(filled(overrides, ['media']), { ext: MEDIA });
    expect(withExt({ describe: [show('show'), { kind: 'text', text: 'x' }] })).toEqual([]);
    expect(
      withExt({
        consents: [{ guard: 'depart', params: ['to'], body: [show('show'), { kind: 'allow' }] }],
      }),
    ).toEqual([
      'Depart guard: "show" is not allowed in a consent guard — a refusal must leave the world as it was.',
    ]);
    // Not `use`d: refused before anything else is asked.
    expect(
      sproutDefinitionProblems(filled({ describe: [show('show')] }, []), { ext: MEDIA }),
    ).toEqual(['Describe: "show" belongs to the "media" extension — add `use media` at the top.']);
    // An extension the host lacks.
    expect(sproutDefinitionProblems(filled({}, ['pictures']), { ext: MEDIA })).toEqual([
      'This host has no extension called "pictures".',
    ]);
  });

  it('refuses pass rules and release / accept guards off a container', () => {
    expect(
      problemsOf({
        passRules: [{ message: 'noisy', condition: lit(true) }],
        consents: [{ guard: 'release', params: ['item', 'to'], body: [{ kind: 'allow' }] }],
      }),
    ).toEqual([
      'Only a container (a room, or a kind that inherits Container) can have pass rules.',
      'Release guard: only a container can release things.',
    ]);
    expect(
      problemsOf({
        inherit: 'Container',
        passRules: [{ message: 'noisy', condition: lit(true) }],
        consents: [{ guard: 'release', params: ['item', 'to'], body: [{ kind: 'allow' }] }],
      }),
    ).toEqual([]);
  });

  it('refuses a grammar slot that is not an argument', () => {
    expect(
      problemsOf({
        messages: [
          {
            name: 'use',
            args: [{ name: 'with', type: 'object' }],
            grammar: ['light [self] with [flint]'],
            when: null,
            abstract: false,
            body: [],
          },
        ],
      }),
    ).toEqual([
      'Message "use": the grammar line "light [self] with [flint]" names [flint], which is not an argument.',
    ]);
  });

  it("refuses behaviour on an instance of a kind; the kind itself is the saver's to check (#341)", () => {
    expect(problemsOf({ inherit: 'Torch', hooks: [] })).toEqual([
      'An instance of a kind may set its properties, names and describe — not behaviour. Write the kind.',
    ]);
    expect(problemsOf({ inherit: 'Torch', messages: [], hooks: [] })).toEqual([]);
    expect(
      sproutDefinitionProblems(
        ItemDefinition.parse(torch({ inherit: 'Torch', messages: [], hooks: [] })),
        { zoneKinds: new Map() },
      ),
    ).toEqual(['No kind called "Torch" is defined here.']);
    expect(problemsOf({ inherit: 'Actor' })).toContain('Nothing may inherit Actor.');
    expect(problemsOf({ inherit: 'Room' })).toContain('Only a room is a Room.');
  });

  it('a kind may hold abstract messages and inherit another kind; it may not inherit itself', () => {
    const usable = KindDefinition.parse({
      role: 'kind',
      kindName: 'Usable',
      name: 'Usable',
      prose: '',
      properties: [{ type: 'boolean', name: 'takeable', default: true }],
      messages: [
        {
          name: 'use',
          args: [{ name: 'with', type: 'object' }],
          grammar: [],
          when: null,
          abstract: true,
          body: [],
        },
      ],
    });
    expect(sproutDefinitionProblems(usable)).toEqual([]);
    expect(
      KindDefinition.safeParse({ ...usable, inherit: 'Usable' }).error?.issues.map(
        (i) => i.message,
      ),
    ).toEqual(['"Usable" cannot inherit itself.']);
  });

  it('refuses a hook on a property self does not have, and a duplicate each variable', () => {
    expect(
      problemsOf({
        hooks: [{ property: 'warmth', value: null, was: null, body: [] }],
        messages: [
          {
            name: 'sweep',
            args: [{ name: 'with', type: 'object' }],
            grammar: [],
            when: null,
            abstract: false,
            body: [{ kind: 'each', variable: 'with', in: { kind: 'room' }, body: [] }],
          },
        ],
      }),
    ).toEqual([
      'Message "sweep": "with" is already bound.',
      'Changed "warmth": self does not declare a property "warmth".',
    ]);
  });

  it('refuses a consent guard handled as a message, and a guard with too many parameters', () => {
    expect(
      problemsOf({
        handlers: [{ message: 'accept', from: null, value: null, body: [] }],
        consents: [{ guard: 'depart', params: ['a', 'b'], body: [{ kind: 'allow' }] }],
      }),
    ).toEqual([
      'On "accept": "accept" is a consent guard, not a message to handle.',
      'Depart guard takes 1 parameter.',
    ]);
  });

  it('counts an else-if chain as one level', () => {
    let body: SproutStatement[] = [{ kind: 'say', text: 'end' }];
    for (let i = 0; i < 15; i++) {
      body = [{ kind: 'if', cond: lit(true), then: [{ kind: 'say', text: 'x' }], else: body }];
    }
    expect(
      problemsOf({
        messages: [{ name: 'chain', args: [], grammar: [], when: null, abstract: false, body }],
      }),
    ).toEqual([]);
  });

  it('refuses a body that nests too deep', () => {
    let body: SproutStatement[] = [{ kind: 'say', text: 'deep' }];
    for (let i = 0; i < 9; i++) body = [{ kind: 'if', cond: lit(true), then: body, else: [] }];
    expect(
      problemsOf({
        messages: [{ name: 'dig', args: [], grammar: [], when: null, abstract: false, body }],
      }),
    ).toEqual(['Message "dig": nests too deep (8 at most).']);
  });
});

describe('issues carry a level (§3.2)', () => {
  it('marks the describe-writes and well-known-type refusals as level-1 policy, everything else structural', () => {
    // Raw, not parsed: the schema's own refine would refuse this before the levels could be read.
    const issues = sproutDefinitionIssues({
      role: 'item',
      name: 'x',
      names: [],
      prose: '',
      inherit: null,
      uses: [],
      properties: [{ type: 'integer', name: 'takeable', default: 0, min: 0, max: 1 }],
      remembers: [],
      describe: [],
      messages: [
        {
          name: 'poke',
          args: [],
          grammar: [],
          when: null,
          abstract: false,
          body: [{ kind: 'set', property: 'nope', value: lit(1) }],
        },
      ],
      handlers: [],
      hooks: [],
      passRules: [],
      consents: [],
    });
    expect(issues.map((i) => [i.level, i.message.slice(0, 30)])).toEqual([
      [1, '"takeable" is a well-known boo'],
      [null, 'Message "poke": "set" names a '],
    ]);
  });
});

describe('warnings', () => {
  it('warns about a hook nothing sets and a handler nothing sends', () => {
    const def = ItemDefinition.parse(
      torch({
        hooks: [{ property: 'on_fire', value: null, was: null, body: [] }],
        handlers: [
          { message: 'noisy', from: null, value: null, body: [] },
          { message: 'entered', from: null, value: null, body: [] },
        ],
      }),
    );
    expect(sproutDefinitionWarnings(def)).toEqual([
      'On "noisy" never fires: nothing sends it here.',
    ]);
    expect(sproutDefinitionWarnings(def, ['noisy'])).toEqual([]);
    const cold = ItemDefinition.parse(torch({ messages: [] }));
    expect(sproutDefinitionWarnings(cold)).toEqual([
      'Changed "illuminating" never fires: nothing here sets it.',
    ]);
  });
});

describe('kinds resolved into a definition (#341)', () => {
  const kind = (source: Record<string, unknown>) =>
    KindDefinition.parse({ format: 2, role: 'kind', prose: '', properties: [], ...source });
  const usable = kind({
    kindName: 'Usable',
    name: 'Usable',
    inherit: 'Container',
    properties: [{ type: 'boolean', name: 'takeable', default: true }],
    messages: [
      {
        name: 'use',
        args: [{ name: 'with', type: 'object' }],
        grammar: [],
        when: null,
        abstract: true,
        body: [],
      },
      {
        name: 'poke',
        args: [],
        grammar: ['poke [self]'],
        when: null,
        abstract: false,
        body: [{ kind: 'say', text: 'ow' }],
      },
    ],
    names: ['thing'],
  });
  const torchKind = kind({
    kindName: 'Torch',
    name: 'Torch',
    inherit: 'Usable',
    properties: [
      { type: 'boolean', name: 'takeable', default: false },
      { type: 'boolean', name: 'on_fire', default: false },
    ],
    messages: [
      {
        name: 'use',
        args: [{ name: 'with', type: 'object' }],
        grammar: [],
        when: null,
        abstract: false,
        body: [{ kind: 'say', text: 'whump' }],
      },
    ],
    describe: [{ kind: 'text', text: 'A torch.' }],
  });
  const kinds = new Map([
    ['Usable', usable],
    ['Torch', torchKind],
  ]);

  it('folds the chain parents-first, child overriding by name; the root is the built-in', () => {
    const placed = ItemDefinition.parse(
      torch({
        inherit: 'Torch',
        messages: [],
        hooks: [],
        properties: [{ type: 'boolean', name: 'on_fire', default: true }],
        names: [],
        describe: [],
      }),
    );
    const r = resolveDefinition(placed, kinds);
    expect(r.kinds).toEqual(['Torch', 'Usable']);
    expect(r.abstract).toEqual([]);
    expect(r.definition.inherit).toBe('Container');
    expect(r.definition.properties).toEqual([
      { type: 'boolean', name: 'takeable', default: false },
      { type: 'boolean', name: 'on_fire', default: true },
    ]);
    expect(r.definition.messages.map((m) => [m.name, m.abstract])).toEqual([
      ['use', false],
      ['poke', false],
    ]);
    expect(r.definition.names).toEqual(['thing']);
    expect(r.definition.describe).toEqual([{ kind: 'text', text: 'A torch.' }]);
  });

  it('an instance of the abstract kind keeps the abstract message on the list', () => {
    const placed = ItemDefinition.parse(torch({ inherit: 'Usable', messages: [], hooks: [] }));
    expect(resolveDefinition(placed, kinds).abstract).toEqual(['use']);
  });

  it('an unknown kind, or a cycle, stops the chain with no root', () => {
    const placed = ItemDefinition.parse(torch({ inherit: 'Ghost', messages: [], hooks: [] }));
    expect(resolveDefinition(placed, kinds)).toMatchObject({
      kinds: [],
      definition: { inherit: null },
    });
    const a = kind({ kindName: 'A', name: 'A', inherit: 'B' });
    const b = kind({ kindName: 'B', name: 'B', inherit: 'A' });
    const loop = new Map([
      ['A', a],
      ['B', b],
    ]);
    expect(
      resolveDefinition(
        ItemDefinition.parse(torch({ inherit: 'A', messages: [], hooks: [] })),
        loop,
      ).kinds,
    ).toEqual(['A', 'B']);
  });

  it('a spawned instance is the kind as an item, resolved', () => {
    const r = kindAsItem(torchKind, kinds);
    expect(r.definition).toMatchObject({ role: 'item', name: 'Torch', inherit: 'Container' });
    expect(r.kinds).toEqual(['Torch', 'Usable']);
    expect(humaniseKind('WetCup')).toBe('Wet cup');
    expect(humaniseKind('Cup')).toBe('Cup');
  });
});
