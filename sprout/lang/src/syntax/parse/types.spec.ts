import { describe, expect, it } from 'vitest';

import type { Literal } from '../ast.js';
import { locationOf, textOf } from '../../source/source.js';
import { DEFAULT_LIMITS, type StaticCaps } from '../../bundle/limits.js';
import { atMember, readWith, rest } from '../../fixtures/readers.js';
import { file } from './declarations.js';
import type { Parser } from './parser.js';
import { property } from './properties.js';
import { remembers } from './remembers.js';
import { atFraction, atType, literal, skipValue, typeExpr } from './types.js';

/** A `remembers` block read on its own, where nothing but the end of the file ends it. */
const rememberBlock = (p: Parser) => remembers(p, () => false);

/** `reader` over `text` in the file `k.sprout`: what it read, the parser it left, and what was said. */
const run = <T>(reader: (p: Parser) => T, text: string, caps?: StaticCaps) =>
  readWith(reader, text, { name: 'k.sprout', caps });

/** A value, read by `literal`, what it left, and what was said. */
function readValue(text: string, caps?: StaticCaps) {
  const { read, p, refusals } = run(literal, text, caps);
  return { value: read, rest: rest(p), refusals };
}

/** One property, read by `property`, for what a type or a value leaves to the property around it. */
function readProperty(text: string) {
  const { read, refusals } = run(property, text);
  return { declared: read, refusals };
}

/** Every declaration in `text`, and what was said. */
function read(text: string) {
  const { read: declarations, refusals } = readWith(file, text);
  return { declarations, refusals };
}

/** The option names a list default holds, gathered at any depth. */
function optionsOf(literal: Literal | null | undefined): string[] {
  if (literal?.kind === 'option-literal') return [literal.name.text];
  if (literal?.kind === 'list-literal') return literal.elements.flatMap(optionsOf);
  return [];
}

/** The leaf values — integers, strings, booleans — a list default holds, at any depth. */
function leavesOf(literal: Literal | null | undefined): (number | string | boolean)[] {
  if (literal?.kind === 'list-literal') return literal.elements.flatMap(leavesOf);
  if (literal?.kind === 'integer' || literal?.kind === 'string' || literal?.kind === 'boolean') {
    return [literal.value];
  }
  return [];
}

describe('a file that runs out is explained once, not once per bracket', () => {
  const diagnose = (text: string, reader: (p: Parser) => unknown = literal): string[] =>
    run(reader, text).diagnostics.all.map((d) => d.message);

  it('says a nested unclosed list is unclosed once, however deep it is', () => {
    for (const text of ['[oak,[Zeta', '[oak, [oak2, [Zeta', '[a, [b, [c, [Zeta']) {
      const said = diagnose(text);
      expect(
        said.filter((m) => m === 'This list is never closed.'),
        text,
      ).toHaveLength(1);
    }
  });

  it('does not add the outer construct’s own complaint on top of the inner one', () => {
    expect(diagnose('remembers { :a [oak,[Zeta', rememberBlock)).toEqual([
      '`Zeta`, which starts with a capital is not a value.',
      'This list is never closed.',
    ]);
  });

  it('still says so once where the list itself is the one that ran out', () => {
    expect(diagnose('[oak')).toEqual(['This list is never closed.']);
    expect(diagnose('[oak, Zeta')).toEqual([
      '`Zeta`, which starts with a capital is not a value.',
      'This list is never closed.',
    ]);
    expect(diagnose('remembers { :a 0', rememberBlock)).toEqual([
      'This `remembers` block is never closed.',
    ]);
  });
});

