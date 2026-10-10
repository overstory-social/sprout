// The shapes of a reading golden's cases, and the world they are written about: the bench of
// `fixtures/bench.ts` with a yard and a vault beyond its shop, the exits and the link that lead
// there, a butler who acts, a fuse who destroys itself, and the value and set roles the
// reading specs play. Spec support: the package build leaves it out.

import type { BenchExtras } from './bench.js';

/** Who an object a case names is: a path in the tree, or a visitor the state builder made. */
export type Who = readonly string[] | 'marta' | 'ines' | 'fuse';

/** What fills one role of a case's reading. */
export type Fill =
  | { readonly object: Who }
  | { readonly set: readonly Who[] }
  | { readonly value: number | string }
  | {
      readonly exit: {
        readonly direction: string | null;
        readonly label: string;
        readonly to: Who;
      };
    };

/** A reading and the state it is read in. */
export interface ReadingCase {
  readonly name: string;
  readonly area: string;
  readonly actor: Who;
  /** The verb by library and name. */
  readonly verb: string;
  /** What fills each role, by its name; a role left out is unfilled. */
  readonly fills?: Readonly<Record<string, Fill>>;
  readonly state?: string;
  readonly seed?: number;
}

/** What the world adds to the bench's shop. */
export const EXTRAS: BenchExtras = {
  grammar: [
    'exit north "to the yard" -> yard',
    'exit east "into the vault" -> vault say "The door groans."',
    'exit west "through the wall" refuse "The wall is solid."',
    'link onward "onward"',
  ],
  objects: [
    'object guard is Guard',
    'object dial is Dial',
    'object safe is Safe',
    'object both is Both',
    'object tool is Tool',
    'object w1 is Weight',
    'object w2 is Weight',
    'object butler is Butler',
  ],
  places: [
    'object yard is sprout.Place {',
    '  grammar { exit south "back to the shop" -> shop }',
    '}',
    'object vault is Vault',
  ],
  declarations: [
    'enum Topic { bridge, toll, weather }',
    'verb nod { role target  "nod at [target]" }',
    'verb fetch { "fetch" }',
    'verb pry { "pry" }',
    'verb burn { "burn" }',
    'verb dial { role target  role number: integer  "turn [target] to [number]" }',
    'verb order {',
    '  role target  role tool  role weights many',
    '  "order [target] with [tool] using [weights]"  "order [target] using [weights]"  "order [target]"',
    '}',
    '',
    '// A vault is shut until a case opens it.',
    'kind Vault is sprout.Place {',
    '  :shut true',
    '  accept (item, from) { if (self.get(:shut)) { refuse "The vault is shut." } }',
    '}',
    '// Acts for others: fetches the book, and pries the chest with a key it does not carry.',
    'kind Butler is sprout.Actor {',
    '  as actor for fetch { do { act take (target: book) } }',
    '  as actor for pry { do { if (chest.is(Chest)) { act unlock (target: chest, tool: brass_key) } } }',
    '}',
    'kind Fuse is sprout.Actor { as actor for burn { do { say "Fzzt."  destroy self } } }',
    'kind Guard {',
    '  :knows [Topic] default [bridge, toll]',
    '  as target for ask {',
    '    topic from :knows',
    '    do { if (bound topic) { say "bound" } else { say "unbound" } }',
    '  }',
    '}',
    'kind Dial {',
    '  as target for dial { number from 1 to 12  do { if (bound number) { say "bound" } else { say "unbound" } } }',
    '}',
    'kind Safe {',
    '  :combo 0 min 0 max 99',
    '  as target for dial { number from :combo  do { if (bound number) { say "bound" } else { say "unbound" } } }',
    '}',
    'kind First  { :a false  as target for order { permit { if (self.get(:a)) { refuse "First balks." } }  do { say "first" } } }',
    'kind Second { :b false  as target for order { permit { if (self.get(:b)) { refuse "Second balks." } } do { say "second" } } }',
    'kind Both is First, Second { :c false  as target for order { permit { if (self.get(:c)) { refuse "Both balks." } }  do { say "both" } } }',
    'kind Tool { :t false  as tool for order { permit { if (self.get(:t)) { refuse "The tool balks." } } do { say "tool" } } }',
    'kind Weight { as weights for order { do { say "weight" } } }',
  ],
};

