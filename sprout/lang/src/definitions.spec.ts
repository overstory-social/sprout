import { describe, expect, it } from 'vitest';

import {
  ItemDefinition,
  RoomDefinition,
  SproutGuard,
  UNDERSTORY_DEFINITION_BYTES_MAX,
  UNDERSTORY_NODE_DEPTH_MAX,
  sproutProblems,
  type SproutBehaviour,
  type SproutEffect,
} from './definitions.js';

/** A definition as the boundary would hand it on, defaults filled — NOT validated. */
const raw = (def: Partial<SproutBehaviour> & { name: string }) =>
  ({
    fields: [],
    visitorFields: [],
    views: [],
    verbs: [],
    handlers: [],
    ...def,
  }) as SproutBehaviour & { name: string };

// The Sprout AST (#259, understory.md §3.2 / §10.2): structure, never
// text; validated against the object's OWN declared fields at save time,
// so a definition that names a field it did not declare is refused at
// the boundary and never reaches the evaluator.

const LANTERN = {
  format: 1 as const,
  name: 'Brass lantern',
  prose: 'A brass lantern, dark.',
  fields: [
    { type: 'boolean' as const, name: 'lit', default: false },
    { type: 'integer' as const, name: 'fuel', default: 3, min: 0, max: 10 },
    { type: 'enum' as const, name: 'colour', options: ['amber', 'blue'], default: 'amber' },
  ],
  visitorFields: [{ type: 'boolean' as const, name: 'has_lit', default: false }],
  views: [
    {
      guard: {
        kind: 'field' as const,
        on: 'self' as const,
        field: 'lit',
        op: 'eq' as const,
        value: true,
      },
      prose: 'It burns.',
    },
  ],
  verbs: [
    {
      name: 'light',
      guard: {
        kind: 'all' as const,
        guards: [
          {
            kind: 'field' as const,
            on: 'self' as const,
            field: 'lit',
            op: 'eq' as const,
            value: false,
          },
          {
            kind: 'field' as const,
            on: 'self' as const,
            field: 'fuel',
            op: 'gt' as const,
            value: 0,
          },
        ],
      },
      effects: [
        { op: 'set' as const, field: 'lit', value: true },
        { op: 'adjust' as const, field: 'fuel', by: -1 },
        { op: 'set_visitor' as const, field: 'has_lit', value: true },
        { op: 'say' as const, text: 'The wick catches.' },
        { op: 'send_message' as const, to: 'room' as const, item: null, message: 'lantern_lit' },
      ],
    },
  ],
  handlers: [
    {
      message: 'snuff',
      guard: null,
      effects: [{ op: 'set' as const, field: 'lit', value: false }],
    },
  ],
};

describe('the definitions', () => {
  it('a step-1 room row (no behaviour keys) still parses, to empty behaviour', () => {
    const parsed = RoomDefinition.parse({ format: 1, name: 'Porch', prose: '', exits: [] });
    expect(parsed).toEqual({
      format: 1,
      name: 'Porch',
      prose: '',
      exits: [],
      fields: [],
      visitorFields: [],
      views: [],
      verbs: [],
      handlers: [],
    });
  });

  it('a well-formed item parses whole', () => {
    expect(ItemDefinition.safeParse(LANTERN).success).toBe(true);
  });

  it('field names are lower-case identifiers; values are typed', () => {
    expect(
      ItemDefinition.safeParse({
        ...LANTERN,
        fields: [{ type: 'boolean', name: 'Is Lit', default: false }],
      }).success,
    ).toBe(false);
    expect(
      ItemDefinition.safeParse({
        ...LANTERN,
        fields: [{ type: 'integer', name: 'fuel', default: 11, min: 0, max: 10 }],
      }).success,
    ).toBe(false);
    expect(
      ItemDefinition.safeParse({
        ...LANTERN,
        fields: [{ type: 'enum', name: 'colour', options: ['amber'], default: 'blue' }],
      }).success,
    ).toBe(false);
    // floats do not exist (§10.3-7)
    expect(
      SproutGuard.safeParse({ kind: 'field', on: 'self', field: 'fuel', op: 'gt', value: 0.5 })
        .success,
    ).toBe(false);
  });
});