describe('invariants over generated input, brackets included', () => {
  // A small, deterministic generator with brackets in its token pool,
  // so that it generates nested lists — the shape recovery bugs turn on
  // — checking invariants rather than any particular input.
  const POOL = [
    'enum',
    'message',
    'Ward',
    'oak',
    'boolean',
    'default',
    'min',
    'true',
    '4',
    '1.5',
    '"x"',
    ':a',
    '[',
    ']',
    '{',
    '}',
    ',',
    ':',
    '.',
    '%',
    '-',
  ];

  /** A fixed sequence, so a failure is reproducible and the suite is deterministic. */
  function* generated(count: number, seed = 20_260_921): Generator<string> {
    let state = seed;
    const next = (): number => (state = (state * 1_103_515_245 + 12_345) % 2_147_483_648);
    for (let i = 0; i < count; i++) {
      const length = 1 + (next() % 12);
      const words: string[] = [];
      for (let w = 0; w < length; w++) words.push(POOL[next() % POOL.length]!);
      yield words.join(' ');
    }
  }

  const readers: [string, (p: Parser) => unknown][] = [
    ['typeExpr', typeExpr],
    ['literal', literal],
    ['property', property],
    ['remembers', rememberBlock],
    ['file', file],
  ];

  for (const [name, reader] of readers) {
    it(`${name} never throws, and never says one thing twice in one place`, () => {
      for (const text of generated(600)) {
        let said: ReturnType<typeof run>['diagnostics'] | undefined;
        expect(() => {
          said = run(reader, text).diagnostics;
        }, text).not.toThrow();
        const seen = new Set<string>();
        for (const problem of said!.all) {
          const key = `${problem.message}@${problem.at.start}-${problem.at.end}`;
          expect(seen.has(key), `${text}\n  repeated: ${problem.message}`).toBe(false);
          seen.add(key);
        }
      }
    });
  }

  // A diagnostic that should appear can vanish as easily as one that
  // should not can arrive, and a held-back one — the missing comma,
  // which waits for the next word to prove it was wanted — is the kind
  // that vanishes quietly. So the count is checked against the input
  // that produced it, over words an option may be and words it may not.
  it('reports one missing comma for every gap, whatever words the gaps are between', () => {
    // Not `object` beside `is` or `in`: `object oak is` is where an object
    // declaration starts, so a body written that way is an enum never
    // closed and not a missing comma.
    const WORDS = [
      'oak',
      'silver',
      'iron',
      'default',
      'enum',
      'message',
      'world',
      'kind',
      'true',
      'min',
    ];
    const wanted = '`Ward` needs a comma between its options.';
    let state = 20_260_922;
    const next = (): number => (state = (state * 1_103_515_245 + 12_345) % 2_147_483_648);
    for (let i = 0; i < 400; i++) {
      const words: string[] = [WORDS[next() % WORDS.length]!];
      let body = words[0]!;
      let gaps = 0;
      for (let w = 1 + (next() % 6); w > 0; w--) {
        const missing = next() % 2 === 0;
        if (missing) gaps += 1;
        const word = WORDS[next() % WORDS.length]!;
        body += `${missing ? ' ' : ', '}${word}`;
      }
      const text = `enum Ward { ${body} }`;
      const said = read(text).refusals.filter((d) => d.message === wanted).length;
      expect(said, text).toBe(gaps);
    }
  });

  it('gives the same answer for the same source, every time', () => {
    for (const text of generated(200, 7)) {
      const once = run(file, text).diagnostics;
      const twice = run(file, text).diagnostics;
      expect(
        twice.all.map((d) => d.message),
        text,
      ).toEqual(once.all.map((d) => d.message));
    }
  });
});