/** A path under the shop. */
const shop = (...path: string[]): Who => ['shop', ...path];

const SHOP = shop();
const MARTA = 'marta';
const object = (who: Who): Fill => ({ object: who });
const on = (target: Who, tool?: Who): Record<string, Fill> =>
  tool === undefined ? { target: object(target) } : { target: object(target), tool: object(tool) };

export const CARRIED: readonly ReadingCase[] = [
  {
    name: 'a carried tool the actor does not carry is refused in the world’s not_carrying, before any permit',
    area: 'carried',
    actor: MARTA,
    verb: 'sprout.unlock',
    fills: on(shop('chest'), shop('brass_key')),
  },
  {
    name: 'a carried tool in the hand goes through to the participants’ permits',
    area: 'carried',
    actor: MARTA,
    verb: 'sprout.unlock',
    fills: on(shop('chest'), shop('brass_key')),
    state: 'key-held',
  },
  {
    name: 'a carried tool in an open pouch passes, and sprout.RequiresHeld then speaks',
    area: 'carried',
    actor: MARTA,
    verb: 'sprout.unlock',
    fills: on(shop('chest'), shop('brass_key')),
    state: 'pouch',
  },
  {
    name: 'a book in an open pouch props the shelf, which says so',
    area: 'carried',
    actor: MARTA,
    verb: 'bench.prop',
    fills: on(shop('shelf'), shop('book')),
    state: 'pouch',
  },
  {
    name: 'an NPC’s act is held to the same rule, in the same words',
    area: 'carried',
    actor: shop('cat'),
    verb: 'sprout.unlock',
    fills: on(shop('chest'), shop('brass_key')),
  },
  {
    name: 'an NPC that carries the tool goes through to the permits',
    area: 'carried',
    actor: shop('cat'),
    verb: 'sprout.unlock',
    fills: on(shop('chest'), shop('brass_key')),
    state: 'cat-key',
  },
  {
    name: 'a role that is not carried is not asked: the pouch on the floor takes the book',
    area: 'carried',
    actor: MARTA,
    verb: 'sprout.put',
    fills: { item: object(shop('book')), container: object(shop('pouch')) },
    state: 'book-held',
  },
];

const prop = (state: string, name: string): ReadingCase => ({
  name,
  area: 'wildcards',
  actor: MARTA,
  verb: 'bench.prop',
  fills: on(shop('shelf'), shop('gauge')),
  state,
});

export const WILDCARDS: readonly ReadingCase[] = [
  prop('gauge-stuck-bent', 'a participant’s wildcard permit runs before its permit for the verb'),
  prop('gauge-bent', 'a participant’s own permit for the verb runs once its wildcard allows'),
  prop('gauge', 'a gauge that is neither stuck nor bent lets the shelf say its piece'),
  prop(
    'gauge-stuck-wobbly',
    'the order across participants is unchanged: the target refuses before its tool',
  ),
  {
    name: 'a wildcard for the target plays the first role whatever the verb calls it',
    area: 'wildcards',
    actor: MARTA,
    verb: 'sprout.take',
    fills: on(shop('shelf')),
    state: 'gauge-stuck-wobbly',
  },
  {
    name: 'a wildcard for a tool is never played for a target: dropping the stuck gauge is untouched',
    area: 'wildcards',
    actor: MARTA,
    verb: 'sprout.drop',
    fills: on(shop('gauge')),
    state: 'gauge-stuck-wobbly',
  },
  {
    name: 'taking up a key that must be held is untouched, since a key is only a tool',
    area: 'wildcards',
    actor: MARTA,
    verb: 'sprout.take',
    fills: on(shop('brass_key')),
  },
];

