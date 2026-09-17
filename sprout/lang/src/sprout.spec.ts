import { describe, expect, it } from 'vitest';

import {
  ItemDefinition,
  ItemDefinition2,
  RoomDefinition,
  RoomDefinition2,
  SPROUT_MUTATING_STATEMENTS,
  SPROUT_WELL_KNOWN,
  messageIdent,
  sproutDefinitionProblems,
  sproutDefinitionWarnings,
  upgradeSproutDefinition,
  KindDefinition,
  resolveDefinition,
  kindAsItem,
  humaniseKind,
  wellKnownField,
  wellKnownFor,
  type ItemDefinition2 as Item2,
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
    format: 2,
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

describe('format 2: the AST', () => {
  it('parses the torch, filling the defaults', () => {
    const def = ItemDefinition2.parse(torch());
    expect(def.inherit).toBeNull();
    expect(def.source).toBeNull();
    expect(def.remembers).toEqual([]);
    expect(def.consents).toEqual([]);
    expect(sproutDefinitionProblems(def)).toEqual([]);
  });

  it('parses a room with exits and a consent guard', () => {
    const def = RoomDefinition2.parse({
      format: 2,
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
      'image',
    ]);
    expect([...wellKnownFor({ role: 'item', inherit: null }).keys()]).toEqual([
      'takeable',
      'hidden',
      'scenery',
      'image',
    ]);
    expect(wellKnownFor({ role: 'item', inherit: 'Container' }).has('capacity')).toBe(true);
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
    expect(ItemDefinition2.safeParse(torch({ inherit: 'container' })).success).toBe(false);
    expect(ItemDefinition2.safeParse(torch({ inherit: 'Container' })).success).toBe(true);
  });
});

describe('format 2: what the compiler refuses without a parser', () => {
  const problemsOf = (overrides: Partial<Item2>): string[] => {
    const parsed = ItemDefinition2.safeParse(torch(overrides));
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
          { kind: 'show', target: null, property: null },
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
        ItemDefinition2.parse(torch({ inherit: 'Torch', messages: [], hooks: [] })),
        { zoneKinds: new Map() },
      ),
    ).toEqual(['No kind called "Torch" is defined here.']);
    expect(problemsOf({ inherit: 'Actor' })).toContain('Nothing may inherit Actor.');
    expect(problemsOf({ inherit: 'Room' })).toContain('Only a room is a Room.');
  });

  it('a kind may hold abstract messages and inherit another kind; it may not inherit itself', () => {
    const usable = KindDefinition.parse({
      format: 2,
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

describe('format 2: warnings', () => {
  it('warns about a hook nothing sets and a handler nothing sends', () => {
    const def = ItemDefinition2.parse(
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
    const cold = ItemDefinition2.parse(torch({ messages: [] }));
    expect(sproutDefinitionWarnings(cold)).toEqual([
      'Changed "illuminating" never fires: nothing here sets it.',
    ]);
  });
});

describe('the upgrade from format 1', () => {
  const v0Item = ItemDefinition.parse({
    format: 1,
    name: 'Kick wheel',
    prose: 'A kick wheel, the head scraped clean.',
    portable: false,
    fields: [
      { type: 'enum', name: 'stage', options: ['bare', 'centred', 'cup'], default: 'bare' },
      { type: 'integer', name: 'spins', default: 0, min: 0, max: 99 },
    ],
    visitorFields: [{ type: 'integer', name: 'thrown', default: 0, min: 0, max: 99 }],
    views: [
      {
        guard: { kind: 'field', on: 'self', field: 'stage', op: 'eq', value: 'cup' },
        prose: 'A cup rises.',
      },
      {
        guard: { kind: 'field', on: 'self', field: 'stage', op: 'in', value: ['centred'] },
        prose: 'A lump sits centred.',
      },
    ],
    verbs: [
      {
        name: 'Kick the wheel',
        guard: {
          kind: 'all',
          guards: [
            { kind: 'field', on: 'self', field: 'stage', op: 'neq', value: 'cup' },
            {
              kind: 'not',
              guard: { kind: 'field', on: 'visitor', field: 'thrown', op: 'gt', value: 3 },
            },
          ],
        },
        effects: [
          { op: 'adjust', field: 'spins', by: 1 },
          { op: 'set', field: 'stage', value: 'centred' },
          { op: 'set_visitor', field: 'thrown', value: 1 },
          { op: 'say', text: 'It hums.' },
          { op: 'send_message', to: 'room', item: null, message: 'wheel_on' },
          { op: 'send_message', to: 'items', item: null, message: 'humming' },
          { op: 'send_message', to: 'item', item: 'Slop bucket', message: 'splash' },
          {
            op: 'branch',
            guard: {
              kind: 'any',
              guards: [{ kind: 'field', on: 'self', field: 'spins', op: 'gte', value: 5 }],
            },
            then: [{ op: 'say', text: 'Fast now.' }],
            otherwise: [],
          },
        ],
      },
      { name: 'Kick the wheel!', guard: null, effects: [] },
    ],
    handlers: [
      {
        message: 'fired',
        guard: { kind: 'field', on: 'self', field: 'stage', op: 'eq', value: 'cup' },
        effects: [{ op: 'set', field: 'stage', value: 'bare' }],
      },
      { message: 'swept', guard: null, effects: [{ op: 'set', field: 'stage', value: 'bare' }] },
    ],
  });

  it('turns a v0 item into a v2 one with zero problems, keeping name and prose', () => {
    const up = upgradeSproutDefinition(v0Item);
    expect(up.format).toBe(2);
    expect(up.role).toBe('item');
    expect(up.name).toBe('Kick wheel');
    expect(up.prose).toBe(v0Item.prose);
    expect(up.inherit).toBeNull();
    expect(up.source).toBeNull();
    expect(sproutDefinitionProblems(up)).toEqual([]);
    expect(ItemDefinition2.safeParse(up).success).toBe(true);
  });

  it('is the identity on a v2 definition', () => {
    const up = upgradeSproutDefinition(v0Item);
    expect(upgradeSproutDefinition(up)).toBe(up);
  });

  it('declares portable as :takeable and keeps the fields as properties', () => {
    const up = upgradeSproutDefinition(v0Item);
    expect(up.properties.map((p) => p.name)).toEqual(['stage', 'spins', 'takeable']);
    expect(up.properties[2]).toEqual({ type: 'boolean', name: 'takeable', default: false });
    expect(up.remembers).toEqual(v0Item.visitorFields);
    const declared = upgradeSproutDefinition(
      ItemDefinition.parse({
        format: 1,
        name: 'x',
        prose: '',
        portable: true,
        fields: [{ type: 'boolean', name: 'takeable', default: false }],
      }),
    );
    expect(declared.properties).toHaveLength(1);
  });

  it('turns views into a describe if-chain ending in the plain prose', () => {
    const up = upgradeSproutDefinition(v0Item);
    expect(up.describe).toEqual([
      {
        kind: 'if',
        cond: eq(self('stage'), lit('cup')),
        then: [{ kind: 'text', text: 'A cup rises.' }],
        else: [
          {
            kind: 'if',
            cond: eq(self('stage'), lit('centred')),
            then: [{ kind: 'text', text: 'A lump sits centred.' }],
            else: [{ kind: 'text', text: v0Item.prose }],
          },
        ],
      },
    ]);
  });

  it('stops the chain at an unguarded view, and leaves describe empty with no views', () => {
    const plain = upgradeSproutDefinition(
      ItemDefinition.parse({
        format: 1,
        name: 'x',
        prose: 'plain',
        views: [
          { guard: null, prose: 'always' },
          {
            guard: { kind: 'field', on: 'self', field: 'a', op: 'eq', value: 1 },
            prose: 'never reached',
          },
        ],
        fields: [{ type: 'integer', name: 'a', default: 0, min: 0, max: 1 }],
      }),
    );
    expect(plain.describe).toEqual([{ kind: 'text', text: 'always' }]);
    const none = upgradeSproutDefinition(
      ItemDefinition.parse({ format: 1, name: 'x', prose: 'p' }),
    );
    expect(none.describe).toEqual([]);
  });

  it('turns verbs into messages offered when their guard passes, with the label as grammar', () => {
    const up = upgradeSproutDefinition(v0Item);
    const [kick, kick2] = up.messages;
    expect(kick!.name).toBe('kick_the_wheel');
    expect(kick!.grammar).toEqual(['Kick the wheel']);
    expect(kick!.args).toEqual([]);
    expect(kick!.when).toEqual({
      kind: 'binary',
      op: '&&',
      left: { kind: 'binary', op: '!=', left: self('stage'), right: lit('cup') },
      right: {
        kind: 'not',
        expr: {
          kind: 'binary',
          op: '>',
          left: { kind: 'recall', property: 'thrown' },
          right: lit(3),
        },
      },
    });
    expect(kick2!.name).toBe('kick_the_wheel_2');
    expect(kick2!.when).toBeNull();
  });

  it('turns every effect into its statement', () => {
    const body = upgradeSproutDefinition(v0Item).messages[0]!.body;
    expect(body).toEqual([
      { kind: 'adjust', property: 'spins', by: lit(1) },
      { kind: 'set', property: 'stage', value: lit('centred') },
      { kind: 'remember', property: 'thrown', value: lit(1) },
      { kind: 'say', text: 'It hums.' },
      { kind: 'send', target: { kind: 'room' }, message: 'wheel_on', value: null },
      { kind: 'broadcast', message: 'humming', value: null },
      {
        kind: 'send',
        target: { kind: 'name', name: 'slop_bucket' },
        message: 'splash',
        value: null,
      },
      {
        kind: 'if',
        cond: { kind: 'binary', op: '>=', left: self('spins'), right: lit(5) },
        then: [{ kind: 'say', text: 'Fast now.' }],
        else: [],
      },
    ]);
  });

  it('turns an "in" guard into an or-chain', () => {
    const up = upgradeSproutDefinition(
      ItemDefinition.parse({
        format: 1,
        name: 'x',
        prose: '',
        fields: [{ type: 'enum', name: 's', options: ['a', 'b', 'c'], default: 'a' }],
        views: [
          {
            guard: { kind: 'field', on: 'self', field: 's', op: 'in', value: ['a', 'b'] },
            prose: 'ab',
          },
        ],
      }),
    );
    const cond = (up.describe[0] as Extract<SproutStatement, { kind: 'if' }>).cond;
    expect(cond).toEqual({
      kind: 'binary',
      op: '||',
      left: eq(self('s'), lit('a')),
      right: eq(self('s'), lit('b')),
    });
  });

  it('turns handlers into on-handlers, guarded by an if when they had a guard', () => {
    const [fired, swept] = upgradeSproutDefinition(v0Item).handlers;
    expect(fired).toEqual({
      message: 'fired',
      from: null,
      value: null,
      body: [
        {
          kind: 'if',
          cond: eq(self('stage'), lit('cup')),
          then: [{ kind: 'set', property: 'stage', value: lit('bare') }],
          else: [],
        },
      ],
    });
    expect(swept!.body).toEqual([{ kind: 'set', property: 'stage', value: lit('bare') }]);
  });

  it('keeps a room a room, with its exits', () => {
    const room = upgradeSproutDefinition(
      RoomDefinition.parse({
        format: 1,
        name: 'Shed',
        prose: 'A shed.',
        exits: [{ label: 'out', toRoomId: 'yard' }],
      }),
    );
    expect(room.role).toBe('room');
    expect('exits' in room && room.exits).toEqual([{ label: 'out', toRoomId: 'yard' }]);
    expect('takeable' in room.properties.map((p) => p.name)).toBe(false);
    expect(RoomDefinition2.safeParse(room).success).toBe(true);
  });

  it('makes identifiers of labels', () => {
    expect(messageIdent('Kick the wheel')).toBe('kick_the_wheel');
    expect(messageIdent('  Wire it off!  ')).toBe('wire_it_off');
    expect(messageIdent('3 pulls')).toBe('n3_pulls');
    expect(messageIdent('???')).toBe('it');
    expect(messageIdent('a'.repeat(40))).toHaveLength(32);
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
    const placed = ItemDefinition2.parse(
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
    const placed = ItemDefinition2.parse(torch({ inherit: 'Usable', messages: [], hooks: [] }));
    expect(resolveDefinition(placed, kinds).abstract).toEqual(['use']);
  });

  it('an unknown kind, or a cycle, stops the chain with no root', () => {
    const placed = ItemDefinition2.parse(torch({ inherit: 'Ghost', messages: [], hooks: [] }));
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
        ItemDefinition2.parse(torch({ inherit: 'A', messages: [], hooks: [] })),
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