describe('brackets inside brackets with something unreadable at the bottom, enumerated', () => {
  // The random generator above reaches bracket depth two in about one
  // input in forty, which is thin cover for the one shape recovery
  // bugs turn on: brackets inside brackets, something unreadable at
  // the bottom, closed or not. So that shape is enumerated rather than
  // sampled.
  //
  // Every level opens with a lower-case element, which is not
  // decoration. `atType()` skips past every leading `[` before deciding
  // whether what is underneath looks like a type, so `:x [[[Zeta` is
  // read as an attempted list TYPE and never reaches the recovery this
  // suite is about. A lower-case element at the head of each level is
  // what makes the brackets values: `:x [oak,[Zeta`, `:x [oak, [oak2,
  // [Zeta`.
  //
  // `enum` is not among the unreadable tokens on purpose: nothing
  // reserves an option's name, so `[enum]` is a legal list holding one
  // option and says nothing.
  const BAD = ['Zeta', '{', '}', ':a', '1.5', '%'];

  /** The vocabulary of the type path, which these shapes must never reach. */
  const TYPE_PATH = 'list type';

  function* shapes(): Generator<{ text: string; what: string }> {
    for (let depth = 1; depth <= 6; depth++) {
      const open = Array.from({ length: depth }, (_, i) => `[oak${i}, `).join('');
      const close = ']'.repeat(depth);
      for (const bad of BAD) {
        for (const [tail, what] of [
          ['', 'unclosed'],
          [close, 'closed'],
          [`, last${close}`, 'closed with a good neighbour'],
        ] as const) {
          yield { text: `:x ${open}${bad}${tail}`, what: `depth ${depth}, ${bad}, ${what}` };
          yield {
            text: `remembers { :a ${open}${bad}${tail} }`,
            what: `remembers depth ${depth}, ${bad}, ${what}`,
          };
        }
      }
    }
  }

  const readings = (text: string): { property: string[]; remembers: string[] } => {
    return {
      property: run(property, text).diagnostics.all.map((d) => d.message),
      remembers: run(rememberBlock, text).diagnostics.all.map((d) => d.message),
    };
  };

  it('actually reaches the recovery it is about, for every shape in it', () => {
    // The check that keeps this suite from passing while covering
    // nothing.
    let reached = 0;
    for (const { text, what } of shapes()) {
      const said = readings(text);
      const both = [...said.property, ...said.remembers];
      expect(
        both.some((m) => m.includes(TYPE_PATH)),
        `${what}: ${text} went to the type path`,
      ).toBe(false);
      expect(both.length, `${what}: ${text} said nothing`).toBeGreaterThan(0);
      reached += 1;
    }
    expect(reached).toBe(6 * BAD.length * 3 * 2);
  });

  it('says nothing twice in one place, at any depth', () => {
    for (const { text, what } of shapes()) {
      for (const reader of [property, rememberBlock] as ((p: Parser) => unknown)[]) {
        const { diagnostics } = run(reader, text);
        const seen = new Set<string>();
        for (const problem of diagnostics.all) {
          const key = `${problem.message}@${problem.at.start}-${problem.at.end}`;
          expect(seen.has(key), `${what}: ${text}\n  repeated: ${problem.message}`).toBe(false);
          seen.add(key);
        }
      }
    }
  });

  it('says "never closed" at most once, however deep the brackets go', () => {
    for (const { text, what } of shapes()) {
      const said = readings(text).property;
      const unclosed = said.filter((m) => m.includes('never closed'));
      expect(unclosed.length, `${what}: ${text}`).toBeLessThanOrEqual(1);
    }
  });

  it('keeps the well-formed neighbour that follows the unreadable one', () => {
    for (let depth = 1; depth <= 4; depth++) {
      const open = Array.from({ length: depth }, (_, i) => `[oak${i}, `).join('');
      for (const bad of BAD) {
        const text = `${open}${bad}, last${']'.repeat(depth)}`;
        expect(readValue(text).value, `${text} gave back nothing`).not.toBeNull();
        expect(readProperty(`:x ${text}`).declared, `:x ${text} gave back nothing`).not.toBeNull();
      }
    }
  });
});