export const ENGINE: readonly ReadingCase[] = [
  {
    name: 'take a book from the floor',
    area: 'engine',
    actor: MARTA,
    verb: 'sprout.take',
    fills: on(shop('book')),
  },
  {
    name: 'take what is already held is refused by the actor’s own permit',
    area: 'engine',
    actor: MARTA,
    verb: 'sprout.take',
    fills: on(shop('book')),
    state: 'book-held',
  },
  {
    name: 'take a thing in a shut chest is out of the actor’s range',
    area: 'engine',
    actor: MARTA,
    verb: 'sprout.take',
    fills: on(shop('book')),
    state: 'book-in-chest',
  },
  {
    name: 'drop what is held',
    area: 'engine',
    actor: MARTA,
    verb: 'sprout.drop',
    fills: on(shop('book')),
    state: 'book-held',
  },
  {
    name: 'drop what is not held is refused',
    area: 'engine',
    actor: MARTA,
    verb: 'sprout.drop',
    fills: on(shop('book')),
  },
  {
    name: 'put into a shut satchel is refused by the satchel’s accept',
    area: 'engine',
    actor: MARTA,
    verb: 'sprout.put',
    fills: { item: object(shop('book')), container: object(shop('satchel')) },
    state: 'book-held',
  },
  {
    name: 'give a held book to the cat',
    area: 'engine',
    actor: MARTA,
    verb: 'sprout.give',
    fills: { item: object(shop('book')), recipient: object(shop('cat')) },
    state: 'book-held',
  },
  {
    name: 'unlock a chest with a key in the hand',
    area: 'engine',
    actor: MARTA,
    verb: 'sprout.unlock',
    fills: on(shop('chest'), shop('brass_key')),
    state: 'key-held',
    seed: 3,
  },
  {
    name: 'unlock what is already unlocked is refused',
    area: 'engine',
    actor: MARTA,
    verb: 'sprout.unlock',
    fills: on(shop('chest'), shop('brass_key')),
    state: 'key-held-unlocked',
  },
  {
    name: 'open a locked chest is refused by its lock',
    area: 'engine',
    actor: MARTA,
    verb: 'sprout.open',
    fills: on(shop('chest')),
  },
  {
    name: 'open an unlocked chest',
    area: 'engine',
    actor: MARTA,
    verb: 'sprout.open',
    fills: on(shop('chest')),
    state: 'unlocked',
  },
  {
    name: 'examine a thing, which the engine answers',
    area: 'engine',
    actor: MARTA,
    verb: 'sprout.examine',
    fills: on(shop('book')),
  },
  { name: 'look, which the engine answers', area: 'engine', actor: MARTA, verb: 'sprout.look' },
  {
    name: 'inventory, which the engine answers',
    area: 'engine',
    actor: MARTA,
    verb: 'sprout.inventory',
  },
  { name: 'wait, which the engine answers', area: 'engine', actor: MARTA, verb: 'sprout.wait' },
  { name: 'help, which the engine answers', area: 'engine', actor: MARTA, verb: 'sprout.help' },
  {
    name: 'a command no participant answers is answered by the world',
    area: 'engine',
    actor: MARTA,
    verb: 'bench.nod',
    fills: on(shop('book')),
  },
  {
    name: 'an NPC whose command nobody answers is not answered',
    area: 'engine',
    actor: shop('cat'),
    verb: 'bench.nod',
    fills: on(shop('book')),
  },
];

const go = (direction: string | null, label: string, to: Who): Record<string, Fill> => ({
  way: { exit: { direction, label, to } },
});

export const GO: readonly ReadingCase[] = [
  {
    name: 'go through an exit',
    area: 'go',
    actor: MARTA,
    verb: 'sprout.go',
    fills: go('north', 'to the yard', ['yard']),
  },
  {
    name: 'go through an exit to a place whose accept refuses',
    area: 'go',
    actor: MARTA,
    verb: 'sprout.go',
    fills: go('east', 'into the vault', ['vault']),
  },
  {
    name: 'go through an exit that says something as it is taken',
    area: 'go',
    actor: MARTA,
    verb: 'sprout.go',
    fills: go('east', 'into the vault', ['vault']),
    state: 'vault-open',
  },
  {
    name: 'go through a link',
    area: 'go',
    actor: MARTA,
    verb: 'sprout.go',
    fills: go(null, 'onward', ['yard']),
    state: 'linked',
  },
  {
    name: 'go through an exit to a place where another visitor stands, who reads the arrival',
    area: 'go',
    actor: MARTA,
    verb: 'sprout.go',
    fills: go('north', 'to the yard', ['yard']),
    state: 'ines-in-yard',
  },
  {
    name: 'go through an exit from a shop where another visitor stands, who reads the leaving',
    area: 'go',
    actor: MARTA,
    verb: 'sprout.go',
    fills: go('north', 'to the yard', ['yard']),
    state: 'ines-in-shop',
  },
  {
    name: 'go back from the yard, among the people of the shop',
    area: 'go',
    actor: MARTA,
    verb: 'sprout.go',
    fills: go('south', 'back to the shop', SHOP),
    state: 'in-yard',
  },
];

