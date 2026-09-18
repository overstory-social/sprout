import { describe, expect, it } from 'vitest';

import { compileSprout } from './sprout-lang.js';
import { type SproutDefinition } from './sprout.js';
import { type SproutState } from './definitions.js';

import {
  actorObject,
  normalizeObjectState,
  normalizeState,
  type SproutObject,
  type Scene,
} from './engine.js';
import {
  complete,
  parseCommand,
  tokenizeCommand,
  whatYouCanSay,
  type ParseContext,
} from './parser.js';
import { grammarLines, grammarTokens } from './grammar.js';

// The command parser (#342), in Inform's test cases in miniature:
// articles ignored, multi-word nouns, adjectives that disambiguate, two
// keys and a question, "it", "take all", partial understanding, and the
// same-kind rule that takes any one of four wet cups without asking.

function sprout(source: string): SproutDefinition {
  const result = compileSprout(source);
  if (!result.definition) {
    throw new Error(result.problems.map((p) => `${p.line}:${p.column} ${p.message}`).join('\n'));
  }
  return result.definition;
}

const ACTOR = 'p-actor';

function object(
  id: string,
  kind: 'room' | 'item',
  definition: SproutDefinition,
  state: SproutState = {},
  where: string | null = 'room',
  kinds: string[] = [],
): SproutObject {
  return {
    id,
    kind,
    definition,
    kinds,
    state: normalizeObjectState(definition, state),
    visitor: normalizeState(definition.remembers, {}),
    container: kind === 'room' ? null : where,
    home: kind === 'room' ? null : 'room',
    spawnedFrom: null,
  };
}

const CELLAR = sprout(`room cellar {
  :illuminated false
  light_up { grammar "light up the room"  self.set(:illuminated, true) }
  stamp { grammar "stamp your feet"  say "creak" }
}`);
const TORCH = sprout(`object torch {
  :names ["torch", "brand"]
  :on_fire false
  :takeable true
  use (with: object) {
    grammar "light [self] with [with]"
    grammar "use [with] on [self]"
    say "whump"
  }
  wave { say "it waves" }
}`);
const FLINT = sprout(`object flint {
  :names ["flint", "flint and steel"]
  :on_fire true
  :takeable true
  strike { grammar "strike [self]"  say "sparks" }
}`);
const BRASS_KEY = sprout(
  `object brass_key { :names ["key"] :takeable true :metal one_of [brass, iron] default brass }`,
);
const IRON_KEY = sprout(
  `object iron_key { :names ["key"] :takeable true :metal one_of [brass, iron] default iron }`,
);
const CUP = sprout(
  `object cup { :names ["cup"] :takeable true :state one_of [wet, fired] default wet }`,
);
const CHEST = sprout(`object chest: Container { :open true :names ["chest", "box"] }`);
const ROCK = sprout(`object rock { :names ["rock"] }`);

function ctx(items: SproutObject[], extra: Partial<ParseContext> = {}): ParseContext {
  const room = object('r', 'room', CELLAR);
  const fixed = items.map((i) => ({
    ...i,
    container: i.container === 'room' ? room.id : i.container,
    home: room.id,
  }));
  const scene: Scene = { room, actor: actorObject(ACTOR), items: fixed };
  return {
    scene,
    exits: [
      { label: 'up the stair', toRoomId: 'r-hall' },
      { label: 'through the beaded curtain', toRoomId: 'r-shop' },
    ],
    people: [{ handle: 'marta', id: 'p-marta' }],
    ...extra,
  };
}

const HERE = () =>
  ctx([
    object('i-torch', 'item', TORCH),
    object('i-flint', 'item', FLINT, {}, ACTOR),
    object('i-brass', 'item', BRASS_KEY),
    object('i-iron', 'item', IRON_KEY),
    object('i-chest', 'item', CHEST),
    object('i-rock', 'item', ROCK),
  ]);