describe('a list is bounded by what the host allows', () => {
  const allowed = DEFAULT_LIMITS.caps.listElements;
  const list = (many: number) => `[${Array.from({ length: many }, (_, i) => `e${i}`).join(', ')}]`;

  it('reads a list up to the cap, and refuses one past it', () => {
    expect(readValue(list(allowed)).value).not.toBeNull();
    expect(readValue(list(allowed + 1)).value).toBeNull();
    expect(readProperty(`:x [Ward] default ${list(allowed + 1)}`).declared).toBeNull();
  });

  it('refuses rather than keeping the first few, because a silent drop is the one thing it must not be', () => {
    const { value, refusals } = readValue(list(allowed + 4));
    expect(value).toBeNull();
    expect(refusals.map((d) => d.message)).toContain(`A list holds at most ${allowed} things.`);
  });

  it('points at the element that breaks it, not at the list', () => {
    // The span, not only the words: a report at the opening bracket
    // would say the right thing about the wrong place.
    const { refusals } = readValue(list(allowed + 1));
    const cap = refusals.find((d) => d.message.startsWith('A list holds at most'))!;
    expect(textOf(cap.at)).toBe(`e${allowed}`);
  });

  it('is counted per list, so two over-cap lists are two reports', () => {
    // `overCap` is a local, where the depth bound's report is a field
    // reset once per declaration. Copying that shape here would report
    // the first list and drop the second in silence, which is the one
    // thing a full list must never do.
    const caps = { ...DEFAULT_LIMITS.caps, listElements: 3 };
    const { refusals } = run(rememberBlock, 'remembers { :a [1, 2, 3, 4] :b [5, 6, 7, 8] }', caps);
    expect(refusals.filter((d) => d.message.startsWith('A list holds at most'))).toHaveLength(2);
  });

  it('says it once, and still says what else is wrong inside', () => {
    const over = `[${Array.from({ length: allowed + 4 }, (_, i) => `e${i}`).join(', ')}, Zeta]`;
    const said = readValue(over).refusals.map((d) => d.message);
    expect(said.filter((m) => m.startsWith('A list holds at most'))).toHaveLength(1);
    expect(said.join(' ')).toContain('`Zeta`, which starts with a capital is not a value.');
  });

  it('takes the bound from the host rather than a number of its own', () => {
    const caps = { ...DEFAULT_LIMITS.caps, listElements: 2 };
    expect(readValue(list(2), caps).value).not.toBeNull();
    const { value, refusals } = readValue(list(3), caps);
    expect(value).toBeNull();
    expect(refusals.map((d) => d.message)).toContain('A list holds at most 2 things.');
  });
});

describe('a type is not taken from the next declaration', () => {
  it('says the type is missing where `object` starts an object, though it names a type too', () => {
    // The object after it is the file's, to read and refuse there.
    const { read: type, p, refusals } = run(typeExpr, '\nobject bench is Bench\n');
    expect(type).toBeNull();
    expect(refusals.map((d) => [locationOf(d.at), d.message])).toEqual([
      ['k.sprout:2:1', '`object` starts a declaration, so the type before it is missing.'],
    ]);
    expect(rest(p)).toBe('object bench is Bench\n');
    // Where no declaration follows, `object` is the type it names.
    expect(run(typeExpr, 'object\n').read).toMatchObject({ name: { text: 'object' } });
  });

  it('says the same where it is an enum that follows', () => {
    const { read: type, p, refusals } = run(typeExpr, '\nenum Ward { oak }\n');
    expect(type).toBeNull();
    expect(refusals.map((d) => d.message)).toEqual([
      '`enum` starts a declaration, so the type before it is missing.',
    ]);
    expect(rest(p)).toBe('enum Ward { oak }\n');
  });
});

describe('a value abandoned to recovery does not step into the next declaration', () => {
  it('does not take a bad bound’s neighbour word for the rest of it', () => {
    // `:x true max -` fails at its bound and steps over what is left
    // of it; that step must stop at `kind`, the next declaration's own
    // word, or `Omega` vanishes with nothing said about it.
    const { read: declared, p, refusals } = run(property, ':x true max -\nkind Omega { }\n');
    expect(declared).toBeNull();
    expect(refusals.map((d) => d.message)).toEqual(['A max is a whole number.']);
    expect(rest(p)).toBe('kind Omega { }\n');
    const skipped = run(skipValue, '- oak\nkind Omega { }\n').p;
    expect(rest(skipped)).toBe('kind Omega { }\n');
  });
});