export const VALUES: readonly ReadingCase[] = [
  {
    name: 'a symbol the role-player’s list property holds is bound',
    area: 'values',
    actor: MARTA,
    verb: 'sprout.ask',
    fills: { target: object(shop('guard')), topic: { value: 'bridge' } },
  },
  {
    name: 'a symbol the list property does not hold is not bound',
    area: 'values',
    actor: MARTA,
    verb: 'sprout.ask',
    fills: { target: object(shop('guard')), topic: { value: 'weather' } },
  },
  {
    name: 'a number inside the range a play writes out is bound',
    area: 'values',
    actor: MARTA,
    verb: 'bench.dial',
    fills: { target: object(shop('dial')), number: { value: 5 } },
  },
  {
    name: 'a number outside the range a play writes out is not bound',
    area: 'values',
    actor: MARTA,
    verb: 'bench.dial',
    fills: { target: object(shop('dial')), number: { value: 50 } },
  },
  {
    name: 'a number inside the range of the integer property a play names is bound',
    area: 'values',
    actor: MARTA,
    verb: 'bench.dial',
    fills: { target: object(shop('safe')), number: { value: 42 } },
  },
];

const order = (state: string, name: string, tool = true, weights = true): ReadingCase => ({
  name,
  area: 'composition',
  actor: MARTA,
  verb: 'bench.order',
  fills: {
    target: object(shop('both')),
    ...(tool ? { tool: object(shop('tool')) } : {}),
    ...(weights ? { weights: { set: [shop('w1'), shop('w2')] } } : {}),
  },
  state,
});

export const COMPOSITION: readonly ReadingCase[] = [
  order(
    'fresh',
    'every part plays: the target’s composed kinds, its tool, then the weights of a set role',
  ),
  order('first-balks', 'the first composed kind refuses before the composer’s own play'),
  order('both-balks', 'the composer’s own permit refuses after those it composes'),
  order('tool-balks', 'the tool refuses after the target'),
  order(
    'fresh',
    'a tool and a set left out are not participants, and the set is the empty set',
    false,
    false,
  ),
];

export const ACTING: readonly ReadingCase[] = [
  {
    name: 'an NPC acts a reading, heard from it by whoever would hear its tell',
    area: 'acting',
    actor: shop('butler'),
    verb: 'bench.fetch',
  },
  {
    name: 'an NPC’s act the consent pass refuses is said to whoever would hear it',
    area: 'acting',
    actor: shop('butler'),
    verb: 'bench.pry',
  },
  {
    name: 'an actor that destroys itself in its own do is gone',
    area: 'acting',
    actor: 'fuse',
    state: 'fuse',
    verb: 'bench.burn',
  },
];

export const READINGS: readonly ReadingCase[] = [
  ...CARRIED,
  ...WILDCARDS,
  ...ENGINE,
  ...GO,
  ...VALUES,
  ...COMPOSITION,
  ...ACTING,
];

/** The writes that make each state from a world with Marta standing in the shop. */
export type Write =
  | { readonly place: readonly [Who, Who] }
  | { readonly set: readonly [Who, Readonly<Record<string, string | number | boolean>>] }
  | { readonly link: readonly [Who, string, Who] }
  | { readonly visitor: readonly [string, string, Who] }
  | { readonly spawn: readonly [string, Who] };

