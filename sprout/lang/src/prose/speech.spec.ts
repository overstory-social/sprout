import { describe, expect, it } from 'vitest';

import { DEFAULT_LIMITS } from '../bundle/limits.js';
import { BudgetExhausted } from '../runtime/budget.js';
import { engineLine } from '../runtime/engine-lines.js';
import { parseProse } from '../syntax/parse.js';
import { Diagnostics } from '../source/diagnostics.js';
import { SourceFile } from '../source/source.js';
import {
  boundObject,
  BRASS_KEY,
  CRATE,
  OAK_DOOR,
  passageFor,
  PRESS,
  proseTurn,
  YARD,
} from '../fixtures/prose.js';
import type { InstanceId } from '../runtime/ids.js';
import { renderFor } from './speech.js';

/** Words in quotes, as a `say` gives them. */
function quoted(text: string) {
  return {
    text,
    prose: parseProse(new SourceFile('q.sprout', text), new Diagnostics()),
    library: 'mill',
  };
}

describe('a line said is rendered for each reader', () => {
  it('renders a passage as the speaker’s kind has it, with the names in scope where it was said', () => {
    const turn = proseTurn();
    expect(
      passageFor(turn, PRESS, 'inked', turn.marta, {
        actor: boundObject(turn.marta),
        tools: { binds: 'set', ids: [BRASS_KEY] },
      }),
    ).toEqual(['You inks a press with a brass key.']);
  });

  it('renders words in quotes as a one-line passage, capitalised, and differently to each reader', () => {
    const turn = proseTurn();
    const line = {
      by: PRESS,
      said: quoted('{actor} leans on {self}. \\{brace}'),
      bindings: new Map([['actor', boundObject(turn.marta)]]),
    };
    // The verb's agreement is the author's: the line is written for bystanders.
    expect(renderFor(line, turn.marta, turn.context)).toEqual(['You leans on a press. {brace}']);
    expect(renderFor(line, BRASS_KEY, turn.context)).toEqual(['Marta leans on a press. {brace}']);
    expect(renderFor(line, PRESS, turn.context)).toEqual(['Marta leans on you. {brace}']);
  });

  it('renders the engine’s fixed words with what it binds', () => {
    const turn = proseTurn();
    const line = {
      by: YARD,
      said: engineLine('{item} cannot stand in {to}.'),
      bindings: new Map([
        ['item', boundObject(turn.marta)],
        ['to', boundObject(CRATE)],
      ]),
    };
    expect(renderFor(line, turn.marta, turn.context)).toEqual(['You cannot stand in the crate.']);
  });

  it('sees into the actor’s hands in a refusal’s words, and nowhere else', () => {
    const turn = proseTurn();
    turn.draft.place(BRASS_KEY, turn.marta);
    // An actor passes nothing, so only open hands let the yard see the key.
    const context = {
      ...turn.context,
      passes: (container: string) => container !== turn.marta && container !== turn.draft.world,
    };
    const line = {
      by: YARD,
      said: quoted('{actor} holds {actor.count}.'),
      bindings: new Map([['actor', boundObject(turn.marta)]]),
    };
    expect(renderFor({ ...line, effect: 'refused' as const }, turn.marta, context)).toEqual([
      'You holds 1.',
    ]);
    expect(renderFor({ ...line, effect: 'said' as const }, turn.marta, context)).toEqual([
      'You holds 0.',
    ]);
    expect(renderFor(line, turn.marta, context)).toEqual(['You holds 0.']);
  });

  it('opens only the hands, so a shut container in them stays shut', () => {
    const turn = proseTurn();
    turn.draft.place(CRATE, turn.marta);
    const line = {
      by: YARD,
      said: quoted('The crate holds {crate.count}.'),
      bindings: new Map([
        ['actor', boundObject(turn.marta)],
        ['crate', boundObject(CRATE)],
      ]),
      effect: 'refused' as const,
    };
    const shut = (lid: boolean) => ({
      ...turn.context,
      passes: (container: string) =>
        container !== turn.marta && container !== turn.draft.world && (lid || container !== CRATE),
    });
    expect(renderFor(line, turn.marta, shut(false))).toEqual(['The crate holds 0.']);
    expect(renderFor(line, turn.marta, shut(true))).toEqual(['The crate holds 3.']);
  });

  it('opens a guard’s mover’s hands where it binds no actor, and no hands but a visitor’s', () => {
    const turn = proseTurn();
    turn.draft.place(BRASS_KEY, turn.marta);
    turn.draft.place(OAK_DOOR, PRESS);
    const context = {
      ...turn.context,
      passes: (container: string) =>
        container !== turn.marta && container !== PRESS && container !== turn.draft.world,
    };
    const refused = (name: string, who: InstanceId) => ({
      by: YARD,
      said: quoted(`{${name}.count}.`),
      bindings: new Map([[name, boundObject(who)]]),
      effect: 'refused' as const,
    });
    expect(renderFor(refused('mover', turn.marta), turn.marta, context)).toEqual(['1.']);
    expect(renderFor(refused('actor', PRESS), turn.marta, context)).toEqual(['0.']);
    expect(renderFor(refused('mover', PRESS), turn.marta, context)).toEqual(['0.']);
  });

  it('renders nothing of a passage that is absent', () => {
    const turn = proseTurn();
    const line = { by: PRESS, said: { absent: 'gone' }, bindings: new Map() };
    expect(renderFor(line, turn.marta, turn.context)).toEqual([]);
    expect(turn.context.budget.spentOutput(turn.marta)).toBe(0);
  });
});