describe('an unclosed list stops at what follows it, not the file', () => {
  /** The list a world's property `:a` starts, read by `literal` where the world's body holds it. */
  const inWorld = (text: string) => {
    const { p, diagnostics } = atMember(text, text.indexOf('['), 'w');
    const value = literal(p);
    return { value, rest: rest(p), refusals: diagnostics.refusals };
  };

  it('refuses it once at the member written after it, and keeps that member', () => {
    const { value, rest, refusals } = inWorld('world w is sprout.World {\n  :a [oak\n  :b 1\n}\n');
    expect(refusals.map((d) => [locationOf(d.at), d.message])).toEqual([
      ['ward.sprout:3:3', 'This list is never closed.'],
    ]);
    expect(value).toBeNull();
    expect(rest).toBe(':b 1\n}\n');
  });

  it('refuses it once at the body’s own `}` when nothing else follows', () => {
    const { rest, refusals } = inWorld('world w is sprout.World {\n  :a [oak\n}\n');
    expect(refusals.map((d) => [locationOf(d.at), d.message])).toEqual([
      ['ward.sprout:3:1', 'This list is never closed.'],
    ]);
    expect(rest).toBe('}\n');
  });

  it('says so once, however deep it is nested, when a member follows', () => {
    const { rest, refusals } = inWorld('world w is sprout.World {\n  :a [[oak\n  :b 1\n}\n');
    expect(refusals.map((d) => d.message)).toEqual(['This list is never closed.']);
    expect(rest).toBe(':b 1\n}\n');
  });
});

describe('a guard after a list default is the next member, not more of the list', () => {
  it('keeps the guard whole after a list closed where it should be, and one closed early', () => {
    for (const list of ['[oak, silver]', '[oak, ], silver]']) {
      const text = `kind K {\n  :x [Ward] default ${list}\n  accept (item, from) { allow }\n}`;
      const { p } = atMember(text, text.indexOf(list), 'K');
      expect(literal(p), list).not.toBeNull();
      expect(rest(p), list).toBe('accept (item, from) { allow }\n}');
    }
  });
});