export const STATES: Readonly<Record<string, readonly Write[]>> = {
  fresh: [],
  'key-held': [{ place: [shop('brass_key'), MARTA] }],
  'key-held-unlocked': [
    { place: [shop('brass_key'), MARTA] },
    { set: [shop('chest'), { locked: false }] },
  ],
  unlocked: [{ set: [shop('chest'), { locked: false }] }],
  pouch: [
    { place: [shop('pouch'), MARTA] },
    { place: [shop('brass_key'), shop('pouch')] },
    { place: [shop('book'), shop('pouch')] },
  ],
  'cat-key': [{ place: [shop('brass_key'), shop('cat')] }],
  'book-held': [{ place: [shop('book'), MARTA] }],
  'book-in-chest': [{ place: [shop('book'), shop('chest')] }],
  gauge: [{ place: [shop('gauge'), MARTA] }],
  'gauge-bent': [{ place: [shop('gauge'), MARTA] }, { set: [shop('gauge'), { bent: true }] }],
  'gauge-stuck-bent': [
    { place: [shop('gauge'), MARTA] },
    { set: [shop('gauge'), { stuck: true, bent: true }] },
  ],
  'gauge-stuck-wobbly': [
    { place: [shop('gauge'), MARTA] },
    { set: [shop('gauge'), { stuck: true }] },
    { set: [shop('shelf'), { wobbly: true }] },
  ],
  'vault-open': [{ set: [['vault'], { shut: false }] }],
  linked: [{ link: [SHOP, 'onward', ['yard']] }],
  'in-yard': [{ place: [MARTA, ['yard']] }],
  'ines-in-yard': [{ visitor: ['visit-2', 'Ines', ['yard']] }],
  'ines-in-shop': [{ visitor: ['visit-2', 'Ines', shop()] }],
  fuse: [{ spawn: ['bench.Fuse', shop()] }],
  'first-balks': [{ set: [shop('both'), { a: true, c: true }] }],
  'both-balks': [{ set: [shop('both'), { c: true }] }],
  'tool-balks': [{ set: [shop('tool'), { t: true }] }],
};

/** One way of a place a golden asks after. */
export interface WaysCase {
  readonly name: string;
  readonly state: string;
  readonly place: Who;
}

export const WAYS: readonly WaysCase[] = [
  { name: 'the ways out of the shop, a refusing exit among them', state: 'fresh', place: SHOP },
  { name: 'the ways out of the shop once a link is connected', state: 'linked', place: SHOP },
  { name: 'the ways out of the yard', state: 'fresh', place: ['yard'] },
  { name: 'a place with no ways out', state: 'fresh', place: ['vault'] },
];

/** What taking a way says: the way by its label. */
export interface SayingCase {
  readonly name: string;
  readonly state: string;
  readonly place: Who;
  readonly label: string;
}

export const SAYINGS: readonly SayingCase[] = [
  { name: 'an exit that says something', state: 'fresh', place: SHOP, label: 'into the vault' },
  { name: 'an exit that says nothing', state: 'fresh', place: SHOP, label: 'to the yard' },
];

/** An intent read from a line, and the steps it plans. */
export interface IntentCase {
  readonly name: string;
  readonly state: string;
  readonly intent: string;
  readonly actor: Who;
  /** The thing that fills each slot. */
  readonly slots: Readonly<Record<string, Who>>;
}

export const INTENTS: readonly IntentCase[] = [
  {
    name: 'each step of open_with is planned, its roles filled from the slots',
    state: 'key-held',
    intent: 'sprout.open_with',
    actor: MARTA,
    slots: { y: shop('chest'), x: shop('brass_key') },
  },
  {
    name: 'a step whose when is false in the world the line was typed into is left out',
    state: 'key-held-unlocked',
    intent: 'sprout.open_with',
    actor: MARTA,
    slots: { y: shop('chest'), x: shop('brass_key') },
  },
  {
    name: 'a step whose role the slot’s thing does not fit is left out without reading its when',
    state: 'key-held',
    intent: 'sprout.open_with',
    actor: MARTA,
    slots: { y: shop('pouch'), x: shop('brass_key') },
  },
];
