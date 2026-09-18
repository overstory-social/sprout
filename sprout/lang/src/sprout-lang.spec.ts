import { describe, expect, it } from 'vitest';

import { MEDIA } from './fixtures/media.js';

import {
  compileSprout,
  compileSproutKind,
  definitionProblems,
  humanise,
  identOf,
  printSprout,
  tokenize,
} from './sprout-lang.js';
import { type SproutDefinition } from './sprout.js';

/** sprout.md §2.1, the torch — one object per source, so the torch alone. */
const TORCH = `
object torch: Container {
  :names ["torch", "brand", "stick"]
  :on_fire false
  :illuminating false
  :takeable true

  describe {
    if (self.get(:on_fire)) { text "A pitch torch, burning steadily." }
    else { text "A pitch torch, cold. It wants a light." }
  }

  use (with: object) {
    grammar "light [self] with [with]"
    grammar "use [with] on [self]"
    if (with.get(:on_fire)) {
      self.set(:on_fire, true)
      self.set(:illuminating, true)
      say "The pitch catches with a soft whump."
    } else {
      say "Nothing about that will light a torch."
    }
  }

  changed :illuminating (value) { broadcast :illuminating(value) }
  pass :illuminating (true)
  pass any (self.get(:open))
}
`;

const CELLAR = `
room cellar {
  :illuminated false
  describe {
    if (self.get(:illuminated)) {
      text "A vaulted cellar. Barrels along one wall; a stair up."
    } else {
      text "Pitch dark. You can feel a wall, and cold air moving."
    }
  }
  on :illuminating (from, value) { self.set(:illuminated, value) }
  accept (item, from) {
    if (item.is(Actor) && !self.get(:illuminated)) { refuse "Too dark to find the stair." }
    else { allow }
  }
  exit "up" to hall
}
`;

const ROOMS = new Map([
  ['hall', 'room-hall-id'],
  ['cellar', 'room-cellar-id'],
]);

function compiled(source: string): SproutDefinition {
  const result = compileSprout(source, { rooms: ROOMS, ext: MEDIA });
  if (!result.definition) {
    throw new Error(result.problems.map((p) => `${p.line}:${p.column} ${p.message}`).join('\n'));
  }
  return result.definition;
}

/** print → compile is the identity on the tree (source aside). */
function roundTrips(def: SproutDefinition): string {
  const idents = new Map([...ROOMS].map(([k, v]) => [v, k]));
  const printed = printSprout(def, { roomIdents: idents, ext: MEDIA });
  const again = compiled(printed);
  expect(again).toEqual(def);
  return printed;
}

describe('the lexer', () => {
  it('tokenises symbols, kinds, strings with escapes, comments and punctuation', () => {
    const tokens = tokenize(
      'object x: Kind { :p "a \\"q\\"" # note\n // more\n self.get(:p) != 3 }',
    );
    expect(tokens.map((t) => `${t.kind}:${t.text}`)).toEqual([
      'ident:object',
      'ident:x',
      'punct::',
      'kind:Kind',
      'punct:{',
      'symbol:p',
      'string:a "q"',
      'ident:self',
      'punct:.',
      'ident:get',
      'punct:(',
      'symbol:p',
      'punct:)',
      'punct:!=',
      'integer:3',
      'punct:}',
      'eof:',
    ]);
    expect(tokens[7]).toMatchObject({ line: 3, column: 2 });
  });
});