const parse = (text: string, c: ParseContext = HERE()) => parseCommand(c, text);
const command = (text: string, c?: ParseContext) => {
  const r = parse(text, c);
  if (!r.ok) throw new Error(`no command: ${r.reply}`);
  return r.command;
};
const reply = (text: string, c?: ParseContext) => {
  const r = parse(text, c);
  if (r.ok) throw new Error(`parsed: ${JSON.stringify(r.command)}`);
  return r.reply;
};

describe('words and grammar', () => {
  it('tokenises, dropping articles and filler, keeping order', () => {
    expect(tokenizeCommand('Light the Torch with a flint, please!')).toEqual([
      'light',
      'torch',
      'with',
      'flint',
    ]);
  });

  it('turns a grammar line into literals and slots; an unknown slot is dropped', () => {
    expect(grammarTokens('light [self] with [with]', ['with'])).toEqual([
      { lit: 'light' },
      { slot: 'self', kind: 'object' },
      { lit: 'with' },
      { slot: 'with', kind: 'object' },
    ]);
    expect(grammarTokens('poke [ghost]', [])).toEqual([{ lit: 'poke' }]);
  });

  it('a message without grammar gets the default lines from its name and arguments', () => {
    expect(grammarLines(TORCH.messages[1]!)).toEqual(['wave [self]']);
    expect(grammarLines({ ...TORCH.messages[0]!, grammar: [] })).toEqual([
      'use [self]',
      'use [self] with [with]',
    ]);
  });
});

describe('parseCommand: the builder’s grammar', () => {
  it('matches a grammar line, binding self and an argument, articles ignored, multi-word nouns first', () => {
    expect(command('light the torch with the flint and steel')).toEqual({
      kind: 'verb',
      targetId: 'i-torch',
      message: 'use',
      args: { with: 'i-flint' },
    });
    expect(command('use flint on torch')).toMatchObject({
      targetId: 'i-torch',
      args: { with: 'i-flint' },
    });
    expect(parse('light torch with flint')).toMatchObject({ ok: true, noun: 'i-torch' });
  });

  it('a line without [self] implies its owner; a bare default line works too', () => {
    expect(command('stamp your feet')).toEqual({
      kind: 'verb',
      targetId: 'r',
      message: 'stamp',
      args: {},
    });
    expect(command('wave the brand')).toEqual({
      kind: 'verb',
      targetId: 'i-torch',
      message: 'wave',
      args: {},
    });
  });

  it('prefers the object’s own message over a built-in with the same words', () => {
    const c = ctx([object('i-torch', 'item', TORCH), object('i-flint', 'item', FLINT)]);
    // "strike" is only the flint's; "take" is only built-in
    expect(command('strike the flint', c)).toMatchObject({ kind: 'verb', message: 'strike' });
    expect(command('take the flint', c)).toEqual({ kind: 'take', itemIds: ['i-flint'] });
  });

  it('two keys: a question, unless an adjective settles it', () => {
    expect(reply('take the key')).toBe('Which do you mean, the brass key or the iron key?');
    expect(command('take the brass key')).toEqual({ kind: 'take', itemIds: ['i-brass'] });
    expect(command('take iron key')).toEqual({ kind: 'take', itemIds: ['i-iron'] });
    expect(parse('take the key')).toMatchObject({ ok: false, missed: false });
  });

  it('four wet cups are one kind in one state: any will do, the first is taken without a question', () => {
    const cups = ['i-cup-3', 'i-cup-1', 'i-cup-2'].map((id) => object(id, 'item', CUP));
    const c = ctx(cups);
    expect(command('take a cup', c)).toEqual({ kind: 'take', itemIds: ['i-cup-1'] });
    cups[1]!.state['state'] = 'fired';
    expect(reply('take cup', c)).toBe(
      'Which do you mean, the fired cup, the wet cup, or the wet cup?',
    );
    expect(command('take the fired cup', c)).toEqual({ kind: 'take', itemIds: ['i-cup-1'] });
  });

  it('"it" is the last noun; "take all" is everything here', () => {
    expect(command('wave it', ctx(HERE().scene.items, { lastNoun: 'i-torch' }))).toMatchObject({
      targetId: 'i-torch',
      message: 'wave',
    });
    expect(command('take all')).toEqual({
      kind: 'take',
      itemIds: ['i-brass', 'i-chest', 'i-iron', 'i-rock', 'i-torch'],
    });
    expect(reply('take it')).toBe("You can't see any such thing.");
  });
});

