import { describe, expect, it } from 'vitest';

import { Diagnostics } from '../../source/diagnostics.js';
import { parseDeclarations, parseProperty, parseRemembers } from '../parse.js';
import { SourceFile, textOf } from '../../source/source.js';
import { DEFAULT_LIMITS } from '../../bundle/limits.js';
import { read, readProperty } from '../../fixtures/parse.js';

describe('a file that runs out is explained once, not once per bracket', () => {
  const diagnose = (
    text: string,
    fn: (source: SourceFile, diagnostics: Diagnostics) => unknown = parseProperty,
  ): string[] => {
    const diagnostics = new Diagnostics();
    fn(new SourceFile('k.sprout', text), diagnostics);
    return diagnostics.all.map((d) => d.message);
  };

  it('says a nested unclosed list is unclosed once, however deep it is', () => {
    for (const text of [':x [oak,[Zeta', ':x [oak, [oak2, [Zeta', ':x [a, [b, [c, [Zeta']) {
      const said = diagnose(text);
      expect(
        said.filter((m) => m === 'This list is never closed.'),
        text,
      ).toHaveLength(1);
    }
  });

  it('does not add the outer construct’s own complaint on top of the inner one', () => {
    expect(diagnose(':remembers [a: [oak,[Zeta', parseRemembers)).toEqual([
      '`Zeta`, which starts with a capital is not a value.',
      'This list is never closed.',
    ]);
  });

  it('still says so once where the list itself is the one that ran out', () => {
    expect(diagnose(':x [oak')).toEqual(['This list is never closed.']);
    expect(diagnose(':x [oak, Zeta')).toEqual([
      '`Zeta`, which starts with a capital is not a value.',
      'This list is never closed.',
    ]);
    expect(diagnose(':remembers [a: 0', parseRemembers)).toEqual([
      'This `:remembers` is never closed.',
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

  const readers: [string, (s: SourceFile, d: Diagnostics) => unknown][] = [
    ['parseDeclarations', parseDeclarations],
    ['parseProperty', parseProperty],
    ['parseRemembers', parseRemembers],
  ];

  for (const [name, read] of readers) {
    it(`${name} never throws, and never says one thing twice in one place`, () => {
      for (const text of generated(600)) {
        const diagnostics = new Diagnostics();
        const source = new SourceFile('fuzz.sprout', text);
        expect(() => read(source, diagnostics), text).not.toThrow();
        const seen = new Set<string>();
        for (const problem of diagnostics.all) {
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
    const WORDS = ['oak', 'silver', 'iron', 'default', 'enum', 'message', 'world', 'true', 'min'];
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
      const source = new SourceFile('fuzz.sprout', text);
      const once = new Diagnostics();
      const twice = new Diagnostics();
      parseDeclarations(source, once);
      parseDeclarations(new SourceFile('fuzz.sprout', text), twice);
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
            text: `:remembers [a: ${open}${bad}${tail}]`,
            what: `remembers depth ${depth}, ${bad}, ${what}`,
          };
        }
      }
    }
  }

  const readings = (text: string): { property: string[]; remembers: string[] } => {
    const property = new Diagnostics();
    const remembers = new Diagnostics();
    parseProperty(new SourceFile('k.sprout', text), property);
    parseRemembers(new SourceFile('k.sprout', text), remembers);
    return {
      property: property.all.map((d) => d.message),
      remembers: remembers.all.map((d) => d.message),
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
      for (const read of [parseProperty, parseRemembers]) {
        const diagnostics = new Diagnostics();
        read(new SourceFile('k.sprout', text), diagnostics);
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
        const text = `:x ${open}${bad}, last${']'.repeat(depth)}`;
        const diagnostics = new Diagnostics();
        const declared = parseProperty(new SourceFile('k.sprout', text), diagnostics);
        expect(declared, `${text} gave back nothing`).not.toBeNull();
      }
    }
  });
});

describe('a list is bounded by what the host allows', () => {
  const allowed = DEFAULT_LIMITS.caps.listElements;
  const list = (many: number) =>
    `:x [Ward] default [${Array.from({ length: many }, (_, i) => `e${i}`).join(', ')}]`;

  it('reads a list up to the cap, and refuses one past it', () => {
    expect(readProperty(list(allowed)).declared).not.toBeNull();
    expect(readProperty(list(allowed + 1)).declared).toBeNull();
  });

  it('refuses rather than keeping the first few, because a silent drop is the one thing it must not be', () => {
    const { declared, refusals } = readProperty(list(allowed + 4));
    expect(declared).toBeNull();
    expect(refusals.map((d) => d.message)).toContain(`A list holds at most ${allowed} things.`);
  });

  it('points at the element that breaks it, not at the list', () => {
    // The span, not only the words: a report at the opening bracket
    // would say the right thing about the wrong place.
    const { refusals } = readProperty(list(allowed + 1));
    const cap = refusals.find((d) => d.message.startsWith('A list holds at most'))!;
    expect(textOf(cap.at)).toBe(`e${allowed}`);
  });

  it('is counted per list, so two over-cap lists are two reports', () => {
    // `overCap` is a local, where the depth bound's report is a field
    // reset once per declaration. Copying that shape here would report
    // the first list and drop the second in silence, which is the one
    // thing a full list must never do.
    const caps = { ...DEFAULT_LIMITS.caps, listElements: 3 };
    const diagnostics = new Diagnostics();
    parseRemembers(
      new SourceFile('k.sprout', ':remembers [a: [1, 2, 3, 4], b: [5, 6, 7, 8]]'),
      diagnostics,
      caps,
    );
    expect(
      diagnostics.refusals.filter((d) => d.message.startsWith('A list holds at most')),
    ).toHaveLength(2);
  });

  it('says it once, and still says what else is wrong inside', () => {
    const over = `:x [Ward] default [${Array.from({ length: allowed + 4 }, (_, i) => `e${i}`).join(', ')}, Zeta]`;
    const said = readProperty(over).refusals.map((d) => d.message);
    expect(said.filter((m) => m.startsWith('A list holds at most'))).toHaveLength(1);
    expect(said.join(' ')).toContain('`Zeta`, which starts with a capital is not a value.');
  });

  it('takes the bound from the host rather than a number of its own', () => {
    const caps = { ...DEFAULT_LIMITS.caps, listElements: 2 };
    expect(readProperty(list(2), caps).declared).not.toBeNull();
    const { declared, refusals } = readProperty(list(3), caps);
    expect(declared).toBeNull();
    expect(refusals.map((d) => d.message)).toContain('A list holds at most 2 things.');
  });
});
