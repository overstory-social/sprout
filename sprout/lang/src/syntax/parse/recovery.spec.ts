import { describe, expect, it } from 'vitest';

import type {
  Declaration,
  KindDeclaration,
  Literal,
  ObjectDeclaration,
  WorldDeclaration,
  WorldMember,
} from '../ast.js';
import { Diagnostics, type Diagnostic } from '../../source/diagnostics.js';
import { DEEPEST, parseDeclarations, parseProperty, parseRemembers } from '../parse.js';
import { SourceFile } from '../../source/source.js';

describe('a defect in one item never loses a well-formed neighbour in silence', () => {
  // The generator in `types.spec.ts` asserts no-throw, no-repeat and
  // determinism, and a parser that drops an entry and says one true
  // thing passes all three. This is the invariant that catches it, and
  // it needs no knowledge of what the defect was: the shapes are built
  // here, so what was well formed is known.
  //
  // Every defect is SELF-CONTAINED — balanced brackets, and not a bare
  // closer. An unclosed bracket really does swallow what follows it,
  // and a bare `]` really does end the construct; in both cases what
  // comes after is not a sibling, and blaming the parser for it would
  // be the suite lying rather than the parser.
  //
  // A construct past the parser's depth bound is one of the defects,
  // written as a value and as a TYPE: the two go down different paths,
  // and only the type path reads a bracket it may then have to step
  // back over.
  const tooDeep = (inner: string) => '['.repeat(DEEPEST + 1) + inner + ']'.repeat(DEEPEST + 1);

  const ENTRY_DEFECTS = [
    'Zeta: 0',
    '4: 0',
    'b 1',
    'b: Zeta',
    'b: 1.5',
    'b: %',
    'b: :wet',
    'b:',
    ': 0',
    'b: {}',
    'b: [oak silver]',
    'b: 0 min [1, 2]',
    'b: 0 min oak',
    'b: 0 min max 9',
    'b: 0 min 0 min 1',
    'b: 0 max 1.5',
    'b: Ward.',
    'b: Ward.Iron',
    'b: integer.3',
    'b: Ward.oak default silver',
    'b: 0 min',
    `b: ${tooDeep('oak')}`,
    `b: ${tooDeep('Ward')} default oak`,
    `b: [Ward] default [${Array.from({ length: 17 }, (_, i) => `e${i}`).join(',')}]`,
    'b: 0 min -[1]',
    'b: 0 max -[1, 2]',
    'b: 0 min -oak',
    'b: 0 min - max 9',
    'b: -[1]',
  ];

  // Not `enum`: it is a reserved word, but the parser reads `[oak, enum]`
  // as a list of two words and leaves `enum` to be refused where options
  // are checked against their enum, so there is no parse defect to find.
  const ELEMENT_DEFECTS = ['Zeta', '1.5', '%', ':a', '{', '}', tooDeep('oak')];
  const DECLARATION_DEFECTS = [
    'enum',
    'enum {',
    'message',
    'enum Ward {',
    `message :a with ${tooDeep('Ward')}`,
    '%',
    'enum Ward { oak oak }',
    // Worlds. The first two: a member word that also starts a
    // declaration, and a member whose value is a list that was never
    // closed. Either could take the declaration after it with it.
    'world w: sprout.World { enum Inner { oak } }',
    'world w: sprout.World { :x [ }',
    // Not `world w: sprout.World { }`: it PARSES, and what is wrong with
    // it — no visitor kind, nowhere to arrive — is `resolveVisitors`' and
    // `arrivalOf`'s to say.
    // A shape that is not a parse defect belongs in world.spec.ts.
    'world w: sprout.World { nonsense }',
    'world w: 4 { }',
    'world',
    'world w',
    'world w: sprout.World { visitors }',
    'world w: sprout.World { visitors are 4 }',
    // Kinds and objects: a name, a composition, a brace or a container
    // missing or wrong, a member no kind holds, a list never closed, a
    // declaration inside the body, and a world's own member in an
    // object's.
    'kind',
    'kind K',
    'kind K: 4 { }',
    'kind K { nonsense }',
    'kind K { :x [ }',
    'kind K { enum Inner { oak } }',
    'object',
    'object o: K { }',
    'object o: K in { }',
    'object o: K in r { visitors are X }',
    // A container's path: a dot left at its end, two in a row, a number
    // or a capital for a step, spaces around a dot; and the same where a
    // world says its visitors arrive.
    'object o: K in r.',
    'object o: K in r..s { }',
    'object o: K in r.4 { }',
    'object o: K in r.S',
    'object o: K in r . s',
    'world w: sprout.World { visitors arrive at y. }',
  ];

  /**
   * What holds a body of members, as each is opened. A world, a kind and
   * an object read their bodies through one reader, and the net runs over
   * each, so a change to it for one is tested for all three. `visitors …`
   * is a world's alone, so in a kind or an object it is one more word that
   * is not a member.
   */
  const OWNERS = [
    { kind: 'world', name: 'w', open: 'world w: sprout.World {' },
    { kind: 'kind', name: 'K', open: 'kind K {' },
    { kind: 'object', name: 'o', open: 'object o: K in r {' },
  ] as const;
  type Owner = (typeof OWNERS)[number];

  /** The declaration an owner opened, among what a file read. */
  const ownedBy = (owner: Owner, declared: readonly Declaration[]) =>
    declared.find(
      (d): d is WorldDeclaration | KindDeclaration | ObjectDeclaration => d.kind === owner.kind,
    );

  /**
   * Every well-formed thing is KEPT.
   *
   * Kept, not merely "named in something said": a name is "named" by
   * any refusal that happens to quote it, so a declaration that
   * vanished entirely would pass if whatever swallowed it complained
   * about its name on the way past. And kept HERE: a declaration
   * written inside a world, reparsed as a sibling of the world that
   * held it, is not kept.
   *
   * So: kept, and nothing else appears that was not written at this
   * level. A defect that genuinely takes a neighbour with it is named
   * in the table rather than covered by a weaker rule.
   */
  function nothingVanishes(
    what: string,
    kept: readonly string[],
    good: string[],
    written: string[] = good,
  ) {
    for (const name of good) {
      expect(kept, `${what}: \`${name}\` vanished`).toContain(name);
    }
    for (const name of kept) {
      expect(written, `${what}: \`${name}\` appeared where it was not written`).toContain(name);
    }
  }

  it('over a `:remembers`, whichever side of the defect the good entries are', () => {
    let checked = 0;
    for (const defect of ENTRY_DEFECTS) {
      for (const [text, good] of [
        [`:remembers [alpha: 0, ${defect}]`, ['alpha']],
        [`:remembers [${defect}, omega: 1]`, ['omega']],
        [`:remembers [alpha: 0, ${defect}, omega: 1]`, ['alpha', 'omega']],
      ] as const) {
        checked += 1;
        const diagnostics = new Diagnostics();
        const remembered = parseRemembers(new SourceFile('k.sprout', text), diagnostics);
        nothingVanishes(
          text,
          remembered?.properties.map((p) => p.name.text) ?? [],
          [...good],
          [...good, 'b'],
        );
        // And it is a defect at all — the net is worth nothing if the
        // shapes it walks are well formed.
        expect(diagnostics.refusals.length, `${text}: nothing was wrong with it`).toBeGreaterThan(
          0,
        );
      }
    }
    expect(checked).toBe(ENTRY_DEFECTS.length * 3);
  });

  it('over the members of a world, a kind and an object, in every order', () => {
    // The member-shaped defects: a member word with nothing it can read
    // after it, a member word followed by one that is no member, and a
    // word that is no member at all. Then the tables above as a world
    // writes them: an entry defect as a property where it has the
    // shape of one and inside a `:remembers` always, and an element
    // defect inside a list default.
    const MEMBER_DEFECTS = [
      'visitors are 4',
      'visitors arrive y',
      'visitors',
      'contains 4',
      'nonsense',
      '4',
      // A `without` with its member, its `from` or its kind missing or
      // wrong, each a line that would otherwise take the next member.
      'without',
      'without accept',
      'without accept from',
      'without accept from 4',
      'without nonsense from K',
      'without :x from K',
      'without changed',
      'without on :stir',
      'without as target',
      'without as target for',
      ...ENTRY_DEFECTS.filter((entry) => entry.startsWith('b:')).map(
        (entry) => `:b${entry.slice(2)}`,
      ),
      ...ENTRY_DEFECTS.map((entry) => `:remembers [${entry}]`),
      ...ELEMENT_DEFECTS.map((element) => `:b [Ward] default [oak, ${element}]`),
    ];
    // Symbols, and not `visitors …`: a property whose value is missing
    // reads the next word as its value, which is a reading and not a
    // loss, and a symbol can never be a value.
    const GOOD = [':alpha 0', ':remembers [omega: 1]'] as const;
    /** A member by what it would be looked up as. */
    const nameOf = (member: WorldMember): string =>
      member.kind === 'property'
        ? member.name.text
        : member.kind === 'remembers'
          ? `remembers:${member.properties.map((p) => p.name.text).join(',')}`
          : member.kind;
    let checked = 0;
    for (const owner of OWNERS) {
      for (const defect of MEMBER_DEFECTS) {
        for (const order of [
          [GOOD[0], defect, GOOD[1]],
          [GOOD[0], GOOD[1], defect],
          [defect, GOOD[0], GOOD[1]],
          [GOOD[1], defect, GOOD[0]],
          [GOOD[1], GOOD[0], defect],
          [defect, GOOD[1], GOOD[0]],
        ]) {
          checked += 1;
          const text = `${owner.open}\n  ${order.join('\n  ')}\n}\n`;
          const diagnostics = new Diagnostics();
          const declared = parseDeclarations(new SourceFile('k.sprout', text), diagnostics);
          // What the defect itself may leave standing: the `contains` a
          // `contains 4` did read, and a `:remembers` whose entry was refused.
          nothingVanishes(
            text,
            ownedBy(owner, declared)?.members.map(nameOf) ?? [],
            ['alpha', 'remembers:omega'],
            ['alpha', 'remembers:omega', 'b', 'contains', 'remembers:', 'remembers:b'],
          );
          expect(diagnostics.refusals.length, `${text}: nothing was wrong with it`).toBeGreaterThan(
            0,
          );
        }
      }
    }
    expect(checked).toBe(OWNERS.length * MEMBER_DEFECTS.length * 6);
  });

  it('over a list literal', () => {
    for (const defect of ELEMENT_DEFECTS) {
      for (const [text, good] of [
        [`:x [Ward] default [oak, ${defect}]`, ['oak']],
        [`:x [Ward] default [${defect}, silver]`, ['silver']],
        [`:x [Ward] default [oak, ${defect}, silver]`, ['oak', 'silver']],
      ] as const) {
        const diagnostics = new Diagnostics();
        const declared = parseProperty(new SourceFile('k.sprout', text), diagnostics);
        // Only the options: an element that is not one has no name to
        // go missing, and rendering its kind would make this rule
        // complain about shapes rather than about losses.
        const written =
          declared?.default?.kind === 'list-literal'
            ? declared.default.elements.flatMap((e) =>
                e.kind === 'option-literal' ? [e.name.text] : [],
              )
            : [];
        nothingVanishes(text, written, [...good], [...good, 'oak', 'silver']);
        expect(diagnostics.refusals.length, `${text}: nothing was wrong with it`).toBeGreaterThan(
          0,
        );
      }
    }
  });

  it('over the declarations of a whole file', () => {
    for (const defect of DECLARATION_DEFECTS) {
      for (const [text, good] of [
        [`enum Alpha { x }\n${defect}\n`, ['Alpha']],
        [`${defect}\nenum Omega { y }\n`, ['Omega']],
        [`enum Alpha { x }\n${defect}\nenum Omega { y }\n`, ['Alpha', 'Omega']],
      ] as const) {
        const diagnostics = new Diagnostics();
        const declared = parseDeclarations(new SourceFile('k.sprout', text), diagnostics);
        // A construct that was never closed gives its contents to the
        // file — `world w: sprout.World { enum Inner { oak } }` is a world that ran
        // on, and `Inner` is the file's enum. That is the rule, and it
        // keeps the author's work rather than skipping to a brace and
        // losing it. So a name
        // WRITTEN inside the defect may surface at the top level; a
        // name that was never written anywhere still may not. A world or
        // an object whose defect is in one member is kept, under its own
        // name.
        const inside = [
          ...(defect.match(/[A-Z][A-Za-z_]*/g) ?? []),
          ...(defect.match(/^(?:world|object) (\w+)/)?.slice(1) ?? []),
        ];
        nothingVanishes(
          text,
          declared.map((d) => d.name.text),
          [...good],
          [...good, 'Ward', ...inside],
        );
        expect(diagnostics.refusals.length, `${text}: nothing was wrong with it`).toBeGreaterThan(
          0,
        );
      }
    }
  });

  // --- the same rule, over generated input -----------------------------
  //
  // The tables above place a hand-picked defect beside well-formed
  // items. What follows builds every item from its parts, with a fixed
  // seed, and puts one defect into any one part of one item, so the net
  // reaches shapes nobody thought to write down.
  //
  // A defect is one of three sorts, and the rule is as strong as each
  // allows. Most are self-contained, and every well-formed item is
  // KEPT. A stray closer really does end what it closes, so an item
  // after it may instead be NAMED in something said. An unclosed bracket
  // really does take what follows it, as far as whichever closer turns
  // up, so it is held only to the rest of the rule, which binds all
  // three: nothing appears that was not written, nothing is thrown, and
  // the defect is refused, which keeps the net from passing vacuously.

  type Sort = 'contained' | 'stray' | 'unclosed';

  /** One defect as written. */
  interface Defect {
    readonly text: string;
    readonly sort: Sort;
  }
  const contained = (text: string): Defect => ({ text, sort: 'contained' });
  const stray = (text: string): Defect => ({ text, sort: 'stray' });
  const unclosed = (text: string): Defect => ({ text, sort: 'unclosed' });

  /** mulberry32: a fixed stream of choices, so every failure reproduces from the source it prints. */
  function chooser(seed: number) {
    let state = seed >>> 0;
    const below = (n: number): number => {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) % n;
    };
    const one = <T>(items: readonly T[]): T => items[below(items.length)]!;
    const shuffled = <T>(items: readonly T[]): T[] => {
      const out = [...items];
      for (let i = out.length - 1; i > 0; i--) {
        const j = below(i + 1);
        [out[i], out[j]] = [out[j]!, out[i]!];
      }
      return out;
    };
    return { below, one, shuffled };
  }
  type Chooser = ReturnType<typeof chooser>;

  const OVER_CAP = `[${Array.from({ length: 17 }, (_, i) => i).join(', ')}]`;

  /** What a written property is made of after its name. */
  type Role = 'type' | 'default' | 'value' | 'bound';
  interface Part {
    readonly role: Role;
    readonly text: string;
  }

  /**
   * A well-formed property's parts: a written type and `default`, or a
   * bare value; a number, a truth value, text, an option or a list
   * nested up to three deep; and on a number, a `min` and a `max` in
   * either order, or one, or neither.
   */
  function wellFormedParts(c: Chooser): Part[] {
    const int = (): string => `${c.below(3) === 0 ? '-' : ''}${c.below(100)}`;
    const nested = (depth: number, leaf: () => string): string => {
      const count = depth > 1 ? 1 + c.below(2) : c.below(4);
      const inner = (): string => (depth > 1 ? nested(depth - 1, leaf) : leaf());
      return `[${Array.from({ length: count }, inner).join(', ')}]`;
    };
    const bare = (value: string): Part[] => [{ role: 'value', text: value }];
    const typed = (type: string, value: string): Part[] => [
      { role: 'type', text: type },
      { role: 'default', text: 'default' },
      { role: 'value', text: value },
    ];
    const depth = 1 + c.below(3);
    const listOf = (element: string): string =>
      `${'['.repeat(depth)}${element}${']'.repeat(depth)}`;
    const shapes: (() => Part[])[] = [
      () => bare(int()),
      () => typed('integer', int()),
      () => bare(c.one(['true', 'false'])),
      () => typed('boolean', c.one(['true', 'false'])),
      () => bare('"a line"'),
      () => typed('string', '"a line"'),
      () => bare('oak'),
      () => typed(c.one(['Ward', 'sprout.Ward']), 'oak'),
      () => bare(c.one(['Ward.oak', 'sprout.Ward.oak'])),
      () =>
        typed(
          listOf('Ward'),
          nested(depth, () => c.one(['oak', 'silver'])),
        ),
      () => typed(listOf('integer'), nested(depth, int)),
      () => bare(nested(depth, int)),
    ];
    const parts = c.one(shapes)();
    if (/^-?\d+$/.test(parts.at(-1)!.text)) {
      const bounds = [`min ${int()}`, `max ${int()}`].filter(() => c.below(2) === 0);
      if (c.below(2) === 0) bounds.reverse();
      parts.push(...bounds.map((text) => ({ role: 'bound' as const, text })));
    }
    return parts;
  }

  /**
   * What a defect in each part may be: between them, every sort the
   * net is for — a wrong token, a missing one, a reserved word, a
   * capitalised word, a fraction, a nest too deep, a list over the cap,
   * a bad bound, a stray closer and an unclosed bracket.
   */
  const PART_DEFECTS: Record<Exclude<Role, 'bound'>, readonly Defect[]> = {
    type: [
      contained('%'),
      contained('integer.3'),
      contained('sprout.'),
      contained('[Ward, oak]'),
      contained(tooDeep('Ward')),
      unclosed('[Ward'),
    ],
    default: [contained(''), contained('defualt')],
    value: [
      contained(''),
      contained('1.5'),
      contained('-1.5'),
      contained('%'),
      contained(':wet'),
      contained('{}'),
      contained('Zeta'),
      contained('-oak'),
      contained('-[1]'),
      contained('-'),
      contained('Ward.Iron'),
      contained(tooDeep('1')),
      contained(OVER_CAP),
      contained('[oak silver]'),
      contained('[oak, [silver, Zeta]]'),
      // Not `message :stir` or `enum Ward { oak }`: a reserved word that
      // completes its declaration's opening is no longer a defect
      // contained in this value — the property reader takes it for a
      // missing value with a declaration written after it, which is not
      // a loss and has its own coverage: `[oak, enum]` in world.spec.ts
      // for a reserved word that stands as a value, and the world-body
      // run below, through `following`, for one that opens a real
      // declaration. A capitalised word in the same spot is still
      // refused everywhere it can stand, so it keeps that coverage.
      contained('Ward'),
      contained('Drying'),
      unclosed('[oak'),
    ],
  };

  /** What may stand after a `min` or a `max` and is not a whole number. */
  const BAD_BOUNDS: readonly Defect[] = [
    ...['[1]', '-[1]', '-[1, 2]', '[[1]]', 'oak', '-oak', 'Ward', '"9"', 'true', ':wet'].map(
      (text) => contained(text),
    ),
    ...['1.5', '-1.5', '-', '', '- -', tooDeep('1'), OVER_CAP].map((text) => contained(text)),
    stray(']'),
    unclosed('[1'),
  ];

  /** Between any two parts: something that closes or opens and should not. */
  const BETWEEN: readonly Defect[] = [stray(']'), stray('}'), contained(')'), unclosed('[')];

  /** How a defect in a name is written, as a `:remembers` entry and as a property. */
  const NAME_DEFECTS: Record<'entry' | 'member', readonly string[]> = {
    entry: ['Zeta:', '4:', ':', 'faulty', '"faulty":', 'faulty::'],
    member: [':Zeta', 'faulty', '"faulty"', '::faulty', ': faulty'],
  };

  /** A property as written, the name first in the form its place asks for. */
  const spelled = (name: string, form: 'entry' | 'member', parts: readonly string[]): string =>
    [form === 'entry' ? `${name}:` : `:${name}`, ...parts].filter((t) => t !== '').join(' ');

  const wellFormed = (c: Chooser, name: string, form: 'entry' | 'member'): string =>
    spelled(
      name,
      form,
      wellFormedParts(c).map((part) => part.text),
    );

  /**
   * A property called `faulty` with one defect in one part: its name,
   * its type, its `default`, its value, a bound, or between two parts.
   */
  function defectiveProperty(
    c: Chooser,
    form: 'entry' | 'member',
  ): { text: string; defect: Defect } {
    const parts = wellFormedParts(c);
    const texts = parts.map((part) => part.text);
    const roll = c.below(10);
    if (roll === 0) {
      const text = [c.one(NAME_DEFECTS[form]), ...texts].join(' ');
      return { text, defect: contained('') };
    }
    if (roll <= 3) {
      // A bad bound, in place of one written or added to any value, or
      // a bound written twice.
      const which = c.one(['min', 'max']);
      const defect = c.below(6) === 0 ? contained(`0 ${which} 1`) : c.one(BAD_BOUNDS);
      const bound = `${which} ${defect.text}`.trim();
      const at = parts.findIndex((part) => part.role === 'bound');
      if (at >= 0 && c.below(2) === 0) texts[at] = bound;
      else texts.push(bound);
      return { text: spelled('faulty', form, texts), defect };
    }
    if (roll <= 5) {
      const defect = c.one(BETWEEN);
      const at = c.below(texts.length + 1);
      texts.splice(at, 0, defect.text);
      return { text: spelled('faulty', form, texts), defect };
    }
    const at = c.below(parts.filter((part) => part.role !== 'bound').length);
    const defect = c.one(PART_DEFECTS[parts[at]!.role as Exclude<Role, 'bound'>]);
    texts[at] = defect.text;
    return { text: spelled('faulty', form, texts), defect };
  }

  /**
   * The rule, at the strength the defect's sort allows. `good` were
   * written well formed; `written` is every name the source holds at
   * this level, the defective item's included. `refusable` is false only
   * where a reader read on its own stopped before the end, since the
   * text after what it reads is not its to refuse.
   */
  function explained(
    text: string,
    sort: Sort,
    kept: readonly string[],
    good: readonly string[],
    written: readonly string[],
    said: readonly Diagnostic[],
    refusable = true,
  ) {
    if (refusable) {
      expect(said.length, `${text}\n  nothing was wrong with it`).toBeGreaterThan(0);
    }
    if (sort === 'contained') {
      nothingVanishes(text, kept, [...good], [...written]);
      return;
    }
    if (sort === 'stray') {
      for (const name of good) {
        // As said: `remembers.walks` is said as `walks`, and a property
        // as it was written, `:bravo`.
        const word = name.split('.').at(-1)!;
        const named = said.some(
          (d) => d.message.includes(`\`${word}\``) || d.message.includes(`\`:${word}\``),
        );
        expect(
          kept.includes(name) || named,
          `${text}\n  \`${name}\` vanished, and nothing said names it`,
        ).toBe(true);
      }
    }
    nothingVanishes(text, kept, [], [...written]);
  }

  /** Whether a reader read on its own stopped short of the end of what it was given. */
  const stoppedShort = (text: string, read: { at: { end: number } } | null | undefined): boolean =>
    read !== null && read !== undefined && read.at.end < text.trimEnd().length;

  /** Runs one reader, and fails with the source if it throws. */
  function reading<T>(text: string, read: (s: SourceFile, d: Diagnostics) => T) {
    const diagnostics = new Diagnostics();
    let result: T | undefined;
    expect(() => {
      result = read(new SourceFile('g.sprout', text), diagnostics);
    }, text).not.toThrow();
    return { result: result as T, said: diagnostics.refusals };
  }

  /** Counts what a generated run reached, so a sort it never tried is a failure. */
  function tally() {
    const seen = new Map<string, number>();
    return {
      add: (key: string) => seen.set(key, (seen.get(key) ?? 0) + 1),
      keys: () => [...seen.keys()].sort(),
    };
  }

  const SORTS = ['contained', 'stray', 'unclosed'];

  /** One `:remembers` of well-formed entries and one defective one, in any order. */
  function generatedRemembers(c: Chooser, names: readonly string[]) {
    const faulty = c.below(names.length + 1);
    const entries = names.map((name) => wellFormed(c, name, 'entry'));
    // A missing or doubled comma after a well-formed entry is a defect
    // of its own, and changes nothing about what must be kept.
    const inSeparator = faulty < names.length && c.below(8) === 0;
    const made = inSeparator
      ? { text: wellFormed(c, 'faulty', 'entry'), defect: contained('') }
      : defectiveProperty(c, 'entry');
    entries.splice(faulty, 0, made.text);
    const body = inSeparator
      ? `${entries.slice(0, faulty + 1).join(', ')}${c.one([' ', ', , '])}${entries.slice(faulty + 1).join(', ')}`
      : entries.join(', ');
    return { ...made, text: `:remembers [${body}]` };
  }

  it('over generated `:remembers`, a defect in any part of any entry', () => {
    // An entry refused before the rest of it is read is stepped over
    // through its own brackets, the way a refused member is, so every
    // shape here is held to the strong rule: nothing written is lost.
    const c = chooser(20_260_922);
    const reached = tally();
    for (let i = 0; i < 1000; i++) {
      const good = ['alpha', 'bravo', 'charlie', 'delta'].slice(0, c.below(5));
      const made = generatedRemembers(c, good);
      const { result, said } = reading(made.text, parseRemembers);
      reached.add(made.defect.sort);
      explained(
        made.text,
        made.defect.sort,
        result?.properties.map((p) => p.name.text) ?? [],
        good,
        [...good, 'faulty'],
        said,
        !stoppedShort(made.text, result),
      );
    }
    expect(reached.keys()).toEqual(SORTS);
  });

  it('over a generated property on its own, a defect in any part', () => {
    // No neighbour to lose, so what holds is that nothing is thrown and
    // the defect is refused, wherever in the property it is.
    const c = chooser(20_260_923);
    const reached = tally();
    for (let i = 0; i < 400; i++) {
      const made = defectiveProperty(c, 'member');
      const { result, said } = reading(made.text, parseProperty);
      reached.add(made.defect.sort);
      if (!stoppedShort(made.text, result)) {
        expect(said.length, `${made.text}\n  nothing was wrong with it`).toBeGreaterThan(0);
      }
    }
    expect(reached.keys()).toEqual(SORTS);
  });

  /**
   * The element pool a generated list draws its leaves from, and the
   * declared type that matches: options for an enum, and, so the elements
   * written after a stray closer are named whatever shape they are, whole
   * numbers (signed ones included) and text too.
   */
  const ELEMENT_KINDS: readonly { readonly type: string; readonly pool: readonly string[] }[] = [
    { type: 'Ward', pool: ['oak', 'silver', 'iron', 'brass', 'tin', 'copper', 'zinc', 'lead'] },
    { type: 'integer', pool: ['1', '-2', '3', '-4', '5', '-6', '7', '-8'] },
    { type: 'string', pool: ['"a"', '"b"', '"c"', '"d"', '"e"', '"f"', '"g"', '"h"'] },
  ];

  it('over a generated list default, a defect at any depth', () => {
    const c = chooser(20_260_924);
    const ELEMENT: readonly Defect[] = [
      ...['Zeta', '1.5', '-1.5', '%', ':a', '{', ')', '-oak', '-[oak]', '-', 'Ward.oak'].map(
        (text) => contained(text),
      ),
      contained(tooDeep('oak')),
      contained(OVER_CAP),
      stray('}'),
      stray(']'),
      unclosed('['),
    ];
    const reached = tally();
    for (let i = 0; i < 600; i++) {
      // The list is built with numbered holes for its leaves, so the
      // defect can go in place of one leaf, beside it, or in place of
      // the comma after it.
      const kind = c.one(ELEMENT_KINDS);
      const depth = 1 + c.below(3);
      let leaves = 0;
      const nested = (level: number): string => {
        const inner = Array.from({ length: 1 + c.below(3) }, () =>
          level > 1 ? nested(level - 1) : `<${leaves++}>`,
        );
        return `[${inner.join(', ')}]`;
      };
      const template = nested(depth);
      const names = Array.from({ length: leaves }, (_, n) => kind.pool[n % kind.pool.length]!);
      const target = c.below(leaves);
      const commaAfter = template.includes(`<${target}>,`);
      const how = c.below(commaAfter ? 3 : 2);
      const defect = how === 2 ? contained(c.one([' ', ',,'])) : c.one(ELEMENT);
      const value = template.replace(/<(\d+)>(,?)/g, (_, n: string, comma: string) => {
        const leaf = names[Number(n)]!;
        if (Number(n) !== target) return `${leaf}${comma}`;
        if (how === 0) return `${defect.text}${comma}`;
        if (how === 1) return `${leaf} ${defect.text}${comma}`;
        return `${leaf}${defect.text}`;
      });
      const text = `:x ${'['.repeat(depth)}${kind.type}${']'.repeat(depth)} default ${value}`;
      const { result, said } = reading(text, parseProperty);
      const kept: string[] = [];
      const walk = (literal: Literal | null | undefined): void => {
        if (literal?.kind === 'option-literal') kept.push(literal.name.text);
        else if (literal?.kind === 'integer') kept.push(String(literal.value));
        else if (literal?.kind === 'string') kept.push(`"${literal.value}"`);
        else if (literal?.kind === 'list-literal') literal.elements.forEach(walk);
      };
      walk(result?.default);
      reached.add(defect.sort);
      const good = names.filter((_, n) => n !== target || how !== 0);
      explained(
        text,
        defect.sort,
        kept,
        [...new Set(good)],
        [...names, 'Ward', 'Zeta', 'oak'],
        said,
        !stoppedShort(text, result),
      );
    }
    expect(reached.keys()).toEqual(SORTS);
  });

  /** A world member by what it would be looked up as, a `:remembers` by each entry. */
  const memberNames = (member: WorldMember): string[] =>
    member.kind === 'property'
      ? [member.name.text]
      : member.kind === 'remembers'
        ? member.properties.map((p) => `remembers.${p.name.text}`)
        : [member.kind];

  /** One defective world member, of any kind a world holds, or text between two members. */
  function defectiveMember(c: Chooser): { text: string; defect: Defect } {
    const roll = c.below(8);
    if (roll <= 3) return defectiveProperty(c, 'member');
    if (roll <= 5) return generatedRemembers(c, ['echo']);
    if (roll === 6) {
      const text = c.one([
        'visitors are 4',
        'visitors arrive y',
        'visitors',
        'visitors are',
        'contains 4',
        'nonsense',
        '4',
        'without',
        'without accept',
        'without accept from 4',
        'without nonsense from K',
        'without changed',
      ]);
      return { text, defect: contained(text) };
    }
    // A word that starts a declaration ends the world as never closed,
    // and what follows is the file's: see "recovery and reading ask the
    // same word different questions".
    if (c.below(4) === 0) return { text: 'enum', defect: unclosed('enum') };
    const defect = c.one([stray(']'), contained(')'), unclosed('[')]);
    return { text: defect.text, defect };
  }

  /**
   * What may follow a body that was never closed: declarations written
   * well, which are kept, and ones whose own header reads like the
   * entries of a `:remembers` — `, name: 1]` — which are kept or refused
   * at their own text, and never taken for the body's.
   */
  const FOLLOWING = [
    { name: 'Omega', text: 'enum Omega { y }', wellFormed: true },
    { name: 'omega', text: 'message :omega', wellFormed: true },
    { name: 'omega', text: 'world omega: sprout.World {\n  visitors are P\n}', wellFormed: true },
    { name: 'Omega', text: 'kind Omega: sprout.Container {\n  contains\n}', wellFormed: true },
    { name: 'omega', text: 'object omega: Crate in yard', wellFormed: true },
    { name: 'Omega', text: 'kind Omega: sprout.Container, name: 1] { }', wellFormed: false },
    { name: 'omega', text: 'object omega: Crate, name: 1] in yard', wellFormed: false },
    {
      name: 'omega',
      text: 'world omega: sprout.World, name: 1] {\n  visitors are P\n}',
      wellFormed: false,
    },
    { name: 'Omega', text: 'enum Omega, name: [1]] { y }', wellFormed: false },
  ] as const;

  /**
   * A world never closed says so, and the declaration after it is its
   * own: kept, or refused somewhere in its own text by something other
   * than the world's refusal.
   */
  function closedByWhatFollows(
    text: string,
    world: string,
    following: (typeof FOLLOWING)[number],
    declared: readonly Declaration[],
    said: readonly Diagnostic[],
  ) {
    const unclosed = `\`${world}\` is never closed.`;
    expect(
      said.some((d) => d.message === unclosed),
      `${text}\n  nothing says \`${world}\` is never closed`,
    ).toBe(true);
    const kept = declared.some((d) => d.name.text === following.name);
    const from = text.lastIndexOf(following.text);
    const refused = said.some((d) => d.at.start >= from && d.message !== unclosed);
    expect(
      kept || (!following.wellFormed && refused),
      `${text}\n  \`${following.name}\` vanished, and nothing in it was refused`,
    ).toBe(true);
  }

  it('over a generated body of a world, a kind and an object, a defect in any member', () => {
    const SYMBOL_LED = [
      { names: ['alpha'], text: (ch: Chooser) => wellFormed(ch, 'alpha', 'member') },
      { names: ['bravo'], text: (ch: Chooser) => wellFormed(ch, 'bravo', 'member') },
      {
        names: ['remembers.charlie', 'remembers.delta'],
        text: (ch: Chooser) =>
          `:remembers [${wellFormed(ch, 'charlie', 'entry')}, ${wellFormed(ch, 'delta', 'entry')}]`,
      },
    ];
    const WORD_LED = [
      { names: ['visitors-are'], text: () => 'visitors are P', worldOnly: true },
      { names: ['visitors-arrive-at'], text: () => 'visitors arrive at y', worldOnly: true },
      { names: ['contains'], text: () => 'contains actors', worldOnly: false },
      { names: ['without'], text: () => 'without changed :lit from Lamp', worldOnly: false },
    ];
    for (const [n, owner] of OWNERS.entries()) {
      const c = chooser(20_260_925 + n);
      const reached = tally();
      const wordLed = WORD_LED.filter((member) => owner.kind === 'world' || !member.worldOnly);
      for (let i = 0; i < 800; i++) {
        const members = c.shuffled([
          ...SYMBOL_LED.filter(() => c.below(3) !== 0),
          ...wordLed.filter(() => c.below(2) === 0),
        ]);
        // A property whose value is missing reads the next word as its
        // value, which is a reading and not a loss, so a member that
        // starts with a word never comes straight after the defect.
        let at = c.below(members.length + 1);
        while (at < members.length && wordLed.includes(members[at] as (typeof WORD_LED)[number])) {
          at += 1;
        }
        const made = defectiveMember(c);
        const lines = members.map((member) => member.text(c));
        lines.splice(at, 0, made.text);
        // Now and then the world is never closed, and a declaration follows
        // it, with a `:remembers` last in the body or not. Not after a brace
        // in the defect, which would close it, nor an unclosed bracket,
        // which takes what follows as far as a closer turns up.
        const crossable = made.defect.sort !== 'unclosed' && !made.text.includes('}');
        const following = crossable && c.below(4) === 0 ? c.one(FOLLOWING) : null;
        if (following !== null) {
          // Whether a `:remembers` closes the body last is drawn only
          // where the defect is not already the line right before
          // `following`: there, standing directly against it is the
          // shape this run is for, since a value missing exactly where
          // `following`'s word stands is refused by the property reader
          // before it can be taken for a bare option.
          const remembersLast = at < members.length && c.below(2) === 0;
          if (remembersLast) lines.push(':remembers [zulu: 0]');
          const text = `${owner.open}\n  ${lines.join('\n  ')}\n${following.text}\n`;
          const { result, said } = reading(text, parseDeclarations);
          reached.add(remembersLast && !following.wellFormed ? 'across' : 'never closed');
          closedByWhatFollows(text, owner.name, following, result, said);
          continue;
        }
        const text = `${owner.open}\n  ${lines.join('\n  ')}\n}\n`;
        const { result, said } = reading(text, parseDeclarations);
        const inRemembers = made.text.startsWith(':remembers');
        reached.add(made.defect.sort);
        const good = members.flatMap((member) => member.names);
        if (inRemembers) good.push('remembers.echo');
        explained(
          text,
          made.defect.sort,
          ownedBy(owner, result)?.members.flatMap(memberNames) ?? [],
          good,
          // A symbol written where a value goes, `:wet` or `:stir`, is a
          // member of its own: a reading, and not something that appeared.
          [...good, 'faulty', 'remembers.faulty', 'remembers.echo', 'contains', 'wet', 'stir'],
          said,
        );
      }
      expect(reached.keys(), owner.kind).toEqual([...SORTS, 'across', 'never closed'].sort());
    }
  });

  it('over a generated file, a defect in any part of any declaration', () => {
    // Every defect here is held to the strong rule, the unclosed and the
    // stray ones too: at the top of a file, the word that starts the next
    // declaration is where recovery stops, whatever bracket is open.
    const c = chooser(20_260_926);
    const option = c.one;
    const reached = tally();
    const DECLARED = [
      { name: 'Alpha', text: () => 'enum Alpha { oak, silver }' },
      { name: 'Bravo', text: () => 'enum Bravo { iron }' },
      { name: 'golf', text: () => option(['message :golf', 'message :golf with [Ward]']) },
      { name: 'hotel', text: () => option(['message :hotel with boolean', 'message :hotel']) },
      {
        name: 'india',
        text: () => 'world india: sprout.World {\n  visitors are P\n  visitors arrive at y\n}',
      },
      {
        name: 'Juliet',
        text: () =>
          option(['kind Juliet { }', 'kind Juliet: Crate, sprout.Container {\n  :open true\n}']),
      },
      {
        name: 'kilo',
        text: () =>
          option([
            'object kilo: Juliet in yard',
            'object kilo: Juliet in yard {\n  contains\n}',
            'object kilo: Juliet in yard.shed.shelf',
          ]),
      },
    ];
    // A world never closed, holding a `:remembers` or not; whatever
    // follows it, in the file or here, is a declaration of its own.
    const unclosedWorld = (): string =>
      `world faulty: sprout.World {\n  ${option(['visitors are P', 'visitors are P\n  :remembers [a: 0]', ':remembers [a: 0]'])}`;
    const DEFECTIVE: readonly (() => string)[] = [
      // An enum: its name, its braces, one option, or a comma.
      () => `enum ${option(['faulty', '', '4', 'Faulty.'])} { oak }`,
      () => 'enum Faulty oak, silver }',
      () => 'enum Faulty { oak, silver',
      () => {
        const bad = option([
          'Zeta',
          'enum',
          'message',
          'world',
          'kind',
          'object',
          'in',
          'without',
          'from',
          'integer',
          '4',
          ':a',
          '%',
          '"x"',
        ]);
        return `enum Faulty { oak, ${bad}, silver }`;
      },
      () => `enum Faulty { oak${option([' ', ', ,'])} silver }`,
      () => 'enum Faulty { oak, ], silver }',
      () => 'enum Faulty { oak, [, silver }',
      // A message: its name, or what it carries.
      () => option(['message', 'message faulty', 'message :faulty boolean']),
      () => {
        const carried = option(['', '4', 'sprout.', tooDeep('Ward'), '[Ward, oak]', '%', '[Ward']);
        return `message :faulty with ${carried}`;
      },
      // A world: its name, what it is composed from, a brace, a member.
      () => option(['world faulty: 4 { }', 'world faulty', 'world: sprout.World']),
      () =>
        `world faulty: sprout.World {\n  visitors arrive at ${option(['yard.', 'yard..shed', 'yard.4', 'yard . shed'])}\n}`,
      unclosedWorld,
      () => `world faulty: sprout.World {\n  visitors are P\n  ${defectiveMember(c).text}\n}`,
      // A kind: its name, what it composes, its braces, a member.
      () =>
        option([
          'kind',
          'kind faulty { }',
          'kind: Crate { }',
          'kind Faulty',
          'kind Faulty: 4 { }',
          'kind Faulty: Crate Fixture { }',
        ]),
      () => `kind Faulty: sprout.Container {\n  ${defectiveMember(c).text}\n}`,
      // An object: its name, what it composes, its container, a member.
      () =>
        option([
          'object',
          'object Faulty: Crate in yard',
          'object faulty: 4 in yard',
          'object faulty: Crate',
          'object faulty: Crate { }',
          'object faulty: Crate in { }',
          'object faulty: Crate in Yard',
          'object faulty: Crate in yard.',
          'object faulty: Crate in yard..shed',
          'object faulty: Crate in yard.4 { }',
          'object faulty: Crate in yard.Shed',
          'object faulty: Crate in yard . shed { contains }',
        ]),
      () => `object faulty: Crate in yard {\n  ${defectiveMember(c).text}\n}`,
    ];
    const used = new Set<number>();
    for (let i = 0; i < 700; i++) {
      const declared = c.shuffled(DECLARED).slice(0, c.below(DECLARED.length + 1));
      const which = c.below(DEFECTIVE.length);
      used.add(which);
      const unclosed = DEFECTIVE[which] === unclosedWorld;
      // After a world never closed, now and then a declaration whose own
      // header reads like the entries of a `:remembers`.
      const following =
        unclosed && c.below(2) === 0 ? c.one(FOLLOWING.filter((f) => !f.wellFormed)) : null;
      const defect = `${DEFECTIVE[which]!()}${following === null ? '' : `\n${following.text}`}`;
      const blocks = declared.map((d) => d.text());
      blocks.splice(c.below(blocks.length + 1), 0, defect);
      const text = `${blocks.join('\n')}\n`;
      const { result, said } = reading(text, parseDeclarations);
      // What a construct never closed gives the file was written inside
      // it, so a capitalised word or a world's name written in the defect
      // may surface; a name written nowhere may not.
      const inside = [
        ...(defect.match(/[A-Z][A-Za-z_]*/g) ?? []),
        ...(defect.match(/world (\w+)/)?.slice(1) ?? []),
      ];
      const good = declared.map((d) => d.name);
      explained(
        text,
        'contained',
        result.map((d) => d.name.text),
        good,
        [...good, 'faulty', 'Faulty', ...inside],
        said,
      );
      if (unclosed) {
        reached.add(
          following !== null && defect.includes(':remembers') ? 'across' : 'unclosed world',
        );
        expect(
          said.some((d) => d.message === '`faulty` is never closed.'),
          `${text}\n  nothing says \`faulty\` is never closed`,
        ).toBe(true);
      }
      if (following !== null) closedByWhatFollows(text, 'faulty', following, result, said);
    }
    expect(used.size).toBe(DEFECTIVE.length);
    expect(reached.keys()).toEqual(['across', 'unclosed world']);
  });
});