describe('compileSprout', () => {
  it('compiles the torch with zero problems', () => {
    const result = compileSprout(TORCH);
    expect(result.problems).toEqual([]);
    expect(result.warnings).toEqual([]);
    const def = result.definition!;
    expect(def.role).toBe('item');
    expect(def.name).toBe('Torch');
    expect(def.inherit).toBe('Container');
    expect(def.names).toEqual(['torch', 'brand', 'stick']);
    expect(def.properties).toEqual([
      { type: 'boolean', name: 'on_fire', default: false },
      { type: 'boolean', name: 'illuminating', default: false },
      { type: 'boolean', name: 'takeable', default: true },
    ]);
    expect(def.messages[0]).toMatchObject({
      name: 'use',
      args: [{ name: 'with', type: 'object' }],
      grammar: ['light [self] with [with]', 'use [with] on [self]'],
      when: null,
      abstract: false,
    });
    expect(def.hooks).toEqual([
      {
        property: 'illuminating',
        value: 'value',
        was: null,
        body: [
          { kind: 'broadcast', message: 'illuminating', value: { kind: 'ref', name: 'value' } },
        ],
      },
    ]);
    expect(def.passRules).toEqual([
      { message: 'illuminating', condition: { kind: 'literal', value: true } },
      { message: null, condition: { kind: 'get', target: { kind: 'self' }, property: 'open' } },
    ]);
  });

  it('compiles the cellar: exits through the room map, a consent guard, a handler with parameters', () => {
    const def = compiled(CELLAR);
    expect(def.role).toBe('room');
    expect('exits' in def && def.exits).toEqual([{ label: 'up', toRoomId: 'room-hall-id' }]);
    expect(def.handlers[0]).toMatchObject({
      message: 'illuminating',
      from: 'from',
      value: 'value',
    });
    expect(def.consents[0]).toMatchObject({ guard: 'accept', params: ['item', 'from'] });
  });

  it('accepts an exit to a room id in quotes, and refuses an unknown room name', () => {
    const raw = compiled('room r { exit "out" to "raw-id" }');
    expect(raw.role === 'room' && raw.exits).toEqual([{ label: 'out', toRoomId: 'raw-id' }]);
    expect(
      compileSprout('room r {\n  exit "out" to nowhere\n}', { rooms: ROOMS }).problems,
    ).toEqual([{ line: 2, column: 17, message: 'No room is called "nowhere" here.', level: null }]);
  });

  it('reads every property shape', () => {
    const def = compiled(`use media
    object o {
      :a true
      :b default false
      :c 3
      :d -2 min -5 max 5
      :e one_of [wet, "bone dry", fired] default fired
      :f one_of [x]
      :g "Sold out"
      :image media "m-abc"
      :blueprint media
      :remembers [met: false, cups: 0 min 0 max 99, mood: one_of [a, b] default b]
    }`);
    expect(def.uses).toEqual(['media']);
    expect(def.properties).toEqual([
      { type: 'boolean', name: 'a', default: true },
      { type: 'boolean', name: 'b', default: false },
      { type: 'integer', name: 'c', default: 3, min: -999_999, max: 999_999 },
      { type: 'integer', name: 'd', default: -2, min: -5, max: 5 },
      { type: 'enum', name: 'e', options: ['wet', 'bone dry', 'fired'], default: 'fired' },
      { type: 'enum', name: 'f', options: ['x'], default: 'x' },
      { type: 'string', name: 'g', default: 'Sold out' },
      { type: 'media', name: 'image', default: 'm-abc' },
      { type: 'media', name: 'blueprint', default: null },
    ]);
    expect(def.remembers.map((f) => f.name)).toEqual(['met', 'cups', 'mood']);
    expect(def.remembers[2]).toMatchObject({ type: 'enum', default: 'b' });
  });

  it('parses expressions with precedence, unary not, and every read', () => {
    const def = compiled(`object o {
      :n 0
      poke when (self.get(:n) + 1 > 2 && !actor.recall(:met) || room.count == 3 - 1) {
        if (with.is(Actor) || (self.get(:n) - 1) - 1 == 0) { say "x" }
      }
      :remembers [met: false]
    }`);
    const when = def.messages[0]!.when!;
    expect(when).toEqual({
      kind: 'binary',
      op: '||',
      left: {
        kind: 'binary',
        op: '&&',
        left: {
          kind: 'binary',
          op: '>',
          left: {
            kind: 'binary',
            op: '+',
            left: { kind: 'get', target: { kind: 'self' }, property: 'n' },
            right: { kind: 'literal', value: 1 },
          },
          right: { kind: 'literal', value: 2 },
        },
        right: { kind: 'not', expr: { kind: 'recall', property: 'met' } },
      },
      right: {
        kind: 'binary',
        op: '==',
        left: { kind: 'count', target: { kind: 'room' } },
        right: {
          kind: 'binary',
          op: '-',
          left: { kind: 'literal', value: 3 },
          right: { kind: 'literal', value: 1 },
        },
      },
    });
    const cond = (def.messages[0]!.body[0] as { cond: unknown }).cond;
    expect(cond).toMatchObject({
      kind: 'binary',
      op: '||',
      left: { kind: 'is', kindName: 'Actor' },
      right: {
        kind: 'binary',
        op: '==',
        left: { kind: 'binary', op: '-', left: { kind: 'binary', op: '-' } },
      },
    });
  });

  it('parses every statement', () => {
    const def = compiled(`use media
    object o: Container {
      :blueprint media
      :n 0
      :s one_of [a, b]
      :remembers [seen: 0 min 0 max 9]
      act (with: object) {
        self.set(:n, 1)
        self.adjust(:n, -1)
        self.set(:s, :b)
        actor.remember(:seen, actor.recall(:seen) + 1)
        broadcast :ping
        broadcast :pong(self.get(:n))
        send room :hush
        send with :nudge(true)
        show
        show self :blueprint
        show room
        move with to actor
        move self to room
        spawn Cup in actor
        each thing in self { send thing :shake }
        destroy self
      }
      release (item, to) { if (item.is(Actor)) { refuse "no" } else { allow } }
    }`);
    const kinds = def.messages[0]!.body.map((s) => s.kind);
    expect(kinds).toEqual([
      'set',
      'adjust',
      'set',
      'remember',
      'broadcast',
      'broadcast',
      'send',
      'send',
      'ext',
      'ext',
      'ext',
      'move',
      'move',
      'spawn',
      'each',
      'destroy',
    ]);
    expect(def.messages[0]!.body[8]).toEqual({
      kind: 'ext',
      extension: 'media',
      statement: 'show',
      args: { target: null, property: null },
    });
    expect(def.messages[0]!.body[9]).toEqual({
      kind: 'ext',
      extension: 'media',
      statement: 'show',
      args: {
        target: { kind: 'target', target: { kind: 'self' } },
        property: { kind: 'symbol', name: 'blueprint' },
      },
    });
    expect(def.messages[0]!.body[10]).toEqual({
      kind: 'ext',
      extension: 'media',
      statement: 'show',
      args: { target: { kind: 'target', target: { kind: 'room' } }, property: null },
    });
  });

  it('accepts an abstract message only on a kind — so refuses it here, with the parser-free checks', () => {
    const result = compileSprout('object o {\n  use (with: object) abstract\n}');
    expect(result.definition).toBeNull();
    expect(result.problems.map((p) => p.message)).toEqual([
      'Message "use" is abstract, and abstract messages belong on kinds, not on something placed in a room.',
    ]);
  });

  it('reports syntax problems with a line and column', () => {
    expect(compileSprout('object o {\n  say "hi"\n}').problems).toEqual([
      {
        line: 2,
        column: 3,
        message: '"say" is a keyword; a message needs another name.',
        level: null,
      },
    ]);
    expect(compileSprout('object o {\n  poke {\n    room.set(:x, 1)\n  }\n}').problems).toEqual([
      {
        line: 3,
        column: 5,
        message:
          'Only self may be written: tell the room (`send room :message`) and let it decide.',
        level: null,
      },
    ]);
    expect(compileSprout('kind Torch {}').problems[0]).toMatchObject({
      line: 1,
      column: 1,
      message: 'A kind is written in the kinds panel, not placed as an object or a room.',
    });
    expect(compileSprout('object torch: Torch in cellar {}').problems[0]!.message).toContain(
      'leave `in` out',
    );
    expect(compileSprout('object o { if { }').problems[0]!.message).toContain('is a keyword');
    expect(compileSprout('object o { poke { say "a\nb" } }').problems[0]!.message).toBe(
      'A string does not span lines.',
    );
    expect(compileSprout('object o { } object p { }').problems[0]!.message).toContain(
      'One object per source',
    );
    expect(compileSprout('object o { poke { grammar "x" } }').problems).toEqual([]);
    expect(
      compileSprout('object o { poke { if (true) { grammar "x" } } }').problems[0]!.message,
    ).toContain('top of a message body');
    expect(compileSprout('object o { x @ }').problems[0]).toEqual({
      line: 1,
      column: 14,
      message: 'Unexpected character "@".',
      level: null,
    });
  });

  it('turns semantic problems into problems at the head, deduplicated', () => {
    const result = compileSprout(
      'object o {\n  poke { self.set(:warmth, 1) self.set(:warmth, 2) }\n}',
    );
    expect(result.definition).toBeNull();
    expect(result.problems).toEqual([
      {
        line: 1,
        column: 1,
        message: 'Message "poke": "set" names a property "warmth" that self does not declare.',
        level: null,
      },
    ]);
    expect(definitionProblems(compiled(TORCH))).toEqual([]);
  });

  it('refuses a describe that spawns at save (§2.12, #441) — the builder learns at the editor, not at look', () => {
    const result = compileSprout(
      'object bag {\n  describe { text "A bag." spawn Lump in room }\n}',
    );
    expect(result.definition).toBeNull();
    expect(result.problems.map((p) => p.message)).toEqual([
      'Describe: "spawn" changes the world, and describe only reads it — put it in a message or a handler.',
    ]);
  });

  it('carries the warnings through', () => {
    const quiet = 'object o {\n  :a false\n  changed :a { say "x" }\n  on :ping { say "y" }\n}';
    const result = compileSprout(quiet);
    expect(result.warnings).toEqual([
      'Changed "a" never fires: nothing here sets it.',
      'On "ping" never fires: nothing sends it here.',
    ]);
    expect(compileSprout(quiet, { zoneMessages: ['ping'] }).warnings).toHaveLength(1);
  });

  it("does not take the next statement as an extension statement's optional target", () => {
    const def = compiled(
      'use media\nobject o {\n  :n 0\n  poke {\n    show\n    self.set(:n, 1)\n  }\n}',
    );
    expect(def.messages[0]!.body.map((s) => s.kind)).toEqual(['ext', 'set']);
  });

  it('refuses an extension the host lacks, and an extension statement in a source that does not use it', () => {
    expect(compileSprout('use pictures\nobject o { }', { ext: MEDIA }).problems[0]).toMatchObject({
      line: 1,
      message: 'This host has no extension called "pictures".',
    });
    // Without `use media`, `show` is an ordinary word — here a message nobody defined.
    expect(compileSprout('object o { poke { show } }', { ext: MEDIA }).problems[0]?.message).toBe(
      '"show" is not a statement.',
    );
    // `use` itself stays an ordinary word: the language's own example verb.
    expect(
      compileSprout('object o { use (with: object) { say "x" } }', { ext: MEDIA }).problems,
    ).toEqual([]);
  });
});