describe('a stray `]` inside a list default does not lose what it closed too early', () => {
  it('names what is written after it rather than dropping it in silence', () => {
    // The stray closer ends the inner list at `silver`, as it must —
    // nothing before a `]` can tell a stray one from its own — but the
    // second `]` right after it is the mistake: `brass` and `tin` are
    // named rather than left for whatever reads next to lose.
    const { value, refusals } = readValue('[[oak, silver, ]], [brass, tin]]');
    expect(refusals.map((d) => d.message)).toEqual([
      '`brass` and `tin` are written after the `]` that ends this list.',
    ]);
    expect(refusals[0]!.remedy).toBe(
      'Everything the list holds goes inside its brackets. Take out the `]` that ends it too early.',
    );
    expect(textOf(refusals[0]!.at)).toBe('brass');
    expect(optionsOf(value)).toEqual(['oak', 'silver']);
  });

  it('says nothing else about the property once it has named them', () => {
    const text = ':x [[Ward]] default [[oak, silver, ]], [brass, tin]] min 0';
    const { refusals } = readProperty(text);
    expect(refusals).toHaveLength(1);
  });

  it('does the same for a single-level list, one `]` early', () => {
    const { value, refusals } = readValue('[oak, ], silver]');
    expect(refusals.map((d) => d.message)).toEqual([
      '`silver` is written after the `]` that ends this list.',
    ]);
    expect(optionsOf(value)).toEqual(['oak']);
  });

  it('names integers, signed ones included, the same way for an integer list of lists', () => {
    const { value, refusals } = readValue('[[1, 2, ]], [-3, 4]]');
    expect(refusals.map((d) => d.message)).toEqual([
      '`-3` and `4` are written after the `]` that ends this list.',
    ]);
    expect(leavesOf(value)).toEqual([1, 2]);
  });

  it('names strings and true/false the same way', () => {
    const { value, refusals } = readValue('[["a", "b", ]], ["c", "d"]]');
    expect(refusals.map((d) => d.message)).toEqual([
      '`"c"` and `"d"` are written after the `]` that ends this list.',
    ]);
    expect(leavesOf(value)).toEqual(['a', 'b']);

    const said = readValue('[[true, false, ]], [true]]').refusals.map((d) => d.message);
    expect(said).toEqual(['`true` is written after the `]` that ends this list.']);
  });

  it('leaves a `remembers` entry after it for the block to read, not itself', () => {
    // `:visits` is the next property of the block, however this list
    // closed.
    const text = 'remembers { :tags [oak, ], silver] :visits 0 }';
    const { read: declared, refusals } = run(rememberBlock, text);
    expect(declared?.properties.map((p) => p.name.text)).toEqual(['tags', 'visits']);
    expect(refusals.map((d) => d.message)).toEqual([
      '`silver` is written after the `]` that ends this list.',
    ]);
  });

  it('leaves a word with a value after it for what reads next, as a property that lost its colon', () => {
    // `faulty "x"` has no colon, so nothing here can call it a property
    // for certain — but a bare word with another value standing right
    // after it, no comma between them, is never two elements of THIS
    // list either. The list's own close is genuine, not stray.
    const text = 'remembers { :echo [oak] faulty "x" }';
    const { read: declared, refusals } = run(rememberBlock, text);
    expect(declared?.properties.map((p) => p.name.text)).toEqual(['echo']);
    expect(optionsOf(declared?.properties[0]?.default)).toEqual(['oak']);
    expect(refusals.map((d) => d.message)).toEqual([
      'A `remembers` block holds properties, and `faulty` is not one.',
    ]);
    const inBody = readValue('[oak] faulty "x"\n  :after 1');
    expect(inBody.refusals).toEqual([]);
    expect(inBody.rest).toBe('faulty "x"\n  :after 1');
  });

  it('names a bare word after the `]` as more of the list where no value follows it', () => {
    const { refusals } = readValue('[oak, ], silver, gold]');
    expect(refusals.map((d) => d.message)).toEqual([
      '`silver` and `gold` are written after the `]` that ends this list.',
    ]);
  });
});

describe('what a type or a value starts with', () => {
  it('is a type where a capital, a built-in word or a bracket of one comes next', () => {
    for (const [text, is] of [
      ['Ward', true],
      ['sprout.Ward', true],
      ['integer', true],
      ['[[Ward]]', true],
      ['oak', false],
      ['[oak]', false],
      ['4', false],
    ] as const) {
      expect(atType(run(() => null, text).p), text).toBe(is);
    }
  });

  it('reads the types the spec writes, down to their spans', () => {
    for (const text of ['boolean', 'Ward', 'sprout.Ward', '[Ward]', '[[integer]]']) {
      const { read: type, p, refusals } = run(typeExpr, text);
      expect(refusals, text).toEqual([]);
      expect(textOf(type!.at), text).toBe(text);
      expect(p.done, text).toBe(true);
    }
  });

  it('refuses a fraction where a whole number is read, and steps over it', () => {
    /** Whether a fraction follows the whole number `text` starts with. */
    const afterNumber = (text: string) =>
      run((p) => {
        p.next();
        return atFraction(p);
      }, text);
    const { read: fraction, p, refusals } = afterNumber('1.5 :next');
    expect(fraction).toBe(true);
    expect(refusals.map((d) => d.message)).toEqual(['Sprout has no fractions.']);
    expect(rest(p)).toBe(':next');
    expect(afterNumber('1 :next').read).toBe(false);
  });
});