describe('what is rendered is charged to its reader', () => {
  it('counts the characters each reader is told, apart from every other reader', () => {
    const turn = proseTurn();
    const line = { by: PRESS, said: quoted('Clunk.'), bindings: new Map() };
    renderFor(line, turn.marta, turn.context);
    renderFor(line, turn.marta, turn.context);
    renderFor(line, BRASS_KEY, turn.context);
    expect(turn.context.budget.spentOutput(turn.marta)).toBe(12);
    expect(turn.context.budget.spentOutput(BRASS_KEY)).toBe(6);
  });

  it('faults a turn that tells one reader more than the host allows', () => {
    const turn = proseTurn({ ...DEFAULT_LIMITS.budgets, output: 10 });
    const line = { by: PRESS, said: quoted('Clunk.'), bindings: new Map() };
    renderFor(line, turn.marta, turn.context);
    expect(() => renderFor(line, turn.marta, turn.context)).toThrow(BudgetExhausted);
    expect(() => renderFor(line, BRASS_KEY, turn.context)).not.toThrow();
  });

  it('renders nothing for anyone but the actor it would take past their output, and never faults', () => {
    // The brass key stands in for someone else in the place.
    const turn = proseTurn({ ...DEFAULT_LIMITS.budgets, output: 10 });
    const clunk = { by: PRESS, said: quoted('Clunk.'), bindings: new Map() };
    const thud = { by: PRESS, said: quoted('Thud.'), bindings: new Map() };
    expect(renderFor(clunk, BRASS_KEY, turn.context)).toEqual(['Clunk.']);
    expect(renderFor(clunk, BRASS_KEY, turn.context)).toEqual([]);
    // Cut short: nothing more that turn, though this would have fitted.
    expect(renderFor(thud, BRASS_KEY, turn.context)).toEqual([]);
    expect(turn.context.budget.spentOutput(BRASS_KEY)).toBe(6);
    expect(renderFor(clunk, turn.marta, turn.context)).toEqual(['Clunk.']);
  });

  it('runs a named passage one passage deep, and comes back up however it ends', () => {
    const turn = proseTurn({ ...DEFAULT_LIMITS.budgets, passageDepth: 1 });
    expect(passageFor(turn, PRESS, 'mood', turn.marta)).toHaveLength(1);
    expect(() => passageFor(turn, CRATE, 'listing', turn.marta)).toThrow(BudgetExhausted);
    expect(turn.context.budget.passageDepth).toBe(0);
  });
});
