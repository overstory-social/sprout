// A `move` in a `do`: the messages and notices it hands on, a guard's
// refusal and the engine's own said to the actor while the body goes on,
// the order a body's effects keep, and the fault the compiler could not
// foresee. The depot below is this file's own world.

import { describe, expect, it } from 'vitest';

import { compiledWorld } from '../../fixtures/bundle.js';
import { boundObject } from '../evaluate.js';
import { declaredId, type InstanceId } from '../ids.js';
import { MoveFault } from '../move.js';
import { runReading, type Bound } from '../reading.js';
import {
  acted,
  contextOf,
  lines,
  NOTHING,
  reading,
  turn,
  words,
  type Turn,
} from '../../fixtures/reading.js';

/**
 * A depot whose things move in their `do`s. The walker boards a cart by
 * moving itself; the cart grabs the actor, which `sprout.Actor`'s
 * `depart` refuses since the mover is the cart, and folds into itself,
 * which the engine refuses; the crate packs a new sheet into the actor's
 * hands, and scraps itself after moving to where the actor stands; a
 * pin moves itself into whatever it pins, which holds nothing.
 */
const DEPOT = compiledWorld('depot', {
  'world.sprout': [
    'world depot is sprout.World { contains visitors are Walker visitors arrive at yard',
    '  object yard is sprout.Place {',
    '    object cart is Cart',
    '    object crate is Crate',
    '    object pin is Pin',
    '    object plain is Plain',
    '    object cat is Walker',
    '  }',
    '}',
    'verb board { role target  "board [target]" }',
    'verb grab  { role target  "grab at [target]" }',
    'verb fold  { role target  "fold [target]" }',
    'verb pack  { role target  "pack [target]" }',
    'verb scrap { role target  "scrap [target]" }',
    'verb fix   { role target  role tool  "fix [target] with [tool]" }',
    'kind Walker is sprout.Actor { as actor for board { do { move self to target } } }',
    'kind Cart is sprout.Place {',
    '  as target for grab { do { move actor to self  say "after" } }',
    '  as target for fold { do { move self to self } }',
    '}',
    'kind Sheet { }',
    'kind Plain { }',
    'kind Crate {',
    '  contains',
    '  as target for pack  { do { let sheet = spawn Sheet in self  move sheet to actor  say "packed" } }',
    '  as target for scrap { do { move self to here  destroy self } }',
    '}',
    'kind Pin { as tool for fix { do { move self to target } } }',
    '',
  ].join('\n'),
});

describe('a `move` in a `do`', () => {
  const at = (...path: string[]): InstanceId => declaredId('depot', path);
  const YARD_ID = at();
  const [CART, CRATE, PIN, PLAIN, CAT_ID] = ['cart', 'crate', 'pin', 'plain', 'cat'].map((name) =>
    at('yard', name),
  );
  const run = (one: Turn, verb: string, actor: InstanceId, bindings: Record<string, Bound>) =>
    acted(runReading(reading(DEPOT, verb, actor, bindings), contextOf(one)));

  it('moves, and hands on the three messages and what the places speak', () => {
    const one = turn(DEPOT, [at('yard')]);
    const [visitor] = one.people;
    const done = run(one, 'board', visitor!, { target: { object: CART! } });
    expect(one.draft.instance(visitor!)!.container).toBe(CART);
    expect(done.sends.slice(0, 3)).toEqual([
      { message: 'left', recipient: at('yard'), item: visitor, to: CART },
      { message: 'entered', recipient: CART, item: visitor, from: at('yard') },
      { message: 'moved', recipient: visitor, from: at('yard'), to: CART },
    ]);
    // The cat, an NPC, is sent the places' messages and reads neither notice.
    const toCat = done.sends.filter((send) => send.recipient === CAT_ID);
    expect(toCat.map((send) => send.message)).toEqual(['departed', 'arrived']);
    expect(done.notices.map((notice) => [notice.notice, notice.place, notice.audience])).toEqual([
      ['leaves', at('yard'), []],
      ['arrives', CART, []],
      ['described', CART, [visitor]],
    ]);
    // Nothing was said, so the world answers.
    expect(lines(done)).toEqual([[YARD_ID, NOTHING]]);
  });

  it('says a guard’s refusal to the actor, from the refusing party, and the body goes on', () => {
    const one = turn(DEPOT, [at('yard')]);
    const [visitor] = one.people;
    const done = run(one, 'grab', visitor!, { target: { object: CART! } });
    expect(one.draft.instance(visitor!)!.container).toBe(at('yard'));
    expect(done.said.map((line) => [line.effect, line.by, words(line.said)])).toEqual([
      ['refused', visitor, 'sprout.Actor held_fast: {self} is not something you can carry off.'],
      ['said', CART, 'after'],
    ]);
    // The mover is the object whose body ran the `move`, not the actor.
    expect(done.said[0]!.bindings).toEqual(
      new Map([
        ['mover', boundObject(CART!)],
        ['to', boundObject(CART!)],
      ]),
    );
    expect(done.said[0]!.to).toEqual([visitor]);
    expect(done.sends).toEqual([]);
  });

  it('says the engine’s own refusal from the world, and counts it as said to the actor', () => {
    const one = turn(DEPOT, [at('yard')]);
    const [visitor] = one.people;
    const done = run(one, 'fold', visitor!, { target: { object: CART! } });
    const world = one.draft.instance(YARD_ID)!.kind;
    expect(done.said).toEqual([
      {
        effect: 'refused',
        to: [visitor],
        by: YARD_ID,
        speaker: null,
        said: { passage: world.passages.get('inside_itself') },
        bindings: new Map([['item', boundObject(CART!)]]),
      },
    ]);
  });

  it('keeps what a body spawns, moves and says in the order it did them', () => {
    const one = turn(DEPOT, [at('yard')]);
    const [visitor] = one.people;
    const done = run(one, 'pack', visitor!, { target: { object: CRATE! } });
    const sheet = done.sends[1]!.recipient;
    expect(done.sends.map((send) => [send.message, send.recipient])).toEqual([
      ['entered', CRATE],
      ['spawned', sheet],
      ['left', CRATE],
      ['entered', visitor],
      ['moved', sheet],
    ]);
    expect(one.draft.children(visitor!)).toEqual([sheet]);
    expect(lines(done)).toEqual([[CRATE, 'packed']]);
  });

  it('moves `self` before a `destroy self` in the same body takes effect at its end', () => {
    const one = turn(DEPOT, [at('yard')]);
    const [visitor] = one.people;
    const done = run(one, 'scrap', visitor!, { target: { object: CRATE! } });
    expect(done.destroyed).toEqual([CRATE]);
    expect(done.sends.map((send) => send.message)).toEqual(['left', 'entered', 'moved']);
    expect(one.draft.destroyed(CRATE!)!.container).toBe(at('yard'));
  });

  it('faults where the destination holds nothing, which the compiler could not tell', () => {
    const one = turn(DEPOT, [at('yard')]);
    const [visitor] = one.people;
    const bindings = { target: { object: PLAIN! }, tool: { object: PIN! } };
    expect(() => run(one, 'fix', visitor!, bindings)).toThrow(MoveFault);
  });

  it('says an NPC’s refused move to whoever would hear its `tell`, from it', () => {
    const one = turn(DEPOT, [at('yard')]);
    const [marta] = one.people;
    const done = run(one, 'grab', CAT_ID!, { target: { object: CART! } });
    expect(done.said[0]).toMatchObject({
      effect: 'refused',
      by: CAT_ID,
      to: [marta],
      speaker: CAT_ID,
    });
  });
});