describe('printSprout', () => {
  it('round-trips the torch and the cellar', () => {
    const printed = roundTrips(compiled(TORCH));
    expect(printed).toContain('object torch: Container {');
    expect(printed).toContain('  changed :illuminating (value) {');
    expect(printed).toContain('  pass any (self.get(:open))');
    const cellar = roundTrips(compiled(CELLAR));
    expect(cellar).toContain('  exit "up" to hall');
    expect(cellar).toContain('  accept (item, from) {');
  });

  it('round-trips every property shape, statement and expression', () => {
    roundTrips(
      compiled(`use media
      object o: Container {
      :name "The odd one, comma and all"
      :names ["odd one", "thing"]
      :a true
      :c 3
      :d -2 min -5 max 5
      :e one_of [wet, "bone dry", fired] default fired
      :g "text"
      :image media "m-1"
      :plan media
      :remembers [met: false, cups: 0 min 0 max 99]
      prose "Plain \\"prose\\" with a\\nnewline."
      describe {
        show
        show self :plan
        show room
        if (self.get(:a)) { text "a" } else if (self.get(:c) > 2) { text "c" } else if (self.get(:e) == :wet) { text "w" } else { text "z" }
        if (self.get(:a)) { text "only" }
      }
      act (with: object, onto: object) when (!(self.get(:a) && self.get(:c) == 1) || with.is(Actor)) {
        grammar "act [with] onto [onto]"
        self.set(:c, (self.get(:c) - 1) - (2 - 3))
        self.set(:plan, "m-2")
        self.set(:plan, none)
        self.adjust(:c, self.get(:c) + 1 - 2)
        actor.remember(:cups, actor.recall(:cups) + 1)
        broadcast :ping
        broadcast :pong(self.get(:c))
        send room :hush
        send onto :nudge(true)
        show
        show self :plan
        move with to actor
        spawn Cup in room
        each thing in self { send thing :shake }
        destroy self
      }
      on :ping { say "p" }
      on :pong (_, value) { self.set(:c, value) }
      on :hush (from) { say "h" }
      changed :c (_, was) { say "c" }
      changed :a { say "a" }
      pass :ping (true)
      pass any (self.get(:open) || self.count > 3)
      depart (to) { if (to.is(Actor)) { refuse "stay" } else { allow } }
      release (item, to) { allow }
      accept (item, from) { allow }
    }`),
    );
  });

  it('parenthesises only where precedence needs it', () => {
    const def = compiled(`object o {
      :n 0
      poke when ((self.get(:n) + 1) == 2) { say "x" }
    }`);
    const printed = printSprout(def);
    expect(printed).toContain('poke when (self.get(:n) + 1 == 2) {');
    const nested = compiled(
      'object o {\n  :n 0\n  poke when (self.get(:n) - (1 - 2) == 0 && !(self.get(:n) == 1)) { say "x" }\n}',
    );
    expect(printSprout(nested)).toContain(
      'poke when (self.get(:n) - (1 - 2) == 0 && !(self.get(:n) == 1)) {',
    );
  });

  it('compiles and prints a kind (#341)', () => {
    const source = `kind WetCup: Usable {
  :names ["cup"]
  :state one_of [wet, leather] default wet

  use (with: object) abstract

  dry {
    self.set(:state, :leather)
  }
}
`;
    const result = compileSproutKind(source);
    expect(result.problems).toEqual([]);
    const kind = result.definition!;
    expect(kind).toMatchObject({
      role: 'kind',
      kindName: 'WetCup',
      name: 'Wet cup',
      inherit: 'Usable',
    });
    expect(kind.messages[0]).toMatchObject({ name: 'use', abstract: true });
    expect(printSprout(kind)).toBe(source);
    expect(compileSproutKind('object o {}').problems[0]!.message).toContain('A kind starts with');
    expect(compileSproutKind('kind Usable: Usable {}').problems[0]!.message).toBe(
      '"Usable" cannot inherit itself.',
    );
    expect(
      compileSprout('object o: Torch { :n 1 }', { zoneKinds: new Map() }).problems[0]!.message,
    ).toBe('No kind called "Torch" is defined here.');
  });

  it('names things both ways', () => {
    expect(humanise('kick_wheel')).toBe('Kick wheel');
    expect(identOf('Kick wheel')).toBe('kick_wheel');
    expect(identOf('The Front Room!')).toBe('the_front_room');
    expect(printSprout(compiled('object kick_wheel {}'))).toBe('object kick_wheel {\n}\n');
    expect(printSprout(compiled('object x { :name "Kick wheel" }'))).toBe(
      'object kick_wheel {\n}\n',
    );
  });
});