describe('sproutProblems — save-time cross-validation', () => {
  it('a clean definition has none', () => {
    expect(sproutProblems(ItemDefinition.parse(LANTERN), ['Brass lantern', 'Mirror'])).toEqual([]);
  });

  it('every referenced field must be declared, on the right side', () => {
    const def = raw({
      ...LANTERN,
      verbs: [
        {
          name: 'poke',
          guard: { kind: 'field', on: 'self', field: 'has_lit', op: 'eq', value: true },
          effects: [
            { op: 'set', field: 'nope', value: true },
            { op: 'set_visitor', field: 'lit', value: true },
          ],
        },
      ],
    });
    const problems = sproutProblems(def);
    expect(problems).toContain(
      'Verb "poke": the guard reads a field "has_lit" that is not declared.',
    );
    expect(problems).toContain('Verb "poke": "set" names a field "nope" that is not declared.');
    expect(problems).toContain(
      'Verb "poke": "set_visitor" names a visitor field "lit" that is not declared.',
    );
  });

  it('values must fit the field; adjust and ordering are for integers only', () => {
    const def = raw({
      ...LANTERN,
      verbs: [
        {
          name: 'fiddle',
          guard: { kind: 'field', on: 'self', field: 'lit', op: 'gt', value: 1 },
          effects: [
            { op: 'set', field: 'colour', value: 'green' },
            { op: 'adjust', field: 'lit', by: 1 },
            { op: 'set', field: 'fuel', value: 'lots' },
          ],
        },
      ],
    });
    const problems = sproutProblems(def);
    expect(problems).toContain('Verb "fiddle": "gt" only orders integer fields; "lit" is boolean.');
    expect(problems).toContain('Verb "fiddle": 1 is not a boolean of "lit".');
    expect(problems).toContain('Verb "fiddle": "green" is not a value of "colour".');
    expect(problems).toContain(
      'Verb "fiddle": "adjust" only moves integer fields; "lit" is boolean.',
    );
    expect(problems).toContain('Verb "fiddle": "lots" is not a value of "fuel".');
  });

  it('"in" wants a list; the others want one value', () => {
    const def = raw({
      ...LANTERN,
      views: [
        {
          guard: { kind: 'field', on: 'self', field: 'colour', op: 'in', value: 'amber' },
          prose: 'x',
        },
        {
          guard: { kind: 'field', on: 'self', field: 'colour', op: 'eq', value: ['amber'] },
          prose: 'y',
        },
      ],
    });
    const problems = sproutProblems(def);
    expect(problems).toContain('View 1: "in" needs a list of values.');
    expect(problems).toContain('View 2: "eq" compares against one value.');
  });

  it('duplicate fields, verbs and handled messages are refused', () => {
    const def = raw({
      ...LANTERN,
      fields: [...LANTERN.fields, { type: 'boolean', name: 'lit', default: true }],
      verbs: [LANTERN.verbs[0], { ...LANTERN.verbs[0], name: 'LIGHT' }],
      handlers: [LANTERN.handlers[0], LANTERN.handlers[0]],
    });
    const problems = sproutProblems(def);
    expect(problems).toContain('The field "lit" is declared twice.');
    expect(problems).toContain('The verb "LIGHT" is declared twice.');
    expect(problems).toContain('The message "snuff" is handled twice.');
  });

  it('a message to one item names a sibling that is in the room (§10.3-6)', () => {
    const def = raw({
      ...LANTERN,
      verbs: [
        {
          name: 'signal',
          guard: null,
          effects: [
            { op: 'send_message', to: 'item', item: 'Mirror', message: 'flash' },
            { op: 'send_message', to: 'item', item: '  ', message: 'flash' },
            {
              op: 'branch',
              guard: { kind: 'field', on: 'self', field: 'lit', op: 'eq', value: true },
              then: [{ op: 'send_message', to: 'item', item: 'Ghost', message: 'boo' }],
              otherwise: [],
            },
          ],
        },
      ],
    });
    expect(sproutProblems(def)).toEqual([
      'Verb "signal": a message to one item needs the item\'s name.',
    ]);
    const withRoom = sproutProblems(def, ['mirror', 'Brass lantern']);
    expect(withRoom).toContain('Verb "signal": no item called "Ghost" is in this room.');
    expect(withRoom).not.toContain('Verb "signal": no item called "Mirror" is in this room.');
  });

  it('the boundary itself refuses an inconsistent definition (superRefine)', () => {
    const res = ItemDefinition.safeParse({
      ...LANTERN,
      verbs: [{ name: 'x', guard: null, effects: [{ op: 'set', field: 'nope', value: 1 }] }],
    });
    expect(res.success).toBe(false);
  });

  it('caps: node depth and definition size', () => {
    let guard: SproutGuard = { kind: 'field', on: 'self', field: 'lit', op: 'eq', value: true };
    for (let i = 0; i < UNDERSTORY_NODE_DEPTH_MAX; i++) guard = { kind: 'not', guard };
    const deep = sproutProblems(raw({ ...LANTERN, views: [{ guard, prose: 'deep' }] }));
    expect(deep).toContain(
      `View 1: the guard nests too deep (${UNDERSTORY_NODE_DEPTH_MAX} at most).`,
    );
    let effects: SproutEffect[] = [{ op: 'say', text: 'bottom' }];
    for (let i = 0; i < UNDERSTORY_NODE_DEPTH_MAX; i++) {
      effects = [
        {
          op: 'branch',
          guard: { kind: 'field', on: 'self', field: 'lit', op: 'eq', value: true },
          then: effects,
          otherwise: [],
        },
      ];
    }
    expect(
      sproutProblems(raw({ ...LANTERN, verbs: [{ name: 'dig', guard: null, effects }] })),
    ).toContain(`Verb "dig": nests too deep (${UNDERSTORY_NODE_DEPTH_MAX} at most).`);
    const big = raw({
      ...LANTERN,
      verbs: Array.from({ length: 16 }, (_, i) => ({
        name: `v${i}`,
        guard: null,
        effects: Array.from({ length: 16 }, () => ({ op: 'say', text: 'x'.repeat(600) })),
      })),
    });
    expect(JSON.stringify(big).length).toBeGreaterThan(UNDERSTORY_DEFINITION_BYTES_MAX);
    expect(sproutProblems(big)).toContain('The definition is too big (64 KB at most).');
  });
});