describe('parseCommand: the built-ins', () => {
  it('look, inventory, wait, help, examine', () => {
    expect(command('look')).toEqual({ kind: 'look' });
    expect(command('l')).toEqual({ kind: 'look' });
    expect(command('i')).toEqual({ kind: 'inventory' });
    expect(command('wait')).toEqual({ kind: 'wait' });
    expect(command('what can I do')).toEqual({ kind: 'help' });
    expect(command('?')).toEqual({ kind: 'help' });
    expect(command('look at the torch')).toEqual({ kind: 'examine', id: 'i-torch' });
    expect(command('x rock')).toEqual({ kind: 'examine', id: 'i-rock' });
  });

  it('take, drop (only what is held), put in (only an open container), give to (someone present)', () => {
    expect(command('pick up the torch')).toEqual({ kind: 'take', itemIds: ['i-torch'] });
    expect(command('drop the flint')).toEqual({ kind: 'drop', itemIds: ['i-flint'] });
    expect(reply('drop the torch')).toBe("You can't see any such thing.");
    expect(command('put the flint in the box')).toEqual({
      kind: 'put',
      itemId: 'i-flint',
      intoId: 'i-chest',
    });
    expect(reply('put the flint in the rock')).toBe("You can't see any such thing.");
    expect(command('give the flint to marta')).toEqual({
      kind: 'give',
      itemId: 'i-flint',
      toProfileId: 'p-marta',
    });
    expect(command('hand flint to @marta')).toMatchObject({ kind: 'give' });
    expect(reply('give the flint to bob')).toBe("You can't see any such thing.");
  });

  it('go: by the exit’s label, a word of it, or a direction in it', () => {
    expect(command('go up the stair')).toEqual({ kind: 'go', toRoomId: 'r-hall' });
    expect(command('up')).toEqual({ kind: 'go', toRoomId: 'r-hall' });
    expect(command('stair')).toEqual({ kind: 'go', toRoomId: 'r-hall' });
    expect(command('go through the beaded curtain')).toEqual({ kind: 'go', toRoomId: 'r-shop' });
    expect(command('curtain')).toEqual({ kind: 'go', toRoomId: 'r-shop' });
    expect(reply('go north')).toBe("You can't go that way.");
  });
});

describe('a miss says how far it got', () => {
  it('the verb landed, the noun did not', () => {
    expect(reply('light the lantern with the flint')).toBe("You can't see any such thing.");
    expect(parse('light the lantern with the flint')).toMatchObject({ missed: true });
  });

  it('the verb landed alone', () => {
    expect(reply('light')).toBe('I only understood you as far as wanting to light something.');
    expect(reply('take')).toBe('I only understood you as far as wanting to take something.');
  });

  it('a noun without a verb, and a word nothing here knows', () => {
    expect(reply('torch')).toBe('I see the torch, but not what to do with it. Try a verb first.');
    expect(reply('xyzzy')).toBe('I don\'t know the word "xyzzy" here.');
    expect(reply('   ')).toBe('Say something, and I will try.');
  });
});

describe('completion and help', () => {
  it('completes from the same grammar, slots filled with what is here, shortest first', () => {
    const lines = complete(HERE(), 'li');
    expect(lines[0]).toBe('light up the room');
    expect(lines).toContain('light torch with flint');
    expect(lines).toContain('light torch with torch');
    expect(complete(HERE(), 'take b')).toEqual(['take box', 'take brand']);
    expect(complete(HERE(), 'zzz')).toEqual([]);
  });

  it('help lists every grammar line of what is here, slots as ellipses', () => {
    expect(whatYouCanSay(HERE())).toEqual([
      'light up the room',
      'stamp your feet',
      'light torch with …',
      'use … on torch',
      'wave torch',
      'strike flint',
    ]);
  });
});
